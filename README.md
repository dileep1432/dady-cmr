# Microfinance & Loan Management CRM (Salesforce LWC + Apex)

Custom login, staff permission matrix, Daily/Weekly paid-vs-not-paid tracking, late fines, customer profile with clean PDF statement, click-to-call, Loan Manager (Delete), Excel/CSV bulk upload and Google Sheets sync.

## 1. Deploy (Developer Org)
```bash
sf org login web --alias crm-dev
sf project deploy start --source-dir force-app --target-org crm-dev
sf apex run test --class-names CrmTests --result-format human --code-coverage --target-org crm-dev
```
Then in the org:
1. Setup > Permission Sets > **CRM App User** > Manage Assignments: assign it to every Salesforce user who will open the app.
2. Developer Console > Debug > Open Execute Anonymous Apex:
   `System.debug(DatabaseInitializer.runDefault());` creates Super Admin `admin` with a random one-time password (read it in the debug log).
   Or choose your own: `System.debug(DatabaseInitializer.run('owner','A-long-password-1'));`
3. App Launcher > **Microfinance CRM** (or add the `crmAppContainer` component to any App/Home/Tab page, or an Experience Cloud page).
4. Log in with the Super Admin, open **Users** and create staff accounts with the checkboxes.

## 2. Google Sheets setup (Super Admin > Excel & Sheets)
1. Google Cloud: enable the Google Sheets API, create a **service account**, create a JSON key.
2. Create the spreadsheet and share it (Editor) with the service account email.
3. Paste Spreadsheet ID (or URL), `client_email`, and `private_key` (the whole PEM) and Save, then **Test Connection**.
4. Tabs `Customers`, `Loans`, `Payments`, `Fines` are created automatically. Column A holds the Salesforce Id so edits update the right row.
5. Tick **Auto-sync** to push every new/changed record, or use **Sync All** / **Import from Google Sheet**.

## 3. How the rules map to the code
| Requirement | Where |
|---|---|
| Interest 20% DAILY / 26% WEEKLY, Total Payable = Principal x (1+rate) + fines, Total Paid, Status, Loan Code (`S.No`, `S.No-2`...) | `LoanRecalcService` + triggers on Loan/Collection/Late Fine |
| Outstanding Due | formula field `Loan_Account__c.Outstanding_Due__c` |
| Installment pre-fill 1% daily / 6% weekly, capped to outstanding | `LoanCrmController.defaultInstallment` (shown in the Collect modal) |
| Today / current-week (Sunday-Saturday) tabs | `LoanCrmController.getLoans`, `CrmUtil.weekStart` |
| Permission checks on every `@AuraEnabled` method | `AuthController.require(token, PERM_*)` |
| Hidden buttons | `crmLoanTracker`, `customerProfile`, `crmCustomersView`, `crmAppContainer` read `session.can*` |
| Delete only in its own tab, 1.2 s unlock | `loanDeleteManager` |
| DD-MM-YYYY | `crmDateInput`, `crmUtils.formatDate`, `CrmUtil.formatDate` |
| Customer-only PDF | `CustomerStatementPDF.page` + `CustomerStatementController` (5-minute token) |
| Click-to-call | `<a href="tel:...">` in lists and profile |

Permission rules: Super Admin can do everything. **View Only** blocks every write for that user. Otherwise: Add Collection = record payments; Edit Records = add/edit customers and loans (and import them); Add Late Fines = fines; Delete Loans = Loan Manager tab. Only Super Admin sees Users and Google settings.

## 4. Decisions you should know about
- **Passwords** are stored as salted, 3,000-round SHA-256 (`v1$rounds$salt$hash`), not a bare hash. Five wrong attempts lock the account for 15 minutes.
- **Sessions** are stateless HMAC-signed tokens (12 h). Log out discards the token in the browser; deactivating a user cuts access immediately because the user is re-checked on every call. The signing secret lives in `CRM_Config__c`.
- **Apex runs `without sharing`** by design: the custom token and checkboxes are the access control. `CRM_Staff_User__c` and `CRM_Config__c` are Private and the permission set grants no object access, so ordinary users cannot read hashes or the Google key through standard Salesforce UI. Salesforce admins can, so keep admin access tight.
- **Google auth** uses Remote Site Settings plus a JWT signed in Apex (Named Credentials cannot do service-account JWT). The private key is stored in `CRM_Config__c.Private_Key__c`; enable Shield Platform Encryption on it if you have it. It is never sent back to the browser.
- Sheet writes use `RAW`, so text like `=1+1` is stored as text, never evaluated.
- **Overpayments are rejected** (amount > outstanding). Say if you want them allowed.
- "Today" uses the Salesforce user's timezone on the server.
- The PDF shows `Rs.` instead of the rupee symbol because the PDF renderer's default fonts lack the glyph.
- On Experience Cloud, set `pdf-path` on `customerProfile` to your site's Visualforce path and use authenticated (not guest) users.

## 5. Limits
- Sync All writes up to 10,000 rows per tab; Import from Google Sheet reads up to 1,000 rows per tab per run (use the file uploader in batches for more).
- Deleting a loan is not mirrored to the sheet until the next **Sync All**.
- Re-importing a payment/fine that already exists (same loan, date, amount, reference/reason) is skipped as a duplicate.
- Upload only files you trust: SheetJS 0.18.5 (the last build on npm) has known issues with maliciously crafted spreadsheets.

## 6. What was and was not verified
Apex files parse cleanly with the Apex ANTLR grammar, and every LWC file compiles with `@lwc/compiler` and passes the template-anti-pattern linter. It has **not** been deployed to an org, and the Apex tests and code analyzer have **not** been run (there is no org in this environment), so expect to fix a few compile or test details on first deploy.
