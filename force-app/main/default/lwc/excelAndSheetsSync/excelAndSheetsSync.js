import { LightningElement, api } from 'lwc';
import { loadScript } from 'lightning/platformResourceLoader';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import SHEETJS from '@salesforce/resourceUrl/sheetjs';
import previewImport from '@salesforce/apex/CrmImportController.previewImport';
import commitImport from '@salesforce/apex/CrmImportController.commitImport';
import getConfig from '@salesforce/apex/SheetsController.getConfig';
import saveConfig from '@salesforce/apex/SheetsController.saveConfig';
import testConnection from '@salesforce/apex/SheetsController.testConnection';
import syncAllToSheet from '@salesforce/apex/SheetsController.syncAllToSheet';
import importFromSheet from '@salesforce/apex/SheetsController.importFromSheet';
import { errorMessage, isSessionError } from 'c/crmUtils';

const CHUNK = 300;
const MAX_ROWS = 20000;

/** Excel/CSV bulk uploader (SheetJS) and Google Sheets settings / manual sync. */
export default class ExcelAndSheetsSync extends LightningElement {
    @api token;
    @api session;

    entity = 'BORROWERS';
    fileName = '';
    workbook = null;
    sheetName = '';
    rows = [];
    validated = false;
    busy = false;
    dragging = false;
    uploadError = '';
    progress = '';
    summary = '';
    problems = [];
    sheetjsReady = false;

    sheetId = '';
    serviceEmail = '';
    privateKey = '';
    hasPrivateKey = false;
    autoSync = false;
    lastSync = '';
    lastStatus = '';
    sheetsBusy = false;
    sheetsError = '';
    sheetsInfo = '';

    connectedCallback() {
        if (this.isSuperAdmin) {
            this.loadSettings();
        }
    }

    get isSuperAdmin() {
        return !!(this.session && this.session.isSuperAdmin);
    }

    get entityOptions() {
        const s = this.session || {};
        const options = [];
        if (s.canEditRecords) {
            options.push({ label: 'Customers (Borrowers)', value: 'BORROWERS' }, { label: 'Loans', value: 'LOANS' });
        }
        if (s.canAddCollection) {
            options.push({ label: 'Collections (Payments)', value: 'COLLECTIONS' });
        }
        if (s.canAddFines) {
            options.push({ label: 'Late Fines', value: 'FINES' });
        }
        return options;
    }

    get dropClass() {
        return this.dragging ? 'crm-dropzone crm-dropzone-over' : 'crm-dropzone';
    }

    get sheetOptions() {
        return this.workbook ? this.workbook.SheetNames.map((n) => ({ label: n, value: n })) : [];
    }

    get showSheetPicker() {
        return this.workbook && this.workbook.SheetNames.length > 1;
    }

    get rowCountText() {
        return `${this.rows.length} rows found`;
    }

    get validateDisabled() {
        return this.busy || this.rows.length === 0;
    }

    get importDisabled() {
        return this.busy || !this.validated || this.rows.length === 0;
    }

    get hasProblems() {
        return this.problems.length > 0;
    }

    get problemRows() {
        return this.problems.slice(0, 200).map((p) => ({ ...p, key: `${p.rowNumber}-${p.status}` }));
    }

    get keyLabel() {
        return this.hasPrivateKey ? 'Private key (saved; paste a new one to replace)' : 'Service account private key';
    }

    get lastSyncText() {
        if (!this.lastSync && !this.lastStatus) {
            return '';
        }
        return `Last sync: ${this.lastSync} ${this.lastStatus}`;
    }

    // ------------------------------------------------------------ file handling

    handleEntity(event) {
        this.entity = event.detail.value;
        this.resetResult();
    }

    handleDragOver(event) {
        event.preventDefault();
        this.dragging = true;
    }

    handleDragLeave() {
        this.dragging = false;
    }

    handleDrop(event) {
        event.preventDefault();
        this.dragging = false;
        const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
        if (file) {
            this.readFile(file);
        }
    }

    handleFile(event) {
        const file = event.target.files && event.target.files[0];
        if (file) {
            this.readFile(file);
        }
    }

    async ensureSheetJs() {
        if (!this.sheetjsReady) {
            await loadScript(this, SHEETJS);
            this.sheetjsReady = true;
        }
    }

    async readFile(file) {
        this.resetResult();
        this.uploadError = '';
        if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
            this.uploadError = 'Choose an .xlsx, .xls or .csv file.';
            return;
        }
        try {
            await this.ensureSheetJs();
            const buffer = await file.arrayBuffer();
            this.workbook = window.XLSX.read(buffer, { type: 'array', cellDates: true });
            this.fileName = file.name;
            this.sheetName = this.workbook.SheetNames[0];
            this.parseSheet();
        } catch (e) {
            this.uploadError = `Could not read the file: ${errorMessage(e)}`;
        }
    }

    handleSheet(event) {
        this.sheetName = event.detail.value;
        this.resetResult();
        this.parseSheet();
    }

    parseSheet() {
        const sheet = this.workbook.Sheets[this.sheetName];
        const parsed = window.XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false, dateNF: 'dd-mm-yyyy' });
        if (parsed.length > MAX_ROWS) {
            this.uploadError = `Too many rows (${parsed.length}). Split the file into batches of ${MAX_ROWS} rows or fewer.`;
            this.rows = [];
            return;
        }
        this.rows = parsed;
    }

    resetResult() {
        this.validated = false;
        this.summary = '';
        this.progress = '';
        this.problems = [];
    }

    // ---------------------------------------------------------- validate / import

    handleValidate() {
        return this.runImport(true);
    }

    handleImport() {
        return this.runImport(false);
    }

    async runImport(dryRun) {
        this.busy = true;
        this.resetResult();
        this.uploadError = '';
        const totals = { ok: 0, error: 0, skip: 0, inserted: 0, updated: 0 };
        const problems = [];
        try {
            for (let start = 0; start < this.rows.length; start += CHUNK) {
                const chunk = this.rows.slice(start, start + CHUNK);
                this.progress = `${dryRun ? 'Validating' : 'Importing'} rows ${start + 1} to ${start + chunk.length} of ${this.rows.length}...`;
                const args = { token: this.token, entity: this.entity, rowsJson: JSON.stringify(chunk), firstRowNumber: start + 2 };
                const result = dryRun ? await previewImport(args) : await commitImport(args);
                totals.ok += result.okCount;
                totals.error += result.errorCount;
                totals.skip += result.skipCount;
                totals.inserted += result.insertedCount;
                totals.updated += result.updatedCount;
                result.rows.filter((r) => r.status !== 'OK').forEach((r) => problems.push(r));
            }
            this.problems = problems;
            this.progress = '';
            if (dryRun) {
                this.validated = true;
                this.summary = `Validation: ${totals.ok} ready, ${totals.skip} duplicates (will be skipped), ${totals.error} with errors (will not be imported).`;
            } else {
                this.validated = false;
                this.summary = `Import finished: ${totals.inserted} created, ${totals.updated} updated, ${totals.skip} duplicates skipped, ${totals.error} failed.`;
                this.dispatchEvent(new ShowToastEvent({ title: 'Import finished', message: this.summary, variant: totals.error ? 'warning' : 'success' }));
            }
        } catch (e) {
            this.handleError(e);
            this.uploadError = errorMessage(e);
            this.progress = '';
        } finally {
            this.busy = false;
        }
    }

    handleError(e) {
        if (isSessionError(e)) {
            this.dispatchEvent(new CustomEvent('sessionexpired', { bubbles: true, composed: true }));
        }
    }

    // ------------------------------------------------------------ Google Sheets

    async loadSettings() {
        try {
            const config = await getConfig({ token: this.token });
            this.sheetId = config.spreadsheetId || '';
            this.serviceEmail = config.serviceAccountEmail || '';
            this.hasPrivateKey = config.hasPrivateKey;
            this.autoSync = config.autoSync;
            this.lastSync = config.lastSync || '';
            this.lastStatus = config.lastSyncStatus || '';
        } catch (e) {
            this.handleError(e);
            this.sheetsError = errorMessage(e);
        }
    }

    handleSheetId(event) {
        this.sheetId = event.target.value;
    }
    handleServiceEmail(event) {
        this.serviceEmail = event.target.value;
    }
    handlePrivateKey(event) {
        this.privateKey = event.target.value;
    }
    handleAutoSync(event) {
        this.autoSync = event.target.checked;
    }

    async sheetsAction(work, doneMessage) {
        this.sheetsBusy = true;
        this.sheetsError = '';
        this.sheetsInfo = '';
        try {
            const message = await work();
            this.sheetsInfo = message || doneMessage;
            await this.loadSettings();
        } catch (e) {
            this.handleError(e);
            this.sheetsError = errorMessage(e);
        } finally {
            this.sheetsBusy = false;
        }
    }

    handleSaveSettings() {
        return this.sheetsAction(async () => {
            await saveConfig({
                token: this.token,
                spreadsheetIdOrUrl: this.sheetId,
                serviceAccountEmail: this.serviceEmail,
                privateKey: this.privateKey,
                autoSync: this.autoSync
            });
            this.privateKey = '';
            return 'Settings saved.';
        });
    }

    handleTest() {
        return this.sheetsAction(() => testConnection({ token: this.token }));
    }

    handleSyncAll() {
        return this.sheetsAction(async () => `Synced: ${await syncAllToSheet({ token: this.token })}`);
    }

    handleImportSheet() {
        return this.sheetsAction(async () => `Imported: ${await importFromSheet({ token: this.token })}`);
    }
}
