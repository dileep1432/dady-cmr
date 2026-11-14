// ==========================================================================
// MICROFINANCE CRM - SHEETS-SYNC.JS
// Excel/.xlsx & CSV Import/Export via SheetJS CDN
// Google Sheets Live Link via Apps Script Web App Bridge
// GitHub Pages Compatible • 100% Static Host • Vanilla ES6+
// ==========================================================================

/**
 * Google Sheets Sync & SheetJS Excel/CSV Integration
 * Handles cloud persistence via Apps Script Web App and local Excel/CSV backup
 */

// Initialize sheets sync when DOM loads
document.addEventListener('DOMContentLoaded', () => {
    window.MicrofinanceCRM = window.MicrofinanceCRM || {};
    window.MicrofinanceCRM.initSheetsSync = initSheetsSync;
});

/**
 * Sheets Synchronisation Initialisation
 * Sets up UI elements, event listeners, and sync state
 */
function initSheetsSync() {
    'use strict';

    // Check if Google Sheets is configured
    const syncState = window.MicrofinanceCRM ? window.MicrofinanceCRM.getSyncState() : null;

    // Update UI based on sync state
    updateSyncUI(syncState);

    // =========================================================================
    // GOOGLE SHEETS CONNECTION
    // =========================================================================

    /**
     * Update sync UI elements
     * @param {object} syncState - Current sync state from app.js
     */
    function updateSyncUI(syncState) {
        const gsheetIdInput = document.getElementById('gsheet-id');
        const gscriptUrlInput = document.getElementById('gscript-url');
        const testBtn = document.getElementById('btn-test-sync');
        const syncNowBtn = document.getElementById('btn-sync-now');
        const pullFromCloudBtn = document.getElementById('btn-pull-from-cloud');
        const syncStatusDiv = document.getElementById('sync-status');
        const appsScriptCode = document.getElementById('apps-script-code');

        if (!gsheetIdInput || !gscriptUrlInput) return;

        if (syncState && syncState.googleSheetId) {
            // Sheets are configured
            gsheetIdInput.value = syncState.googleSheetId;
            gscriptUrlInput.value = syncState.googleWebAppUrl || '';

            if (testBtn) {
                testBtn.onclick = () => testSheetsConnection(syncState);
            }

            if (syncNowBtn) {
                syncNowBtn.onclick = () => syncToSheets(false);
            }

            if (pullFromCloudBtn) {
                pullFromCloudBtn.onclick = () => syncToSheets(true);
            }

            if (syncStatusDiv) {
                syncStatusDiv.innerHTML = `
                    <div class="form-help">✅ Google Sheets configured</div>
                    <div>Spreadsheet ID: ${syncState.googleSheetId}</div>
                    <div>Ready for sync operations</div>
                `;
            }

            if (appsScriptCode) {
                appsScriptCode.textContent = getAppsScriptSnippet(syncState.googleSheetId);
            }
        } else {
            // Sheets not configured
            if (gsheetIdInput) gsheetIdInput.value = '';
            if (gscriptUrlInput) gscriptUrlInput.value = '';

            if (testBtn) testBtn.onclick = () => showSheetsSetupGuide();

            if (syncStatusDiv) {
                syncStatusDiv.innerHTML = `
                    <div class="form-help">⚠️ Google Sheets not configured</div>
                    <p>Please paste your Google Spreadsheet ID and Apps Script Web App URL</p>
                    <div class="form-help small">1. Create a new Google Sheet</div>
                    <div class="form-help small">2. Deploy Apps Script as Web App</div>
                    <div class="form-help small">3. Paste the URL below</div>
                `;
            }

            if (appsScriptCode) {
                appsScriptCode.textContent = getAppsScriptSnippet();
            }
        }
    }

    /**
     * Test Google Sheets connection
     * @param {object} syncState - Sync state object
     */
    async function testSheetsConnection(syncState) {
        const testBtn = document.getElementById('btn-test-sync');
        const syncStatusDiv = document.getElementById('sync-status');

        if (!testBtn || !syncStatusDiv || !syncState) return;

        testBtn.disabled = true;
        testBtn.textContent = 'Testing...';
        syncStatusDiv.innerHTML = '<div class="form-help">🔗 Testing connection...</div>';

        try {
            // Use the Apps Script web app URL for testing
            const webAppUrl = syncState.googleWebAppUrl || document.getElementById('gscript-url').value;

            if (!webAppUrl) {
                showToast('No Web App URL configured', 'error');
                return;
            }

            // Test endpoint: append a timeout parameter to verify CORS
            const testUrl = `${webAppUrl}?action=test`;

            const response = await fetch(testUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                },
                cache: 'no-cache',
                mode: 'cors' // Enable CORS for GitHub Pages
            });

            const data = await response.json();

            if (data.success) {
                showToast('Google Sheets connection successful', 'success');
                if (syncStatusDiv) {
                    syncStatusDiv.innerHTML = `
                        <div class="form-help">✅ Connection successful</div>
                        <div>Spreadsheet ID: ${syncState.googleSheetId}</div>
                    `;
                }
            } else {
                showToast(`Connection failed: ${data.error || 'Unknown error'}`, 'error');
                if (syncStatusDiv) {
                    syncStatusDiv.innerHTML = `
                        <div class="form-help">❌ Connection failed</div>
                        <div>${data.error || 'Check CORS configuration'}</div>
                    `;
                }
            }
        } catch (error) {
            console.error('Sheets connection test error:', error);
            showToast('Connection test failed. Check CORS and URL.', 'error');
            if (syncStatusDiv) {
                syncStatusDiv.innerHTML = `
                    <div class="form-help">❌ Connection failed</div>
                    <div>Network error or CORS blocked</div>
                `;
            }
        } finally {
            testBtn.disabled = false;
            testBtn.textContent = '🔗 Test Connection';
        }
    }

    /**
     * Sync data to/from Google Sheets
     * @param {boolean} pull - If true, pull from cloud; if false, push to cloud
     */
    async function syncToSheets(pull) {
        const syncStatusDiv = document.getElementById('sync-status');
        const syncNowBtn = document.getElementById('btn-sync-now');
        const pullFromCloudBtn = document.getElementById('btn-pull-from-cloud');

        if (!syncStatusDiv) return;

        // Show sync in progress
        syncStatusDiv.innerHTML = '<div class="form-help">☁️ Syncing...</div>';

        if (syncNowBtn) syncNowBtn.disabled = true;
        if (pullFromCloudBtn) pullFromCloudBtn.disabled = true;

        try {
            // Build and send sync payload
            const payload = buildSyncPayload(pull);
            const webAppUrl = document.getElementById('gscript-url')?.value || '';

            if (!webAppUrl) {
                showToast('No Apps Script Web App URL configured', 'error');
                resetSyncUI();
                return;
            }

            const action = pull ? 'pull' : 'push';
            const response = await fetch(`${webAppUrl}?action=${action}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload),
                cache: 'no-cache',
                mode: 'cors'
            });

            const data = await response.json();

            if (data.success) {
                // Refresh local state from synced data
                if (pull && data.data) {
                    refreshStateFromPayload(data.data);
                }

                showToast(`Sync ${pull ? 'from' : 'to'} cloud successful`, 'success');

                // Update UI
                const syncState = window.MicrofinanceCRM ? window.MicrofinanceCRM.getSyncState() : null;
                updateSyncUI(syncState);

                // Re-render dashboard and tables
                if (window.MicrofinanceCRM && window.MicrofinanceCRM.renderDashboard) {
                    window.MicrofinanceCRM.renderDashboard();
                }
            } else {
                showToast(`Sync failed: ${data.error || 'Unknown error'}`, 'error');
                if (syncStatusDiv) {
                    syncStatusDiv.innerHTML = `
                        <div class="form-help">❌ Sync failed</div>
                        <div>${data.error || 'See console for details'}</div>
                    `;
                }
            }
        } catch (error) {
            console.error('Sheets sync error:', error);
            showToast('Sync failed. Check network, CORS, and Apps Script deployment.', 'error');
            if (syncStatusDiv) {
                syncStatusDiv.innerHTML = `
                    <div class="form-help">❌ Sync error</div>
                    <div>See console for details</div>
                `;
            }
        } finally {
            resetSyncUI();
        }
    }

    /**
     * Build sync payload for Google Apps Script
     * @param {boolean} pull - If true, pull data from cloud; if false, push local data
     * @returns {object} - Sync payload
     */
    function buildSyncPayload(pull) {
        const sheetId = document.getElementById('gsheet-id')?.value || '';

        if (pull) {
            // Pull: request all tabs from cloud
            return {
                action: 'pull',
                sheetId: sheetId || '',
                timestamp: new Date().toISOString()
            };
        } else {
            // Push: send all local data tabs
            return {
                action: 'push',
                sheetId: sheetId || '',
                data: {
                    customers: window.MicrofinanceCRM ? window.MicrofinanceCRM.getBorrowers() || [] : [],
                    loans: window.MicrofinanceCRM ? window.MicrofinanceCRM.getLoans() || [] : [],
                    payments: window.MicrofinanceCRM ? window.MicrofinanceCRM.getPayments() || [] : [],
                    fines: window.MicrofinanceCRM ? window.MicrofinanceCRM.getFines() || [] : [],
                    users: window.MicrofinanceCRM ? window.MicrofinanceCRM.getUsers() || [] : []
                },
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Refresh local state from synced payload
     * @param {object} data - Synced data from cloud
     */
    function refreshStateFromPayload(data) {
        if (!data) return;

        if (window.MicrofinanceCRM && window.MicrofinanceCRM.refreshStateFromPayload) {
            window.MicrofinanceCRM.refreshStateFromPayload(data);
        } else {
            // Fallback: manually update state
            if (data.customers && Array.isArray(data.customers)) {
                window.MicrofinanceCRM.state.borrowers = data.customers.map(c => ({
                    sNo: parseInt(c.sNo, 10).toString().padStart(4, '0') || '0001',
                    fullName: c.fullName || '',
                    mobile: c.mobile || '',
                    location: c.location || '',
                    notes: c.notes || ''
                }));
            }

            if (data.loans && Array.isArray(data.loans)) {
                window.MicrofinanceCRM.state.loans = data.loans.map(l => ({
                    loanId: l.loanId || `${l.customerId}-${l.id || 1}`,
                    customerId: l.customerId || '',
                    repaymentType: l.repaymentType || 'DAILY',
                    principal: parseFloat(l.principal) || 0,
                    ratePercent: parseFloat(l.ratePercent) || 20,
                    totalPayable: parseFloat(l.totalPayable) || 0,
                    loanDate: l.loanDate || new Date().toISOString().split('T')[0],
                    status: l.status || 'ACTIVE'
                }));
            }

            if (data.payments && Array.isArray(data.payments)) {
                window.MicrofinanceCRM.state.payments = data.payments.map(p => ({
                    paymentId: p.paymentId || generateId('pay'),
                    loanId: p.loanId || '',
                    customerId: p.customerId || '',
                    amount: parseFloat(p.amount) || 0,
                    paymentDate: p.paymentDate || new Date().toISOString().split('T')[0],
                    paymentMethod: p.paymentMethod || 'Cash',
                    referenceNo: p.referenceNo || '',
                    collectedBy: p.collectedBy || ''
                }));
            }

            if (data.fines && Array.isArray(data.fines)) {
                window.MicrofinanceCRM.state.fines = data.fines.map(f => ({
                    fineId: f.fineId || generateId('fine'),
                    loanId: f.loanId || '',
                    customerId: f.customerId || '',
                    fineAmount: parseFloat(f.fineAmount) || 0,
                    reason: f.reason || '',
                    fineDate: f.fineDate || new Date().toISOString().split('T')[0]
                }));
            }

            if (data.users && Array.isArray(data.users)) {
                window.MicrofinanceCRM.state.users = data.users.map(u => ({
                    id: u.id || generateId('user'),
                    fullName: u.fullName || '',
                    loginId: u.loginId || '',
                    passwordHash: u.passwordHash || '',
                    permissions: u.permissions || { viewOnly: false, addCollection: false, editRecords: false, addLateFine: false, deleteLoan: false },
                    created: u.created || new Date().toISOString(),
                    isActive: u.isActive !== false
                }));
            }
        }
    }

    // =========================================================================
    // EXCEL / CSV UPLOAD & DOWNLOAD (SheetJS)
    // =========================================================================

    /**
     * Export all data to Excel (.xlsx) file
     * @param {string} filename - Suggested filename
     */
    window.MicrofinanceCRM.exportToExcel = function(filename = 'microfinance-crm-backup.xlsx') {
        'use strict';

        // SheetJS already loaded via CDN in index.html
        try {
            const workbook = SSF._ssf;
            const worksheetNames = ['Customers', 'Loans', 'Payments', 'Fines', 'Users'];
            const worksheetData = {

                Customers: window.MicrofinanceCRM ? window.MicrofinanceCRM.getBorrowers() || [] : []().map(b => ({
                    S_No: b.sNo,
                    FullName: b.fullName,
                    Mobile: b.mobile,
                    Location: b.location || '',
                    Notes: b.notes || ''
                })),

                Loans: window.MicrofinanceCRM ? window.MicrofinanceCRM.getLoans() || [] : []().map(l => ({
                    LoanID: l.loanId,
                    CustomerID: l.customerId,
                    RepaymentType: l.repaymentType,
                    Principal: l.principal,
                    RatePercent: l.ratePercent,
                    TotalPayable: l.totalPayable,
                    LoanDate: l.loanDate,
                    Status: l.status
                })),

                Payments: window.MicrofinanceCRM ? window.MicrofinanceCRM.getPayments() || [] : []().map(p => ({
                    PaymentID: p.paymentId,
                    LoanID: p.loanId,
                    CustomerID: p.customerId,
                    Amount: p.amount,
                    PaymentDate: p.paymentDate,
                    PaymentMethod: p.paymentMethod,
                    ReferenceNo: p.referenceNo || '',
                    CollectedBy: p.collectedBy || ''
                })),

                Fines: window.MicrofinanceCRM ? window.MicrofinanceCRM.getFines() || [] : []().map(f => ({
                    FineID: f.fineId,
                    LoanID: f.loanId,
                    CustomerID: f.customerId,
                    FineAmount: f.fineAmount,
                    Reason: f.reason || '',
                    FineDate: f.fineDate
                })),

                Users: window.MicrofinanceCRM ? window.MicrofinanceCRM.getUsers() || [] : []().map(u => ({
                    ID: u.id,
                    FullName: u.fullName,
                    LoginID: u.loginId,
                    PasswordHash: u.passwordHash,
                    Permissions: JSON.stringify(u.permissions),
                    Created: u.created,
                    IsActive: u.isActive ? 'Active' : 'Inactive'
                }))
            };

            // Build workbook
            const wb = XLSX.utils.book_new();

            worksheetNames.forEach((name, index) => {
                const data = worksheetData[name];
                const ws = data.length > 0 ? XLSX.utils.json_to_sheet(data, { header: Object.keys(data[0] || {}) }) : {};
                wb.SheetNames.push(name);
                wb.Sheets[name] = ws;
            });

            // Generate and trigger download
            const excelBinary = XLSX.write(wb, { bookType: 'xlsx', type: 'binary' });
            const blob = new Blob([S2AB(excelBinary)], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);

            showToast('Excel backup exported successfully', 'success');
        } catch (error) {
            console.error('Excel export error:', error);
            showToast('Failed to export Excel file', 'error');
        }
    };

    /**
     * Import data from uploaded Excel (.xlsx) or CSV file
     * @param {File} file - Uploaded file
     * @param {function} callback - Callback with import results
     */
    window.MicrofinanceCRM.importFromFile = async function(file, callback) {
        'use strict';

        if (!file) {
            showToast('No file selected', 'error');
            if (callback) callback({ errors: ['No file selected'] });
            return;
        }

        const reader = new FileReader();

        reader.onload = async (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });

                const results = {
                    customers: [],
                    loans: [],
                    payments: [],
                    fines: [],
                    users: [],
                    errors: [],
                    warnings: []
                };

                // Import each sheet
                workbook.SheetNames.forEach(sheetName => {
                    const worksheet = workbook.SheetNames[sheetName];
                    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[worksheet]);

                    if (sheetName === 'Customers' || sheetName === 'Borrowers') {
                        rows.forEach(row => {
                            const sNo = row.S_No ? String(parseInt(row.S_No, 10)).padStart(4, '0') : '0';
                            results.customers.push({
                                sNo,
                                fullName: row.FullName || row.Name || '',
                                mobile: row.Mobile || row.Phone || '',
                                location: row.Location || row.Address || '',
                                notes: row.Notes || ''
                            });
                        });
                    } else if (sheetName === 'Loans') {
                        rows.forEach(row => {
                            results.loans.push({
                                loanId: row.LoanID || `${row.CustomerID}-${row.id || 1}`,
                                customerId: row.CustomerID || '',
                                repaymentType: row.RepaymentType || 'DAILY',
                                principal: parseFloat(row.Principal) || 0,
                                ratePercent: parseFloat(row.RatePercent) || 20,
                                totalPayable: parseFloat(row.TotalPayable) || 0,
                                loanDate: row.LoanDate || new Date().toISOString().split('T')[0],
                                status: row.Status || 'ACTIVE'
                            });
                        });
                    } else if (sheetName === 'Payments' || sheetName === 'Collections') {
                        rows.forEach(row => {
                            results.payments.push({
                                paymentId: row.PaymentID || generateId('pay'),
                                loanId: row.LoanID || '',
                                customerId: row.CustomerID || '',
                                amount: parseFloat(row.Amount) || 0,
                                paymentDate: row.PaymentDate || new Date().toISOString().split('T')[0],
                                paymentMethod: row.PaymentMethod || 'Cash',
                                referenceNo: row.ReferenceNo || '',
                                collectedBy: row.CollectedBy || ''
                            });
                        });
                    } else if (sheetName === 'Fines') {
                        rows.forEach(row => {
                            results.fines.push({
                                fineId: row.FineID || generateId('fine'),
                                loanId: row.LoanID || '',
                                customerId: row.CustomerID || '',
                                fineAmount: parseFloat(row.FineAmount) || 0,
                                reason: row.Reason || '',
                                fineDate: row.FineDate || new Date().toISOString().split('T')[0]
                            });
                        });
                    } else if (sheetName === 'Users') {
                        rows.forEach(row => {
                            if (row.FullName || row.LoginID) {
                                results.users.push({
                                    id: row.ID || generateId('user'),
                                    fullName: row.FullName || '',
                                    loginId: row.LoginID || '',
                                    passwordHash: row.PasswordHash || sha256Hash('Temp@123'),
                                    permissions: parsePermissions(row.Permissions || ''),
                                    created: row.Created || new Date().toISOString(),
                                    isActive: row.IsActive !== 'Inactive'
                                });
                            }
                        });
                    }
                });

                // Validate imported data
                results.errors = validateImportData(results);

                // Merge with existing state
                if (results.errors.length === 0 && (results.customers.length > 0 || results.loans.length > 0)) {
                    mergeImportedData(results);
                    saveStateToStorage();
                    renderDashboard();
                    showToast(`Imported ${results.customers.length} customers, ${results.loans.length} loans`, 'success');
                } else if (results.errors.length > 0) {
                    const errorSummary = results.errors.slice(0, 3).map(e => e.message).join('; ');
                    showToast(`Import completed with ${results.errors.length} errors`, 'warning');
                } else {
                    showToast('No valid records found in import file', 'warning');
                }

                if (callback) callback(results);
            } catch (error) {
                console.error('Excel import error:', error);
                showToast('Failed to import Excel file. Check format.', 'error');
                if (callback) callback({ errors: ['Import failed: ' + error.message] });
            }
        };

        reader.onerror = () => {
            showToast('Error reading file', 'error');
            if (callback) callback({ errors: ['File read error'] });
        };

        reader.readAsArrayBuffer(file);
    };

    /**
     * Validate imported data for errors
     * @param {object} results - Import results so far
     * @returns {array} - Array of error objects
     */
    function validateImportData(results) {
        'use strict';
        const errors = [];

        if (results.customers) {
            results.customers.forEach((c, idx) => {
                if (!c.fullName || c.fullName.trim().length < 2) {
                    errors.push({ type: 'customer', index: idx, message: `Row ${idx + 1}: Invalid or missing Full Name` });
                }
                if (!c.mobile || !/^[0-9+\-\s]{10,15}$/.test(c.mobile)) {
                    errors.push({ type: 'customer', index: idx, message: `Row ${idx + 1}: Invalid mobile number` });
                }
                if (!c.sNo || c.sNo === '0') {
                    errors.push({ type: 'customer', index: idx, message: `Row ${idx + 1}: Invalid S_No` });
                }
            });
        }

        if (results.loans) {
            results.loans.forEach((l, idx) => {
                if (!l.customerId) {
                    errors.push({ type: 'loan', index: idx, message: `Row ${idx + 1}: Missing CustomerID` });
                }
                if (!l.principal || l.principal <= 0) {
                    errors.push({ type: 'loan', index: idx, message: `Row ${idx + 1}: Invalid Principal amount` });
                }
                if (!l.loanDate) {
                    errors.push({ type: 'loan', index: idx, message: `Row ${idx + 1}: Missing LoanDate` });
                } else if (!formatDateDDMMYYYY(l.loanDate)) {
                    errors.push({ type: 'loan', index: idx, message: `Row ${idx + 1}: Invalid LoanDate format. Use DD-MM-YYYY` });
                }
            });
        }

        return errors;
    }

    /**
     * Parse permission string from Excel import
     * @param {string} permStr
     * @returns {object}
     */
    function parsePermissions(permStr) {
        'use strict';
        const perms = {
            viewOnly: false,
            addCollection: false,
            editRecords: false,
            addLateFine: false,
            deleteLoan: false
        };

        if (!permStr) return perms;

        const permMap = {
            'viewOnly': 'viewOnly',
            'addCollection': 'addCollection',
            'editRecords': 'editRecords',
            'addLateFine': 'addLateFine',
            'deleteLoan': 'deleteLoan'
        };

        const foundPerms = permStr.split(',').map(p => p.trim());
        foundPerms.forEach(p => {
            if (permMap[p]) {
                perms[permMap[p]] = true;
            }
        });

        return perms;
    }

    /**
     * Merge imported data with existing state
     * @param {object} results - Import results from importFromFile
     */
    function mergeImportedData(results) {
        'use strict';

        // Merge customers
        if (results.customers) {
            results.customers.forEach(newCustomer => {
                const existingIdx = window.MicrofinanceCRM ? window.MicrofinanceCRM.state.borrowers.findIndex(
                    b => b.sNo === newCustomer.sNo
                ) : -1;

                if (existingIdx >= 0) {
                    // Update existing
                    window.MicrofinanceCRM.state.borrowers[existingIdx] = {
                        ...window.MicrofinanceCRM.state.borrowers[existingIdx],
                        ...newCustomer,
                        fullName: newCustomer.fullName || window.MicrofinanceCRM.state.borrowers[existingIdx].fullName,
                        mobile: newCustomer.mobile || window.MicrofinanceCRM.state.borrowers[existingIdx].mobile
                    };
                } else {
                    // Add new
                    newCustomer.sNo = parseInt(newCustomer.sNo, 10).toString().padStart(4, '0') || '0001';
                    window.MicrofinanceCRM.state.borrowers.push({
                        sNo: newCustomer.sNo,
                        fullName: newCustomer.fullName,
                        mobile: newCustomer.mobile,
                        location: newCustomer.location,
                        notes: newCustomer.notes
                    });
                }
            });
        }

        // Merge loans
        if (results.loans) {
            results.loans.forEach(newLoan => {
                const existingIdx = window.MicrofinanceCRM ? window.MicrofinanceCRM.state.loans.findIndex(
                    l => l.loanId === newLoan.loanId || (l.customerId === newLoan.customerId && l.loanDate === newLoan.loanDate)
                ) : -1;

                if (existingIdx >= 0) {
                    window.MicrofinanceCRM.state.loans[existingIdx] = {
                        ...window.MicrofinanceCRM.state.loans[existingIdx],
                        ...newLoan
                    };
                } else {
                    window.MicrofinanceCRM.state.loans.push(newLoan);
                }
            });
        }

        // Merge payments
        if (results.payments) {
            results.payments.forEach(newPayment => {
                const duplicateIdx = window.MicrofinanceCRM ? window.MicrofinanceCRM.state.payments.findIndex(
                    p => p.loanId === newPayment.loanId &&
                         p.paymentDate === newPayment.paymentDate &&
                         Math.abs(p.amount - newPayment.amount) < 0.01
                ) : -1;

                if (duplicateIdx >= 0) {
                    window.MicrofinanceCRM.state.payments[duplicateIdx] = {
                        ...window.MicrofinanceCRM.state.payments[duplicateIdx],
                        ...newPayment
                    };
                } else {
                    window.MicrofinanceCRM.state.payments.push(newPayment);
                }
            });
        }

        // Merge fines
        if (results.fines) {
            results.fines.forEach(newFine => {
                const duplicateIdx = window.MicrofinanceCRM ? window.MicrofinanceCRM.state.fines.findIndex(
                    f => f.loanId === newFine.loanId &&
                         f.fineDate === newFine.fineDate &&
                         Math.abs(f.fineAmount - newFine.fineAmount) < 0.01
                ) : -1;

                if (duplicateIdx >= 0) {
                    window.MicrofinanceCRM.state.fines[duplicateIdx] = {
                        ...window.MicrofinanceCRM.state.fines[duplicateIdx],
                        ...newFine
                    };
                } else {
                    window.MicrofinanceCRM.state.fines.push(newFine);
                }
            });
        }

        // Save and re-render
        saveStateToStorage();
        if (window.MicrofinanceCRM && window.MicrofinanceCRM.renderDashboard) {
            window.MicrofinanceCRM.renderDashboard();
        }
    }

    // =========================================================================
    // GOOGLE APPS SCRIPT SNIPPET
    // =========================================================================

    /**
     * Get Apps Script Code.gs snippet for Google Sheets integration
     * @param {string} sheetId - Optional spreadsheet ID to include in snippet
     * @returns {string} - Code.gs code
     */
    window.MicrofinanceCRM.getAppsScriptSnippet = function(sheetId) {
        'use strict';

        const id = sheetId || 'YOUR_SPREADSHEET_ID_HERE';

        return `// ==========================================================================
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
    const ss = SpreadsheetApp.openById('${id}');

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
// ==========================================================================`;
    };

    /**
     * Get default Apps Script snippet (no sheet ID)
     * @returns {string}
     */
    function getAppsScriptSnippet() {
        return window.MicrofinanceCRM.getAppsScriptSnippet();
    }

    // =========================================================================
    // UTILITY: Show Toast
    // =========================================================================

    /**
     * Show a toast notification
     * @param {string} message - Toast message
     * @param {string} type - Toast type (success, error, warning, info)
     */
    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toastTypes = {
            success: 'toast-success',
            error: 'toast-error',
            warning: 'toast-warning',
            info: 'toast-info'
        };

        const typeClass = toastTypes[type] || 'toast-info';
        const iconMap = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };

        const toast = document.createElement('div');
        toast.className = `toast ${typeClass}`;
        toast.innerHTML = `
            <span class="toast-icon">${iconMap[type] || 'ℹ️'}</span>
            <span class="toast-message">${message}</span>
            <button class="toast-close" aria-label="Close toast">✕</button>
        `;

        container.appendChild(toast);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (toast.parentElement) {
                toast.remove();
            }
        }, 5000);

        // Handle close button
        const closeBtn = toast.querySelector('.toast-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                if (toast.parentElement) {
                    toast.remove();
                }
            });
        }
    }

    // =========================================================================
    // INITIAL STATE HELPERS (exposed for app.js integration)
    // =========================================================================

    /**
     * Get current sync state
     * @returns {object}
     */
    window.MicrofinanceCRM.getSyncState = function() {
        'use strict';
        return {
            googleSheetId: state.sync?.googleSheetId || localStorage.getItem('mfcrm-google-sheet-id') || null,
            googleWebAppUrl: state.sync?.googleWebAppUrl || localStorage.getItem('mfcrm-google-webapp-url') || null
        };
    };

    /**
     * Get borrowers array
     * @returns {array}
     */
    window.MicrofinanceCRM.getBorrowers = function() {
        'use strict';
        return state?.borrowers || [];
    };

    /**
     * Get loans array
     * @returns {array}
     */
    window.MicrofinanceCRM.getLoans = function() {
        'use strict';
        return state?.loans || [];
    };

    /**
     * Get payments array
     * @returns {array}
     */
    window.MicrofinanceCRM.getPayments = function() {
        'use strict';
        return state?.payments || [];
    };

    /**
     * Get fines array
     * @returns {array}
     */
    window.MicrofinanceCRM.getFines = function() {
        'use strict';
        return state?.fines || [];
    };

    /**
     * Get users array
     * @returns {array}
     */
    window.MicrofinanceCRM.getUsers = function() {
        'use strict';
        return state?.users || [];
    };

    // Initial UI update
    setTimeout(updateSyncUI, 100);
}