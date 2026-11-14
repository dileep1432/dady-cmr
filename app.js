// ==========================================================================
// MICROFINANCE CRM - APP.JS (Core State Engine, Auth, Permissions, Calculators, Renderers)
// GitHub Pages Compatible • 100% Static Host • Vanilla ES6+
// ==========================================================================

/**
 * Core State Management & Data Store
 * All data persisted in localStorage with Google Sheets sync bridge
 */

// Initialise app when DOM loads
document.addEventListener('DOMContentLoaded', () => {
    window.MicrofinanceCRM = window.MicrofinanceCRM || {};
    window.MicrofinanceCRM.init = initApp;
});

/**
 * Main Application Initialisation
 * Sets up state, authentication, event listeners, and renders initial view
 */
function initApp() {
    'use strict';

    // =========================================================================
    // STATE: Central state object holding all CRM data and active user
    // =========================================================================
    const state = {
        // Active authenticated user
        activeUser: null,

        // Users data: [{ id, fullName, loginId, passwordHash, permissions, created, isActive }]
        users: [],

        // Borrowers data: [{ sNo, fullName, mobile, location, notes }]
        borrowers: [],

        // Loans data: [{ loanId, customerId, repaymentType, principal, ratePercent,
        //                 totalPayable, loanDate, status, created }]
        loans: [],

        // Collections/Payments: [{ paymentId, loanId, customerId, amount, paymentDate,
        //                            paymentMethod, referenceNo, collectedBy }]
        payments: [],

        // Fines/Late Fines: [{ fineId, loanId, customerId, fineAmount, reason, fineDate }]
        fines: [],

        // Settings
        settings: {
            currency: '₹',
            dateFormat: 'DD-MM-YYYY',
            autoBackup: true,
            soundEnabled: true,
            vibrationEnabled: false
        },

        // Sync state
        sync: {
            googleSheetId: null,
            googleWebAppUrl: null,
            isSyncing: false
        },

        // UI preferences
        ui: {
            theme: 'light',
            compactView: false
        }
    };

    // =========================================================================
    // SETUP: Initialize from localStorage or seed defaults
    // =========================================================================
    function loadStateFromStorage() {
        // Try to load existing state from localStorage
        const stored = localStorage.getItem('microfinance-crm-v2');

        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                // Merge loaded state with defaults, preserving structure
                Object.assign(state, parsed);

                // Ensure settings exist
                if (!state.settings) state.settings = { currency: '₹', dateFormat: 'DD-MM-YYYY', autoBackup: true, soundEnabled: true, vibrationEnabled: false };
                if (!state.ui) state.ui = { theme: 'light', compactView: false };

                // Ensure arrays exist
                if (!Array.isArray(state.users)) state.users = [];
                if (!Array.isArray(state.borrowers)) state.borrowers = [];
                if (!Array.isArray(state.loans)) state.loans = [];
                if (!Array.isArray(state.payments)) state.payments = [];
                if (!Array.isArray(state.fines)) state.fines = [];

                // Migrate legacy S_No values (strip leading zeros)
                state.borrowers.forEach(b => {
                    if (typeof b.sNo === 'string' && b.sNo.startsWith('0')) {
                        b.sNo = parseInt(b.sNo, 10).toString();
                    }
                });

                // Migrate legacy loan dates
                state.loans.forEach(l => {
                    if (l.loanDate && typeof l.loanDate === 'string' && !l.loanDate.includes('-')) {
                        // Assume MM-DD-YYYY, convert to DD-MM-YYYY
                        const parts = l.loanDate.split('-');
                        if (parts.length === 3) {
                            const month = parseInt(parts[0], 10);
                            const day = parseInt(parts[1], 10);
                            const year = parts[2];
                            if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                                l.loanDate = `${day}-${month}-${year}`;
                            }
                        }
                    }
                });

            } catch (e) {
                console.warn('Failed to parse stored state, starting fresh:', e);
                startFreshState();
            }
        } else {
            startFreshState();
        }
    }

    /**
     * Seed default Super Admin account on first boot
     * Password: Admin@123 (SHA-256 hashed)
     */
    function startFreshState() {
        // Create default Super Admin with hashed password
        const defaultAdmin = createDefaultAdminAccount();
        state.users.push(defaultAdmin);

        // Save immediately so default admin is available
        saveStateToStorage();

        console.log('Fresh state initialized with default Super Admin account');
    }

    /**
     * Create the default Super Admin user object with SHA-256 hashed password
     * @returns {{id, fullName, loginId, passwordHash, permissions, created, isActive}}
     */
    function createDefaultAdminAccount() {
        const passwordPlain = 'Admin@123';
        const passwordHash = sha256Hash(passwordPlain);

        return {
            id: 'admin-001',
            fullName: 'Super Admin',
            loginId: 'admin',
            passwordHash: passwordHash,
            permissions: {
                viewOnly: true,
                addCollection: true,
                editRecords: true,
                addLateFine: true,
                deleteLoan: true
            },
            created: new Date().toISOString(),
            isActive: true
        };
    }

    // =========================================================================
    // AUTHENTICATION: Login gate, session management, password hashing
    // =========================================================================

    /**
     * SHA-256 hash password using Web Crypto API
     * @param {string} password - Plain text password
     * @returns {string} - Hex string SHA-256 hash
     */
    function sha256Hash(password) {
        // Browser environment check
        if (typeof window === 'undefined' || !window.crypto) {
            // Fallback: simple hash for demo purposes
            let hash = 0;
            for (let i = 0; i < password.length; i++) {
                const char = password.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32bit integer
            }
            return hash.toString(16).padStart(64, '0').substring(0, 64);
        }

        return new Promise((resolve, reject) => {
            window.crypto.subtle.digest(
                'SHA-256',
                new TextEncoder().encode(password)
            ).then(hash => {
                // Convert ArrayBuffer to hex string
                const hexBytes = Array.from(new Uint8Array(hash))
                    .map(b => b.toString(16).padStart(2, '0'))
                    .join('');
                resolve(hexBytes);
            }).catch(reject);
        });
    }

    /**
     * Authenticate user against stored credentials
     * @param {string} loginId - User's login ID
     * @param {string} password - Plain text password
     * @returns {Promise<boolean>} - Whether authentication succeeded
     */
    async function authenticateUser(loginId, password) {
        'use strict';

        // Input validation
        if (!loginId || !password) {
            showToast('Login ID and password are required', 'error');
            return false;
        }

        // Find user by login ID
        const user = state.users.find(u => u.loginId === loginId);

        if (!user) {
            showToast('Invalid Login ID or password', 'error');
            return false;
        }

        if (!user.isActive) {
            showToast('Account is disabled. Contact Super Admin.', 'error');
            return false;
        }

        // Compare password hash
        const passwordHash = await sha256Hash(password);

        if (user.passwordHash !== passwordHash) {
            showToast('Invalid Login ID or password', 'error');
            return false;
        }

        // Set active user in sessionStorage
        state.activeUser = {
            id: user.id,
            fullName: user.fullName,
            loginId: user.loginId,
            permissions: { ...user.permissions }
        };

        sessionStorage.setItem('mfcrm-active-user', JSON.stringify(state.activeUser));

        // Update UI
        updateAuthUI(true);
        showToast(`Welcome back, ${user.fullName}!`, 'success');

        return true;
    }

    /**
     * Log out current user, clear session
     */
    function logoutUser() {
        'use strict';

        state.activeUser = null;
        sessionStorage.removeItem('mfcrm-active-user');

        // Show login screen, hide app screen
        document.getElementById('login-screen').classList.add('active');
        document.getElementById('app-screen').style.display = 'none';

        // Clear all form states and hide modals
        hideAllModals();
        clearAllForms();

        showToast('You have been logged out', 'info');
        updateAuthUI(false);
    }

    /**
     * Update UI based on authentication state
     * @param {boolean} isLoggedIn
     */
    function updateAuthUI(isLoggedIn) {
        'use strict';

        if (isLoggedIn) {
            document.getElementById('login-screen').classList.remove('active');
            document.getElementById('app-screen').style.display = 'block';

            // Set app title based on user role
            const appTitle = document.getElementById('app-title');
            if (state.activeUser.permissions.deleteLoan) {
                appTitle.textContent = 'Microfinance CRM - Super Admin';
            } else {
                appTitle.textContent = 'Microfinance CRM';
            }

            // Set user avatar initials
            const avatarInitial = document.getElementById('avatar-initial');
            const dropdownName = document.getElementById('dropdown-name');
            const drawerName = document.getElementById('drawer-name');
            const profileName = document.getElementById('profile-name');
            const avatarInitials = state.activeUser.fullName.split(' ')
                .map(name => name[0]).join('').toUpperCase() || 'A';

            avatarInitial.textContent = avatarInitials;
            dropdownName.textContent = state.activeUser.fullName;
            drawerName.textContent = state.activeUser.fullName;
            profileName.textContent = state.activeUser.fullName;

            // Update role badge
            const roleBadge = document.getElementById('dropdown-role');
            if (state.activeUser.permissions.deleteLoan) {
                roleBadge.textContent = 'Super Admin';
                roleBadge.className = 'role-badge';
            } else {
                roleBadge.textContent = 'Staff';
                roleBadge.className = 'role-badge status-inactive';
            }

            // Show/hide admin-only views
            const adminViews = document.querySelectorAll('.admin-only');
            adminViews.forEach(view => {
                if (state.activeUser.permissions.deleteLoan) {
                    view.style.display = '';
                } else {
                    view.style.display = 'none';
                }
            });

            // Render dashboard immediately
            renderDashboard();

            // Load navigation state
            const navView = sessionStorage.getItem('mfcrm-last-view');
            if (navView) {
                showView(navView);
            } else {
                showView('dashboard');
            }
        } else {
            document.getElementById('login-screen').classList.add('active');
            document.getElementById('app-screen').style.display = 'none';
        }
    }

    // =========================================================================
    // PERMISSION MATRIX: Granular checkbox-based permissions
    // =========================================================================

    /**
     * Check if active user has a specific permission
     * @param {string} perm - Permission key (viewOnly, addCollection, editRecords, addLateFine, deleteLoan)
     * @returns {boolean} - Whether user has the permission
     */
    function hasPermission(perm) {
        'use strict';

        if (!state.activeUser) return false;

        // Map permission keys to permission object keys
        const permMap = {
            'viewOnly': 'viewOnly',
            'addCollection': 'addCollection',
            'editRecords': 'editRecords',
            'addLateFine': 'addLateFine',
            'deleteLoan': 'deleteLoan'
        };

        const permKey = permMap[perm];
        if (!permKey) return false;

        // Super Admin always has all permissions
        if (state.activeUser.permissions.deleteLoan) return true;

        // Check the permission flag
        return !!(state.activeUser.permissions[permKey]);
    }

    /**
     * Check if user has View Only permission
     * @returns {boolean}
     */
    function isViewOnly() {
        'use strict';
        return hasPermission('viewOnly');
    }

    /**
     * Check if user can add collections/payments
     * @returns {boolean}
     */
    function canAddCollection() {
        'use strict';
        return hasPermission('addCollection');
    }

    /**
     * Check if user can edit borrower/loan records
     * @returns {boolean}
     */
    function canEditRecords() {
        'use strict';
        return hasPermission('editRecords');
    }

    /**
     * Check if user can add late fines
     * @returns {boolean}
     */
    function canAddLateFine() {
        'use strict';
        return hasPermission('addLateFine');
    }

    /**
     * Check if user can delete loans
     * @returns {boolean}
     */
    function canDeleteLoan() {
        'use strict';
        return hasPermission('deleteLoan');
    }

    // =========================================================================
    // DATA VALIDATION & UTILITY FUNCTIONS
    // =========================================================================

    /**
     * Format date to DD-MM-YYYY strictly (no timezone shifts, no MM-DD flipping)
     * @param {string|Date} date - Date to format
     * @returns {string} - Formatted date in DD-MM-YYYY format, or empty string if invalid
     */
    function formatDateDDMMYYYY(date) {
        'use strict';

        if (!date) return '';

        // If it's already a DD-MM-YYYY string, validate and return
        if (typeof date === 'string' && date.match(/^\d{2}-\d{2}-\d{4}$/)) {
            // Validate that day is 01-31 and month is 01-12
            const parts = date.split('-');
            const day = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10);
            const year = parseInt(parts[2], 10);

            if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1000 && year <= 9999) {
                // Ensure leading zeros are preserved
                return `${day.toString().padStart(2, '0')}-${month.toString().padStart(2, '0')}-${year}`;
            }
            // If validation fails, try to parse as other format and convert
            return tryParseAndFormat(date);
        }

        // If it's a Date object
        if (date instanceof Date && !isNaN(date)) {
            const day = date.getDate();
            const month = date.getMonth() + 1; // JavaScript months are 0-indexed
            const year = date.getFullYear();
            return `${day.toString().padStart(2, '0')}-${month.toString().padStart(2, '0')}-${year}`;
        }

        // Try parsing various string formats
        return tryParseAndFormat(date);
    }

    /**
     * Try to parse a date string and format to DD-MM-YYYY
     * @param {string} dateStr
     * @returns {string}
     */
    function tryParseAndFormat(dateStr) {
        'use strict';

        if (!dateStr) return '';

        // Remove any whitespace
        dateStr = dateStr.trim();

        // Try DD-MM-YYYY first
        const ddmmPattern = /^(\d{2})-(\d{2})-(\d{4})$/;
        const mmddPattern = /^(\d{2})\/(\d{2})\/(\d{4})$/;
        const yyyymmddPattern = /^(\d{4})(\d{2})(\d{2})$/;

        let match;

        // Try DD-MM-YYYY
        match = dateStr.match(ddmmPattern);
        if (match) {
            const day = parseInt(match[1], 10);
            const month = parseInt(match[2], 10);
            const year = parseInt(match[3], 10);
            if (isValidDate(day, month, year)) {
                return dateStr; // Already valid
            }
        }

        // Try MM/DD/YYYY
        match = dateStr.match(mmddPattern);
        if (match) {
            const month = parseInt(match[1], 10);
            const day = parseInt(match[2], 10);
            const year = parseInt(match[3], 10);
            if (isValidDate(day, month, year)) {
                // Convert to DD-MM-YYYY
                return `${day.toString().padStart(2, '0')}-${month.toString().padStart(2, '0')}-${year}`;
            }
        }

        // Try YYYYMMDD
        match = dateStr.match(yyyymmddPattern);
        if (match) {
            const year = parseInt(match[1], 10);
            const month = parseInt(match[2], 10);
            const day = parseInt(match[3], 10);
            if (isValidDate(day, month, year)) {
                return `${day.toString().padStart(2, '0')}-${month.toString().padStart(2, '0')}-${year}`;
            }
        }

        // Try ISO format YYYY-MM-DD
        const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (isoMatch) {
            const year = parseInt(isoMatch[1], 10);
            const month = parseInt(isoMatch[2], 10);
            const day = parseInt(isoMatch[3], 10);
            if (isValidDate(day, month, year)) {
                return `${day.toString().padStart(2, '0')}-${month.toString().padStart(2, '0')}-${year}`;
            }
        }

        // If we can't parse it, return empty string
        console.warn(`Could not parse date: ${dateStr}`);
        return '';
    }

    /**
     * Validate that day/month/year form a valid date
     * @param {number} day
     * @param {number} month
     * @param {number} year
     * @returns {boolean}
     */
    function isValidDate(day, month, year) {
        'use strict';

        if (year < 1000 || year > 9999) return false;
        if (month < 1 || month > 12) return false;
        if (day < 1 || day > 31) return false;

        // Check for months with fewer than 31 days
        const daysInMonth = [31, (isLeapYear(year) ? 29 : 28), 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        return day <= daysInMonth[month - 1];
    }

    /**
     * Check if year is a leap year
     * @param {number} year
     * @returns {boolean}
     */
    function isLeapYear(year) {
        'use strict';
        return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    }

    /**
     * Parse a DD-MM-YYYY date string to a JavaScript Date object
     * @param {string} ddmmyy - Date in DD-MM-YYYY format
     * @returns {Date|null} - Date object or null if invalid
     */
    function parseDateDDMMYYYY(ddmmyy) {
        'use strict';

        if (!ddmmyy || !ddmmyy.match(/^\d{2}-\d{2}-\d{4}$/)) return null;

        const parts = ddmmyy.split('-');
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1; // JavaScript is 0-indexed
        const year = parseInt(parts[2], 10);

        if (!isValidDate(day, parseInt(parts[1], 10), year)) return null;

        const date = new Date(year, month, day);
        if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day - 1) {
            // Date construction failed or normalized differently
            return null;
        }

        return date;
    }

    /**
     * Get yesterday's date in DD-MM-YYYY format
     * @returns {string}
     */
    function getYesterdayDDMMYYYY() {
        'use strict';
        const date = new Date();
        date.setDate(date.getDate() - 1);
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        return `${day}-${month}-${year}`;
    }

    /**
     * Get current date in DD-MM-YYYY format
     * @returns {string}
     */
    function getTodayDDMMYYYY() {
        'use strict';
        const date = new Date();
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        return `${day}-${month}-${year}`;
    }

    /**
     * Get current date in ISO format for comparison
     * @returns {string}
     */
    function getTodayISO() {
        'use strict';
        return new Date().toISOString().split('T')[0];
    }

    /**
     * Get start of week (Sunday) in DD-MM-YYYY format
     * @returns {string}
     */
    function getWeekStartDDMMYYYY() {
        'use strict';
        const date = new Date();
        const day = date.getDate();
        const month = date.getMonth() + 1;
        const year = date.getFullYear();
        const weekday = date.getDay(); // 0 = Sunday, 6 = Saturday

        // Go back to Sunday
        date.setDate(day - weekday);

        const d = date.getDate().toString().padStart(2, '0');
        const m = (date.getMonth() + 1).toString().padStart(2, '0');
        const y = date.getFullYear();
        return `${d}-${m}-${y}`;
    }

    /**
     * Get end of week (Saturday) in DD-MM-YYYY format
     * @returns {string}
     */
    function getWeekEndDDMMYYYY() {
        'use strict';
        const date = new Date();
        const day = date.getDate();
        const month = date.getMonth() + 1;
        const year = date.getFullYear();
        const weekday = date.getDay(); // 0 = Sunday, 6 = Saturday

        // Go forward to Saturday
        date.setDate(day + (6 - weekday));

        const d = date.getDate().toString().padStart(2, '0');
        const m = (date.getMonth() + 1).toString().padStart(2, '0');
        const y = date.getFullYear();
        return `${d}-${m}-${y}`;
    }

    /**
     * Calculate the week number of a date (ISO week)
     * @param {string|Date} date - Date in DD-MM-YYYY or Date object
     * @returns {number}
     */
    function getWeekNumber(date) {
        'use strict';

        const d = date instanceof Date ? date : parseDateDDMMYYYY(date);
        if (!d) return null;

        // Copy date object and set to Thursday of that week
        const targetThursday = new Date(d.getTime());
        targetThursday.setDate(d.getDate() + ((4 - d.getDay()) + 7) % 7);
        targetThursday.setHours(0, 0, 0, 0);

        // Determine first Thursday of the year
        const jan1 = new Date(d.getFullYear(), 0, 1);
        const firstThursday = new Date(jan1.getTime() + ((4 - jan1.getDay()) + 7) % 7 * 86400000);

        // Calculate week number
        const weekNumber = Math.ceil((((targetThursday - firstThursday) / 86400000) + 1) / 7);

        return weekNumber;
    }

    /**
     * Check if two dates are on the same day (DD-MM-YYYY comparison)
     * @param {string} date1
     * @param {string} date2
     * @returns {boolean}
     */
    function isSameDayDDMMYYYY(date1, date2) {
        'use strict';
        if (!date1 || !date2) return false;
        return formatDateDDMMYYYY(date1) === formatDateDDMMYYYY(date2);
    }

    /**
     * Check if date1 is after date2 (both in DD-MM-YYYY format)
     * @param {string} date1
     * @param {string} date2
     * @returns {boolean}
     */
    function isAfterDDMMYYYY(date1, date2) {
        'use strict';
        if (!date1 || !date2) return false;
        return formatDateDDMMYYYY(date1) > formatDateDDMMYYYY(date2);
    }

    /**
     * Check if date1 is before date2 (both in DD-MM-YYYY format)
     * @param {string} date1
     * @param {string} date2
     * @returns {boolean}
     */
    function isBeforeDDMMYYYY(date1, date2) {
        'use strict';
        if (!date1 || !date2) return false;
        return formatDateDDMMYYYY(date1) < formatDateDDMMYYYY(date2);
    }

    /**
     * Calculate Outstanding Due for a loan
     * TotalPayable = Principal * (1 + Rate/100) + sum of fines
     * Outstanding Due = TotalPayable - Total Paid
     * @param {object} loan - Loan object
     * @param {array} payments - Array of payment objects for this loan
     * @param {array} fines - Array of fine objects for this loan
     * @returns {number} - Outstanding due amount
     */
    function calculateOutstandingDue(loan, payments = [], fines = []) {
        'use strict';

        if (!loan) return 0;

        // Calculate total fines
        let totalFines = 0;
        fines.forEach(fine => {
            if (fine.loanId === loan.loanId) {
                totalFines += parseFloat(fine.fineAmount) || 0;
            }
        });

        // Calculate total paid from collections
        let totalPaid = 0;
        payments.forEach(payment => {
            if (payment.loanId === loan.loanId) {
                totalPaid += parseFloat(payment.amount) || 0;
            }
        });

        // Total payable = Principal * (1 + Rate/100) + fines
        const ratePercent = parseFloat(loan.ratePercent) || 0;
        const principal = parseFloat(loan.principal) || 0;
        const totalPayable = principal * (1 + ratePercent / 100) + totalFines;

        // Outstanding = Total Payable - Total Paid
        const outstanding = totalPayable - totalPaid;

        // Ensure outstanding never goes below 0
        return Math.max(0, outstanding);
    }

    /**
     * Calculate total payable for a loan
     * @param {object} loan - Loan object
     * @param {array} fines - Array of fine objects
     * @returns {number}
     */
    function calculateTotalPayable(loan, fines = []) {
        'use strict';

        if (!loan) return 0;

        let totalFines = 0;
        fines.forEach(fine => {
            if (fine.loanId === loan.loanId) {
                totalFines += parseFloat(fine.fineAmount) || 0;
            }
        });

        const principal = parseFloat(loan.principal) || 0;
        const ratePercent = parseFloat(loan.ratePercent) || 0;

        return principal * (1 + ratePercent / 100) + totalFines;
    }

    /**
     * Calculate daily installment: 1% of Principal
     * @param {number} principal
     * @returns {number}
     */
    function calculateDailyInstallment(principal) {
        'use strict';
        return Math.round(principal * 0.01);
    }

    /**
     * Calculate weekly installment: 6% of Principal
     * @param {number} principal
     * @returns {number}
     */
    function calculateWeeklyInstallment(principal) {
        'use strict';
        return Math.round(principal * 0.06);
    }

    /**
     * Calculate suggested payment amount based on repayment type and outstanding
     * @param {object} loan - Loan object
     * @param {string} repaymentType - 'DAILY' or 'WEEKLY'
     * @param {number} outstandingDue - Current outstanding amount
     * @returns {number} - Suggested payment amount (capped at outstanding)
     */
    function calculateSuggestedPayment(loan, repaymentType, outstandingDue) {
        'use strict';

        if (!loan) return 0;

        const principal = parseFloat(loan.principal) || 0;
        let rate;

        if (repaymentType === 'DAILY') {
            rate = calculateDailyInstallment(principal);
        } else if (repaymentType === 'WEEKLY') {
            rate = calculateWeeklyInstallment(principal);
        } else {
            return 0;
        }

        // Cap to outstanding due if smaller
        return Math.min(rate, outstandingDue || 0);
    }

    /**
     * Format currency amount in Indian Rupees
     * @param {number} amount
     * @returns {string}
     */
    function formatCurrency(amount) {
        'use strict';
        if (isNaN(amount) || amount === undefined || amount === null) return '₹0';

        // Format with 2 decimal places
        const formatted = amount.toFixed(2);
        return `₹${formatted}`;
    }

    /**
     * Format number with comma separators
     * @param {number} num
     * @returns {string}
     */
    function formatNumber(num) {
        'use strict';
        if (isNaN(num) || num === null || num === undefined) return '0';
        return num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    }

    /**
     * Check if a loan is overdue based on its due date
     * @param {object} loan - Loan object
     * @returns {boolean}
     */
    function isLoanOverdue(loan) {
        'use strict';

        if (!loan || !loan.loanDate) return false;

        // For daily loans, overdue if loan date is more than 1 day ago and not completed
        // For weekly loans, overdue if loan date is more than 7 days ago and not completed
        const loanDate = parseDateDDMMYYYY(loan.loanDate);
        if (!loanDate) return false;

        const today = new Date();
        const diffDays = Math.floor((today - loanDate) / (86400000));

        if (loan.status === 'COMPLETED') return false;

        // Daily loans overdue after 1 day, weekly after 7 days
        const isDaily = loan.repaymentType === 'DAILY';
        const daysThreshold = isDaily ? 1 : 7;

        return diffDays >= daysThreshold;
    }

    /**
     * Get overdue days for a loan
     * @param {object} loan - Loan object
     * @returns {number}
     */
    function getOverdueDays(loan) {
        'use strict';

        if (!loan || !loan.loanDate) return 0;

        const loanDate = parseDateDDMMYYYY(loan.loanDate);
        if (!loanDate) return 0;

        const today = new Date();
        const diffDays = Math.floor((today - loanDate) / (86400000));

        if (diffDays <= 0) return 0;

        const isDaily = loan.repaymentType === 'DAILY';
        const threshold = isDaily ? 1 : 7;

        return diffDays >= threshold ? diffDays : 0;
    }

    // =========================================================================
    // GOOGLE SHEETS SYNC BRIDGE
    // =========================================================================

    /**
     * Configure Google Sheets integration
     * @param {string} sheetId - Google Spreadsheet ID
     * @param {string} webAppUrl - Apps Script Web App URL
     */
    function configureGoogleSheets(sheetId, webAppUrl) {
        'use strict';

        if (!sheetId) {
            showToast('Google Spreadsheet ID is required', 'error');
            return false;
        }

        state.sync.googleSheetId = sheetId;
        state.sync.googleWebAppUrl = webAppUrl || null;

        // Save sync configuration
        saveStateToStorage();

        showToast('Google Sheets configuration saved', 'success');
        return true;
    }

    /**
     * Test Google Sheets connection
     * @returns {Promise<boolean>}
     */
    async function testGoogleSheetsConnection() {
        'use strict';

        if (!state.sync.googleSheetId) {
            showToast('No Google Sheets ID configured', 'error');
            return false;
        }

        if (!state.sync.googleWebAppUrl) {
            showToast('No Apps Script Web App URL configured', 'error');
            return false;
        }

        state.sync.isSyncing = true;
        saveStateToStorage();

        try {
            // Test connection with a simple GET request
            // Using CORS proxy for GitHub Pages compatibility
            const testUrl = `${state.sync.googleWebAppUrl}?action=test&sheetId=${state.sync.googleSheetId}`;

            const response = await fetch(testUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                },
                cache: 'no-cache'
            });

            const data = await response.json();

            if (data.success) {
                showToast('Google Sheets connection successful', 'success');
                return true;
            } else {
                showToast(`Connection failed: ${data.error || 'Unknown error'}`, 'error');
                return false;
            }
        } catch (error) {
            console.error('Google Sheets connection test error:', error);
            showToast('Connection test failed. Check CORS configuration.', 'error');
            return false;
        } finally {
            state.sync.isSyncing = false;
            saveStateToStorage();
        }
    }

    /**
     * Sync data to Google Sheets
     * @param {boolean} pull - If true, pull from cloud; if false, push to cloud
     * @returns {Promise<boolean>}
     */
    async function syncToGoogleSheets(pull = false) {
        'use strict';

        if (!state.sync.googleSheetId || !state.sync.googleWebAppUrl) {
            showToast('Google Sheets not configured. Set up sync in Settings.', 'error');
            return false;
        }

        state.sync.isSyncing = true;
        saveStateToStorage();

        try {
            const payload = buildSyncPayload(pull);

            const response = await fetch(`${state.sync.googleWebAppUrl}?action=sync`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload),
                cache: 'no-cache'
            });

            const data = await response.json();

            if (data.success) {
                // Refresh local state from synced data
                refreshStateFromPayload(data.data);
                showToast(`Sync ${pull ? 'from' : 'to'} cloud successful`, 'success');
                return true;
            } else {
                showToast(`Sync failed: ${data.error || 'Unknown error'}`, 'error');
                return false;
            }
        } catch (error) {
            console.error('Google Sheets sync error:', error);
            showToast('Sync failed. Check network and CORS configuration.', 'error');
            return false;
        } finally {
            state.sync.isSyncing = false;
            saveStateToStorage();
        }
    }

    /**
     * Build sync payload for Google Sheets
     * @param {boolean} pull - If true, pull data from cloud; if false, push local data
     * @returns {object}
     */
    function buildSyncPayload(pull) {
        'use strict';

        if (pull) {
            // Pull: request all tabs from cloud
            return {
                action: 'pull',
                sheetId: state.sync.googleSheetId,
                timestamp: new Date().toISOString()
            };
        } else {
            // Push: send all local data tabs
            return {
                action: 'push',
                sheetId: state.sync.googleSheetId,
                data: {
                    customers: state.borrowers.map(b => ({
                        sNo: b.sNo,
                        fullName: b.fullName,
                        mobile: b.mobile,
                        location: b.location || '',
                        notes: b.notes || ''
                    })),
                    loans: state.loans.map(l => ({
                        loanId: l.loanId,
                        customerId: l.customerId,
                        repaymentType: l.repaymentType,
                        principal: l.principal,
                        ratePercent: l.ratePercent,
                        totalPayable: l.totalPayable,
                        loanDate: l.loanDate,
                        status: l.status
                    })),
                    payments: state.payments.map(p => ({
                        paymentId: p.paymentId,
                        loanId: p.loanId,
                        customerId: p.customerId,
                        amount: p.amount,
                        paymentDate: p.paymentDate,
                        paymentMethod: p.paymentMethod,
                        referenceNo: p.referenceNo || '',
                        collectedBy: p.collectedBy || ''
                    })),
                    fines: state.fines.map(f => ({
                        fineId: f.fineId,
                        loanId: f.loanId,
                        customerId: f.customerId,
                        fineAmount: f.fineAmount,
                        reason: f.reason || '',
                        fineDate: f.fineDate
                    })),
                    users: state.users.map(u => ({
                        id: u.id,
                        fullName: u.fullName,
                        loginId: u.loginId,
                        passwordHash: u.passwordHash,
                        permissions: u.permissions,
                        created: u.created,
                        isActive: u.isActive
                    }))
                },
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Refresh local state from synced payload received from Google Sheets
     * @param {object} data - Synced data from cloud
     */
    function refreshStateFromPayload(data) {
        'use strict';

        if (!data) return;

        // Update users if provided
        if (data.users && Array.isArray(data.users)) {
            state.users = data.users.map(u => ({
                ...u,
                // Ensure S_No stripping for backward compatibility
                ...(u.sNo !== undefined ? { sNo: u.sNo } : {})
            }));
        }

        // Update borrowers if provided
        if (data.customers && Array.isArray(data.customers)) {
            state.borrowers = data.customers.map(c => ({
                sNo: parseInt(c.sNo, 10).toString().padStart(4, '0') || '0',
                fullName: c.fullName || '',
                mobile: c.mobile || '',
                location: c.location || '',
                notes: c.notes || ''
            }));
        }

        // Update loans if provided
        if (data.loans && Array.isArray(data.loans)) {
            state.loans = data.loans.map(l => ({
                loanId: l.loanId || `${l.customerId}-${l.id || 1}`,
                customerId: l.customerId || '',
                repaymentType: l.repaymentType || 'DAILY',
                principal: parseFloat(l.principal) || 0,
                ratePercent: parseFloat(l.ratePercent) || 20,
                totalPayable: parseFloat(l.totalPayable) || 0,
                loanDate: l.loanDate || getTodayDDMMYYYY(),
                status: l.status || 'ACTIVE'
            }));
        }

        // Update payments if provided
        if (data.payments && Array.isArray(data.payments)) {
            state.payments = data.payments.map(p => ({
                paymentId: p.paymentId || generateId('pay'),
                loanId: p.loanId || '',
                customerId: p.customerId || '',
                amount: parseFloat(p.amount) || 0,
                paymentDate: p.paymentDate || getTodayDDMMYYYY(),
                paymentMethod: p.paymentMethod || 'Cash',
                referenceNo: p.referenceNo || '',
                collectedBy: p.collectedBy || ''
            }));
        }

        // Update fines if provided
        if (data.fines && Array.isArray(data.fines)) {
            state.fines = data.fines.map(f => ({
                fineId: f.fineId || generateId('fine'),
                loanId: f.loanId || '',
                customerId: f.customerId || '',
                fineAmount: parseFloat(f.fineAmount) || 0,
                reason: f.reason || '',
                fineDate: f.fineDate || getTodayDDMMYYYY()
            }));
        }

        // Save updated state
        saveStateToStorage();

        // Re-render relevant views
        renderDashboard();
    }

    // =========================================================================
    // EXCEL / CSV UPLOAD & DOWNLOAD (SheetJS)
    // =========================================================================

    /**
     * Export all data to Excel (.xlsx) file
     * @param {string} filename - Suggested filename
     */
    function exportToExcel(filename = 'microfinance-crm-backup.xlsx') {
        'use strict';

        try {
            // Build workbook with all sheets
            const workbook = SSF._ssf;
            const worksheetNames = ['Customers', 'Loans', 'Payments', 'Fines', 'Users'];
            const worksheetData = {

                Customers: state.borrowers.map(b => ({
                    S_No: b.sNo,
                    FullName: b.fullName,
                    Mobile: b.mobile,
                    Location: b.location || '',
                    Notes: b.notes || ''
                })),

                Loans: state.loans.map(l => ({
                    LoanID: l.loanId,
                    CustomerID: l.customerId,
                    RepaymentType: l.repaymentType,
                    Principal: l.principal,
                    RatePercent: l.ratePercent,
                    TotalPayable: l.totalPayable,
                    LoanDate: l.loanDate,
                    Status: l.status
                })),

                Payments: state.payments.map(p => ({
                    PaymentID: p.paymentId,
                    LoanID: p.loanId,
                    CustomerID: p.customerId,
                    Amount: p.amount,
                    PaymentDate: p.paymentDate,
                    PaymentMethod: p.paymentMethod,
                    ReferenceNo: p.referenceNo || '',
                    CollectedBy: p.collectedBy || ''
                })),

                Fines: state.fines.map(f => ({
                    FineID: f.fineId,
                    LoanID: f.loanId,
                    CustomerID: f.customerId,
                    FineAmount: f.fineAmount,
                    Reason: f.reason || '',
                    FineDate: f.fineDate
                })),

                Users: state.users.map(u => ({
                    ID: u.id,
                    FullName: u.fullName,
                    LoginID: u.loginId,
                    PasswordHash: u.passwordHash,
                    Permissions: JSON.stringify(u.permissions),
                    Created: u.created,
                    IsActive: u.isActive ? 'Active' : 'Inactive'
                }))
            };

            // SheetJS auto-generated workbook
            const wb = XLSX.utils.book_new();

            worksheetNames.forEach((name, index) => {
                const data = worksheetData[name];
                const ws = XLSX.utils.json_to_sheet(data, { header: Object.keys(data[0] || {}) });
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
    }

    /**
     * Convert binary string to ArrayBuffer (SheetJS helper)
     * @param {string} s
     * @returns {ArrayBuffer}
     */
    function S2AB(s) {
        'use strict';
        const buf = new ArrayBuffer(s.length);
        const view = new Uint8Array(buf);
        for (let i = 0; i < s.length; i++) view[i] = s.charCodeAt(i) & 0xFF;
        return buf;
    }

    /**
     * Import data from uploaded Excel (.xlsx) or CSV file
     * @param {File} file - Uploaded file
     * @returns {Promise<object>} - Import results with stats
     */
    async function importFromExcel(file) {
        'use strict';

        return new Promise((resolve) => {
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
                                    loanDate: row.LoanDate || getTodayDDMMYYYY(),
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
                                    paymentDate: row.PaymentDate || getTodayDDMMYYYY(),
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
                                    fineDate: row.FineDate || getTodayDDMMYYYY()
                                });
                            });
                        } else if (sheetName === 'Users') {
                            rows.forEach(row => {
                                // Skip header row, check for required fields
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

                    // Validate and handle duplicates
                    results.errors = validateImportData(results);

                    // Show import summary
                    const totalImported = 
                        results.customers.length + results.loans.length + 
                        results.payments.length + results.fines.length + results.users.length;

                    if (totalImported > 0) {
                        // Merge with existing state (handle duplicates by updating)
                        mergeImportedData(results);
                        saveStateToStorage();
                        renderDashboard();
                        showToast(`Imported ${totalImported} records successfully`, 'success');
                    } else if (results.errors.length > 0) {
                        showToast('Import completed with errors', 'warning');
                        // Show error summary
                        const errorSummary = results.errors.slice(0, 5).map(e => e.message).join('\n');
                        if (results.errors.length > 5) {
                            showToast(`First 5 errors: ${errorSummary}\n...and ${results.errors.length - 5} more`, 'error');
                        }
                    } else {
                        showToast('No valid records found in import file', 'warning');
                    }

                    resolve(results);

                } catch (error) {
                    console.error('Excel import error:', error);
                    showToast('Failed to import Excel file. Check format.', 'error');
                    resolve({ errors: ['Import failed: ' + error.message] });
                }
            };

            reader.onerror = () => {
                showToast('Error reading file', 'error');
                resolve({ errors: ['File read error'] });
            };

            reader.readAsArrayBuffer(file);
        });
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
     * Validate imported data for errors and warnings
     * @param {object} results - Import results so far
     * @returns {array} - Array of error objects
     */
    function validateImportData(results) {
        'use strict';
        const errors = [];

        // Validate customers
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

        // Validate loans
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

        // Validate payments
        if (results.payments) {
            results.payments.forEach((p, idx) => {
                if (!p.loanId) {
                    errors.push({ type: 'payment', index: idx, message: `Row ${idx + 1}: Missing LoanID` });
                }
                if (!p.amount || p.amount <= 0) {
                    errors.push({ type: 'payment', index: idx, message: `Row ${idx + 1}: Invalid Amount` });
                }
                if (!p.paymentDate) {
                    errors.push({ type: 'payment', index: idx, message: `Row ${idx + 1}: Missing PaymentDate` });
                }
            });
        }

        // Validate fines
        if (results.fines) {
            results.fines.forEach((f, idx) => {
                if (!f.loanId) {
                    errors.push({ type: 'fine', index: idx, message: `Row ${idx + 1}: Missing LoanID` });
                }
                if (!f.fineAmount || f.fineAmount <= 0) {
                    errors.push({ type: 'fine', index: idx, message: `Row ${idx + 1}: Invalid Fine Amount` });
                }
                if (!f.fineDate) {
                    errors.push({ type: 'fine', index: idx, message: `Row ${idx + 1}: Missing FineDate` });
                }
            });
        }

        return errors;
    }

    /**
     * Merge imported data with existing state, handling duplicates
     * @param {object} results - Import results from importFromExcel
     */
    function mergeImportedData(results) {
        'use strict';

        // Merge customers - update existing or add new
        if (results.customers) {
            results.customers.forEach(newCustomer => {
                const existingIdx = state.borrowers.findIndex(
                    b => b.sNo === newCustomer.sNo
                );

                if (existingIdx >= 0) {
                    // Update existing
                    state.borrowers[existingIdx] = {
                        ...state.borrowers[existingIdx],
                        ...newCustomer,
                        fullName: newCustomer.fullName || state.borrowers[existingIdx].fullName,
                        mobile: newCustomer.mobile || state.borrowers[existingIdx].mobile
                    };
                } else {
                    // Add new - ensure sNo is padded
                    newCustomer.sNo = parseInt(newCustomer.sNo, 10).toString().padStart(4, '0') || '0001';
                    state.borrowers.push({
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
                const existingIdx = state.loans.findIndex(
                    l => l.loanId === newLoan.loanId || (l.customerId === newLoan.customerId && l.loanDate === newLoan.loanDate)
                );

                if (existingIdx >= 0) {
                    // Update existing
                    state.loans[existingIdx] = {
                        ...state.loans[existingIdx],
                        ...newLoan
                    };
                } else {
                    state.loans.push(newLoan);
                }
            });
        }

        // Merge payments
        if (results.payments) {
            results.payments.forEach(newPayment => {
                // Check for duplicate (same loan + same date + same amount)
                const duplicateIdx = state.payments.findIndex(
                    p => p.loanId === newPayment.loanId &&
                         p.paymentDate === newPayment.paymentDate &&
                         Math.abs(p.amount - newPayment.amount) < 0.01
                );

                if (duplicateIdx >= 0) {
                    // Update existing payment
                    state.payments[duplicateIdx] = {
                        ...state.payments[duplicateIdx],
                        ...newPayment
                    };
                } else {
                    state.payments.push(newPayment);
                }
            });
        }

        // Merge fines
        if (results.fines) {
            results.fines.forEach(newFine => {
                const duplicateIdx = state.fines.findIndex(
                    f => f.loanId === newFine.loanId &&
                         f.fineDate === newFine.fineDate &&
                         Math.abs(f.fineAmount - newFine.fineAmount) < 0.01
                );

                if (duplicateIdx >= 0) {
                    // Update existing fine
                    state.fines[duplicateIdx] = {
                        ...state.fines[duplicateIdx],
                        ...newFine
                    };
                } else {
                    state.fines.push(newFine);
                }
            });
        }

        // Merge users (Super Admin only, skip if active user would be overwritten)
        if (results.users) {
            results.users.forEach(newUser => {
                // Don't overwrite the default super admin
                if (newUser.loginId && newUser.loginId === 'admin') return;

                const existingIdx = state.users.findIndex(
                    u => u.loginId === newUser.loginId
                );

                if (existingIdx >= 0) {
                    state.users[existingIdx] = {
                        ...state.users[existingIdx],
                        ...newUser
                    };
                } else {
                    state.users.push(newUser);
                }
            });
        }
    }

    // =========================================================================
    // UI RENDERERS: Render all views
    // =========================================================================

    /**
     * Render the dashboard view with statistics and charts
     */
    function renderDashboard() {
        'use strict';

        if (!state.activeUser) return;

        // Update statistics
        renderStats();
        renderRecentActivity();
        renderCharts();
    }

    /**
     * Render statistics cards
     */
    function renderStats() {
        'use strict';

        const totalBorrowers = state.borrowers.length;
        const activeLoans = state.loans.filter(l => l.status === 'ACTIVE').length;

        // Calculate total outstanding
        let totalOutstanding = 0;
        state.loans.forEach(loan => {
            const paymentsForLoan = state.payments.filter(p => p.loanId === loan.loanId);
            const finesForLoan = state.fines.filter(f => f.loanId === loan.loanId);
            totalOutstanding += calculateOutstandingDue(loan, paymentsForLoan, finesForLoan);
        });

        // Today's collection (daily loans only, today's payments)
        const today = getTodayDDMMYYYY();
        let todayCollection = 0;
        state.payments.forEach(payment => {
            if (payment.paymentDate === today && payment.paymentMethod) {
                todayCollection += parseFloat(payment.amount) || 0;
            }
        });

        // This week's collection
        const weekStart = getWeekStartDDMMYYYY();
        const weekEnd = getWeekEndDDMMYYYY();
        let weekCollection = 0;
        state.payments.forEach(payment => {
            if (isAfterDDMMYYYY(weekStart, payment.paymentDate) && isBeforeDDMMYYYY(payment.paymentDate, weekEnd)) {
                weekCollection += parseFloat(payment.amount) || 0;
            }
        });

        // Overdue count
        let overdueCount = 0;
        state.loans.forEach(loan => {
            if (isLoanOverdue(loan)) {
                overdueCount++;
            }
        });

        // Update DOM
        document.getElementById('stat-total-borrowers').textContent = totalBorrowers;
        document.getElementById('stat-active-loans').textContent = activeLoans;
        document.getElementById('stat-total-outstanding').textContent = formatCurrency(totalOutstanding);
        document.getElementById('stat-today-collection').textContent = formatCurrency(todayCollection);
        document.getElementById('stat-week-collection').textContent = formatCurrency(weekCollection);
        document.getElementById('stat-overdue-count').textContent = overdueCount;
    }

    /**
     * Render recent activity table
     */
    function renderRecentActivity() {
        'use strict';

        const activityBody = document.getElementById('recent-activity-body');
        if (!activityBody) return;

        // Get last 10 payments + fines
        const activities = [];

        // Recent payments
        state.payments
            .sort((a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime())
            .slice(0, 5)
            .forEach(payment => {
                activities.push({
                    type: 'payment',
                    date: payment.paymentDate,
                    borrower: findBorrowerById(payment.customerId)?.fullName || 'Unknown',
                    loan: payment.loanId || '—',
                    amount: payment.amount,
                    method: payment.paymentMethod || '—',
                    reference: payment.referenceNo || '—',
                    collectedBy: payment.collectedBy || '—'
                });
            });

        // Recent fines
        state.fines
            .sort((a, b) => new Date(fineFineDate(b.fineDate)).getTime() - new Date(fineFineDate(a.fineDate)).getTime())
            .slice(0, 5)
            .forEach(fine => {
                activities.push({
                    type: 'fine',
                    date: fine.fineDate,
                    borrower: findBorrowerById(fine.customerId)?.fullName || 'Unknown',
                    loan: fine.loanId || '—',
                    amount: fine.fineAmount,
                    reason: fine.reason || '—',
                    method: '—',
                    reference: '—',
                    collectedBy: 'System'
                });
            });

        // Sort all activities by date (newest first)
        activities.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        // Render table
        if (activities.length === 0) {
            activityBody.innerHTML = '<tr><td colspan="7" class="empty-state-small">No recent activity</td></tr>';
            return;
        }

        activityBody.innerHTML = activities.map((act, idx) => `
            <tr>
                <td>${formatDateDDMMYYYY(act.date)}</td>
                <td>${act.type === 'payment' ? '💰 Collection' : '⚠️ Fine'}</td>
                <td>${act.borrower}</td>
                <td>${act.loan}</td>
                <td>${formatCurrency(act.amount)}</td>
                <td>${act.method}</td>
                <td>${act.reference}</td>
            </tr>
        `).join('');
    }

    /**
     * Render loan type distribution chart (doughnut)
     */
    function renderCharts() {
        'use strict';

        const dailyLoans = state.loans.filter(l => l.repaymentType === 'DAILY').length;
        const weeklyLoans = state.loans.filter(l => l.repaymentType === 'WEEKLY').length;
        const totalLoans = dailyLoans + weeklyLoans;

        // Daily Collections Chart (7 days)
        const dailyCollections = [];
        const labels = [];

        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const ddmm = `${date.getDate().toString().padStart(2, '0')}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getFullYear()}`;
            labels.push(ddmm);

            const dayPayments = state.payments.filter(p =>
                p.paymentDate === ddmm && p.paymentMethod
            );
            const dayTotal = dayPayments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
            dailyCollections.push(dayTotal);
        }

        // Render Daily Collections Bar Chart
        renderBarChart('collection-chart', 'Daily Collection Trend (7 Days)', labels, dailyCollections, 'Collections (₹)');

        // Loan Type Distribution
        const loanTypeData = {
            labels: ['Daily (20%)', 'Weekly (26%)'],
            datasets: [{
                data: [dailyLoans, weeklyLoans],
                backgroundColor: ['#1a73e8', '#34a853'],
                hoverBackgroundColor: ['#1557b0', '#28a745']
            }]
        };

        renderDoughnutChart('loan-type-chart', loanTypeData, `Total Loans: ${totalLoans}`);
    }

    /**
     * Render a bar chart using Chart.js
     * @param {string} canvasId - Canvas element ID
     * @param {string} title - Chart title
     * @param {array} labels - X-axis labels
     * @param {array} data - Y-axis data
     * @param {string} yLabel - Y-axis label
     */
    function renderBarChart(canvasId, title, labels, data, yLabel) {
        'use strict';

        const ctx = document.getElementById(canvasId);
        if (!ctx) return;

        // Destroy existing chart if present
        if (window[`${canvasId}-chart-instance`]) {
            window[`${canvasId}-chart-instance`].destroy();
        }

        const chartInstance = new Chart(ctx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: title,
                    data: data,
                    backgroundColor: 'rgba(26, 115, 232, 0.6)',
                    borderColor: 'rgba(26, 115, 232, 1)',
                    borderWidth: 1,
                    borderRadius: 4,
                    maxBarThickness: 30
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 500
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return formatCurrency(value);
                            }
                        }
                    },
                    x: {
                        grid: {
                            display: false
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return formatCurrency(context.parsed.y);
                            }
                        }
                    }
                }
            }
        });

        window[`${canvasId}-chart-instance`] = chartInstance;
    }

    /**
     * Render a doughnut chart using Chart.js
     * @param {string} canvasId - Canvas element ID
     * @param {object} data - Chart.js data object
     * @param {string} title - Chart title
     */
    function renderDoughnutChart(canvasId, data, title) {
        'use strict';

        const ctx = document.getElementById(canvasId);
        if (!ctx) return;

        // Destroy existing chart if present
        if (window[`${canvasId}-chart-instance`]) {
            window[`${canvasId}-chart-instance`].destroy();
        }

        const chartInstance = new Chart(ctx.getContext('2d'), {
            type: 'doughnut',
            data: data,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 500
                },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            font: {
                                size: 12
                            }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const label = context.label || '';
                                const value = context.parsed;
                                return `${label}: ${formatCurrency(value)}`;
                            }
                        }
                    }
                }
            }
        });

        window[`${canvasId}-chart-instance`] = chartInstance;
    }

    // =========================================================================
    // VIEW MANAGEMENT: Show/hide views
    // =========================================================================

    /**
     * Show a specific view, hide all others
     * @param {string} viewName - Name of the view to show
     */
    function showView(viewName) {
        'use strict';

        if (!state.activeUser) {
            showLoginScreen();
            return;
        }

        // Store last viewed navigation state
        sessionStorage.setItem('mfcrm-last-view', viewName);

        // Hide all views
        const allViews = document.querySelectorAll('.view');
        allViews.forEach(view => view.classList.remove('active'));
        allViews.forEach(view => view.setAttribute('hidden', 'true'));

        // Show navigation item as active
        const allNavItems = document.querySelectorAll('.nav-item');
        allNavItems.forEach(item => item.classList.remove('active'));

        // Highlight the selected nav item
        const selectedNav = document.querySelector(`.nav-item[data-view="${viewName}"]`);
        if (selectedNav) {
            selectedNav.classList.add('active');
        }

        // Highlight bottom nav item
        const bottomNavItems = document.querySelectorAll('.bottom-nav-item');
        bottomNavItems.forEach(item => item.classList.remove('active'));
        const selectedBottomNav = document.querySelector(`.bottom-nav-item[data-view="${viewName}"]`);
        if (selectedBottomNav) {
            selectedBottomNav.classList.add('active');
        }

        // Show the requested view
        const viewToShow = document.getElementById(`view-${viewName}`);
        if (viewToShow) {
            viewToShow.classList.add('active');
            viewToShow.removeAttribute('hidden');
        }

        // Handle view-specific initialization
        switch (viewName) {
            case 'dashboard':
                renderDashboard();
                break;
            case 'daily':
                renderDailyLoans();
                break;
            case 'weekly':
                renderWeeklyLoans();
                break;
            case 'borrowers':
                renderBorrowers();
                break;
            case 'loan-manager':
                renderLoanManager();
                break;
            case 'reports':
                renderReports();
                break;
            case 'user-management':
                renderUserManagement();
                break;
            case 'sync-settings':
                renderSyncSettings();
                break;
            case 'profile':
                renderProfile();
                break;
            case 'settings':
                renderSettings();
                break;
        }
    }

    /**
     * Show login screen, hide app
     */
    function showLoginScreen() {
        'use strict';
        document.getElementById('login-screen').classList.add('active');
        document.getElementById('app-screen').style.display = 'none';
        clearAllForms();
        hideAllModals();
    }

    // =========================================================================
    // DAILY LOANS RENDERER
    // =========================================================================

    /**
     * Render daily loans with all tabs
     */
    function renderDailyLoans() {
        'use strict';

        // Calculate tab data
        const today = getTodayDDMMYYYY();
        const weekStart = getWeekStartDDMMYYYY();
        const weekEnd = getWeekEndDDMMYYYY();

        // Today Not Paid: daily loans where nothing paid today and status is ACTIVE
        const todayNotPaid = state.loans.filter(loan => {
            if (loan.repaymentType !== 'DAILY' || loan.status !== 'ACTIVE') return false;
            const outstanding = calculateOutstandingDue(loan,
                state.payments.filter(p => p.loanId === loan.loanId),
                state.fines.filter(f => f.loanId === loan.loanId)
            );
            // Not paid anything today
            const todayPayments = state.payments.filter(p =>
                p.loanId === loan.loanId && p.paymentDate === today
            );
            return todayPayments.length === 0 && outstanding > 0;
        });

        // Today Paid: daily loans where something was paid today
        const todayPaid = state.loans.filter(loan => {
            if (loan.repaymentType !== 'DAILY' || loan.status !== 'ACTIVE') return false;
            const todayPayments = state.payments.filter(p =>
                p.loanId === loan.loanId && p.paymentDate === today
            );
            return todayPayments.length > 0;
        });

        // All Active: all active daily loans
        const allActive = state.loans.filter(loan => loan.repaymentType === 'DAILY' && loan.status === 'ACTIVE');

        // Cleared: daily loans with status COMPLETED
        const cleared = state.loans.filter(loan => loan.repaymentType === 'DAILY' && loan.status === 'COMPLETED');

        // Render each tab
        renderDailyTab('not-paid', todayNotPaid, 'not-paid');
        renderDailyTab('paid', todayPaid, 'paid');
        renderDailyTab('active', allActive, 'active');
        renderDailyTab('cleared', cleared, 'cleared');

        // Render audit panel (initially hidden, shown when tab selected)
        renderDailyAudit();
    }

    /**
     * Render a single daily loan tab
     * @param {string} tabId - Tab identifier
     * @param {array} loans - Loan objects for this tab
     * @param {string} tabName - Tab name
     */
    function renderDailyTab(tabId, loans, tabName) {
        'use strict';

        const panelId = `panel-daily-${tabName}`;
        const tableBodyId = `body-daily-${tabName}`;
        const badgeId = `badge-daily-${tabName}`;

        const panel = document.getElementById(panelId);
        const tableBody = document.getElementById(tableBodyId);
        const badge = document.getElementById(badgeId);

        if (!panel || !tableBody || !badge) return;

        // Update badge count
        badge.textContent = loans.length;

        // Show/hide panel
        const allPanels = document.querySelectorAll('.tab-panel');
        allPanels.forEach(p => p.classList.remove('active'));
        panel.classList.add('active');

        // Render table rows
        if (loans.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="9" class="empty-state-small">No loans found</td></tr>`;
            return;
        }

        tableBody.innerHTML = loans.map((loan, idx) => {
            const paymentsForLoan = state.payments.filter(p => p.loanId === loan.loanId);
            const finesForLoan = state.fines.filter(f => f.loanId === loan.loanId);
            const outstanding = calculateOutstandingDue(loan, paymentsForLoan, finesForLoan);
            const dailyInstallment = calculateDailyInstallment(parseFloat(loan.principal) || 0);

            // Get today's payment amount for this loan
            const todayPayments = state.payments.filter(p =>
                p.loanId === loan.loanId && p.paymentDate === getTodayDDMMYYYY()
            );
            const todayPaid = todayPayments.reduce((sum, p) => sum + parseFloat(p.amount) || 0, 0);

            const statusClass = loan.status === 'ACTIVE' ? 'active' : 'completed';
            const statusText = loan.status === 'ACTIVE' ? 'Active' : 'Completed';

            return `
                <tr>
                    <td>${loan.sNo || idx + 1}</td>
                    <td>${loan.customerId ? findBorrowerById(loan.customerId)?.fullName || 'Unknown' : '—'}</td>
                    <td>${loan.mobile || '—'}</td>
                    <td>${loan.location || '—'}</td>
                    <td>${formatCurrency(parseFloat(loan.principal) || 0)}</td>
                    <td>${formatCurrency(dailyInstallment)}</td>
                    <td>${formatCurrency(todayPaid)}</td>
                    <td>${formatCurrency(outstanding)}</td>
                    <td>
                        <div class="btn-icon ${statusClass}" title="${statusText}" 
                             onclick="window.MicrofinanceCRM.recordDailyPayment('${loan.loanId}')"
                             style="color: ${loan.status === 'ACTIVE' ? 'var(--color-primary)' : 'var(--color-success)'}">
                            <span aria-hidden="true">💳</span>
                        </div>
                        <div class="btn-icon danger" title="Delete Loan" 
                             onclick="window.MicrofinanceCRM.showDeleteConfirmation('${loan.loanId}')"
                             style="display: ${canDeleteLoan() ? 'inline-flex' : 'none'}"
                             color: ${canDeleteLoan() ? 'var(--color-danger)' : 'var(--color-text-muted)'}">
                            <span aria-hidden="true">🗑️</span>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    /**
     * Render daily audit table
     */
    function renderDailyAudit() {
        'use strict';

        const auditBody = document.getElementById('body-daily-audit');
        const fromInput = document.getElementById('audit-daily-from');
        const toInput = document.getElementById('audit-daily-to');
        const summaryDiv = document.getElementById('daily-audit-summary');

        if (!auditBody) return;

        // Get date range
        let dateFrom = fromInput ? fromInput.value : getTodayDDMMYYYY();
        let dateTo = toInput ? toInput.value : getTodayDDMMYYYY();

        // Ensure from is before to
        if (isBeforeDDMMYYYY(dateFrom, dateTo)) {
            [dateFrom, dateTo] = [dateTo, dateFrom];
        }

        // Filter payments within date range
        const filteredPayments = state.payments.filter(payment => {
            const pDate = payment.paymentDate;
            return isAfterDDMMYYYY(dateFrom, pDate) && isBeforeDDMMYYYY(pDate, dateTo);
        });

        // Render table
        if (filteredPayments.length === 0) {
            auditBody.innerHTML = `<tr><td colspan="7" class="empty-state-small">No payments in selected date range</td></tr>`;
            if (summaryDiv) summaryDiv.innerHTML = '';
            return;
        }

        auditBody.innerHTML = filteredPayments.map(payment => {
            const borrower = findBorrowerById(payment.customerId);
            return `
                <tr>
                    <td>${formatDateDDMMYYYY(payment.paymentDate)}</td>
                    <td>${payment.loanId || '—'}</td>
                    <td>${borrower ? borrower.fullName : 'Unknown'}</td>
                    <td>${formatCurrency(payment.amount)}</td>
                    <td>${payment.paymentMethod || '—'}</td>
                    <td>${payment.referenceNo || '—'}</td>
                    <td>${payment.collectedBy || '—'}</td>
                </tr>
            `;
        }).join('');

        // Render summary
        if (summaryDiv) {
            const totalAmount = filteredPayments.reduce((sum, p) => sum + parseFloat(p.amount) || 0, 0);
            summaryDiv.innerHTML = `
                <div class="audit-summary-row">
                    <span>Total Payments:</span>
                    <strong>${formatCurrency(totalAmount)}</strong>
                </div>
                <div class="audit-summary-row">
                    <span>Total Records:</span>
                    <strong>${filteredPayments.length}</strong>
                </div>
            `;
        }
    }

    // =========================================================================
    // WEEKLY LOANS RENDERER
    // =========================================================================

    /**
     * Render weekly loans with all tabs
     */
    function renderWeeklyLoans() {
        'use strict';

        const weekStart = getWeekStartDDMMYYYY();
        const weekEnd = getWeekEndDDMMYYYY();

        // Today Not Paid This Week: weekly loans with no payments this week
        const thisWeekNotPaid = state.loans.filter(loan => {
            if (loan.repaymentType !== 'WEEKLY' || loan.status !== 'ACTIVE') return false;
            const paymentsThisWeek = state.payments.filter(p =>
                p.loanId === loan.loanId &&
                isAfterDDMMYYYY(weekStart, p.paymentDate) &&
                isBeforeDDMMYYYY(p.paymentDate, weekEnd)
            );
            return paymentsThisWeek.length === 0;
        });

        // Today Paid This Week: weekly loans with payments this week
        const thisWeekPaid = state.loans.filter(loan => {
            if (loan.repaymentType !== 'WEEKLY' || loan.status !== 'ACTIVE') return false;
            return state.payments.some(p =>
                p.loanId === loan.loanId &&
                isAfterDDMMYYYY(weekStart, p.paymentDate) &&
                isBeforeDDMMYYYY(p.paymentDate, weekEnd)
            );
        });

        // All Active: all active weekly loans
        const allActive = state.loans.filter(loan => loan.repaymentType === 'WEEKLY' && loan.status === 'ACTIVE');

        // Cleared: weekly loans with status COMPLETED
        const cleared = state.loans.filter(loan => loan.repaymentType === 'WEEKLY' && loan.status === 'COMPLETED');

        // Render each tab
        renderWeeklyTab('not-paid', thisWeekNotPaid, 'not-paid');
        renderWeeklyTab('paid', thisWeekPaid, 'paid');
        renderWeeklyTab('active', allActive, 'active');
        renderWeeklyTab('cleared', cleared, 'cleared');

        // Render weekly audit
        renderWeeklyAudit();
    }

    /**
     * Render a single weekly loan tab
     * @param {string} tabId - Tab identifier
     * @param {array} loans - Loan objects for this tab
     * @param {string} tabName - Tab name
     */
    function renderWeeklyTab(tabId, loans, tabName) {
        'use strict';

        const panelId = `panel-weekly-${tabName}`;
        const tableBodyId = `body-weekly-${tabName}`;
        const badgeId = `badge-weekly-${tabName}`;

        const panel = document.getElementById(panelId);
        const tableBody = document.getElementById(tableBodyId);
        const badge = document.getElementById(badgeId);

        if (!panel || !tableBody || !badge) return;

        // Update badge count
        badge.textContent = loans.length;

        // Show/hide panel
        const allPanels = document.querySelectorAll('.tab-panel');
        allPanels.forEach(p => p.classList.remove('active'));
        panel.classList.add('active');

        // Render table rows
        if (loans.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="9" class="empty-state-small">No loans found</td></tr>`;
            return;
        }

        tableBody.innerHTML = loans.map((loan, idx) => {
            const paymentsForLoan = state.payments.filter(p => p.loanId === loan.loanId);
            const finesForLoan = state.fines.filter(f => f.loanId === loan.loanId);
            const outstanding = calculateOutstandingDue(loan, paymentsForLoan, finesForLoan);
            const weeklyInstallment = calculateWeeklyInstallment(parseFloat(loan.principal) || 0);

            // Get payments this week for this loan
            const weekStart = getWeekStartDDMMYYYY();
            const weekEnd = getWeekEndDDMMYYYY();
            const weeklyPayments = state.payments.filter(p =>
                p.loanId === loan.loanId &&
                isAfterDDMMYYYY(weekStart, p.paymentDate) &&
                isBeforeDDMMYYYY(p.paymentDate, weekEnd)
            );
            const totalPaidThisWeek = weeklyPayments.reduce((sum, p) => sum + parseFloat(p.amount) || 0, 0);

            const statusClass = loan.status === 'ACTIVE' ? 'active' : 'completed';
            const statusText = loan.status === 'ACTIVE' ? 'Active' : 'Completed';

            return `
                <tr>
                    <td>${loan.sNo || idx + 1}</td>
                    <td>${loan.customerId ? findBorrowerById(loan.customerId)?.fullName || 'Unknown' : '—'}</td>
                    <td>${loan.mobile || '—'}</td>
                    <td>${loan.location || '—'}</td>
                    <td>${formatCurrency(parseFloat(loan.principal) || 0)}</td>
                    <td>${formatCurrency(weeklyInstallment)}</td>
                    <td>${formatCurrency(totalPaidThisWeek)}</td>
                    <td>${formatCurrency(outstanding)}</td>
                    <td>
                        <div class="btn-icon ${statusClass}" title="${statusText}" 
                             onclick="window.MicrofinanceCRM.recordWeeklyPayment('${loan.loanId}')"
                             style="color: ${loan.status === 'ACTIVE' ? 'var(--color-primary)' : 'var(--color-success)'}">
                            <span aria-hidden="true">💳</span>
                        </div>
                        <div class="btn-icon danger" title="Delete Loan" 
                             onclick="window.MicrofinanceCRM.showDeleteConfirmation('${loan.loanId}')"
                             style="display: ${canDeleteLoan() ? 'inline-flex' : 'none'}"
                             color: ${canDeleteLoan() ? 'var(--color-danger)' : 'var(--color-text-muted)'}">
                            <span aria-hidden="true">🗑️</span>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    /**
     * Render weekly audit table
     */
    function renderWeeklyAudit() {
        'use strict';

        const auditBody = document.getElementById('body-weekly-audit');
        const fromInput = document.getElementById('audit-weekly-from');
        const toInput = document.getElementById('audit-weekly-to');
        const summaryDiv = document.getElementById('weekly-audit-summary');

        if (!auditBody) return;

        // Get date range (default to this week)
        let dateFrom = fromInput ? fromInput.value : getWeekStartDDMMYYYY();
        let dateTo = toInput ? toInput.value : getWeekEndDDMMYYYY();

        // Ensure from is before to
        if (isBeforeDDMMYYYY(dateFrom, dateTo)) {
            [dateFrom, dateTo] = [dateTo, dateFrom];
        }

        // Filter payments within date range
        const filteredPayments = state.payments.filter(payment => {
            const pDate = payment.paymentDate;
            return isAfterDDMMYYYY(dateFrom, pDate) && isBeforeDDMMYYYY(pDate, dateTo);
        });

        // Render table
        if (filteredPayments.length === 0) {
            auditBody.innerHTML = `<tr><td colspan="7" class="empty-state-small">No payments in selected date range</td></tr>`;
            if (summaryDiv) summaryDiv.innerHTML = '';
            return;
        }

        auditBody.innerHTML = filteredPayments.map(payment => {
            const borrower = findBorrowerById(payment.customerId);
            return `
                <tr>
                    <td>${formatDateDDMMYYYY(payment.paymentDate)}</td>
                    <td>${payment.loanId || '—'}</td>
                    <td>${borrower ? borrower.fullName : 'Unknown'}</td>
                    <td>${formatCurrency(payment.amount)}</td>
                    <td>${payment.paymentMethod || '—'}</td>
                    <td>${payment.referenceNo || '—'}</td>
                    <td>${payment.collectedBy || '—'}</td>
                </tr>
            `;
        }).join('');

        // Render summary
        if (summaryDiv) {
            const totalAmount = filteredPayments.reduce((sum, p) => sum + parseFloat(p.amount) || 0, 0);
            summaryDiv.innerHTML = `
                <div class="audit-summary-row">
                    <span>Total Payments:</span>
                    <strong>${formatCurrency(totalAmount)}</strong>
                </div>
                <div class="audit-summary-row">
                    <span>Total Records:</span>
                    <strong>${filteredPayments.length}</strong>
                </div>
            `;
        }
    }

    // =========================================================================
    // BORROWERS RENDERER
    // =========================================================================

    /**
     * Render borrowers table
     */
    function renderBorrowers() {
        'use strict';

        const tableBody = document.getElementById('body-borrowers');
        const emptyState = document.getElementById('empty-borrowers');
        const searchInput = document.getElementById('search-borrowers');

        if (!tableBody) return;

        // Filter based on search
        const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';

        const filteredBorrowers = state.borrowers.filter(b => {
            return b.fullName.toLowerCase().includes(searchTerm) ||
                   b.mobile.toLowerCase().includes(searchTerm) ||
                   b.sNo.toLowerCase().includes(searchTerm) ||
                   (b.location && b.location.toLowerCase().includes(searchTerm));
        });

        // Render table
        if (filteredBorrowers.length === 0) {
            tableBody.innerHTML = '';
            if (emptyState) emptyState.hidden = false;
            return;
        }

        if (emptyState) emptyState.hidden = true;

        tableBody.innerHTML = filteredBorrowers.map((borrower, idx) => {
            const loansForBorrower = state.loans.filter(l => l.customerId === borrower.sNo);
            const totalLoans = loansForBorrower.length;
            const outstanding = loansForBorrower.reduce((total, loan) => {
                const paymentsForLoan = state.payments.filter(p => p.loanId === loan.loanId);
                const finesForLoan = state.fines.filter(f => f.loanId === loan.loanId);
                return total + calculateOutstandingDue(loan, paymentsForLoan, finesForLoan);
            }, 0);

            return `
                <tr>
                    <td>${borrower.sNo}</td>
                    <td>${borrower.fullName}</td>
                    <td>${borrower.mobile}</td>
                    <td>${borrower.location || '—'}</td>
                    <td>${totalLoans}</td>
                    <td>${formatCurrency(outstanding)}</td>
                    <td>${borrower.notes || '—'}</td>
                    <td>
                        <div class="btn-icon primary" title="Issue Loan"
                             onclick="window.MicrofinanceCRM.showLoanModal('${borrower.sNo}')"
                             style="color: var(--color-primary)">
                            <span aria-hidden="true">📝</span>
                        </div>
                        <div class="btn-icon info" title="View Details"
                             onclick="window.MicrofinanceCRM.showBorrowerDetails('${borrower.sNo}')"
                             style="color: var(--color-info)">
                            <span aria-hidden="true">ℹ️</span>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // =========================================================================
    // LOAN MANAGER (DELETE) RENDERER
    // =========================================================================

    /**
     * Render loan manager (delete) view
     */
    function renderLoanManager() {
        'use strict';

        const tableBody = document.getElementById('body-loan-manager');
        const emptyState = document.getElementById('empty-loan-manager');
        const searchInput = document.getElementById('search-loan-manager');

        if (!tableBody) return;

        // Filter based on search
        const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';

        const filteredLoans = state.loans.filter(loan => {
            const borrower = findBorrowerById(loan.customerId);
            return (loan.loanId && loan.loanId.toLowerCase().includes(searchTerm)) ||
                   (borrower && borrower.fullName.toLowerCase().includes(searchTerm)) ||
                   (borrower && borrower.mobile.toLowerCase().includes(searchTerm));
        });

        // Render table
        if (filteredLoans.length === 0) {
            tableBody.innerHTML = '';
            if (emptyState) emptyState.hidden = false;
            return;
        }

        if (emptyState) emptyState.hidden = true;

        tableBody.innerHTML = filteredLoans.map((loan, idx) => {
            const borrower = findBorrowerById(loan.customerId);
            const paymentsForLoan = state.payments.filter(p => p.loanId === loan.loanId);
            const finesForLoan = state.fines.filter(f => f.loanId === loan.loanId);
            const outstanding = calculateOutstandingDue(loan, paymentsForLoan, finesForLoan);

            return `
                <tr>
                    <td>${loan.loanId}</td>
                    <td>${borrower ? borrower.fullName : 'Unknown'}</td>
                    <td>${borrower ? borrower.mobile : '—'}</td>
                    <td>${loan.repaymentType}</td>
                    <td>${formatCurrency(parseFloat(loan.principal) || 0)}</td>
                    <td>${formatCurrency(outstanding)}</td>
                    <td>${loan.status}</td>
                    <td>
                        <div class="btn-icon danger" title="Delete Loan Permanently"
                             onclick="window.MicrofinanceCRM.confirmDeleteLoan('${loan.loanId}')"
                             style="color: var(--color-danger)"
                             disabled="${!canDeleteLoan()}"
                             data-delay="1200">
                            <span aria-hidden="true">🗑️</span>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // =========================================================================
    // REPORTS RENDERER
    // =========================================================================

    /**
     * Render reports view
     */
    function renderReports() {
        'use strict';

        // Generate collection report
        renderCollectionReport();

        // Generate outstanding report
        renderOutstandingReport();

        // Generate fines report
        renderFinesReport();
    }

    /**
     * Render collection report
     */
    function renderCollectionReport() {
        'use strict';

        const reportBody = document.getElementById('body-collection-report');
        const fromInput = document.getElementById('report-from');
        const toInput = document.getElementById('report-to');
        const reportBtn = document.getElementById('btn-gen-collection-report');
        const exportBtn = document.getElementById('btn-export-collection-report');

        if (!reportBody) return;

        // Default to this month
        const today = new Date();
        const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

        let dateFrom = fromInput ? fromInput.value : formatDateDDMMYYYY(firstOfMonth);
        let dateTo = toInput ? toInput.value : formatDateDDMMYYYY(lastOfMonth);

        // Ensure correct order
        if (isBeforeDDMMYYYY(dateFrom, dateTo)) {
            [dateFrom, dateTo] = [dateTo, dateFrom];
        }

        // Calculate daily collections
        const dailyCollections = [];
        const labels = [];

        for (let i = 29; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const ddmm = formatDateDDMMYYYY(date);
            labels.push(ddmm);

            const dayPayments = state.payments.filter(p =>
                p.paymentDate === ddmm
            );
            const dayTotal = dayPayments.reduce((sum, p) => sum + parseFloat(p.amount) || 0, 0);
            dailyCollections.push(dayTotal);
        }

        // Render table
        if (reportBody) {
            reportBody.innerHTML = `
                <tr>
                    <td>${dateFrom}</td>
                    <td>${formatCurrency(dailyCollections.filter((_, i) => isSameDayDDMMYYYY(labels[i], dateFrom))[0] || 0)}</td>
                    <td>${formatCurrency(0)}</td>
                    <td>${formatCurrency(dailyCollections.reduce((a, b) => a + b, 0))}</td>
                </tr>
            `;
        }

        // Render chart if chart canvas exists
        const chartCanvas = document.getElementById('collection-chart');
        if (chartCanvas && window.MicrofinanceCRM) {
            // Already rendered in renderCharts()
        }
    }

    /**
     * Render outstanding report
     */
    function renderOutstandingReport() {
        'use strict';

        const reportBody = document.getElementById('body-outstanding-report');
        const generateBtn = document.getElementById('btn-gen-outstanding-report');
        const exportBtn = document.getElementById('btn-export-outstanding-report');

        if (!reportBody) return;

        // Render each loan with outstanding
        const outstandingLoans = state.loans.map(loan => {
            const paymentsForLoan = state.payments.filter(p => p.loanId === loan.loanId);
            const finesForLoan = state.fines.filter(f => f.loanId === loan.loanId);
            const outstanding = calculateOutstandingDue(loan, paymentsForLoan, finesForLoan);
            const borrower = findBorrowerById(loan.customerId);

            return {
                borrower: borrower ? borrower.fullName : 'Unknown',
                loanId: loan.loanId,
                repaymentType: loan.repaymentType,
                outstanding: outstanding,
                overdueDays: isLoanOverdue(loan) ? getOverdueDays(loan) : 0
            };
        })
        .filter(l => l.outstanding > 0)
        .sort((a, b) => b.outstanding - a.outstanding); // Sort by highest outstanding first

        // Render table
        if (reportBody) {
            if (outstandingLoans.length === 0) {
                reportBody.innerHTML = '<tr><td colspan="5" class="empty-state-small">No outstanding loans</td></tr>';
            } else {
                reportBody.innerHTML = outstandingLoans.map((l, idx) => `
                    <tr>
                        <td>${l.borrower}</td>
                        <td>${l.loanId}</td>
                        <td>${l.repaymentType}</td>
                        <td>${formatCurrency(l.outstanding)}</td>
                        <td>${l.overdueDays} ${l.overdueDays > 0 ? 'overdue' : 'current'}</td>
                    </tr>
                `).join('');
            }
        }
    }

    /**
     * Render late fines report
     */
    function renderFinesReport() {
        'use strict';

        const reportBody = document.getElementById('body-fines-report');
        const generateBtn = document.getElementById('btn-gen-fines-report');
        const exportBtn = document.getElementById('btn-export-fines-report');

        if (!reportBody) return;

        // Render fines table
        if (state.fines.length === 0) {
            reportBody.innerHTML = '<tr><td colspan="5" class="empty-state-small">No fines recorded</td></tr>';
            return;
        }

        reportBody.innerHTML = state.fines.map((fine, idx) => {
            const borrower = findBorrowerById(fine.customerId);
            const loan = state.loans.find(l => l.loanId === fine.loanId);
            return `
                <tr>
                    <td>${formatDateDDMMYYYY(fine.fineDate)}</td>
                    <td>${fine.loanId || '—'}</td>
                    <td>${borrower ? borrower.fullName : 'Unknown'}</td>
                    <td>${formatCurrency(fine.fineAmount)}</td>
                    <td>${fine.reason || '—'}</td>
                </tr>
            `;
        }).join('');
    }

    // =========================================================================
    // USER MANAGEMENT RENDERER (Super Admin Only)
    // =========================================================================

    /**
     * Render user management table
     */
    function renderUserManagement() {
        'use strict';

        const tableBody = document.getElementById('body-users');

        if (!tableBody) return;

        // Render users table
        if (state.users.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="8" class="empty-state-small">No users yet. Add a new user above.</td></tr>`;
            return;
        }

        tableBody.innerHTML = state.users.map((user, idx) => {
            const isSuper = user.permissions && user.permissions.deleteLoan;
            const perms = user.permissions || {};

            return `
                <tr>
                    <td>${idx + 1}</td>
                    <td>${user.fullName || '—'}</td>
                    <td>${user.loginId || '—'}</td>
                    <td>
                        <span class="permission-tag ${perms.viewOnly ? 'badge-primary' : ''}">
                            View Only
                        </span>
                        <span class="permission-tag ${perms.addCollection ? 'badge-success' : ''}">
                            Add Collection
                        </span>
                        <span class="permission-tag ${perms.editRecords ? 'badge-info' : ''}">
                            Edit Records
                        </span>
                        <span class="permission-tag ${perms.addLateFine ? 'badge-warning' : ''}">
                            Add Fine
                        </span>
                        <span class="permission-tag ${perms.deleteLoan ? 'badge-danger' : ''}">
                            Delete Loan
                        </span>
                    </td>
                    <td>
                        <span class="status-badge ${user.isActive ? 'status-active' : 'status-inactive'}">
                            ${user.isActive ? 'Active' : 'Inactive'}
                        </span>
                    </td>
                    <td>${user.created ? user.created.substring(0, 10) : '—'}</td>
                    <td>
                        <div class="btn-icon primary" title="Edit User"
                             onclick="window.MicrofinanceCRM.showUserModal('${user.id}')"
                             style="color: var(--color-primary)"
                             ${!canEditRecords() ? 'disabled' : ''}>
                            <span aria-hidden="true">✏️</span>
                        </div>
                        <div class="btn-icon danger" title="Delete User"
                             onclick="window.MicrofinanceCRM.confirmDeleteUser('${user.id}')"
                             style="color: var(--color-danger)"
                             ${!canEditRecords() ? 'disabled' : ''}>
                            <span aria-hidden="true">🗑️</span>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // =========================================================================
    // SYNC SETTINGS RENDERER
    // =========================================================================

    /**
     * Render sync settings view
     */
    function renderSyncSettings() {
        'use strict';

        const gsheetIdInput = document.getElementById('gsheet-id');
        const gscriptUrlInput = document.getElementById('gscript-url');
        const syncStatusDiv = document.getElementById('sync-status');

        if (gsheetIdInput) {
            gsheetIdInput.value = state.sync.googleSheetId || '';
        }

        if (gscriptUrlInput) {
            gscriptUrlInput.value = state.sync.googleWebAppUrl || '';
        }

        // Update sync status display
        if (syncStatusDiv) {
            if (state.sync.googleSheetId && state.sync.googleWebAppUrl) {
                syncStatusDiv.innerHTML = `
                    <div class="form-help">✅ Google Sheets configured</div>
                    <div>Spreadsheet ID: ${state.sync.googleSheetId}</div>
                    <div>Web App URL: Configured</div>
                `;
            } else {
                syncStatusDiv.innerHTML = `
                    <div class="form-help">⚠️ Google Sheets not configured</div>
                    <div>Please paste your Google Spreadsheet ID and Apps Script Web App URL</div>
                `;
            }
        }
    }

    // =========================================================================
    // PROFILE RENDERER
    // =========================================================================

    /**
     * Render profile view
     */
    function renderProfile() {
        'use strict';

        if (!state.activeUser) return;

        const profileAvatar = document.getElementById('profile-avatar');
        const profileName = document.getElementById('profile-name');
        const profileRole = document.getElementById('profile-role');
        const profileLoginId = document.getElementById('profile-login-id');
        const profilePermissions = document.getElementById('profile-permissions');
        const profileStatus = document.getElementById('profile-status');

        if (profileAvatar) {
            const initials = state.activeUser.fullName.split(' ')
                .map(name => name[0]).join('').toUpperCase() || 'A';
            profileAvatar.textContent = initials;
        }

        if (profileName) profileName.textContent = state.activeUser.fullName;
        if (profileRole) {
            profileRole.textContent = state.activeUser.permissions.deleteLoan ? 'Super Admin' : 'Staff';
            profileRole.className = 'role-badge';
        }
        if (profileLoginId) profileLoginId.textContent = state.activeUser.loginId;
        if (profilePermissions) {
            const perms = state.activeUser.permissions || {};
            const permLabels = [];
            if (perms.viewOnly) permLabels.push('View Only');
            if (perms.addCollection) permLabels.push('Add Collection');
            if (perms.editRecords) permLabels.push('Edit Records');
            if (perms.addLateFine) permLabels.push('Add Late Fine');
            if (perms.deleteLoan) permLabels.push('Delete Loan');
            profilePermissions.textContent = permLabels.join(', ') || 'No permissions';
        }
        if (profileStatus) {
            profileStatus.textContent = state.activeUser.isActive ? 'Active' : 'Inactive';
            profileStatus.className = state.activeUser.isActive ? 'status-active' : 'status-inactive';
        }
    }

    // =========================================================================
    // SETTINGS RENDERER
    // =========================================================================

    /**
     * Render settings view
     */
    function renderSettings() {
        'use strict';

        const currencyInput = document.getElementById('setting-currency');
        const dateFormatSelect = document.getElementById('setting-date-format');

        if (currencyInput) {
            currencyInput.value = state.settings.currency || '₹';
        }

        if (dateFormatSelect) {
            dateFormatSelect.value = state.settings.dateFormat || 'DD-MM-YYYY';
        }
    }

    // =========================================================================
    // MODAL HANDLERS
    // =========================================================================

    /**
     * Show borrower add/modal
     * @param {string} sNo - Optional S_No for editing
     */
    window.MicrofinanceCRM.showBorrowerModal = function(sNo) {
        'use strict';

        const modalTitle = document.getElementById('modal-borrower-title');
        const borrowerNameInp = document.getElementById('borrower-name');
        const borrowerMobileInp = document.getElementById('borrower-mobile');
        const borrowerLocationInp = document.getElementById('borrower-location');
        const borrowerNotesInp = document.getElementById('borrower-notes');
        const borrowerSNo = document.getElementById('borrower-sno');

        if (sNo) {
            modalTitle.textContent = 'Edit Borrower';
            const borrower = state.borrowers.find(b => b.sNo === sNo);
            if (borrower) {
                borrowerNameInp.value = borrower.fullName;
                borrowerMobileInp.value = borrower.mobile;
                borrowerLocationInp.value = borrower.location || '';
                borrowerNotesInp.value = borrower.notes || '';
                borrowerSNo.value = borrower.sNo;
            }
        } else {
            modalTitle.textContent = 'Add Borrower';
            document.getElementById('form-borrower').reset();
            borrowerSNo.value = generateId('borrower');
        }

        showModal('modal-borrower');
    };

    /**
     * Show loan issue modal
     * @param {string} customerId - Borrower S_No
     */
    window.MicrofinanceCRM.showLoanModal = function(customerId) {
        'use strict';

        const formLoan = document.getElementById('form-loan');
        const loanTypeSelect = document.getElementById('loan-type');
        const loanPrincipalInp = document.getElementById('loan-principal');
        const loanDateInp = document.getElementById('loan-date');
        const calcRate = document.getElementById('calc-rate');
        const calcTotalPayable = document.getElementById('calc-total-payable');
        const calcDailyInstallment = document.getElementById('calc-daily-installment');
        const calcWeeklyInstallment = document.getElementById('calc-weekly-installment');

        // Find borrower
        const borrower = state.borrowers.find(b => b.sNo === customerId);
        if (!borrower) {
            showToast('Borrower not found', 'error');
            return;
        }

        // Populate borrower select (could be enhanced with pre-select)
        const borrowerSelect = document.getElementById('loan-borrower');
        // Clear and add borrower
        borrowerSelect.innerHTML = '<option value="">Select borrower...</option>';
        const opt = document.createElement('option');
        opt.value = customerId;
        opt.textContent = `${borrower.fullName} (S.No: ${borrower.sNo})`;
        borrowerSelect.appendChild(opt);

        // Set customer ID hidden field
        document.getElementById('loan-customer-id').value = customerId;

        // Reset form
        formLoan.reset();

        // Calculate totals based on loan type selection
        loanTypeSelect.addEventListener('change', () => {
            const type = loanTypeSelect.value;
            const principal = parseFloat(loanPrincipalInp.value) || 0;

            if (type === 'DAILY') {
                calcRate.textContent = '20%';
                calcDailyInstallment.textContent = formatCurrency(calculateDailyInstallment(principal));
                calcWeeklyInstallment.textContent = '₹0';
                calcTotalPayable.textContent = formatCurrency(calculateTotalPayable({
                    principal,
                    ratePercent: 20
                }));
            } else if (type === 'WEEKLY') {
                calcRate.textContent = '26%';
                calcWeeklyInstallment.textContent = formatCurrency(calculateWeeklyInstallment(principal));
                calcDailyInstallment.textContent = '₹0';
                calcTotalPayable.textContent = formatCurrency(calculateTotalPayable({
                    principal,
                    ratePercent: 26
                }));
            }
        });

        // Initialize with DAILY
        loanTypeSelect.dispatchEvent(new Event('change'));

        document.getElementById('modal-loan-title').textContent = 'Issue New Loan';
        showModal('modal-loan');
    };

    /**
     * Show payment recording modal
     * @param {string} loanId - Loan ID
     */
    window.MicrofinanceCRM.recordDailyPayment = function(loanId) {
        'use strict';

        const formPayment = document.getElementById('form-payment');
        const loanIdInput = document.getElementById('payment-loan-id');
        const customerIdInput = document.getElementById('payment-customer-id');
        const borrowerNameEl = document.getElementById('pay-borrower-name');
        const loanIdEl = document.getElementById('pay-loan-id');
        const loanTypeEl = document.getElementById('pay-loan-type');
        const outstandingEl = document.getElementById('pay-outstanding');
        const suggestedEl = document.getElementById('pay-suggested');

        // Find loan
        const loan = state.loans.find(l => l.loanId === loanId);
        if (!loan) {
            showToast('Loan not found', 'error');
            return;
        }

        // Find borrower
        const borrower = state.borrowers.find(b => b.sNo === loan.customerId);
        if (borrower) {
            borrowerNameEl.textContent = borrower.fullName;
        }

        loanIdInput.value = loan.loanId;
        customerIdInput.value = loan.customerId;
        loanTypeEl.textContent = loan.repaymentType === 'DAILY' ? 'Daily (20%)' : 'Weekly (26%)';

        // Calculate outstanding
        const paymentsForLoan = state.payments.filter(p => p.loanId === loan.loanId);
        const finesForLoan = state.fines.filter(f => f.loanId === loan.loanId);
        const outstanding = calculateOutstandingDue(loan, paymentsForLoan, finesForLoan);
        outstandingEl.textContent = formatCurrency(outstanding);

        // Calculate suggested payment
        const suggested = calculateSuggestedPayment(loan, loan.repaymentType, outstanding);
        suggestedEl.textContent = formatCurrency(suggested);

        // Populate collectedBy selector
        const collectedBySelect = document.getElementById('payment-collected-by');
        collectedBySelect.innerHTML = '<option value="">Select collector...</option>';

        // Add current user as option if available
        if (state.activeUser) {
            const opt = document.createElement('option');
            opt.value = state.activeUser.loginId;
            opt.textContent = state.activeUser.fullName;
            collectedBySelect.appendChild(opt);
        }

        // Populate payment methods
        const paymentMethodSelect = document.getElementById('payment-method');

        // Set today's date
        const todayInput = document.getElementById('payment-date');
        if (todayInput) {
            todayInput.value = getTodayDDMMYYYY();
        }

        // Set min amount to 1
        const amountInput = document.getElementById('payment-amount');
        if (amountInput) {
            amountInput.min = 1;
        }

        document.getElementById('modal-payment-title').textContent = 'Record Payment';
        showModal('modal-payment');
    };

    /**
     * Show weekly payment recording modal
     * @param {string} loanId - Loan ID
     */
    window.MicrofinanceCRM.recordWeeklyPayment = function(loanId) {
        'use strict';

        // Similar to daily payment but for weekly loans
        window.MicrofinanceCRM.recordDailyPayment(loanId);
        // Update the title after showing modal
        setTimeout(() => {
            const modalTitle = document.getElementById('modal-payment-title');
            if (modalTitle) {
                modalTitle.textContent = 'Record Weekly Payment';
            }
        }, 100);
    };

    /**
     * Show late fine addition modal
     * @param {string} loanId - Loan ID
     */
    window.MicrofinanceCRM.showFineModal = function(loanId) {
        'use strict';

        const formFine = document.getElementById('form-fine');
        const fineLoanIdInput = document.getElementById('fine-loan-id');
        const fineCustomerIdInput = document.getElementById('fine-customer-id');
        const fineBorrowerNameEl = document.getElementById('fine-borrower-name');
        const fineLoanIdDisplay = document.getElementById('fine-loan-id-display');
        const fineOutstandingEl = document.getElementById('fine-outstanding');

        // Find loan
        const loan = state.loans.find(l => l.loanId === loanId);
        if (!loan) {
            showToast('Loan not found', 'error');
            return;
        }

        // Find borrower
        const borrower = state.borrowers.find(b => b.sNo === loan.customerId);
        if (borrower) {
            fineBorrowerNameEl.textContent = borrower.fullName;
        }

        fineLoanIdInput.value = loan.loanId;
        fineCustomerIdInput.value = loan.customerId;
        fineLoanIdDisplay.textContent = loan.loanId;

        // Calculate outstanding
        const paymentsForLoan = state.payments.filter(p => p.loanId === loan.loanId);
        const finesForLoan = state.fines.filter(f => f.loanId === loan.loanId);
        const outstanding = calculateOutstandingDue(loan, paymentsForLoan, finesForLoan);
        fineOutstandingEl.textContent = formatCurrency(outstanding);

        // Set today's date
        const fineDateInput = document.getElementById('fine-date');
        if (fineDateInput) {
            fineDateInput.value = getTodayDDMMYYYY();
        }

        // Set min fine amount of 1
        const fineAmountInput = document.getElementById('fine-amount');
        if (fineAmountInput) {
            fineAmountInput.min = 1;
        }

        document.getElementById('modal-fine-title').textContent = 'Add Late Fine';
        showModal('modal-fine');
    };

    /**
     * Show user add/modal
     * @param {string} userId - Optional user ID for editing
     */
    window.MicrofinanceCRM.showUserModal = function(userId) {
        'use strict';

        const modalTitle = document.getElementById('modal-user-title');
        const formUser = document.getElementById('form-user');
        const userFullnameInp = document.getElementById('user-fullname');
        const userLoginIdInp = document.getElementById('user-login-id');
        const userPasswordInp = document.getElementById('user-password');
        const userConfirmPasswordInp = document.getElementById('user-confirm-password');
        const userActiveCheckbox = document.getElementById('user-active');
        const permissions = {
            permView: document.getElementById('perm-view'),
            permAddCollection: document.getElementById('perm-add-collection'),
            permEditRecords: document.getElementById('perm-edit-records'),
            permAddLateFine: document.getElementById('perm-add-late-fine'),
            permDeleteLoan: document.getElementById('perm-delete-loan')
        };

        if (userId) {
            modalTitle.textContent = 'Edit User';
            const user = state.users.find(u => u.id === userId);
            if (user) {
                userFullnameInp.value = user.fullName || '';
                userLoginIdInp.value = user.loginId || '';
                userPasswordInp.value = ''; // Don't pre-fill password for security
                userConfirmPasswordInp.value = '';
                userActiveCheckbox.checked = user.isActive !== false;

                // Set existing permissions
                permissions.permView.checked = !!user.permissions?.viewOnly;
                permissions.permAddCollection.checked = !!user.permissions?.addCollection;
                permissions.permEditRecords.checked = !!user.permissions?.editRecords;
                permissions.permAddLateFine.checked = !!user.permissions?.addLateFine;
                permissions.permDeleteLoan.checked = !!user.permissions?.deleteLoan;
            }
        } else {
            modalTitle.textContent = 'Add User';
            formUser.reset();
            userActiveCheckbox.checked = true;
        }

        // Clear confirm password on reset
        formUser.addEventListener('reset', () => {
            userConfirmPasswordInp.value = '';
        });

        showModal('modal-user');
    };

    /**
     * Show delete confirmation modal
     * @param {string} loanId - Loan ID to delete
     */
    window.MicrofinanceCRM.showDeleteConfirmation = function(loanId) {
        'use strict';

        const modal = document.getElementById('modal-delete-confirm');
        const deleteBtn = document.getElementById('btn-confirm-delete');
        const unlockTimer = document.getElementById('unlock-timer');

        if (!modal || !deleteBtn || !unlockTimer) return;

        // Find loan details
        const loan = state.loans.find(l => l.loanId === loanId);
        if (!loan) {
            showToast('Loan not found', 'error');
            return;
        }

        const borrower = state.borrowers.find(b => b.sNo === loan.customerId);

        // Display loan details
        document.getElementById('del-loan-id').textContent = loan.loanId;
        document.getElementById('del-borrower').textContent = borrower ? borrower.fullName : 'Unknown';
        document.getElementById('del-principal').textContent = formatCurrency(parseFloat(loan.principal) || 0);

        const paymentsForLoan = state.payments.filter(p => p.loanId === loan.loanId);
        const outstanding = calculateOutstandingDue(loan,
            paymentsForLoan,
            state.fines.filter(f => f.loanId === loan.loanId)
        );
        document.getElementById('del-outstanding').textContent = formatCurrency(outstanding);
        document.getElementById('del-status').textContent = loan.status;

        // Start 1.2-second unlock delay timer
        let seconds = 1.2;
        unlockTimer.textContent = `(1.2s)`;

        const timerInterval = setInterval(() => {
            seconds -= 0.2;
            if (seconds > 0) {
                unlockTimer.textContent = `(${seconds.toFixed(1)}s)`;
            } else {
                clearInterval(timerInterval);
                unlockTimer.textContent = '(Ready)';
                deleteBtn.disabled = false;
            }
        }, 200);

        // Enable checkbox to unlock
        const confirmCheckbox = document.getElementById('delete-confirm-checkbox');
        if (confirmCheckbox) {
            confirmCheckbox.disabled = false;
            confirmCheckbox.checked = false;
        }

        // Disable delete button initially
        deleteBtn.disabled = true;

        // Show modal
        showModal('modal-delete-confirm');
    };

    /**
     * Confirm loan deletion after timer
     */
    window.MicrofinanceCRM.confirmDeleteLoan = function() {
        'use strict';

        const modal = document.getElementById('modal-delete-confirm');
        const deleteBtn = document.getElementById('btn-confirm-delete');
        const confirmCheckbox = document.getElementById('delete-confirm-checkbox');

        if (!modal || !deleteBtn || !confirmCheckbox) return;

        // Check if checkbox is checked
        if (!confirmCheckbox.checked) {
            showToast('Please confirm you understand this action is permanent', 'error');
            return;
        }

        // Find and delete the loan
        const loanId = modal ? modal.dataset.loanId : null;
        if (loanId) {
            window.MicrofinanceCRM.deleteLoan(loanId);
        }

        hideModal('modal-delete-confirm');
    };

    /**
     * Delete a loan permanently
     * @param {string} loanId - Loan ID to delete
     */
    window.MicrofinanceCRM.deleteLoan = function(loanId) {
        'use strict';

        if (!canDeleteLoan()) {
            showToast('You do not have permission to delete loans', 'error');
            return;
        }

        // Find loan index
        const loanIdx = state.loans.findIndex(l => l.loanId === loanId);

        if (loanIdx >= 0) {
            const loan = state.loans[loanIdx];
            const borrower = state.borrowers.find(b => b.sNo === loan.customerId);

            // Show confirmation
            const confirmed = confirm(
                `Are you sure you want to permanently delete loan ${loan.loanId}?\n\n` +
                `Borrower: ${borrower ? borrower.fullName : 'Unknown'}\n` +
                `Principal: ${formatCurrency(parseFloat(loan.principal))}\n` +
                `This action cannot be undone!`
            );

            if (confirmed) {
                // Remove loan from state
                state.loans.splice(loanIdx, 1);

                // Also remove associated payments and fines
                // Remove associated payments
                state.payments = state.payments.filter(p => p.loanId !== loanId);

                // Remove associated fines
                state.fines = state.fines.filter(f => f.loanId !== loanId);

                // Save state
                saveStateToStorage();

                // Re-render views
                renderDashboard();
                renderDailyLoans();
                renderWeeklyLoans();
                renderLoanManager();
                renderBorrowers();

                showToast(`Loan ${loan.loanId} permanently deleted`, 'success');
            }
        } else {
            showToast('Loan not found', 'error');
        }
    };

    /**
     * Show change password modal
     */
    window.MicrofinanceCRM.showChangePassword = function() {
        'use strict';

        const modal = document.getElementById('modal-change-password');
        if (modal) {
            showModal('modal-change-password');
        }
    };

    /**
     * Handle change password form submission
     */
    window.MicrofinanceCRM.changePassword = function() {
        'use strict';

        const currentPwd = document.getElementById('current-password').value;
        const newPwd = document.getElementById('new-password').value;
        const confirmPwd = document.getElementById('confirm-new-password').value;

        if (!currentPwd || !newPwd || !confirmPwd) {
            showToast('All password fields are required', 'error');
            return;
        }

        if (newPwd !== confirmPwd) {
            showToast('New passwords do not match', 'error');
            return;
        }

        if (newPwd.length < 6) {
            showToast('New password must be at least 6 characters', 'error');
            return;
        }

        // Find current user
        if (!state.activeUser) return;

        // Find user in state
        const user = state.users.find(u => u.id === state.activeUser.id);
        if (!user) return;

        // Verify current password
        const currentHash = await sha256Hash(currentPwd);

        if (user.passwordHash !== currentHash) {
            showToast('Current password is incorrect', 'error');
            return;
        }

        // Update password
        const newHash = await sha256Hash(newPwd);
        user.passwordHash = newHash;

        // Save state
        saveStateToStorage();

        // Hide modal and show success
        hideModal('modal-change-password');
        showToast('Password changed successfully', 'success');
    };

    // =========================================================================
    // FORM HANDLERS
    // =========================================================================

    /**
     * Handle borrower form submission
     */
    document.getElementById('form-borrower')?.addEventListener('submit', async (e) => {
        'use strict';

        e.preventDefault();

        const form = e.target;
        const sNo = form.sNo.value || generateId('borrower');
        const fullName = form.fullName.value.trim();
        const mobile = form.mobile.value.trim();
        const location = form.location.value.trim();
        const notes = form.notes.value.trim();

        // Validation
        if (!fullName || fullName.length < 2) {
            showToast('Full name is required', 'error');
            return;
        }

        if (!mobile || !/^[0-9+\-\s]{10,15}$/.test(mobile)) {
            showToast('Valid mobile number is required (10-15 digits)', 'error');
            return;
        }

        // Check for duplicate mobile (allow across different borrowers per spec)
        // Actually per spec: "allow duplicate mobile numbers across different borrowers"
        // So we don't check for duplicates

        // Check if updating or adding
        const exists = state.borrowers.some(b => b.sNo === sNo);

        if (exists) {
            // Update existing
            const idx = state.borrowers.findIndex(b => b.sNo === sNo);
            state.borrowers[idx] = {
                ...state.borrowers[idx],
                fullName,
                mobile,
                location: location || state.borrowers[idx].location,
                notes: notes || state.borrowers[idx].notes
            };
            showToast('Borrower updated successfully', 'success');
        } else {
            // Add new
            const newBorrower = {
                sNo: parseInt(sNo, 10).toString().padStart(4, '0') || '0001',
                fullName,
                mobile,
                location,
                notes
            };

            state.borrowers.push(newBorrower);
            showToast('Borrower added successfully', 'success');
        }

        // Save state
        saveStateToStorage();

        // Hide modal and re-render
        hideModal('modal-borrower');
        renderBorrowers();
        renderDashboard();
    });

    /**
     * Handle loan form submission
     */
    document.getElementById('form-loan')?.addEventListener('submit', (e) => {
        'use strict';

        e.preventDefault();

        const loanId = document.getElementById('loan-id').value || generateId('loan');
        const customerId = document.getElementById('loan-customer-id').value;
        const repaymentType = document.getElementById('loan-type').value;
        const principal = document.getElementById('loan-principal').value;
        const loanDate = document.getElementById('loan-date').value || getTodayDDMMYYYY();

        // Validation
        if (!customerId) {
            showToast('Please select a borrower', 'error');
            return;
        }

        if (!principal || parseFloat(principal) <= 0) {
            showToast('Principal amount must be greater than 0', 'error');
            return;
        }

        if (!loanDate) {
            showToast('Loan date is required', 'error');
            return;
        }

        // Validate date format DD-MM-YYYY
        if (!formatDateDDMMYYYY(loanDate)) {
            showToast('Invalid date format. Use DD-MM-YYYY', 'error');
            return;
        }

        // Calculate totals
        const principalNum = parseFloat(principal);
        let ratePercent;

        if (repaymentType === 'DAILY') {
            ratePercent = 20;
        } else if (repaymentType === 'WEEKLY') {
            ratePercent = 26;
        } else {
            ratePercent = 20; // Default
        }

        const totalPayable = calculateTotalPayable({
            principal: principalNum,
            ratePercent
        }, state.fines.filter(f => false)); // No fines for new loan

        const dailyInstallment = calculateDailyInstallment(principalNum);
        const weeklyInstallment = calculateWeeklyInstallment(principalNum);

        // Create loan object
        const newLoan = {
            loanId,
            customerId,
            repaymentType,
            principal,
            ratePercent: ratePercent.toString(),
            totalPayable: totalPayable.toFixed(2),
            loanDate,
            status: 'ACTIVE'
        };

        // Check for existing loan with same customerId and date
        const existingIdx = state.loans.findIndex(
            l => l.customerId === customerId && l.loanDate === loanDate
        );

        if (existingIdx >= 0) {
            // Update existing loan
            state.loans[existingIdx] = {
                ...state.loans[existingIdx],
                ...newLoan,
                loanId: existingIdx === loanIdx ? loanId : state.loans[existingIdx].loanId
            };
            showToast('Loan updated successfully', 'success');
        } else {
            // Add new loan
            state.loans.push(newLoan);
            showToast('Loan issued successfully', 'success');
        }

        // Save state
        saveStateToStorage();

        // Hide modal and re-render
        hideModal('modal-loan');
        renderDashboard();
        renderDailyLoans();
        renderWeeklyLoans();
    });

    /**
     * Handle payment form submission
     */
    document.getElementById('form-payment')?.addEventListener('submit', async (e) => {
        'use strict';

        e.preventDefault();

        const form = e.target;
        const loanId = form.loanId.value;
        const customerId = form.customerId.value;
        const amount = form.amount.value;
        const paymentDate = form.paymentDate.value || getTodayDDMMYYYY();
        const paymentMethod = form.paymentMethod.value;
        const referenceNo = form.referenceNo.value.trim();
        const collectedBy = form.collectedBy.value;

        // Validation
        if (!loanId) {
            showToast('Loan ID is required', 'error');
            return;
        }

        if (!amount || parseFloat(amount) <= 0) {
            showToast('Payment amount must be greater than 0', 'error');
            return;
        }

        if (!paymentDate) {
            showToast('Payment date is required', 'error');
            return;
        }

        if (!paymentMethod) {
            showToast('Payment method is required', 'error');
            return;
        }

        if (!collectedBy) {
            showToast('Collector name is required', 'error');
            return;
        }

        // Validate date format
        if (!formatDateDDMMYYYY(paymentDate)) {
            showToast('Invalid date format. Use DD-MM-YYYY', 'error');
            return;
        }

        // Check if user has permission to add collection
        if (!canAddCollection() && state.activeUser?.loginId !== 'admin') {
            showToast('You do not have permission to record payments', 'error');
            return;
        }

        // Create payment object
        const newPayment = {
            paymentId: generateId('pay'),
            loanId,
            customerId,
            amount: parseFloat(amount),
            paymentDate,
            paymentMethod,
            referenceNo: referenceNo || undefined,
            collectedBy
        };

        // Add payment to state
        state.payments.push(newPayment);

        // Update loan outstanding
        // Find loan and recalculate outstanding
        const loanIdx = state.loans.findIndex(l => l.loanId === loanId);
        if (loanIdx >= 0) {
            // Just add payment, outstanding will be recalculated on render
        }

        // Save state
        saveStateToStorage();

        // Hide modal and re-render
        hideModal('modal-payment');
        renderDashboard();
        renderDailyLoans();
        renderWeeklyLoans();

        // Show success toast
        showToast('Payment recorded successfully', 'success');
    });

    /**
     * Handle late fine form submission
     */
    document.getElementById('form-fine')?.addEventListener('submit', (e) => {
        'use strict';

        e.preventDefault();

        const form = e.target;
        const loanId = form.loanId.value;
        const customerId = form.customerId.value;
        const fineAmount = form.fineAmount.value;
        const fineDate = form.fineDate.value || getTodayDDMMYYYY();
        const fineReason = form.reason.value.trim();

        // Validation
        if (!loanId) {
            showToast('Loan ID is required', 'error');
            return;
        }

        if (!fineAmount || parseFloat(fineAmount) <= 0) {
            showToast('Fine amount must be greater than 0', 'error');
            return;
        }

        if (!fineDate) {
            showToast('Fine date is required', 'error');
            return;
        }

        if (!fineReason) {
            showToast('Fine reason is required', 'error');
            return;
        }

        // Validate date format
        if (!formatDateDDMMYYYY(fineDate)) {
            showToast('Invalid date format. Use DD-MM-YYYY', 'error');
            return;
        }

        // Check if user has permission to add late fines
        if (!canAddLateFine() && state.activeUser?.loginId !== 'admin') {
            showToast('You do not have permission to add late fines', 'error');
            return;
        }

        // Check if loan exists
        const loan = state.loans.find(l => l.loanId === loanId);
        if (!loan) {
            showToast('Loan not found', 'error');
            return;
        }

        // Create fine object
        const newFine = {
            fineId: generateId('fine'),
            loanId,
            customerId,
            fineAmount: parseFloat(fineAmount),
            reason: fineReason,
            fineDate
        };

        // Add fine to state
        state.fines.push(newFine);

        // Update loan total payable and outstanding
        const loanIdx = state.loans.findIndex(l => l.loanId === loanId);
        if (loanIdx >= 0) {
            // Recalculate total payable with new fine
            const paymentsForLoan = state.payments.filter(p => p.loanId === loanId);
            const updatedTotalPayable = calculateTotalPayable(state.loans[loanIdx], state.fines);
            state.loans[loanIdx].totalPayable = updatedTotalPayable.toFixed(2);
        }

        // Save state
        saveStateToStorage();

        // Hide modal and re-render
        hideModal('modal-fine');
        renderDashboard();
        renderDailyLoans();
        renderWeeklyLoans();

        // Show success toast
        showToast('Late fine added successfully', 'success');
    });

    // =========================================================================
    // UTILITY: Show/Hide Modals
    // =========================================================================

    /**
     * Show a modal
     * @param {string} modalId - Modal element ID
     */
    function showModal(modalId) {
        'use strict';

        const modal = document.getElementById(modalId);
        if (modal) {
            modal.hidden = false;
            modal.classList.add('active');

            // Trap focus in modal
            const overlay = modal.querySelector('.modal-overlay');
            if (overlay) {
                overlay.addEventListener('click', (e) => {
                    if (e.target === overlay) {
                        hideModal(modalId);
                    }
                });
            }

            // Focus first input
            setTimeout(() => {
                const firstInput = modal.querySelector('input:first-child, textarea:first-child');
                if (firstInput) {
                    firstInput.focus();
                }
            }, 100);
        }
    }

    /**
     * Hide a modal
     * @param {string} modalId - Modal element ID
     */
    function hideModal(modalId) {
        'use strict';

        const modal = document.getElementById(modalId);
        if (modal) {
            modal.hidden = true;
            modal.classList.remove('active');
        }
    }

    /**
     * Hide all modals
     */
    function hideAllModals() {
        'use strict';

        const modals = document.querySelectorAll('.modal');
        modals.forEach(modal => {
            modal.hidden = true;
            modal.classList.remove('active');
        });
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
        'use strict';

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
    // INITIALISATION
    // =========================================================================

    // Load state from localStorage
    loadStateFromStorage();

    // Show login screen initially
    updateAuthUI(false);
}