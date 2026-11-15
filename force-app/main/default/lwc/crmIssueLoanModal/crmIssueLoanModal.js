import { LightningElement, api } from 'lwc';
import { errorMessage, isSessionError, todayIso } from 'c/crmUtils';
import issueLoan from '@salesforce/apex/LoanCrmController.issueLoan';
import updateLoan from '@salesforce/apex/LoanCrmController.updateLoan';
import { formatMoney } from 'c/crmUtils';

const RATES = { DAILY: 20, WEEKLY: 26 };

/** Issue a new loan, or (when "loan" is passed) edit principal / disbursement date. */
export default class CrmIssueLoanModal extends LightningElement {
    @api token;
    @api borrowerId;
    @api borrowerName;
    @api loan;

    repaymentType = 'DAILY';
    principal = '';
    disbursementDate = todayIso();
    error = '';
    busy = false;

    typeOptions = [
        { label: 'DAILY (20% interest)', value: 'DAILY' },
        { label: 'WEEKLY (26% interest)', value: 'WEEKLY' }
    ];

    connectedCallback() {
        if (this.loan) {
            this.repaymentType = this.loan.repaymentType;
            this.principal = String(this.loan.principal);
            this.disbursementDate = this.loan.disbursementDate || todayIso();
        }
    }

    get isEdit() {
        return !!this.loan;
    }

    get previewText() {
        const principal = Number(this.principal) || 0;
        const rate = RATES[this.repaymentType] || 0;
        const total = principal * (1 + rate / 100);
        return `Interest ${rate}%. Total payable before fines: ${formatMoney(total)}.`;
    }

    handleType(event) {
        this.repaymentType = event.detail.value;
    }
    handlePrincipal(event) {
        this.principal = event.target.value;
    }
    handleDate(event) {
        this.disbursementDate = event.detail.value;
    }
    handleCancel() {
        this.dispatchEvent(new CustomEvent('close'));
    }

    async handleSave() {
        this.error = '';
        const principal = Number(this.principal);
        if (!principal || principal <= 0) {
            this.error = 'Enter a principal greater than zero.';
            return;
        }
        const dateInput = this.template.querySelector('c-crm-date-input');
        if (dateInput && !dateInput.reportValidity()) {
            return;
        }
        this.busy = true;
        try {
            if (this.isEdit) {
                await updateLoan({ token: this.token, loan: { id: this.loan.id, principal, disbursementDate: this.disbursementDate } });
            } else {
                await issueLoan({
                    token: this.token,
                    loan: { borrowerId: this.borrowerId, repaymentType: this.repaymentType, principal, disbursementDate: this.disbursementDate }
                });
            }
            this.dispatchEvent(new CustomEvent('saved'));
        } catch (e) {
            if (isSessionError(e)) {
                this.dispatchEvent(new CustomEvent('sessionexpired', { bubbles: true, composed: true }));
            }
            this.error = errorMessage(e);
        } finally {
            this.busy = false;
        }
    }
}
