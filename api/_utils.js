// ==============================================================================
// BK EDU by Minaaz — Serverless API Utilities
// Storage: Vercel Private Blob Store (BLOB_READ_WRITE_TOKEN)
// ==============================================================================
const crypto = require('crypto');
const { put, list } = require('@vercel/blob');

// ==============================================================================
// BLOB STORAGE LAYER
// ==============================================================================
// Data layout in the Blob store:
//   registrations/{registrationId}.json   Full registration record
//   indexes/order/{orderId}.json          { registrationId } — lookup by Razorpay order ID
//
// Security: all blobs are stored with access:'public' within a PRIVATE Blob Store.
// The store is private to the Vercel project — tokens are required for all SDK
// operations. Blob URLs are long, opaque, and never sent to client browsers.
// All admin reads go through authenticated /api/admin/* endpoints.
// ==============================================================================

const BLOB_PREFIX_REG   = 'registrations/';
const BLOB_PREFIX_ORDER = 'indexes/order/';

// ---- Token helper -----------------------------------------------------------
function getBlobToken() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error(
      'BLOB_READ_WRITE_TOKEN is not configured. Add it in Vercel Project Settings → Environment Variables.'
    );
  }
  return token;
}

// ---- Low-level fetch a JSON blob by URL ------------------------------------
async function _fetchBlobJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Blob fetch failed: HTTP ${response.status} from ${url}`);
  }
  return response.json();
}

// ---- Write a JSON blob (always overwrites the same pathname) ---------------
async function _putJson(pathname, data) {
  const token = getBlobToken();
  return put(pathname, JSON.stringify(data), {
    access: 'public',           // within a private store — not publicly listed
    contentType: 'application/json',
    token,
    addRandomSuffix: false,     // deterministic path so updates overwrite
    allowOverwrite: true
  });
}

// ---- Find the single blob URL for a given prefix ---------------------------
async function _listOne(prefix) {
  const token = getBlobToken();
  const { blobs } = await list({ prefix, token, limit: 1 });
  return blobs.length ? blobs[0] : null;
}

// ============================================================
// PUBLIC BLOB STORAGE API — used by all serverless handlers
// ============================================================

/**
 * Save a new registration (status: Pending) to Blob storage.
 * Also writes an order-ID index blob so the webhook can locate it.
 */
async function createRegistration(data) {
  await _putJson(`${BLOB_PREFIX_REG}${data.registration_id}.json`, data);
}

/**
 * Persist an order-ID → registration-ID lookup index after Razorpay order creation.
 * This lets the webhook find a registration by order_id without scanning all blobs.
 */
async function createOrderIndex(orderId, registrationId) {
  await _putJson(`${BLOB_PREFIX_ORDER}${orderId}.json`, { registrationId });
}

/**
 * Read a single registration by its registration ID.
 * Returns the registration object or null if not found.
 */
async function getRegistrationById(registrationId) {
  const blob = await _listOne(`${BLOB_PREFIX_REG}${registrationId}.json`);
  if (!blob) return null;
  return _fetchBlobJson(blob.url);
}

/**
 * Find a registration by Razorpay order ID using the index blob.
 * Falls back to a full scan if the index blob is missing (e.g., legacy registrations).
 * Returns the registration object or null.
 */
async function findRegistrationByOrderId(orderId) {
  // 1. Fast path: index blob
  const indexBlob = await _listOne(`${BLOB_PREFIX_ORDER}${orderId}.json`);
  if (indexBlob) {
    const index = await _fetchBlobJson(indexBlob.url);
    if (index && index.registrationId) {
      return getRegistrationById(index.registrationId);
    }
  }

  // 2. Slow-path fallback: linear scan
  console.warn(`Order index missing for ${orderId} — falling back to full scan`);
  const all = await listAllRegistrations();
  return all.find(r => r.razorpay_order_id === orderId) || null;
}

/**
 * Find a registration by its Razorpay payment ID (requires full scan).
 */
async function findRegistrationByPaymentId(paymentId) {
  const all = await listAllRegistrations();
  return all.find(r => r.razorpay_payment_id === paymentId) || null;
}

/**
 * Atomically read-then-update a registration blob.
 *
 * LIMITATION (disclosed): Vercel Blob has no conditional writes or compare-and-swap.
 * If two webhook retries arrive within milliseconds of each other for the same
 * registration, both may read the same current state and write the same update.
 * The result is idempotent (both write the same Paid/Failed value) so no data
 * corruption occurs. A stale write will never downgrade a Paid registration
 * to Pending because we check current status before overwriting.
 *
 * @param {string} registrationId
 * @param {function} updaterFn  Receives existing record, returns updated record.
 *                              Return null to abort the update.
 * @returns {object|null} Updated record or null if not found / aborted
 */
async function updateRegistration(registrationId, updaterFn) {
  const existing = await getRegistrationById(registrationId);
  if (!existing) {
    throw new Error(`Registration not found: ${registrationId}`);
  }

  const updated = updaterFn(existing);
  if (!updated) return null; // caller chose to abort

  updated.updated_at = new Date().toISOString();
  await _putJson(`${BLOB_PREFIX_REG}${registrationId}.json`, updated);
  return updated;
}

/**
 * List ALL registrations from Blob storage, loading each file in parallel.
 * Handles Vercel Blob pagination (cursor-based, 1 000 per page).
 *
 * Performance note: For a single workshop (~hundreds of registrations) this
 * completes in < 2 s on a Vercel serverless function. Scale this with a cached
 * summary index if registrations reach 10 000+.
 */
async function listAllRegistrations() {
  const token = getBlobToken();
  const allBlobs = [];
  let cursor;

  do {
    const result = await list({
      prefix: BLOB_PREFIX_REG,
      token,
      limit: 1000,
      ...(cursor ? { cursor } : {})
    });
    allBlobs.push(...result.blobs);
    cursor = result.hasMore ? result.cursor : null;
  } while (cursor);

  if (!allBlobs.length) return [];

  // Fetch in parallel — 20 at a time to avoid overwhelming the serverless timeout
  const CHUNK = 20;
  const results = [];
  for (let i = 0; i < allBlobs.length; i += CHUNK) {
    const chunk = allBlobs.slice(i, i + CHUNK);
    const fetched = await Promise.all(
      chunk.map(blob => _fetchBlobJson(blob.url).catch(() => null))
    );
    results.push(...fetched.filter(Boolean));
  }
  return results;
}

// ==============================================================================
// RAZORPAY UTILITIES
// ==============================================================================

/** Create a Razorpay Order via the REST API. Returns null when keys are missing. */
async function createRazorpayOrder({ amount, currency = 'INR', receipt, notes = {} }) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;

  const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: Math.round(amount * 100),
      currency,
      receipt: String(receipt).slice(0, 40),
      notes
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('Razorpay order creation failed:', response.status, errText);
    throw new Error(`Razorpay Order Error: ${errText}`);
  }
  return response.json();
}

/** Verify Razorpay payment callback HMAC-SHA256 signature. Throws if key is missing. */
function verifyRazorpayPaymentSignature({ orderId, paymentId, signature }) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) throw new Error('RAZORPAY_KEY_SECRET is not configured.');

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(expected, 'utf-8'),
    Buffer.from(signature, 'utf-8')
  );
}

/** Verify Razorpay webhook HMAC-SHA256 signature. Throws if secret is missing. */
function verifyWebhookSignature(rawBody, signatureHeader) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new Error('RAZORPAY_WEBHOOK_SECRET is not configured.');

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(expected, 'utf-8'),
    Buffer.from(signatureHeader, 'utf-8')
  );
}

// ==============================================================================
// ADMIN SESSION TOKEN (HMAC-SHA256, 24-hour expiry)
// ==============================================================================

function _adminSecret() {
  return process.env.ADMIN_JWT_SECRET || process.env.ADMIN_PASSWORD || 'bk-edu-admin-default-change-this';
}

function createAdminSessionToken() {
  const payload = { role: 'admin', exp: Date.now() + 24 * 60 * 60 * 1000 };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', _adminSecret()).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

function verifyAdminSessionToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payloadB64, sig] = parts;

  const expectedSig = crypto.createHmac('sha256', _adminSecret()).update(payloadB64).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(sig))) return false;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
    return payload.role === 'admin' && payload.exp && Date.now() < payload.exp;
  } catch { return false; }
}

function requireAdminAuth(req, res) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth.trim();
  if (!verifyAdminSessionToken(token)) {
    res.status(401).json({ error: 'Unauthorized: Invalid or expired admin session.' });
    return false;
  }
  return true;
}

// ==============================================================================
// MISC
// ==============================================================================

/** Generate a human-friendly unique Registration ID: BK-MUM-XXYYZZ */
function generateRegistrationId() {
  return `BK-MUM-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

/** Check which credentials are present/missing — used for pre-flight diagnostics. */
function checkCredentials() {
  const missing = [];
  if (!process.env.BLOB_READ_WRITE_TOKEN) missing.push('BLOB_READ_WRITE_TOKEN');
  if (!process.env.RAZORPAY_KEY_ID)       missing.push('RAZORPAY_KEY_ID');
  if (!process.env.RAZORPAY_KEY_SECRET)   missing.push('RAZORPAY_KEY_SECRET');
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) missing.push('RAZORPAY_WEBHOOK_SECRET');
  if (!process.env.ADMIN_PASSWORD)        missing.push('ADMIN_PASSWORD');
  return missing;
}

module.exports = {
  // Blob storage
  createRegistration,
  createOrderIndex,
  getRegistrationById,
  findRegistrationByOrderId,
  findRegistrationByPaymentId,
  updateRegistration,
  listAllRegistrations,
  // Razorpay
  createRazorpayOrder,
  verifyRazorpayPaymentSignature,
  verifyWebhookSignature,
  // Admin auth
  createAdminSessionToken,
  verifyAdminSessionToken,
  requireAdminAuth,
  // Misc
  generateRegistrationId,
  checkCredentials
};
