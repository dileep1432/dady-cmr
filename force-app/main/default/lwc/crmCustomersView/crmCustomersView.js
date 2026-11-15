import { LightningElement, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getCustomers from '@salesforce/apex/LoanCrmController.getCustomers';
import { formatMoney, telHref, errorMessage, isSessionError } from 'c/crmUtils';

/** Customers tab: search, click-to-call, add customer, open profile. */
export default class CrmCustomersView extends LightningElement {
    @api token;
    @api session;

    rows = [];
    search = '';
    loading = false;
    error = '';
    showAdd = false;
    timer;

    connectedCallback() {
        this.load();
    }

    disconnectedCallback() {
        clearTimeout(this.timer);
    }

    get canEdit() {
        return !!(this.session && this.session.canEditRecords);
    }

    get displayRows() {
        return this.rows.map((c) => ({
            ...c,
            telHref: telHref(c.mobile),
            outstandingText: formatMoney(c.outstanding),
            loanSummary: `${c.activeLoans} active / ${c.totalLoans} loans`
        }));
    }

    get noRows() {
        return !this.loading && this.rows.length === 0;
    }

    handleSearch(event) {
        const value = event.target.value;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.search = value;
            this.load();
        }, 350);
    }

    async load() {
        this.loading = true;
        this.error = '';
        try {
            this.rows = await getCustomers({ token: this.token, searchTerm: this.search });
        } catch (e) {
            if (isSessionError(e)) {
                this.dispatchEvent(new CustomEvent('sessionexpired', { bubbles: true, composed: true }));
            }
            this.error = errorMessage(e);
        } finally {
            this.loading = false;
        }
    }

    handleAdd() {
        this.showAdd = true;
    }

    handleClose() {
        this.showAdd = false;
    }

    handleSaved() {
        this.showAdd = false;
        this.dispatchEvent(new ShowToastEvent({ title: 'Saved', message: 'Customer saved.', variant: 'success' }));
        this.load();
    }

    handleOpen(event) {
        event.preventDefault();
        this.dispatchEvent(new CustomEvent('openprofile', { bubbles: true, composed: true, detail: { borrowerId: event.currentTarget.dataset.borrower } }));
    }
}
