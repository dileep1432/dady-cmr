import { LightningElement, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getLoansForDeletion from '@salesforce/apex/LoanCrmController.getLoansForDeletion';
import deleteLoan from '@salesforce/apex/LoanCrmController.deleteLoan';
import { formatMoney, errorMessage, isSessionError } from 'c/crmUtils';

const UNLOCK_DELAY_MS = 1200;

/** Loan Manager (Delete): the only place loans can be deleted. Confirm button unlocks after 1.2 seconds. */
export default class LoanDeleteManager extends LightningElement {
    @api token;
    @api session;

    rows = [];
    search = '';
    loading = false;
    error = '';
    target = null;
    unlocked = false;
    deleting = false;
    deleteError = '';
    searchTimer;
    unlockTimer;

    connectedCallback() {
        this.load();
    }

    disconnectedCallback() {
        clearTimeout(this.searchTimer);
        clearTimeout(this.unlockTimer);
    }

    get displayRows() {
        return this.rows.map((l) => ({
            ...l,
            principalText: formatMoney(l.principal),
            paidText: formatMoney(l.totalPaid),
            outstandingText: formatMoney(l.outstanding)
        }));
    }

    get noRows() {
        return !this.loading && this.rows.length === 0;
    }

    get confirmDisabled() {
        return !this.unlocked || this.deleting;
    }

    get confirmLabel() {
        return this.unlocked ? 'Yes, delete loan' : 'Please wait...';
    }

    handleSearch(event) {
        const value = event.target.value;
        clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => {
            this.search = value;
            this.load();
        }, 350);
    }

    async load() {
        this.loading = true;
        this.error = '';
        try {
            this.rows = await getLoansForDeletion({ token: this.token, searchTerm: this.search });
        } catch (e) {
            this.fail(e);
            this.error = errorMessage(e);
        } finally {
            this.loading = false;
        }
    }

    fail(e) {
        if (isSessionError(e)) {
            this.dispatchEvent(new CustomEvent('sessionexpired', { bubbles: true, composed: true }));
        }
    }

    handleDelete(event) {
        this.target = this.rows.find((l) => l.id === event.currentTarget.dataset.id) || null;
        this.deleteError = '';
        this.unlocked = false;
        clearTimeout(this.unlockTimer);
        this.unlockTimer = setTimeout(() => {
            this.unlocked = true;
        }, UNLOCK_DELAY_MS);
    }

    handleCancel() {
        clearTimeout(this.unlockTimer);
        this.target = null;
        this.unlocked = false;
    }

    async handleConfirm() {
        if (!this.unlocked || !this.target) {
            return;
        }
        this.deleting = true;
        this.deleteError = '';
        try {
            await deleteLoan({ token: this.token, loanId: this.target.id });
            this.dispatchEvent(new ShowToastEvent({ title: 'Deleted', message: `Loan ${this.target.loanCode} deleted.`, variant: 'success' }));
            this.handleCancel();
            this.load();
        } catch (e) {
            this.fail(e);
            this.deleteError = errorMessage(e);
        } finally {
            this.deleting = false;
        }
    }
}
