import { LightningElement, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getLoans from '@salesforce/apex/LoanCrmController.getLoans';
import getCollections from '@salesforce/apex/LoanCrmController.getCollections';
import { formatDate, formatMoney, telHref, todayIso, errorMessage, isSessionError } from 'c/crmUtils';

/** Shared Daily/Weekly tracker: paid vs not-paid tabs, collect/fine actions and collections audit. */
export default class CrmLoanTracker extends LightningElement {
    @api token;
    @api session;
    @api repaymentType = 'DAILY';

    view = 'NOT_PAID';
    result = null;
    loading = false;
    error = '';
    search = '';
    payLoan = null;
    fineLoan = null;
    auditFrom = todayIso();
    auditTo = todayIso();
    audit = null;

    connectedCallback() {
        this.load();
    }

    get isWeekly() {
        return this.repaymentType === 'WEEKLY';
    }

    get isAudit() {
        return this.view === 'AUDIT';
    }

    get tabs() {
        const scope = this.isWeekly ? 'This Week' : 'Today';
        const defs = [
            { value: 'NOT_PAID', label: `${scope} Not Paid` },
            { value: 'PAID', label: `${scope} Paid` },
            { value: 'ALL_ACTIVE', label: 'All Active' },
            { value: 'CLEARED', label: 'Cleared' },
            { value: 'AUDIT', label: 'Collections Audit' }
        ];
        return defs.map((d) => ({ ...d, pressed: d.value === this.view ? 'true' : 'false' }));
    }

    get periodLabel() {
        return this.isWeekly ? 'Paid this week' : 'Paid today';
    }

    get periodPaidWord() {
        return this.isWeekly ? 'Paid this week:' : 'Paid today:';
    }

    get periodRangeText() {
        if (!this.result || !this.result.periodStart) {
            return '';
        }
        if (this.isWeekly) {
            return `Current week: Sunday ${formatDate(this.result.periodStart)} to Saturday ${formatDate(this.result.periodEnd)}`;
        }
        return `Today: ${formatDate(this.result.periodStart)}`;
    }

    get truncated() {
        return !!(this.result && this.result.truncated);
    }

    get outstandingText() {
        return formatMoney(this.result ? this.result.totalOutstanding : 0);
    }

    get periodPaidText() {
        return formatMoney(this.result ? this.result.totalPeriodPaid : 0);
    }

    get displayRows() {
        if (!this.result) {
            return [];
        }
        const needle = this.search.trim().toLowerCase();
        const canCollect = !!(this.session && this.session.canAddCollection);
        const canFine = !!(this.session && this.session.canAddFines);
        return this.result.rows
            .filter((r) => {
                if (!needle) {
                    return true;
                }
                return [r.borrowerName, r.sNo, r.loanCode, r.mobile].some((v) => (v || '').toLowerCase().includes(needle));
            })
            .map((r) => {
                const completed = r.status === 'COMPLETED';
                return {
                    ...r,
                    telHref: telHref(r.mobile),
                    principalText: formatMoney(r.principal),
                    payableText: formatMoney(r.totalPayable),
                    paidText: formatMoney(r.totalPaid),
                    outstandingText: formatMoney(r.outstanding),
                    periodPaidText: formatMoney(r.periodPaid),
                    installmentText: formatMoney(r.installment),
                    showPeriodPaid: r.periodPaid > 0,
                    badgeClass: completed ? 'crm-badge crm-badge-ok' : 'crm-badge crm-badge-warn',
                    canCollect: canCollect && !completed,
                    canFine: canFine
                };
            });
    }

    get rowCount() {
        return this.displayRows.length;
    }

    get noRows() {
        return !this.loading && this.displayRows.length === 0;
    }

    get auditRows() {
        return this.audit
            ? this.audit.rows.map((p) => ({ ...p, amountText: formatMoney(p.amount), dateText: formatDate(p.paymentDate) }))
            : [];
    }

    get auditCount() {
        return this.audit ? this.audit.rows.length : 0;
    }

    get auditTotalText() {
        return formatMoney(this.audit ? this.audit.total : 0);
    }

    get auditTruncated() {
        return !!(this.audit && this.audit.truncated);
    }

    get noAudit() {
        return !this.loading && this.auditCount === 0;
    }

    handleTab(event) {
        this.view = event.currentTarget.dataset.view;
        this.error = '';
        this.load();
    }

    handleSearch(event) {
        this.search = event.target.value;
    }

    handleFrom(event) {
        this.auditFrom = event.detail.value;
    }

    handleTo(event) {
        this.auditTo = event.detail.value;
    }

    handleAuditToday() {
        this.auditFrom = todayIso();
        this.auditTo = todayIso();
        this.loadAudit();
    }

    load() {
        if (this.isAudit) {
            this.loadAudit();
            return Promise.resolve();
        }
        return this.run(async () => {
            this.result = await getLoans({ token: this.token, repaymentType: this.repaymentType, view: this.view });
        });
    }

    loadAudit() {
        if (!this.auditFrom || !this.auditTo) {
            this.error = 'Choose both dates (DD-MM-YYYY).';
            return Promise.resolve();
        }
        return this.run(async () => {
            this.audit = await getCollections({
                token: this.token,
                repaymentType: this.repaymentType,
                fromDate: this.auditFrom,
                toDate: this.auditTo
            });
        });
    }

    async run(work) {
        this.loading = true;
        this.error = '';
        try {
            await work();
        } catch (e) {
            if (isSessionError(e)) {
                this.dispatchEvent(new CustomEvent('sessionexpired', { bubbles: true, composed: true }));
            }
            this.error = errorMessage(e);
        } finally {
            this.loading = false;
        }
    }

    findRow(id) {
        return this.result ? this.result.rows.find((r) => r.id === id) : null;
    }

    handleCollect(event) {
        this.payLoan = this.findRow(event.currentTarget.dataset.id);
    }

    handleFine(event) {
        this.fineLoan = this.findRow(event.currentTarget.dataset.id);
    }

    closeModals() {
        this.payLoan = null;
        this.fineLoan = null;
    }

    handleSaved() {
        const wasPayment = !!this.payLoan;
        this.closeModals();
        this.dispatchEvent(new ShowToastEvent({ title: 'Saved', message: wasPayment ? 'Payment recorded.' : 'Late fine added.', variant: 'success' }));
        this.load();
    }

    handleOpenProfile(event) {
        event.preventDefault();
        this.dispatchEvent(new CustomEvent('openprofile', { bubbles: true, composed: true, detail: { borrowerId: event.currentTarget.dataset.borrower } }));
    }
}
