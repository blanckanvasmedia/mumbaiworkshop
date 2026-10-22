// ==============================================================================
// BK EDU by Minaaz — API: Admin Authentication
// Endpoint: POST /api/admin/login
// ==============================================================================
const { createAdminSessionToken } = require('../_utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { password } = req.body || {};
    const configuredPassword = process.env.ADMIN_PASSWORD;

    if (!configuredPassword) {
      return res.status(503).json({
        error: 'ADMIN_PASSWORD environment variable is not configured on Vercel.',
        code: 'ADMIN_PW_NOT_CONFIGURED'
      });
    }

    if (!password || String(password).trim() !== configuredPassword.trim()) {
      return res.status(401).json({ error: 'Incorrect administrator password.' });
    }

    // Generate secure 24-hour signed admin token
    const token = createAdminSessionToken();

    return res.status(200).json({
      success: true,
      message: 'Admin authentication successful',
      token,
      expiresIn: 86400
    });

  } catch (err) {
    console.error('Admin login error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
