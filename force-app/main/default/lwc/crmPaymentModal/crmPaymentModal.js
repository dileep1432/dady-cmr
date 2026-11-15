import { LightningElement, api } from 'lwc';
import { errorMessage, isSessionError, todayIso } from 'c/crmUtils';
import recordPayment from '@salesforce/apex/LoanCrmController.recordPayment';
import { formatMoney } from 'c/crmUtils';

/** Record Payment modal. The amount is pre-filled with the proportional installment (1% daily, 6% weekly of principal). */
export default class CrmPaymentModal extends LightningElement {
    @api token;
    @api loan;

    amount = '';
    paymentDate = todayIso();
    method = 'Cash';
    referenceNo = '';
    error = '';
    busy = false;

    methodOptions = [
        { label: 'Cash', value: 'Cash' },
        { label: 'UPI', value: 'UPI' },
        { label: 'Bank Transfer', value: 'Bank Transfer' },
        { label: 'Other', value: 'Other' }
    ];

    connectedCallback() {
        this.amount = this.loan && this.loan.installment ? String(this.loan.installment) : '';
    }

    get outstandingText() {
        return formatMoney(this.loan ? this.loan.outstanding : 0);
    }

    get hintText() {
        const percent = this.loan && this.loan.repaymentType === 'WEEKLY' ? '6%' : '1%';
        return `Suggested installment: ${percent} of principal (never more than the outstanding balance).`;
    }

    handleAmount(event) {
        this.amount = event.target.value;
    }
    handleDate(event) {
        this.paymentDate = event.detail.value;
    }
    handleMethod(event) {
        this.method = event.detail.value;
    }
    handleReference(event) {
        this.referenceNo = event.target.value;
    }
    handleCancel() {
        this.dispatchEvent(new CustomEvent('close'));
    }

    async handleSave() {
        this.error = '';
        const dateInput = this.template.querySelector('c-crm-date-input');
        const amount = Number(this.amount);
        if (!amount || amount <= 0) {
            this.error = 'Enter an amount greater than zero.';
            return;
        }
        if (dateInput && !dateInput.reportValidity()) {
            return;
        }
        this.busy = true;
        try {
            await recordPayment({
                token: this.token,
                payment: { loanId: this.loan.id, amount, paymentDate: this.paymentDate, method: this.method, referenceNo: this.referenceNo }
            });
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
