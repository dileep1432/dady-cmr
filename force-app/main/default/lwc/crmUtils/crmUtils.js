/** Shared helpers: DD-MM-YYYY dates, money, tel links, error handling, session storage. */

const TOKEN_KEY = 'crmSessionToken';

/** @param {string} iso YYYY-MM-DD @returns {string} DD-MM-YYYY */
export function formatDate(iso) {
    if (!iso) {
        return '';
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : iso;
}

/** @param {string} text DD-MM-YYYY @returns {string|null} YYYY-MM-DD or null when invalid */
export function parseDmy(text) {
    const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text || '');
    if (!match) {
        return null;
    }
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const probe = new Date(year, month - 1, day);
    const valid = probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day;
    return valid ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

/** @returns {string} today's date as YYYY-MM-DD in the browser's timezone */
export function todayIso() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
}

/** @param {number} value @returns {string} amount such as ₹1,200.00 */
export function formatMoney(value) {
    const number = Number(value || 0);
    return '\u20B9' + number.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** @param {string} mobile @returns {string} tel: link for click-to-call */
export function telHref(mobile) {
    if (!mobile) {
        return '';
    }
    const cleaned = String(mobile).replace(/[^\d+]/g, '');
    return cleaned ? `tel:${cleaned}` : '';
}

/** @param {*} error any thrown value @returns {string} readable message */
export function errorMessage(error) {
    if (!error) {
        return 'Something went wrong.';
    }
    if (Array.isArray(error.body)) {
        return error.body.map((e) => e.message).join(', ');
    }
    if (error.body && error.body.message) {
        return error.body.message;
    }
    return error.message || 'Something went wrong.';
}

/** @param {*} error @returns {boolean} true when the server says the session is invalid or expired */
export function isSessionError(error) {
    return errorMessage(error).startsWith('SESSION_EXPIRED');
}

export function saveToken(token) {
    try {
        window.sessionStorage.setItem(TOKEN_KEY, token);
    } catch (e) {
        // storage can be unavailable; the user simply logs in again after a refresh
    }
}

export function loadToken() {
    try {
        return window.sessionStorage.getItem(TOKEN_KEY);
    } catch (e) {
        return null;
    }
}

export function clearToken() {
    try {
        window.sessionStorage.removeItem(TOKEN_KEY);
    } catch (e) {
        // ignore
    }
}
