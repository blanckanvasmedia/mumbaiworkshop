// ==============================================================================
// BK EDU by Minaaz — API: Server-side Payment Verification
// Endpoint: POST /api/verify-payment
// Storage: Vercel Private Blob Store
// ==============================================================================
const { updateRegistration, verifyRazorpayPaymentSignature } = require('./_utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  try {
    const { registrationId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};

    if (!registrationId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing required payment verification parameters.' });
    }

    // Verify HMAC-SHA256 signature
    let isValid = false;
    try {
      isValid = verifyRazorpayPaymentSignature({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature
      });
    } catch (sigErr) {
      console.error('Signature verification threw error:', sigErr);
      return res.status(500).json({ error: 'Payment signature check error: ' + sigErr.message });
    }

    if (!isValid) {
      console.warn(`Tampered or invalid signature for reg ${registrationId}, order ${razorpay_order_id}`);
      return res.status(400).json({ error: 'Invalid payment signature. Verification failed.' });
    }

    // Update registration in Blob storage to 'Paid' (idempotent)
    let updated;
    try {
      updated = await updateRegistration(registrationId, (existing) => {
        return {
          ...existing,
          payment_status: 'Paid',
          razorpay_order_id: razorpay_order_id || existing.razorpay_order_id,
          razorpay_payment_id: razorpay_payment_id || existing.razorpay_payment_id,
          razorpay_signature: razorpay_signature || existing.razorpay_signature
        };
      });
    } catch (storageErr) {
      console.error('Failed to update registration status to Paid in Blob:', storageErr);
      return res.status(500).json({ error: 'Storage update failed: ' + storageErr.message });
    }

    if (!updated) {
      return res.status(404).json({ error: `Registration not found: ${registrationId}` });
    }

    console.log(`Registration ${registrationId} verified and marked Paid in Blob`);

    return res.status(200).json({
      success: true,
      verified: true,
      registrationId,
      paymentId: razorpay_payment_id,
      customer: {
        name: updated.full_name,
        email: updated.email
      }
    });

  } catch (err) {
    console.error('Unexpected error in /api/verify-payment:', err);
    return res.status(500).json({ error: 'Internal Server Error: ' + err.message });
  }
};
