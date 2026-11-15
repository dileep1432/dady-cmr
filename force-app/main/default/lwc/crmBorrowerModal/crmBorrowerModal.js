import { LightningElement, api } from 'lwc';
import { errorMessage, isSessionError, todayIso } from 'c/crmUtils';
import saveBorrower from '@salesforce/apex/LoanCrmController.saveBorrower';

/** Add / edit customer modal. Pass "borrower" to edit. Duplicate mobile numbers are allowed. */
export default class CrmBorrowerModal extends LightningElement {
    @api token;
    @api borrower;

    sNo = '';
    name = '';
    mobile = '';
    location = '';
    notes = '';
    error = '';
    busy = false;

    connectedCallback() {
        if (this.borrower) {
            this.sNo = this.borrower.sNo || '';
            this.name = this.borrower.name || '';
            this.mobile = this.borrower.mobile || '';
            this.location = this.borrower.location || '';
            this.notes = this.borrower.notes || '';
        }
    }

    handleSNo(event) {
        this.sNo = event.target.value;
    }
    handleName(event) {
        this.name = event.target.value;
    }
    handleMobile(event) {
        this.mobile = event.target.value;
    }
    handleLocation(event) {
        this.location = event.target.value;
    }
    handleNotes(event) {
        this.notes = event.target.value;
    }
    handleCancel() {
        this.dispatchEvent(new CustomEvent('close'));
    }

    async handleSave() {
        this.error = '';
        if (!this.sNo.trim() || !this.name.trim() || !this.mobile.trim()) {
            this.error = 'S.No, name and mobile are required.';
            return;
        }
        this.busy = true;
        try {
            const id = await saveBorrower({
                token: this.token,
                borrower: {
                    id: this.borrower ? this.borrower.id : null,
                    sNo: this.sNo,
                    name: this.name,
                    mobile: this.mobile,
                    location: this.location,
                    notes: this.notes
                }
            });
            this.dispatchEvent(new CustomEvent('saved', { detail: { id } }));
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
