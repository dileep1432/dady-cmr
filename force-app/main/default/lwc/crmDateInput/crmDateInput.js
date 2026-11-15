import { LightningElement, api } from 'lwc';
import { formatDate, parseDmy, todayIso } from 'c/crmUtils';

/** Text date input that always shows and accepts DD-MM-YYYY and exposes an ISO value. */
export default class CrmDateInput extends LightningElement {
    @api label = 'Date';
    @api required = false;
    @api disabled = false;
    @api showToday = false;

    text = '';
    error = '';
    isoValue = '';

    @api
    get value() {
        return this.isoValue;
    }
    set value(newValue) {
        this.isoValue = newValue || '';
        this.text = formatDate(this.isoValue);
        this.error = '';
    }

    @api
    reportValidity() {
        this.validate();
        return !this.error;
    }

    handleInput(event) {
        const digits = event.target.value.replace(/\D/g, '').slice(0, 8);
        let masked = digits;
        if (digits.length > 4) {
            masked = `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
        } else if (digits.length > 2) {
            masked = `${digits.slice(0, 2)}-${digits.slice(2)}`;
        }
        this.text = masked;
        event.target.value = masked;
        this.isoValue = masked.length === 10 ? parseDmy(masked) || '' : '';
        this.error = '';
        this.fireChange();
    }

    handleBlur() {
        this.validate();
    }

    handleToday() {
        this.isoValue = todayIso();
        this.text = formatDate(this.isoValue);
        this.error = '';
        this.fireChange();
    }

    validate() {
        if (!this.text) {
            this.error = this.required ? 'Enter a date (DD-MM-YYYY).' : '';
        } else if (!parseDmy(this.text)) {
            this.error = 'Use a valid date in DD-MM-YYYY format.';
        } else {
            this.error = '';
        }
    }

    fireChange() {
        this.dispatchEvent(new CustomEvent('change', { detail: { value: this.isoValue } }));
    }
}
