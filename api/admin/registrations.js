// ==============================================================================
// BK EDU by Minaaz — API: Admin List Registrations
// Endpoint: GET /api/admin/registrations
// ==============================================================================
const { getSupabase, requireAdminAuth } = require('../_utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (!requireAdminAuth(req, res)) return;

  try {
    const supabase = getSupabase();
    const {
      search = '',
      status = 'All',
      startDate = '',
      endDate = '',
      limit = 200,
      offset = 0
    } = req.query || {};

    let query = supabase
      .from('registrations')
      .select('*', { count: 'exact' });

    // Filter by payment status
    if (status && status !== 'All') {
      query = query.eq('payment_status', status);
    }

    // Filter by date range
    if (startDate) {
      query = query.gte('created_at', new Date(startDate).toISOString());
    }
    if (endDate) {
      // inclusive end of day
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query = query.lte('created_at', end.toISOString());
    }

    // Search filter across name, email, phone, or registration_id
    if (search && search.trim()) {
      const s = search.trim();
      query = query.or(`full_name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%,registration_id.ilike.%${s}%,razorpay_payment_id.ilike.%${s}%`);
    }

    // Ordering and pagination
    query = query
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    const { data: registrations, count, error } = await query;

    if (error) {
      console.error('Error fetching registrations:', error);
      return res.status(500).json({ error: 'Database query error: ' + error.message });
    }

    return res.status(200).json({
      success: true,
      registrations: registrations || [],
      totalCount: count || 0,
      limit: Number(limit),
      offset: Number(offset)
    });

  } catch (err) {
    console.error('Admin registrations query exception:', err);
    return res.status(500).json({ error: 'Internal Server Error: ' + err.message });
  }
};
