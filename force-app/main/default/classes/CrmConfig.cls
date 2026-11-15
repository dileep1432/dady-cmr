/**
 * Access to the single CRM_Config__c settings record.
 */
public without sharing class CrmConfig {
    private static CRM_Config__c cached;

    /**
     * @return the config record or null when none exists yet
     */
    public static CRM_Config__c get() {
        if (cached == null) {
            List<CRM_Config__c> rows = [
                SELECT Id, Spreadsheet_Id__c, Service_Account_Email__c, Private_Key__c, Auto_Sync__c,
                       Token_Secret__c, Last_Sync__c, Last_Sync_Status__c
                FROM CRM_Config__c
                ORDER BY CreatedDate
                LIMIT 1
            ];
            if (!rows.isEmpty()) {
                cached = rows[0];
            }
        }
        return cached;
    }

    /**
     * Returns the config record, creating it (with a fresh token secret) when missing. Performs DML.
     * @return config record
     */
    public static CRM_Config__c getOrCreate() {
        CRM_Config__c config = get();
        if (config == null) {
            config = new CRM_Config__c(Name = 'CRM Config', Token_Secret__c = newSecret());
            insert config;
            cached = null;
            config = get();
        } else if (String.isBlank(config.Token_Secret__c)) {
            config.Token_Secret__c = newSecret();
            update config;
            cached = null;
            config = get();
        }
        return config;
    }

    /**
     * Updates sync status text on the config record.
     * @param status status message
     */
    public static void recordSyncStatus(String status) {
        CRM_Config__c config = get();
        if (config == null) {
            return;
        }
        config.Last_Sync__c = System.now();
        config.Last_Sync_Status__c = status == null ? null : status.left(250);
        update config;
        cached = null;
    }

    /** Clears the transaction cache. */
    public static void reset() {
        cached = null;
    }

    private static String newSecret() {
        return EncodingUtil.convertToHex(Crypto.generateAesKey(256));
    }
}
