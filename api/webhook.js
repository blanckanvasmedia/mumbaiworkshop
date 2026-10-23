// ==============================================================================
// BK EDU by Minaaz — API: Razorpay Webhook Handler
// Endpoint: POST /api/webhook
// Storage: Vercel Private Blob Store
// ==============================================================================
const {
  getRegistrationById,
  findRegistrationByOrderId,
  findRegistrationByPaymentId,
  updateRegistration,
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

    // Verify webhook signature
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
    const refundEntity = payload.refund ? payload.refund.entity : null;

    // Determine registration identifier
    const orderId = (paymentEntity && paymentEntity.order_id) || (orderEntity && orderEntity.id) || null;
    const paymentId = (paymentEntity && paymentEntity.id) || null;
    const regIdFromNotes = (paymentEntity && paymentEntity.notes && paymentEntity.notes.registration_id)
      || (orderEntity && orderEntity.notes && orderEntity.notes.registration_id)
      || null;

    // Find registration in Blob storage
    let existingReg = null;
    if (regIdFromNotes) {
      existingReg = await getRegistrationById(regIdFromNotes);
    }
    if (!existingReg && orderId) {
      existingReg = await findRegistrationByOrderId(orderId);
    }
    if (!existingReg && paymentId) {
      existingReg = await findRegistrationByPaymentId(paymentId);
    }

    if (!existingReg) {
      console.warn(`Webhook received for unknown registration: order ${orderId}, payment ${paymentId}`);
      // Return 200 so Razorpay stops retrying unknown events
      return res.status(200).json({ status: 'ignored_unmatched_registration' });
    }

    const regId = existingReg.registration_id;

    // Process event types with idempotent state machine
    if (eventType === 'order.paid' || eventType === 'payment.captured') {
      if (existingReg.payment_status === 'Paid') {
        return res.status(200).json({ status: 'already_paid_no_op' });
      }

      await updateRegistration(regId, (rec) => ({
        ...rec,
        payment_status: 'Paid',
        razorpay_order_id: orderId || rec.razorpay_order_id,
        razorpay_payment_id: paymentId || rec.razorpay_payment_id
      }));

      console.log(`Registration ${regId} marked as Paid via webhook`);
      return res.status(200).json({ status: 'marked_paid' });
    }

    if (eventType === 'payment.failed') {
      // Only set to Failed if status is still Pending (don't overwrite Paid if another attempt succeeded)
      if (existingReg.payment_status === 'Pending') {
        await updateRegistration(regId, (rec) => {
          if (rec.payment_status === 'Paid') return null; // Abort if raced to Paid
          return {
            ...rec,
            payment_status: 'Failed',
            razorpay_order_id: orderId || rec.razorpay_order_id,
            razorpay_payment_id: paymentId || rec.razorpay_payment_id
          };
        });
        console.log(`Registration ${regId} marked as Failed via webhook`);
      }
      return res.status(200).json({ status: 'marked_failed' });
    }

    if (eventType === 'refund.created' || eventType === 'refund.processed') {
      await updateRegistration(regId, (rec) => ({
        ...rec,
        payment_status: 'Refunded'
      }));

      console.log(`Registration ${regId} marked as Refunded via webhook`);
      return res.status(200).json({ status: 'marked_refunded' });
    }

    return res.status(200).json({ status: 'ignored_event' });

  } catch (err) {
    console.error('Webhook processing exception:', err);
    return res.status(500).json({ error: 'Webhook processing error: ' + err.message });
  }
};
