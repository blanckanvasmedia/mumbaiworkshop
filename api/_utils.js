// ==============================================================================
// BK EDU by Minaaz — Serverless API Utilities
// Storage: Google Sheets via Google Apps Script Web App
// ==============================================================================
const crypto = require('crypto');

// ==============================================================================
// GOOGLE SHEETS INTEGRATION (via Google Apps Script Web App)
// ==============================================================================

/**
 * Save a new registration to Google Sheets via Google Apps Script Web App.
 * Expects action: 'register', registrationId, name, email, phone, and server-side secret.
 * Saves Payment Status = 'Pending'.
 * Verifies that the Apps Script response indicates success.
 */
async function saveRegistrationToGoogleSheets({
  registrationId, name, email, phone,
  utm_source = '', utm_medium = '', utm_campaign = '',
  utm_term = '', utm_content = '', referrer = ''
}) {
  const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
  const secret = process.env.GOOGLE_SHEETS_INGEST_SECRET;

  if (!scriptUrl) {
    throw new Error('GOOGLE_APPS_SCRIPT_URL is not configured in Vercel Environment Variables.');
  }

  // Build a single readable "Lead Source" label for the sheet
  let leadSource = utm_source || '';
  if (utm_medium) leadSource += (leadSource ? ' / ' : '') + utm_medium;
  if (utm_campaign) leadSource += (leadSource ? ' / ' : '') + utm_campaign;
  if (!leadSource && referrer) {
    try { leadSource = new URL(referrer).hostname; } catch { leadSource = referrer.slice(0, 60); }
  }
  if (!leadSource) leadSource = 'Direct';

  const payload = {
    action: 'register',
    registrationId,
    name,
    fullName: name,
    email,
    phone,
    phoneNumber: phone,
    paymentStatus: 'Pending',
    status: 'Pending',
    // UTM / lead source columns
    leadSource,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_term,
    utm_content,
    referrer,
    secret: secret || '',
    ingestSecret: secret || ''
  };

  const response = await fetch(scriptUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    redirect: 'follow'
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Google Apps Script responded with HTTP ${response.status}: ${errText}`);
  }

  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    if (text.toLowerCase().includes('success') || text.toLowerCase().includes('ok')) {
      result = { success: true, message: text };
    } else {
      throw new Error(`Google Apps Script returned non-JSON response: ${text.slice(0, 200)}`);
    }
  }

  const isSuccess = result && (
    result.success === true ||
    result.status === 'success' ||
    result.result === 'success' ||
    result.ok === true
  );

  if (!isSuccess) {
    throw new Error((result && (result.error || result.message)) || 'Unsuccessful response from Google Apps Script.');
  }

  return result;
}

/**
 * Update payment status to 'Paid' in Google Sheets after verified payment confirmation.
 */
async function updatePaymentInGoogleSheets({ registrationId, orderId, paymentId, status = 'Paid' }) {
  const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
  const secret = process.env.GOOGLE_SHEETS_INGEST_SECRET;

  if (!scriptUrl) return null;

  const payload = {
    action: 'updatePayment',
    registrationId,
    orderId,
    order_id: orderId,
    razorpay_order_id: orderId,
    paymentId,
    payment_id: paymentId,
    razorpay_payment_id: paymentId,
    paymentStatus: status,
    status,
    secret: secret || '',
    ingestSecret: secret || ''
  };

  try {
    const response = await fetch(scriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      redirect: 'follow'
    });

    return await response.json().catch(() => ({ success: true }));
  } catch (err) {
    console.warn('Note: Google Sheets updatePayment call notice:', err.message);
    return null;
  }
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
  if (!process.env.GOOGLE_APPS_SCRIPT_URL)     missing.push('GOOGLE_APPS_SCRIPT_URL');
  if (!process.env.GOOGLE_SHEETS_INGEST_SECRET) missing.push('GOOGLE_SHEETS_INGEST_SECRET');
  if (!process.env.RAZORPAY_KEY_ID)             missing.push('RAZORPAY_KEY_ID');
  if (!process.env.RAZORPAY_KEY_SECRET)         missing.push('RAZORPAY_KEY_SECRET');
  if (!process.env.RAZORPAY_WEBHOOK_SECRET)     missing.push('RAZORPAY_WEBHOOK_SECRET');
  if (!process.env.ADMIN_PASSWORD)              missing.push('ADMIN_PASSWORD');
  return missing;
}

module.exports = {
  // Google Sheets
  saveRegistrationToGoogleSheets,
  updatePaymentInGoogleSheets,
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
  checkCredentials,
  // Admin fallback
  listAllRegistrations: async () => []
};
