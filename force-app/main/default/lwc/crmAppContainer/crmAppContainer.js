import { LightningElement } from 'lwc';
import validateSession from '@salesforce/apex/AuthController.validateSession';
import { saveToken, loadToken, clearToken } from 'c/crmUtils';

/** App shell: login gate, permission-aware navigation, customer profile overlay. */
export default class CrmAppContainer extends LightningElement {
    session = null;
    booting = true;
    notice = '';
    activeTab = 'customers';
    profileId = null;

    async connectedCallback() {
        const stored = loadToken();
        if (stored) {
            try {
                this.applySession(await validateSession({ token: stored }));
            } catch (e) {
                clearToken();
            }
        }
        this.booting = false;
    }

    get token() {
        return this.session ? this.session.token : null;
    }

    get isLoggedOut() {
        return !this.session;
    }

    get userLine() {
        if (!this.session) {
            return '';
        }
        const mode = this.session.viewOnly ? ' (view only)' : '';
        return `${this.session.fullName} \u00B7 ${this.session.role}${mode}`;
    }

    get tabs() {
        const s = this.session || {};
        const defs = [
            { value: 'customers', label: 'Customers', show: true },
            { value: 'daily', label: 'Daily Loans', show: true },
            { value: 'weekly', label: 'Weekly Loans', show: true },
            { value: 'data', label: 'Excel & Sheets', show: !!(s.canEditRecords || s.canAddCollection || s.canAddFines || s.isSuperAdmin) },
            { value: 'delete', label: 'Loan Manager (Delete)', show: !!(s.isSuperAdmin || s.canDeleteLoans) },
            { value: 'users', label: 'Users', show: !!s.isSuperAdmin }
        ];
        return defs.filter((d) => d.show).map((d) => ({ ...d, pressed: d.value === this.activeTab ? 'true' : 'false' }));
    }

    get isCustomers() {
        return this.activeTab === 'customers';
    }
    get isDaily() {
        return this.activeTab === 'daily';
    }
    get isWeekly() {
        return this.activeTab === 'weekly';
    }
    get isData() {
        return this.activeTab === 'data';
    }
    get isDelete() {
        return this.activeTab === 'delete';
    }
    get isUsers() {
        return this.activeTab === 'users';
    }

    applySession(session) {
        this.session = session;
        saveToken(session.token);
        this.notice = '';
    }

    handleLoggedIn(event) {
        this.activeTab = 'customers';
        this.profileId = null;
        this.applySession(event.detail);
    }

    handleTab(event) {
        this.activeTab = event.currentTarget.dataset.tab;
    }

    handleOpenProfile(event) {
        this.profileId = event.detail.borrowerId;
    }

    handleBack() {
        this.profileId = null;
    }

    handleLogout() {
        this.endSession('');
    }

    handleExpired() {
        this.endSession('Your session expired. Please log in again.');
    }

    endSession(message) {
        clearToken();
        this.session = null;
        this.profileId = null;
        this.notice = message;
    }
}
