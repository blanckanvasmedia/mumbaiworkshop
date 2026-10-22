// ==============================================================================
// BK EDU by Minaaz — Serverless API Utilities
// ==============================================================================
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// 1. Supabase Client (Service Role for secure serverless backend operations)
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase environment variables (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) are not configured.');
  }
  return createClient(url, key, {
    auth: { persistSession: false }
  });
}

// 2. Razorpay Order Creation via official REST API
async function createRazorpayOrder({ amount, currency = 'INR', receipt, notes = {} }) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    return null; // Signals that Razorpay API keys are not yet configured
  }

  const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      amount: Math.round(amount * 100), // convert to paise
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

  return await response.json();
}

// 3. Verify Payment Signature (HMAC-SHA256)
function verifyRazorpayPaymentSignature({ orderId, paymentId, signature }) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) {
    throw new Error('RAZORPAY_KEY_SECRET is not configured.');
  }
  const body = `${orderId}|${paymentId}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'utf-8'),
    Buffer.from(signature, 'utf-8')
  );
}

// 4. Verify Razorpay Webhook Signature (HMAC-SHA256)
function verifyWebhookSignature(rawBody, signatureHeader) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('RAZORPAY_WEBHOOK_SECRET is not configured.');
  }
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'utf-8'),
    Buffer.from(signatureHeader, 'utf-8')
  );
}

// 5. Admin Token Generation & Verification (HMAC SHA256 session token)
function getAdminSecret() {
  return process.env.ADMIN_JWT_SECRET || process.env.ADMIN_PASSWORD || 'bk-edu-default-admin-salt-change-in-env';
}

function createAdminSessionToken() {
  const payload = {
    role: 'admin',
    exp: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', getAdminSecret())
    .update(payloadB64)
    .digest('base64url');
  return `${payloadB64}.${signature}`;
}

function verifyAdminSessionToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payloadB64, signature] = parts;

  const expectedSignature = crypto
    .createHmac('sha256', getAdminSecret())
    .update(payloadB64)
    .digest('base64url');

  if (!crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature))) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
    if (!payload.exp || Date.now() > payload.exp) return false;
    return payload.role === 'admin';
  } catch (e) {
    return false;
  }
}

// Helper to check Authorization header
function requireAdminAuth(req, res) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
  if (!verifyAdminSessionToken(token)) {
    res.status(401).json({ error: 'Unauthorized: Invalid or expired admin session.' });
    return false;
  }
  return true;
}

// Generate friendly unique Registration ID: BK-MUM-<6-char-hex>
function generateRegistrationId() {
  const randomHex = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `BK-MUM-${randomHex}`;
}

module.exports = {
  getSupabase,
  createRazorpayOrder,
  verifyRazorpayPaymentSignature,
  verifyWebhookSignature,
  createAdminSessionToken,
  verifyAdminSessionToken,
  requireAdminAuth,
  generateRegistrationId
};
