// ==============================================================================
// BK EDU by Minaaz — API: Razorpay Webhook Handler
// Endpoint: POST /api/webhook
// Storage: Google Sheets via Google Apps Script Web App
// ==============================================================================
const {
  updatePaymentInGoogleSheets,
  verifyWebhookSignature
} = require('./_utils');

// Helper to buffer the raw body for signature verification in Node/Vercel
async function getRawBody(req) {
  if (req.rawBody) return req.rawBody;
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf-8');

  return new Promise((resolve, reject) => {
    let chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', err => reject(err));
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const signature = req.headers['x-razorpay-signature'];
    if (!signature) {
      return res.status(400).json({ error: 'Missing x-razorpay-signature header' });
    }

    const rawBody = await getRawBody(req);

    // Verify webhook cryptographic signature
    let isValid = false;
    try {
      isValid = verifyWebhookSignature(rawBody, signature);
    } catch (sigErr) {
      console.error('Webhook signature validation error:', sigErr);
      return res.status(500).json({ error: 'Webhook configuration error: ' + sigErr.message });
    }

    if (!isValid) {
      console.warn('Invalid Razorpay webhook signature received');
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    const eventData = JSON.parse(rawBody);
    const eventType = eventData.event;
    console.log(`Razorpay webhook received: ${eventType}`);

    const payload = eventData.payload || {};
    const paymentEntity = payload.payment ? payload.payment.entity : null;
    const orderEntity = payload.order ? payload.order.entity : null;

    const orderId = (paymentEntity && paymentEntity.order_id) || (orderEntity && orderEntity.id) || null;
    const paymentId = (paymentEntity && paymentEntity.id) || null;
    const regIdFromNotes = (paymentEntity && paymentEntity.notes && paymentEntity.notes.registration_id)
      || (orderEntity && orderEntity.notes && orderEntity.notes.registration_id)
      || null;

    const registrationId = regIdFromNotes || orderId;

    if (eventType === 'order.paid' || eventType === 'payment.captured') {
      if (registrationId) {
        await updatePaymentInGoogleSheets({
          registrationId,
          paymentId,
          status: 'Paid'
        });
        console.log(`Webhook marked registration ${registrationId} as Paid in Google Sheets`);
      }
      return res.status(200).json({ status: 'marked_paid' });
    }

    if (eventType === 'payment.failed') {
      if (registrationId) {
        await updatePaymentInGoogleSheets({
          registrationId,
          paymentId,
          status: 'Failed'
        });
      }
      return res.status(200).json({ status: 'marked_failed' });
    }

    if (eventType === 'refund.created' || eventType === 'refund.processed') {
      if (registrationId) {
        await updatePaymentInGoogleSheets({
          registrationId,
          paymentId,
          status: 'Refunded'
        });
      }
      return res.status(200).json({ status: 'marked_refunded' });
    }

    return res.status(200).json({ status: 'ignored_event' });

  } catch (err) {
    console.error('Webhook processing exception:', err);
    return res.status(500).json({ error: 'Webhook processing error: ' + err.message });
  }
};
