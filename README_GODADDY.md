# GoDaddy Node.js Hosting — Deployment Guide
## BK EDU by Minaaz — Mumbai Mega Workshop

This package contains the complete, production-ready Node.js 22 / Express application for your BK EDU Mumbai Workshop website, fully prepared for GoDaddy Economy Hosting (cPanel).

---

## 📁 Package Contents

```
├── server.js              # Production Express server (Node.js 22, GoDaddy PORT compatible)
├── package.json           # Dependencies (express, cors, dotenv) & startup scripts
├── index.html             # High-speed landing page (optimized from 5.4MB to 85KB)
├── thank-you.html         # Conversion & Thank You page
├── thank-you/
│   └── index.html         # Pretty URL route (/thank-you)
├── admin/
│   └── index.html         # Admin dashboard portal (/admin)
├── images/                # Extracted & optimized high-resolution web assets
│   ├── logo.png
│   ├── workshop-creative.jpg
│   ├── parimal-mehhta-hero.webp
│   ├── mentor-showcase-popup.png
│   ├── students/          # Student portraits (10 files)
│   └── mentors/           # Mentor portraits (14 files)
├── api/                   # Production backend API routes
│   ├── register.js        # POST /api/register
│   ├── verify-payment.js  # POST /api/verify-payment
│   ├── webhook.js         # POST /api/webhook (Razorpay webhooks)
│   ├── _utils.js          # Google Sheets integration & Razorpay HMAC verifier
│   └── admin/             # Admin authentication & reports
│       ├── login.js
│       ├── registrations.js
│       ├── stats.js
│       └── export.js
└── .env.example           # Reference list of all required environment variables
```

---

## 🚀 Step-by-Step Deployment Instructions

### Step 1: Open cPanel on GoDaddy
1. Log in to your [GoDaddy Account](https://account.godaddy.com/).
2. Under **Web Hosting (Economy)**, click **Manage** → click **cPanel Admin**.

### Step 2: Set Up Node.js Application
1. In cPanel, search for and click **"Setup Node.js App"** (under the *Software* section).
2. Click the blue **"Create Application"** button.
3. Configure the fields:
   - **Node.js version**: Choose **22.x** (or the latest available 20.x/22.x).
   - **Application mode**: Select **Production**.
   - **Application root**: Enter a directory name, e.g., `mumbai-workshop` (or `public_html` if this is your primary domain).
   - **Application URL**: Select your domain or temporary preview subdomain.
   - **Application startup file**: Enter `server.js`.
4. Click **Create** at the top right.

### Step 3: Upload the Project ZIP File
1. Return to the cPanel Home and click **File Manager**.
2. Navigate to the folder you specified in *Application root* (e.g. `mumbai-workshop/`).
3. Click **Upload** at the top bar.
4. Select the provided `bk-edu-mumbai-godaddy.zip` file and upload it.
5. Once upload reaches 100%, go back to the File Manager, right-click `bk-edu-mumbai-godaddy.zip`, and click **Extract** (Extract to the current directory).
6. Delete the `.zip` file from the server after extracting.

### Step 4: Configure Environment Variables
You can configure them either through **cPanel Setup Node.js App** or by creating a `.env` file in the application folder:

1. In **Setup Node.js App**, edit your application.
2. Under **Environment variables**, click **Add Variable** for each:

| Variable Name | Value | Description |
|---|---|---|
| `PORT` | *(assigned automatically)* | GoDaddy assigns this automatically |
| `NODE_ENV` | `production` | Production mode |
| `GOOGLE_APPS_SCRIPT_URL` | `https://script.google.com/macros/s/.../exec` | Your Google Apps Script Web App URL |
| `GOOGLE_SHEETS_INGEST_SECRET` | `YourServerSideIngestSecret123!` | Shared secret string for Google Sheets |
| `RAZORPAY_KEY_ID` | `rzp_live_TWMBEqIOCmE68X` | Your Razorpay Live Key ID |
| `RAZORPAY_KEY_SECRET` | *(your Razorpay secret)* | Your Razorpay Live Key Secret |
| `RAZORPAY_WEBHOOK_SECRET` | *(your webhook secret)* | Webhook secret from Razorpay Dashboard |
| `RAZORPAY_FALLBACK_URL` | `https://rzp.io/rzp/NrwSNBZG` | Fallback payment link |
| `WORKSHOP_FEE_INR` | `999` | Workshop registration fee in INR (₹999) |
| `ADMIN_PASSWORD` | *(your chosen password)* | Password for `/admin` portal |
| `ADMIN_JWT_SECRET` | *(any random string)* | Secret for signing admin sessions |
| `GA_MEASUREMENT_ID` | `G-XXXXXXXXXX` *(optional)* | Google Analytics 4 Measurement ID |

3. Click **Save**.

### Step 5: Install Dependencies
1. In the **Setup Node.js App** page, click the **"Run NPM Install"** button.
   *(cPanel will install `express`, `cors`, and `dotenv` automatically).*
2. Wait until you see the green success message.

### Step 6: Start / Restart the Application
1. Click **Restart Application** (or **Start Application**) at the top of the Setup Node.js App page.
2. Click the **Open** URL link to preview your website.

---

## 🔍 Pre-Launch Testing Checklist

Before updating your domain DNS:
- [ ] Visit `https://your-preview-url/api/health` — it should return `{"status":"ok", "node":"v22.x", ...}`.
- [ ] Open the home page — verify high-speed load, hero creative, mentors, and students.
- [ ] Click **"REGISTER NOW"** — fill test details and submit.
- [ ] Confirm row appears in your **Google Sheet** with **Payment Status = Pending**.
- [ ] Confirm Razorpay checkout / fallback link opens.
- [ ] Visit `https://your-preview-url/admin` — log in with your `ADMIN_PASSWORD` and verify stats.

---

## 🌐 Switching Domain DNS (When Ready)
Only after passing the preview tests:
1. In GoDaddy DNS Management for your domain, update the **A Record** (`@`) or **CNAME** (`www`) to point to your GoDaddy Hosting IP.
2. Your existing Vercel project remains completely untouched as a backup.

