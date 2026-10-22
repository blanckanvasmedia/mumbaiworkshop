// ==============================================================================
// BK EDU by Minaaz — API: Register Student & Initiate Payment
// Endpoint: POST /api/register
// ==============================================================================
const { getSupabase, createRazorpayOrder, generateRegistrationId } = require('./_utils');

module.exports = async function handler(req, res) {
  // CORS & method check
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
      city = '',
      utm_source = '',
      utm_medium = '',
      utm_campaign = '',
      utm_term = '',
      utm_content = '',
      referrer = ''
    } = req.body || {};

    // Basic Validation
    if (!fullName || !fullName.trim()) {
      return res.status(400).json({ error: 'Full name is required.' });
    }
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    if (!phone || phone.trim().length < 8) {
      return res.status(400).json({ error: 'A valid WhatsApp / Phone number is required.' });
    }

    const cleanName = fullName.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone.trim();
    const cleanCity = city.trim();

    // Generate unique Registration ID
    const registrationId = generateRegistrationId();
    const workshopFeeINR = 1500;

    // Check if Supabase credentials exist
    let supabase;
    try {
      supabase = getSupabase();
    } catch (dbErr) {
      console.warn('Supabase not configured:', dbErr.message);
      return res.status(503).json({
        error: 'Database not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel environment variables.',
        code: 'DB_NOT_CONFIGURED'
      });
    }

    // 1. Save Registration in Supabase as 'Pending' BEFORE going to Razorpay
    const newRecord = {
      registration_id: registrationId,
      full_name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      city: cleanCity,
      amount: workshopFeeINR,
      currency: 'INR',
      payment_status: 'Pending',
      utm_source: utm_source || null,
      utm_medium: utm_medium || null,
      utm_campaign: utm_campaign || null,
      utm_term: utm_term || null,
      utm_content: utm_content || null,
      referrer: referrer || null,
      created_at: new Date().toISOString()
    };

    const { data: inserted, error: insertError } = await supabase
      .from('registrations')
      .insert([newRecord])
      .select()
      .single();

    if (insertError) {
      console.error('Failed to insert registration into Supabase:', insertError);
      return res.status(500).json({ error: 'Failed to record registration: ' + insertError.message });
    }

    // 2. Try to create Razorpay Order
    let razorpayOrder = null;
    try {
      razorpayOrder = await createRazorpayOrder({
        amount: workshopFeeINR,
        currency: 'INR',
        receipt: registrationId,
        notes: {
          registration_id: registrationId,
          full_name: cleanName,
          email: cleanEmail,
          phone: cleanPhone
        }
      });
    } catch (rzpErr) {
      console.warn('Razorpay order creation skipped or failed:', rzpErr.message);
    }

    // If order was created, update the registration with razorpay_order_id
    if (razorpayOrder && razorpayOrder.id) {
      await supabase
        .from('registrations')
        .update({ razorpay_order_id: razorpayOrder.id })
        .eq('registration_id', registrationId);

      return res.status(200).json({
        success: true,
        mode: 'checkout',
        registrationId,
        orderId: razorpayOrder.id,
        amount: workshopFeeINR,
        currency: 'INR',
        keyId: process.env.RAZORPAY_KEY_ID,
        customer: {
          name: cleanName,
          email: cleanEmail,
          contact: cleanPhone
        }
      });
    }

    // Fallback mode if Razorpay API keys are not yet configured:
    return res.status(200).json({
      success: true,
      mode: 'fallback_link',
      registrationId,
      fallbackUrl: 'https://rzp.io/l/8WLl29j',
      amount: workshopFeeINR,
      currency: 'INR',
      message: 'Registration recorded successfully.'
    });

  } catch (err) {
    console.error('Unexpected error in /api/register:', err);
    return res.status(500).json({ error: 'Internal Server Error: ' + err.message });
  }
};
