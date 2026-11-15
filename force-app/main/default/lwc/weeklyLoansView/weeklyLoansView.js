import { LightningElement, api } from 'lwc';

/** Weekly Loans tab (wraps the shared tracker). */
export default class WeeklyLoansView extends LightningElement {
    @api token;
    @api session;
}
