import { LightningElement } from 'lwc';
import login from '@salesforce/apex/AuthController.login';
import { errorMessage } from 'c/crmUtils';

/** Entry point: custom Login ID / password screen. Fires "loggedin" with the session info. */
export default class CrmLoginPortal extends LightningElement {
    loginId = '';
    password = '';
    error = '';
    busy = false;

    handleLoginId(event) {
        this.loginId = event.target.value;
    }

    handlePassword(event) {
        this.password = event.target.value;
    }

    handleKey(event) {
        if (event.key === 'Enter') {
            this.handleLogin();
        }
    }

    async handleLogin() {
        if (this.busy) {
            return;
        }
        this.error = '';
        this.busy = true;
        try {
            const session = await login({ loginId: this.loginId, password: this.password });
            this.password = '';
            this.dispatchEvent(new CustomEvent('loggedin', { detail: session }));
        } catch (e) {
            this.error = errorMessage(e);
        } finally {
            this.busy = false;
        }
    }
}
