// ==============================================================================
// BK EDU by Minaaz — API: Export Registrations as CSV
// Endpoint: GET /api/admin/export
// ==============================================================================
const { getSupabase, requireAdminAuth } = require('../_utils');

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
    const supabase = getSupabase();
    const { status = 'All', startDate = '', endDate = '', search = '' } = req.query || {};

    let query = supabase
      .from('registrations')
      .select('*')
      .order('created_at', { ascending: false });

    if (status && status !== 'All') {
      query = query.eq('payment_status', status);
    }
    if (startDate) {
      query = query.gte('created_at', new Date(startDate).toISOString());
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query = query.lte('created_at', end.toISOString());
    }
    if (search && search.trim()) {
      const s = search.trim();
      query = query.or(`full_name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%,registration_id.ilike.%${s}%`);
    }

    const { data: rows, error } = await query;
    if (error) {
      return res.status(500).json({ error: 'Database export error: ' + error.message });
    }

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

    for (const r of rows) {
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
