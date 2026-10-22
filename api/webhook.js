// ==============================================================================
// BK EDU by Minaaz — API: Razorpay Webhook Handler
// Endpoint: POST /api/webhook
// ==============================================================================
const { getSupabase, verifyWebhookSignature } = require('./_utils');

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

    const supabase = getSupabase();
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

    // Helper to find registration
    async function findRegistration() {
      if (regIdFromNotes) {
        const { data } = await supabase
          .from('registrations')
          .select('*')
          .eq('registration_id', regIdFromNotes)
          .maybeSingle();
        if (data) return data;
      }
      if (orderId) {
        const { data } = await supabase
          .from('registrations')
          .select('*')
          .eq('razorpay_order_id', orderId)
          .maybeSingle();
        if (data) return data;
      }
      if (paymentId) {
        const { data } = await supabase
          .from('registrations')
          .select('*')
          .eq('razorpay_payment_id', paymentId)
          .maybeSingle();
        if (data) return data;
      }
      return null;
    }

    const existingReg = await findRegistration();

    if (!existingReg) {
      console.warn(`Webhook received for unknown registration: order ${orderId}, payment ${paymentId}`);
      // Return 200 so Razorpay stops retrying unknown events
      return res.status(200).json({ status: 'ignored_unmatched_registration' });
    }

    // Process event types
    if (eventType === 'order.paid' || eventType === 'payment.captured') {
      // Idempotency: If already Paid, do not duplicate or overwrite
      if (existingReg.payment_status === 'Paid') {
        return res.status(200).json({ status: 'already_paid_no_op' });
      }

      await supabase
        .from('registrations')
        .update({
          payment_status: 'Paid',
          razorpay_payment_id: paymentId || existingReg.razorpay_payment_id,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingReg.id);

      console.log(`Registration ${existingReg.registration_id} marked as Paid via webhook`);
      return res.status(200).json({ status: 'marked_paid' });
    }

    if (eventType === 'payment.failed') {
      // Only set to Failed if status is still Pending (don't overwrite Paid if another attempt succeeded)
      if (existingReg.payment_status === 'Pending') {
        await supabase
          .from('registrations')
          .update({
            payment_status: 'Failed',
            razorpay_payment_id: paymentId || existingReg.razorpay_payment_id,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingReg.id);

        console.log(`Registration ${existingReg.registration_id} marked as Failed via webhook`);
      }
      return res.status(200).json({ status: 'marked_failed' });
    }

    if (eventType === 'refund.created' || eventType === 'refund.processed') {
      await supabase
        .from('registrations')
        .update({
          payment_status: 'Refunded',
          updated_at: new Date().toISOString()
        })
        .eq('id', existingReg.id);

      console.log(`Registration ${existingReg.registration_id} marked as Refunded via webhook`);
      return res.status(200).json({ status: 'marked_refunded' });
    }

    return res.status(200).json({ status: 'ignored_event' });

  } catch (err) {
    console.error('Webhook processing exception:', err);
    return res.status(500).json({ error: 'Webhook processing error: ' + err.message });
  }
};
