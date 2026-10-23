// ==============================================================================
// BK EDU by Minaaz — API: Register Student & Initiate Payment
// Endpoint: POST /api/register
// Storage: Vercel Private Blob Store
// ==============================================================================
const {
  createRegistration,
  createOrderIndex,
  createRazorpayOrder,
  generateRegistrationId
} = require('./_utils');

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
    const {
      fullName,
      email,
      phone,
      city        = '',
      utm_source  = '',
      utm_medium  = '',
      utm_campaign = '',
      utm_term    = '',
      utm_content = '',
      referrer    = ''
    } = req.body || {};

    // Input validation
    if (!fullName || !fullName.trim())
      return res.status(400).json({ error: 'Full name is required.' });
    if (!email || !email.includes('@'))
      return res.status(400).json({ error: 'A valid email address is required.' });
    if (!phone || phone.trim().length < 8)
      return res.status(400).json({ error: 'A valid WhatsApp / Phone number is required.' });

    const cleanName  = fullName.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone.trim();
    const cleanCity  = city.trim();

    // Check Blob token before doing anything else
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return res.status(503).json({
        error: 'Blob storage not configured. Add BLOB_READ_WRITE_TOKEN to Vercel Environment Variables.',
        code: 'BLOB_NOT_CONFIGURED'
      });
    }

    const registrationId  = generateRegistrationId();
    const workshopFeeINR  = 1500;
    const now             = new Date().toISOString();

    // 1. Build registration record
    const newRecord = {
      registration_id:      registrationId,
      full_name:            cleanName,
      email:                cleanEmail,
      phone:                cleanPhone,
      city:                 cleanCity,
      amount:               workshopFeeINR,
      currency:             'INR',
      payment_status:       'Pending',
      razorpay_order_id:    null,
      razorpay_payment_id:  null,
      razorpay_signature:   null,
      utm_source:           utm_source   || null,
      utm_medium:           utm_medium   || null,
      utm_campaign:         utm_campaign || null,
      utm_term:             utm_term     || null,
      utm_content:          utm_content  || null,
      referrer:             referrer     || null,
      created_at:           now,
      updated_at:           now
    };

    // 2. Persist registration as 'Pending' BEFORE touching Razorpay
    await createRegistration(newRecord);
    console.log(`Registration ${registrationId} saved to Blob (Pending)`);

    // 3. Create per-registration Razorpay Order
    let razorpayOrder = null;
    try {
      razorpayOrder = await createRazorpayOrder({
        amount:   workshopFeeINR,
        currency: 'INR',
        receipt:  registrationId,
        notes: {
          registration_id: registrationId,
          full_name:       cleanName,
          email:           cleanEmail,
          phone:           cleanPhone
        }
      });
    } catch (rzpErr) {
      // Razorpay key missing or API error — fall back to shared link
      console.warn('Razorpay order creation skipped:', rzpErr.message);
    }

    // 4. If order was created, update blob with order ID and write lookup index
    if (razorpayOrder && razorpayOrder.id) {
      const withOrder = { ...newRecord, razorpay_order_id: razorpayOrder.id, updated_at: new Date().toISOString() };
      await createRegistration(withOrder);          // overwrite blob with order ID
      await createOrderIndex(razorpayOrder.id, registrationId); // write lookup index
      console.log(`Order ${razorpayOrder.id} linked to ${registrationId}`);

      return res.status(200).json({
        success:        true,
        mode:           'checkout',
        registrationId,
        orderId:        razorpayOrder.id,
        amount:         workshopFeeINR,
        currency:       'INR',
        keyId:          process.env.RAZORPAY_KEY_ID,
        customer: {
          name:    cleanName,
          email:   cleanEmail,
          contact: cleanPhone
        }
      });
    }

    // 5. Graceful fallback when Razorpay keys are not yet configured
    return res.status(200).json({
      success:      true,
      mode:         'fallback_link',
      registrationId,
      fallbackUrl:  'https://rzp.io/l/8WLl29j',
      amount:       workshopFeeINR,
      currency:     'INR',
      message:      'Registration saved. Razorpay keys not yet configured — using shared payment link.'
    });

  } catch (err) {
    console.error('Unexpected error in /api/register:', err);
    return res.status(500).json({ error: 'Internal Server Error: ' + err.message });
  }
};
