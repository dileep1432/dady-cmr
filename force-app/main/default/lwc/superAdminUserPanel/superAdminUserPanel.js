import { LightningElement, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import listStaff from '@salesforce/apex/AuthController.listStaff';
import saveStaff from '@salesforce/apex/AuthController.saveStaff';
import { errorMessage, isSessionError } from 'c/crmUtils';

const EMPTY = {
    id: null,
    fullName: '',
    loginId: '',
    password: '',
    role: 'Staff',
    isActive: true,
    canViewOnly: false,
    canAddCollection: false,
    canEditRecords: false,
    canAddFines: false,
    canDeleteLoans: false
};

/** Super Admin dashboard: create staff, set Login ID / password, activate and toggle permission checkboxes. */
export default class SuperAdminUserPanel extends LightningElement {
    @api token;
    @api session;

    rows = [];
    loading = false;
    error = '';
    form = null;
    formError = '';
    saving = false;

    roleOptions = [
        { label: 'Staff', value: 'Staff' },
        { label: 'Super Admin', value: 'Super Admin' }
    ];

    connectedCallback() {
        this.load();
    }

    get displayRows() {
        return this.rows.map((u) => {
            const perms = [];
            if (u.canViewOnly) {
                perms.push('View only');
            }
            if (u.canAddCollection) {
                perms.push('Collect');
            }
            if (u.canEditRecords) {
                perms.push('Edit');
            }
            if (u.canAddFines) {
                perms.push('Fines');
            }
            if (u.canDeleteLoans) {
                perms.push('Delete loans');
            }
            return {
                ...u,
                lastLoginText: u.lastLogin ? u.lastLogin : 'never',
                statusText: u.isActive ? 'Active' : 'Inactive',
                badgeClass: u.isActive ? 'crm-badge crm-badge-ok' : 'crm-badge crm-badge-warn',
                permissionText: u.role === 'Super Admin' ? 'All permissions' : perms.length ? perms.join(', ') : 'No extra permissions'
            };
        });
    }

    get formTitle() {
        return this.form && this.form.id ? 'Edit Staff User' : 'New Staff User';
    }

    get passwordLabel() {
        return this.form && this.form.id ? 'New Password (leave blank to keep)' : 'Password (min 8 characters)';
    }

    async load() {
        this.loading = true;
        this.error = '';
        try {
            this.rows = await listStaff({ token: this.token });
        } catch (e) {
            this.fail(e);
            this.error = errorMessage(e);
        } finally {
            this.loading = false;
        }
    }

    fail(e) {
        if (isSessionError(e)) {
            this.dispatchEvent(new CustomEvent('sessionexpired', { bubbles: true, composed: true }));
        }
    }

    handleNew() {
        this.form = { ...EMPTY };
        this.formError = '';
    }

    handleEdit(event) {
        const user = this.rows.find((u) => u.id === event.currentTarget.dataset.id);
        this.form = { ...EMPTY, ...user, password: '' };
        this.formError = '';
    }

    handleField(event) {
        this.form = { ...this.form, [event.target.dataset.field]: event.target.value };
    }

    handleCombo(event) {
        this.form = { ...this.form, [event.target.dataset.field]: event.detail.value };
    }

    handleCheck(event) {
        this.form = { ...this.form, [event.target.dataset.field]: event.target.checked };
    }

    handleCancel() {
        this.form = null;
    }

    async handleSave() {
        this.formError = '';
        this.saving = true;
        try {
            await saveStaff({ token: this.token, staff: this.form });
            this.form = null;
            this.dispatchEvent(new ShowToastEvent({ title: 'Saved', message: 'Staff user saved.', variant: 'success' }));
            this.load();
        } catch (e) {
            this.fail(e);
            this.formError = errorMessage(e);
        } finally {
            this.saving = false;
        }
    }
}
