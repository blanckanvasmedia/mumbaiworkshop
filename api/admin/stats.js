// ==============================================================================
// BK EDU by Minaaz — API: Admin Dashboard Statistics
// Endpoint: GET /api/admin/stats
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

    // Query all registrations with relevant columns
    const { data: rows, error } = await supabase
      .from('registrations')
      .select('payment_status, amount');

    if (error) {
      console.error('Failed to fetch stats:', error);
      return res.status(500).json({ error: 'Failed to load statistics: ' + error.message });
    }

    const totalSubmissions = rows.length;
    let paidCount = 0;
    let pendingCount = 0;
    let failedCount = 0;
    let refundedCount = 0;
    let confirmedRevenue = 0;

    for (const row of rows) {
      const status = row.payment_status;
      if (status === 'Paid') {
        paidCount++;
        confirmedRevenue += Number(row.amount || 1500);
      } else if (status === 'Pending') {
        pendingCount++;
      } else if (status === 'Failed') {
        failedCount++;
      } else if (status === 'Refunded') {
        refundedCount++;
      }
    }

    const conversionRate = totalSubmissions > 0
      ? Number(((paidCount / totalSubmissions) * 100).toFixed(1))
      : 0;

    return res.status(200).json({
      success: true,
      stats: {
        totalSubmissions,
        paidCount,
        pendingCount,
        failedCount,
        refundedCount,
        confirmedRevenue,
        conversionRate,
        currency: 'INR'
      }
    });

  } catch (err) {
    console.error('Stats endpoint error:', err);
    return res.status(500).json({ error: 'Internal Server Error: ' + err.message });
  }
};
