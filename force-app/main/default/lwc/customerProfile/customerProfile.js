import { LightningElement, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getCustomerProfile from '@salesforce/apex/LoanCrmController.getCustomerProfile';
import getStatementToken from '@salesforce/apex/LoanCrmController.getStatementToken';
import { formatDate, formatMoney, telHref, errorMessage, isSessionError } from 'c/crmUtils';

/** Customer profile: stats, loans, late-fine ledger (when/why), payment history and clean PDF statement. */
export default class CustomerProfile extends LightningElement {
    @api token;
    @api session;
    @api borrowerId;
    /** Path of the statement Visualforce page. Change it for Experience Cloud sites. */
    @api pdfPath = '/apex/CustomerStatementPDF';

    profile = null;
    loading = false;
    error = '';
    pdfBusy = false;
    showEdit = false;
    showIssue = false;
    editLoan = null;
    payLoan = null;
    fineLoan = null;

    connectedCallback() {
        this.load();
    }

    get canEdit() {
        return !!(this.session && this.session.canEditRecords);
    }

    get telLink() {
        return this.profile ? telHref(this.profile.borrower.mobile) : '';
    }

    get payableText() {
        return formatMoney(this.profile.totalPayable);
    }
    get paidText() {
        return formatMoney(this.profile.totalPaid);
    }
    get outstandingText() {
        return formatMoney(this.profile.totalOutstanding);
    }
    get finesText() {
        return formatMoney(this.profile.totalFines);
    }

    get loanRows() {
        if (!this.profile) {
            return [];
        }
        const canCollect = !!(this.session && this.session.canAddCollection);
        const canFine = !!(this.session && this.session.canAddFines);
        return this.profile.loans.map((l) => {
            const completed = l.status === 'COMPLETED';
            return {
                ...l,
                dateText: formatDate(l.disbursementDate),
                principalText: formatMoney(l.principal),
                payableText: formatMoney(l.totalPayable),
                paidText: formatMoney(l.totalPaid),
                outstandingText: formatMoney(l.outstanding),
                badgeClass: completed ? 'crm-badge crm-badge-ok' : 'crm-badge crm-badge-warn',
                canCollect: canCollect && !completed,
                canFine,
                canEdit: this.canEdit
            };
        });
    }

    get fineRows() {
        return this.profile ? this.profile.fines.map((f) => ({ ...f, dateText: formatDate(f.fineDate), amountText: formatMoney(f.amount) })) : [];
    }

    get paymentRows() {
        return this.profile
            ? this.profile.collections.map((p) => ({ ...p, dateText: formatDate(p.paymentDate), amountText: formatMoney(p.amount) }))
            : [];
    }

    get noLoans() {
        return this.profile && this.profile.loans.length === 0;
    }
    get noFines() {
        return this.profile && this.profile.fines.length === 0;
    }
    get noPayments() {
        return this.profile && this.profile.collections.length === 0;
    }

    async load() {
        this.loading = true;
        this.error = '';
        try {
            this.profile = await getCustomerProfile({ token: this.token, borrowerId: this.borrowerId });
        } catch (e) {
            this.handleError(e);
        } finally {
            this.loading = false;
        }
    }

    handleError(e) {
        if (isSessionError(e)) {
            this.dispatchEvent(new CustomEvent('sessionexpired', { bubbles: true, composed: true }));
        }
        this.error = errorMessage(e);
    }

    handleBack() {
        this.dispatchEvent(new CustomEvent('back'));
    }

    handleEdit() {
        this.showEdit = true;
    }
    handleIssueLoan() {
        this.showIssue = true;
    }
    findLoan(event) {
        return this.profile.loans.find((l) => l.id === event.currentTarget.dataset.id);
    }
    handleCollect(event) {
        this.payLoan = this.findLoan(event);
    }
    handleFine(event) {
        this.fineLoan = this.findLoan(event);
    }
    handleEditLoan(event) {
        this.editLoan = this.findLoan(event);
    }

    closeModals() {
        this.showEdit = false;
        this.showIssue = false;
        this.editLoan = null;
        this.payLoan = null;
        this.fineLoan = null;
    }

    handleSaved() {
        this.closeModals();
        this.dispatchEvent(new ShowToastEvent({ title: 'Saved', message: 'Changes saved.', variant: 'success' }));
        this.load();
    }

    async handlePdf() {
        this.pdfBusy = true;
        try {
            const pdfToken = await getStatementToken({ token: this.token, borrowerId: this.borrowerId });
            window.open(`${this.pdfPath}?t=${encodeURIComponent(pdfToken)}`, '_blank', 'noopener');
        } catch (e) {
            this.handleError(e);
        } finally {
            this.pdfBusy = false;
        }
    }
}
