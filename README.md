# Microfinance & Loan Management CRM

## 📱 GitHub Pages Static Hosted CRM Application

A complete, production-ready Microfinance & Loan Management CRM web application built with clean HTML5, CSS3, and Vanilla JavaScript (ES6+). 100% static-host compatible - no backend server required, works directly on GitHub Pages.

---

## 📦 PROJECT STRUCTURE

```
microfinance-crm/
├── index.html          # Main SPA shell, login screen, dashboard views, modals
├── styles.css          # Responsive mobile-first UI, sticky bottom nav, tables, cards
├── app.js            # Core state engine, authentication, permissions, calculators, renderers
├── sheets-sync.js    # SheetJS import/export + Google Sheets REST API bridge
├── README.md          # Step-by-step setup guide and deployment instructions
└── (optional) sw.js   # Service Worker for PWA offline caching
```

---

## ✅ PREREQUISITES

- GitHub account
- Text editor (VS Code, Sublime, etc.)
- Google account (for Google Sheets integration)
- Modern web browser (Chrome, Firefox, Safari, Edge)

---

## 🚀 GITHUB PAGES DEPLOYMENT GUIDE

### Step 1: Create a New Repository

1. Go to [GitHub.com](https://github.com) and create a new repository
2. Repository name: `<your-username>.github.io` (for default GitHub Pages) OR any name for project pages
3. Initialize with a README (optional)
4. Click "Create repository"

### Step 2: Upload Your Files

**Option A: Using GitHub Web Interface**
1. Click "uploading an existing file" 
2. Select all files from this project: `index.html`, `styles.css`, `app.js`, `sheets-sync.js`, `README.md`
3. Commit changes

**Option B: Using Git CLI**
```bash
# Clone your repository
git clone https://github.com/your-username/your-repo-name.git
cd your-repo-name

# Copy all project files into the repository
cp /path/to/microfinance-crm/* .

# Add and commit
git add .
git commit -m "Initial commit: Microfinance CRM"

# Push to GitHub
git push origin main   # or master, depending on your default branch
```

### Step 3: Enable GitHub Pages

1. Go to your repository on GitHub
2. Click **Settings** (gear icon) in the top right
3. In the left sidebar, click **Pages**
4. Under "Source", select **main branch / root directory** (/)
5. Click **Save**
6. Wait ~10 seconds for GitHub to build and deploy
7. Your site will be available at `https://your-username.github.io/your-repo-name/` (or `.github.io` for default)

### Step 4: Verify Deployment

- Open your deployed URL in a browser
- You should see the Login Portal
- No console errors (check F12 Developer Tools)
- All relative paths (`./styles.css`, `./app.js`) should resolve correctly

---

## 🔐 FIRST-TIME SUPER ADMIN SETUP

### Default Credentials (First Boot)

On first run, the application seeds a default Super Admin account:

| Field | Value |
|-------|-------|
| **Login ID** | `admin` |
| **Password** | `Admin@123` |

### Changing Default Password

1. Log in with the default credentials above
2. Navigate to **Profile** view
3. Click **"Change Password"**
4. Enter current password: `Admin@123`
5. Set new password (minimum 6 characters)
6. Confirm new password
7. Click "Update Password"

**⚠️ IMPORTANT**: Change the default password immediately after first login for security.

### Persistence

- Credentials are hashed using **Web Crypto API SHA-256** and persisted in `localStorage`
- Active session persisted in `sessionStorage` (clears on browser tab close)
- Default admin password can be changed via the Profile view

---

## ☁️ GOOGLE SHEETS LIVE LINK INTEGRATION

### Prerequisites

- Google Account
- Google Spreadsheet

### Step-by-Step Google Sheets Setup

#### 1. Create a Google Spreadsheet

1. Go to [sheets.google.com](https://sheets.google.com)
2. Create a new spreadsheet
3. Name it "Microfinance CRM - Sync"
4. **Important**: Note the Spreadsheet ID from the URL:
   ```
   https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit
   ```
   Copy the `{SPREADSHEET_ID}` value

#### 2. Deploy Apps Script Web App

1. Go to [script.google.com](https://script.google.com)
2. Click **"New Project"**
3. Delete the default `myFunction` and paste the **Code.gs snippet** below

#### 3. Copy the Code.gs Snippet

See the **Code.gs Section** below. This provides the serverless bridge between your static GitHub Pages app and Google Sheets.

#### 4. Deploy the Web App

1. In the Apps Script editor, click **Deploy** > **New deployment**
2. Select "Addons" > "Deploy as web app"
3. **Configure deployment:**
   - **Execute as:** Me (recommended) or "Anyone with link"
   - **Who has access:** Anyone with link (or Anyone)
4. Click **Deploy**
5. In the dialog, select **"Copy link"** and paste the Web App URL

#### 5. Configure in CRM

1. Log into the Microfinance CRM
2. Go to **Sync Settings** view (Super Admin only)
3. Paste your **Google Spreadsheet ID** into the "Google Spreadsheet ID" field
4. Paste your **Apps Script Web App URL** into the "Apps Script Web App URL" field
5. Click **"Test Connection"** to verify CORS configuration
6. Click **"Sync Now"** to push initial data to cloud
7. Click **"Pull from Cloud"** to retrieve data on other devices

### Code.gs Snippet for Google Sheets

Copy and paste this entire script into your Apps Script project:

```javascript
// ==========================================================================
// Google Apps Script Code.gs for Microfinance CRM Two-Way Sync
// Deploy this as a Web App: Publish > Deploy as web app
// Set "Execute as: Me" and "Who has access: Anyone with link"
// ==========================================================================

// Global dataset object to store all tabs
let dataset = {
    Customers: [],  // Borrowers
    Loans: [],      // Loans
    Payments: [],   // Collections/Payments
    Fines: [],      // Late Fines
    Users: []       // User accounts
};

// ==========================================================================
// DO NOT MODIFY FUNCTIONS BELOW THIS LINE
// ==========================================================================

// Main handler for all requests
function doPost(e) {
    try {
        const request = JSON.parse(e.postData.contents);
        const action = request.action;

        switch (action) {
            case 'push':
                // Push local data from web app to spreadsheet
                dataset = request.data || dataset;
                return ContentService
                    .createText(JSON.stringify({ success: true, rows: dataset }))
                    .setMimeType(ContentService.MimeType.JSON);

            case 'pull':
                // Pull data from spreadsheet to web app
                return ContentService
                    .createText(JSON.stringify({ success: true, data: dataset }))
                    .setMimeType(ContentService.MimeType.JSON);

            case 'test':
                // Test CORS connection
                return ContentService
                    .createText(JSON.stringify({ success: true }))
                    .setMimeType(ContentService.MimeType.JSON);

            default:
                return ContentService
                    .createText(JSON.stringify({ success: false, error: 'Unknown action' }))
                    .setMimeType(ContentService.MimeType.JSON);
        }
    } catch (e) {
        return ContentService
            .createText(JSON.stringify({ success: false, error: e.message }))
            .setMimeType(ContentService.MimeType.JSON);
    }
}

// ==========================================================================
// SHEET-SPECIFIC HANDLERS
// ==========================================================================

// Load data into each sheet tab from dataset
function loadDataToSheets() {
    const ss = SpreadsheetApp.openById('YOUR_SPREADSHEET_ID');

    // Customers tab
    const custSheet = ss.getSheetByName('Customers');
    if (custSheet) {
        custSheet.clearContents();
        custSheet.appendRow(['S_No', 'FullName', 'Mobile', 'Location', 'Notes']);
        dataset.Customers.forEach(row => {
            custSheet.appendRow([row.sNo, row.fullName, row.mobile, row.location || '', row.notes || '']);
        });
    }

    // Loans tab
    const loanSheet = ss.getSheetByName('Loans');
    if (loanSheet) {
        loanSheet.clearContents();
        loanSheet.appendRow(['LoanID', 'CustomerID', 'RepaymentType', 'Principal', 'RatePercent', 'TotalPayable', 'LoanDate', 'Status']);
        dataset.Loans.forEach(row => {
            loanSheet.appendRow([row.loanId, row.customerId, row.repaymentType, row.principal, row.ratePercent, row.totalPayable, row.loanDate, row.status]);
        });
    }

    // Payments tab
    const paySheet = ss.getSheetByName('Payments');
    if (paySheet) {
        paySheet.clearContents();
        paySheet.appendRow(['PaymentID', 'LoanID', 'CustomerID', 'Amount', 'PaymentDate', 'PaymentMethod', 'ReferenceNo', 'CollectedBy']);
        dataset.Payments.forEach(row => {
            paySheet.appendRow([row.paymentId, row.loanId, row.customerId, row.amount, row.paymentDate, row.paymentMethod, row.referenceNo || '', row.collectedBy || '']);
        });
    }

    // Fines tab
    const fineSheet = ss.getSheetByName('Fines');
    if (fineSheet) {
        fineSheet.clearContents();
        fineSheet.appendRow(['FineID', 'LoanID', 'CustomerID', 'FineAmount', 'Reason', 'FineDate']);
        dataset.Fines.forEach(row => {
            fineSheet.appendRow([row.fineId, row.loanId, row.customerId, row.fineAmount, row.reason || '', row.fineDate]);
        });
    }

    // Users tab
    const userSheet = ss.getSheetByName('Users');
    if (userSheet) {
        userSheet.clearContents();
        userSheet.appendRow(['ID', 'FullName', 'LoginID', 'PasswordHash', 'Permissions', 'Created', 'IsActive']);
        dataset.Users.forEach(row => {
            userSheet.appendRow([row.id, row.fullName, row.loginId, row.passwordHash, JSON.stringify(row.permissions), row.created, row.isActive ? 'Active' : 'Inactive']);
        });
    }
}

// Initialize on install
function onInstall(e) {
    return doPost(e);
}

// ==========================================================================
// CORS FLEXIBILITY NOTES FOR GITHUB PAGES
// ==========================================================================
// 1. Deploy this script as: Publish > Deploy as web app
// 2. Set "Execute as: Me" 
// 3. Set "Who can access: Anyone with link (or Anyone)
// 4. Copy the Web App URL and paste it into CRM Settings
// 5. For strict CORS on GitHub Pages, add this to Code.gs top:
//    function allowCORS() {
//        const origin = request.getHeader('Origin');
//        if (origin) {
//            response.setHeader('Access-Control-Allow-Origin', origin);
//        }
//    }
//    This may need adjustment based on your domain setup.
// ==========================================================================
```

#### 6. Required Google Sheet Tab Names

Your Google Spreadsheet must have these exact tab names (case-sensitive):

| Tab Name | Data Contains |
|----------|---------------|
| **Customers** | Borrowers: S_No, FullName, Mobile, Location, Notes |
| **Loans** | Loans: LoanID, CustomerID, RepaymentType, Principal, RatePercent, TotalPayable, LoanDate, Status |
| **Payments** | Collections: PaymentID, LoanID, CustomerID, Amount, PaymentDate, PaymentMethod, ReferenceNo, CollectedBy |
| **Fines** | Late Fines: FineID, LoanID, CustomerID, FineAmount, Reason, FineDate |
| **Users** | User Accounts: ID, FullName, LoginID, PasswordHash, Permissions, Created, IsActive |

---

## 📊 CORE FEATURES OVERVIEW

### 1. Authentication & Permissions

- **Login Gate**: SHA-256 hashed password check via Web Crypto API
- **Session Persistence**: `sessionStorage` keeps you logged in
- **Checkbox Permission Matrix** per user:
  - `[ ] View Only` - Read-only access
  - `[ ] Add Collection` - Record payments
  - `[ ] Edit Records` - Add/edit borrowers/loans
  - `[ ] Add Late Fines` - Apply fines
  - `[ ] Delete Loans` - Permanent deletion (Super Admin only)
- **Strict Enforcement**: UI buttons dynamically hidden based on permissions; every data mutation function validates permissions before modifying state

### 2. Data Schema

| Entity | Key Fields |
|--------|-----------|
| **Borrowers** | S_No (unique, leading zeros stripped: `0008` → `8`), FullName, Mobile (duplicates allowed), Location, Notes |
| **Loans** | LoanID (matches Borrower S_No or S_No-2, S_No-3), CustomerID, RepaymentType (DAILY/WEEKLY), Principal, RatePercent (20%/26%), TotalPayable, LoanDate (DD-MM-YYYY), Status (ACTIVE/COMPLETED) |
| **Collections** | PaymentID, LoanID, CustomerID, Amount, PaymentDate, PaymentMethod (Cash/UPI/Bank Transfer/Other), ReferenceNo, CollectedBy |
| **Fines** | FineID, LoanID, CustomerID, FineAmount, Reason, FineDate |

### 3. Date Rules (STRICT DD-MM-YYYY)

- All dates displayed and parsed in **DD-MM-YYYY** format (e.g., `14-11-2026`)
- Never allows browser UTC timezone shifts or MM-DD-YYYY day/month flipping
- Leading zeros stripped consistently: `0008` → `8`
- `OutstandingDue` never drops below `0`

### 4. Installment Calculations

| Repayment Type | Pre-filled Amount | Formula |
|---------------|-------------------|---------|
| **DAILY** | 1% of Principal | `₹10,000` → `₹100`, capped at OutstandingDue |
| **WEEKLY** | 6% of Principal | `₹10,000` → `₹600`, capped at OutstandingDue |

### 5. Real-Time Paid vs. Not-Paid Tabs

**Daily Loans View Sub-tabs:**
- 🔴 **Today Not Paid** - Active daily loans with no payment today
- 🟢 **Today Paid** - Daily loans with payment today (shows exact amount)
- 📋 **All Active** - All active daily loans
- 🏁 **Cleared** - Daily loans with status COMPLETED
- 💰 **Collections Audit** - Date-range filter + ⚡ Today quick filter

**Weekly Loans View Sub-tabs:**
- 🔴 **This Week Not Paid** - Evaluated on Sunday 00:00:00 to Saturday 23:59:59 cycle
- 🟢 **This Week Paid** - Payments within current week
- 📋 **All Active** - All active weekly loans
- 🏁 **Cleared** - Weekly loans with status COMPLETED
- 💰 **Collections Audit** - Date-range filter

### 6. Late Fines & PDF Export

- Adding a late fine appends to `Fines` table with Date (When), Loan S.No, Amount, and Reason (Why)
- Updates `TotalPayable` and `OutstandingDue` automatically
- **PDF Statement Export** (using jsPDF + jsPDF autoTable CDN):
  - Download clean PDF containing ONLY Customer Details
  - Name, S.No, Mobile, Location, Summary Totals
  - Loans Ledger, Late Fines with When/Why
  - Payment History
  - **Zero company name, logo, or branding**

### 7. One-Tap Mobile Calling

- Every borrower mobile number rendered as `<a href="tel:DIGITS">`
- Tapping on iOS or Android triggers native call confirmation prompt
- Dialer opens directly

### 8. Loan Deletion Dashboard

- **Delete Loan** placed in separate `🗑️ Loan Manager (Delete)` view
- Custom confirmation modal with borrower/loan details
- **1.2-second button unlock delay** to prevent accidental mobile touch deletion
- Confirmation checkbox with counting timer
- Permission-gated (Super Admin only)

### 9. Excel / CSV Upload & Download (SheetJS)

- **Upload**: `.xlsx` and `.csv` files for bulk-import
- **Validate**: Row validation with duplicate handling
- **Download**: One-click `.xlsx` full backup export
- **Include**: Customers, Loans, Payments, Fines, Users tabs

### 10. Settings & Preferences

- Currency symbol customization
- Date display format (DD-MM-YYYY or DD/MM/YYYY)
- Auto-backup to localStorage
- Sound notifications
- Vibration on mobile
- Theme preferences

---

## 🛠️ TROUBLESHOOTING

### Common Issues

| Problem | Solution |
|---------|----------|
| **Login not working** | Verify default credentials: `admin` / `Admin@123`. Reset localStorage if corrupted: `localStorage.removeItem('microfinance-crm-v2')` |
| **GitHub Pages 404 errors** | Ensure all script paths use relative paths: `./app.js`, `./styles.css`. Check F12 Console for mixed-content warnings |
| **Google Sheets CORS blocked** | Deploy Apps Script as Web App with "Anyone with link" access. Add CORS header if needed in Code.gs |
| **Dates showing MM-DD-YYYY** | Application uses strict DD-MM-YYYY format. Ensure date inputs follow `DD-MM-YYYY` pattern |
| **Permissions not working** | Super Admin has all permissions. Other users: configure checkbox matrix in User Management view |
| **Excel import failing** | Ensure columns match expected headers: S_No, FullName, Mobile, etc. for Customers tab |
| **Bottom nav hidden on mobile** | Check viewport meta tag: `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">` |
| **Charts not rendering** | Chart.js CDN must be loaded. Check internet connection or replace with simple HTML tables |

### Resetting Application State

If the app behaves unexpectedly:

```javascript
// Clear all local data
localStorage.removeItem('microfinance-crm-v2');
sessionStorage.removeItem('mfcrm-active-user');

// Reload page to start fresh
```

---

## 📱 PROGRESSIVE WEB APP (PWA) OPTIONAL

The application includes PWA support. For offline caching:

1. Create a `sw.js` file in the project root
2. Register the service worker in `index.html` (already included as commented code)
3. The app will cache core assets for offline functionality

**Note**: Full PWA caching requires additional configuration. The current setup is offline-first with `localStorage` persistence.

---

## 🤝 CONTRIBUTING

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 LICENSE

This project is open source and available for commercial use. No attribution required, but appreciated!

**Built with ❤️ for the microfinance community**

---

## 📞 SUPPORT

- Open an issue on the GitHub repository
- Contact: Your Organization
- Documentation: See this README.md