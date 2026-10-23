// ==============================================================================
// BK EDU by Minaaz — API: Server-side Payment Verification
// Endpoint: POST /api/verify-payment
// Storage: Google Sheets via Google Apps Script Web App
// ==============================================================================
const { updatePaymentInGoogleSheets, verifyRazorpayPaymentSignature } = require('./_utils');

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

    // Verify HMAC-SHA256 signature before marking anything as Paid
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

    // Update payment status in Google Sheets to 'Paid'
    try {
      await updatePaymentInGoogleSheets({
        registrationId,
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        status: 'Paid'
      });
      console.log(`Registration ${registrationId} verified and marked Paid in Google Sheets`);
    } catch (sheetErr) {
      console.warn('Note: Google Sheets payment status update notice:', sheetErr.message);
    }

    return res.status(200).json({
      success: true,
      verified: true,
      registrationId,
      paymentId: razorpay_payment_id
    });

  } catch (err) {
    console.error('Unexpected error in /api/verify-payment:', err);
    return res.status(500).json({ error: 'Internal Server Error: ' + err.message });
  }
};
