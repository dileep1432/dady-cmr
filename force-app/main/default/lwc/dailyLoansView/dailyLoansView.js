import { LightningElement, api } from 'lwc';

/** Daily Loans tab (wraps the shared tracker). */
export default class DailyLoansView extends LightningElement {
    @api token;
    @api session;
}
