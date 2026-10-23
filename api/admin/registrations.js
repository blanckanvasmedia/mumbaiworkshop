// ==============================================================================
// BK EDU by Minaaz — API: Admin List Registrations
// Endpoint: GET /api/admin/registrations
// Storage: Vercel Private Blob Store
// ==============================================================================
const { listAllRegistrations, requireAdminAuth } = require('../_utils');

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
    const {
      search = '',
      status = 'All',
      startDate = '',
      endDate = '',
      limit = 200,
      offset = 0
    } = req.query || {};

    let all = await listAllRegistrations();

    // 1. Filter by status
    if (status && status !== 'All') {
      all = all.filter(r => r.payment_status === status);
    }

    // 2. Filter by date range
    if (startDate) {
      const start = new Date(startDate);
      all = all.filter(r => new Date(r.created_at) >= start);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      all = all.filter(r => new Date(r.created_at) <= end);
    }

    // 3. Search filter
    if (search && search.trim()) {
      const s = search.trim().toLowerCase();
      all = all.filter(r => {
        const name  = (r.full_name || '').toLowerCase();
        const email = (r.email || '').toLowerCase();
        const phone = (r.phone || '').toLowerCase();
        const regId = (r.registration_id || '').toLowerCase();
        const payId = (r.razorpay_payment_id || '').toLowerCase();
        return name.includes(s) || email.includes(s) || phone.includes(s) || regId.includes(s) || payId.includes(s);
      });
    }

    // 4. Sort descending by creation date
    all.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    // 5. Pagination
    const totalCount = all.length;
    const off = Math.max(0, parseInt(offset, 10) || 0);
    const lim = Math.max(1, parseInt(limit, 10) || 200);
    const paginated = all.slice(off, off + lim);

    return res.status(200).json({
      success: true,
      registrations: paginated,
      totalCount,
      limit: lim,
      offset: off
    });

  } catch (err) {
    console.error('Admin registrations query exception:', err);
    return res.status(500).json({ error: 'Internal Server Error: ' + err.message });
  }
};
