import { LightningElement, api } from 'lwc';
import { errorMessage, isSessionError, todayIso } from 'c/crmUtils';
import addFine from '@salesforce/apex/LoanCrmController.addFine';

/** Add Late Fine modal. */
export default class CrmFineModal extends LightningElement {
    @api token;
    @api loan;

    amount = '';
    reason = '';
    fineDate = todayIso();
    error = '';
    busy = false;

    handleAmount(event) {
        this.amount = event.target.value;
    }
    handleReason(event) {
        this.reason = event.target.value;
    }
    handleDate(event) {
        this.fineDate = event.detail.value;
    }
    handleCancel() {
        this.dispatchEvent(new CustomEvent('close'));
    }

    async handleSave() {
        this.error = '';
        const amount = Number(this.amount);
        if (!amount || amount <= 0 || !this.reason.trim()) {
            this.error = 'Enter the fine amount and the reason.';
            return;
        }
        const dateInput = this.template.querySelector('c-crm-date-input');
        if (dateInput && !dateInput.reportValidity()) {
            return;
        }
        this.busy = true;
        try {
            await addFine({ token: this.token, fine: { loanId: this.loan.id, amount, reason: this.reason, fineDate: this.fineDate } });
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
