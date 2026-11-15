/**
 * Settings and manual sync actions for Google Sheets. Super Admin only.
 */
public without sharing class SheetsController {
    private static final Pattern SHEET_ID = Pattern.compile('^[A-Za-z0-9_-]{20,120}$');
    private static final Pattern SHEET_URL = Pattern.compile('/spreadsheets/d/([A-Za-z0-9_-]+)');

    public class SheetsConfigDTO {
        @AuraEnabled public String spreadsheetId;
        @AuraEnabled public String serviceAccountEmail;
        @AuraEnabled public Boolean hasPrivateKey;
        @AuraEnabled public Boolean autoSync;
        @AuraEnabled public String lastSync;
        @AuraEnabled public String lastSyncStatus;
    }

    /**
     * @param token session token
     * @return current settings (the private key is never returned)
     */
    @AuraEnabled
    public static SheetsConfigDTO getConfig(String token) {
        AuthController.require(token, AuthController.PERM_SUPER_ADMIN);
        CRM_Config__c config = CrmConfig.get();
        SheetsConfigDTO dto = new SheetsConfigDTO();
        dto.hasPrivateKey = config != null && String.isNotBlank(config.Private_Key__c);
        dto.autoSync = config != null && config.Auto_Sync__c == true;
        dto.spreadsheetId = config == null ? '' : config.Spreadsheet_Id__c;
        dto.serviceAccountEmail = config == null ? '' : config.Service_Account_Email__c;
        dto.lastSync = config == null || config.Last_Sync__c == null ? '' : CrmUtil.formatDate(config.Last_Sync__c.date()) + ' ' + config.Last_Sync__c.format('HH:mm');
        dto.lastSyncStatus = config == null ? '' : config.Last_Sync_Status__c;
        return dto;
    }

    /**
     * Saves Google Sheets settings. A blank private key keeps the stored one.
     * @param token session token
     * @param spreadsheetIdOrUrl spreadsheet id or full URL
     * @param serviceAccountEmail service account client_email
     * @param privateKey service account private_key (PEM or bare base64)
     * @param autoSync push changes automatically
     */
    @AuraEnabled
    public static void saveConfig(String token, String spreadsheetIdOrUrl, String serviceAccountEmail, String privateKey, Boolean autoSync) {
        AuthController.require(token, AuthController.PERM_SUPER_ADMIN);
        String sheetId = extractId(spreadsheetIdOrUrl);
        CRM_Config__c config = CrmConfig.getOrCreate();
        config.Spreadsheet_Id__c = sheetId;
        config.Service_Account_Email__c = String.isBlank(serviceAccountEmail) ? null : serviceAccountEmail.trim();
        if (String.isNotBlank(privateKey)) {
            config.Private_Key__c = privateKey.trim();
        }
        config.Auto_Sync__c = autoSync == true;
        update config;
        CrmConfig.reset();
    }

    /**
     * @param token session token
     * @return connection test result
     */
    @AuraEnabled
    public static String testConnection(String token) {
        AuthController.require(token, AuthController.PERM_SUPER_ADMIN);
        return guarded('test', null);
    }

    /**
     * Pushes all Salesforce data to the sheet.
     * @param token session token
     * @return summary text
     */
    @AuraEnabled
    public static String syncAllToSheet(String token) {
        AuthController.require(token, AuthController.PERM_SUPER_ADMIN);
        return guarded('push', 'Manual sync OK. ');
    }

    /**
     * Imports sheet rows into Salesforce.
     * @param token session token
     * @return summary text
     */
    @AuraEnabled
    public static String importFromSheet(String token) {
        AuthController.require(token, AuthController.PERM_SUPER_ADMIN);
        return guarded('pull', 'Import OK. ');
    }

    private static String guarded(String action, String statusPrefix) {
        String message;
        try {
            if (action == 'test') {
                return GoogleSheetsSyncService.testConnection();
            } else if (action == 'push') {
                message = GoogleSheetsSyncService.syncAll();
            } else {
                message = GoogleSheetsSyncService.importFromSheet();
            }
        } catch (CrmException e) {
            CrmUtil.fail(e.getMessage());
        } catch (CalloutException e) {
            CrmUtil.fail('Could not reach Google: ' + e.getMessage());
        } catch (Exception e) {
            CrmUtil.fail('Sync failed: ' + e.getMessage());
        }
        CrmConfig.recordSyncStatus(statusPrefix + message);
        return message;
    }

    private static String extractId(String raw) {
        if (String.isBlank(raw)) {
            CrmUtil.fail('Enter the Google Spreadsheet ID or URL.');
        }
        String text = raw.trim();
        Matcher fromUrl = SHEET_URL.matcher(text);
        if (fromUrl.find()) {
            text = fromUrl.group(1);
        }
        if (!SHEET_ID.matcher(text).matches()) {
            CrmUtil.fail('That does not look like a Google Spreadsheet ID.');
        }
        return text;
    }
}
