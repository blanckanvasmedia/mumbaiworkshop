// ==============================================================================
// BK EDU by Minaaz — Mumbai Mega Workshop
// GoDaddy Economy Hosting Node.js 22 / Express Application
// ==============================================================================
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Security & CORS Middleware
app.use(cors());

// 2. Body parsers with raw body retention for Razorpay webhook verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf-8');
  }
}));
app.use(express.urlencoded({ extended: true }));

// 3. Static asset caching middleware
const staticOptions = {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
  etag: true
};

// Serve extracted images
app.use('/images', express.static(path.join(__dirname, 'images'), staticOptions));

// Helper: inject Google Analytics 4 only if valid measurement ID configured
function renderHtmlWithGA4(filePath, res) {
  fs.readFile(filePath, 'utf-8', (err, html) => {
    if (err) {
      console.error('Error reading HTML file:', filePath, err);
      return res.status(500).send('Internal Server Error');
    }

    const gaId = (process.env.GA_MEASUREMENT_ID || '').trim();
    if (gaId && /^G-[A-Za-z0-9]+$/i.test(gaId)) {
      const gaSnippet = `
  <!-- Google Analytics 4 (GoDaddy production environment) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${gaId}');
  </script>
`;
      html = html.replace('</head>', `${gaSnippet}\n</head>`);
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  });
}

// 4. Clean Page Routes (replicating Vercel rewrites & cleanUrls)
app.get('/', (req, res) => {
  renderHtmlWithGA4(path.join(__dirname, 'index.html'), res);
});

app.get(['/admin', '/admin/'], (req, res) => {
  renderHtmlWithGA4(path.join(__dirname, 'admin', 'index.html'), res);
});

app.get(['/thank-you', '/thank-you/'], (req, res) => {
  renderHtmlWithGA4(path.join(__dirname, 'thank-you', 'index.html'), res);
});

// Fallback for static files (e.g. admin styling, favicons, etc.)
app.use(express.static(__dirname, {
  extensions: ['html'],
  index: false,
  ...staticOptions
}));

// 5. API Routes
const registerHandler = require('./api/register');
const verifyPaymentHandler = require('./api/verify-payment');
const webhookHandler = require('./api/webhook');

const adminLoginHandler = require('./api/admin/login');
const adminRegistrationsHandler = require('./api/admin/registrations');
const adminStatsHandler = require('./api/admin/stats');
const adminExportHandler = require('./api/admin/export');

// Student registration & payment
app.post('/api/register', (req, res) => registerHandler(req, res));
app.post('/api/verify-payment', (req, res) => verifyPaymentHandler(req, res));
app.post('/api/webhook', (req, res) => webhookHandler(req, res));

// Admin portal API
app.post('/api/admin/login', (req, res) => adminLoginHandler(req, res));
app.get('/api/admin/registrations', (req, res) => adminRegistrationsHandler(req, res));
app.get('/api/admin/stats', (req, res) => adminStatsHandler(req, res));
app.get('/api/admin/export', (req, res) => adminExportHandler(req, res));

// System health & diagnostics endpoint (safe, no secret leakage)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    node: process.version,
    port: PORT,
    environment: {
      googleAppsScriptConfigured: Boolean(process.env.GOOGLE_APPS_SCRIPT_URL),
      googleSheetsSecretConfigured: Boolean(process.env.GOOGLE_SHEETS_INGEST_SECRET),
      razorpayKeyConfigured: Boolean(process.env.RAZORPAY_KEY_ID),
      razorpaySecretConfigured: Boolean(process.env.RAZORPAY_KEY_SECRET),
      razorpayWebhookConfigured: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET),
      adminPasswordConfigured: Boolean(process.env.ADMIN_PASSWORD),
      ga4Configured: Boolean((process.env.GA_MEASUREMENT_ID || '').trim().startsWith('G-'))
    }
  });
});

// 6. 404 Handler
app.use((req, res) => {
  res.status(404).send(`
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="utf-8"><title>404 Not Found - BK EDU</title>
    <style>body{font-family:sans-serif;background:#080808;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column}a{color:#ff6882;text-decoration:none}</style>
    </head>
    <body>
      <h1>404 | Page Not Found</h1>
      <p><a href="/">Return to BK EDU Mumbai Workshop Home &rarr;</a></p>
    </body>
    </html>
  `);
});

// 7. Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// 8. Server Startup
const server = app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  BK EDU by Minaaz — Mumbai Workshop Server`);
  console.log(`  Node.js version : ${process.version}`);
  console.log(`  Listening on    : http://localhost:${PORT}`);
  console.log(`  GoDaddy Port    : ${PORT}`);
  console.log(`=======================================================`);
});

module.exports = app;

