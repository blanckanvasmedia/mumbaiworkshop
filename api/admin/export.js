// ==============================================================================
// BK EDU by Minaaz — API: Export Registrations as CSV
// Endpoint: GET /api/admin/export
// Storage: Vercel Private Blob Store
// ==============================================================================
const { listAllRegistrations, requireAdminAuth } = require('../_utils');

function escapeCsvCell(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (!requireAdminAuth(req, res)) return;

  try {
    const { status = 'All', startDate = '', endDate = '', search = '' } = req.query || {};

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

    const headers = [
      'Registration ID',
      'Name',
      'Email',
      'Phone',
      'City',
      'Registered On (UTC)',
      'Payment Status',
      'Payment ID',
      'Order ID',
      'Amount (INR)',
      'UTM Source',
      'UTM Medium',
      'UTM Campaign',
      'UTM Term',
      'UTM Content',
      'Referrer'
    ];

    const csvLines = [headers.join(',')];

    for (const r of all) {
      const row = [
        escapeCsvCell(r.registration_id),
        escapeCsvCell(r.full_name),
        escapeCsvCell(r.email),
        escapeCsvCell(r.phone),
        escapeCsvCell(r.city),
        escapeCsvCell(r.created_at),
        escapeCsvCell(r.payment_status),
        escapeCsvCell(r.razorpay_payment_id || ''),
        escapeCsvCell(r.razorpay_order_id || ''),
        escapeCsvCell(r.amount || 1500),
        escapeCsvCell(r.utm_source || ''),
        escapeCsvCell(r.utm_medium || ''),
        escapeCsvCell(r.utm_campaign || ''),
        escapeCsvCell(r.utm_term || ''),
        escapeCsvCell(r.utm_content || ''),
        escapeCsvCell(r.referrer || '')
      ];
      csvLines.push(row.join(','));
    }

    const csvContent = csvLines.join('\r\n');
    const dateStamp = new Date().toISOString().slice(0, 10);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="bk-edu-registrations-${dateStamp}.csv"`);
    return res.status(200).send(csvContent);

  } catch (err) {
    console.error('Export CSV exception:', err);
    return res.status(500).json({ error: 'Export failed: ' + err.message });
  }
};
