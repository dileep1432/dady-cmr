/**
 * One-time setup script. Run from Developer Console > Debug > Open Execute Anonymous Apex:
 *   System.debug(DatabaseInitializer.runDefault());
 * or choose your own credentials:
 *   System.debug(DatabaseInitializer.run('owner', 'A-long-password-1'));
 */
public without sharing class DatabaseInitializer {
    private static final Map<String, List<String>> REQUIRED_FIELDS = new Map<String, List<String>>{
        'CRM_Staff_User__c' => new List<String>{ 'Full_Name__c', 'Login_ID__c', 'Password_Hash__c', 'Role__c', 'Is_Active__c', 'Can_View_Only__c', 'Can_Add_Collection__c', 'Can_Edit_Records__c', 'Can_Add_Fines__c', 'Can_Delete_Loans__c', 'Failed_Attempts__c', 'Locked_Until__c', 'Last_Login__c' },
        'CRM_Config__c' => new List<String>{ 'Spreadsheet_Id__c', 'Service_Account_Email__c', 'Private_Key__c', 'Auto_Sync__c', 'Token_Secret__c', 'Last_Sync__c', 'Last_Sync_Status__c' },
        'Borrower__c' => new List<String>{ 'S_No__c', 'Full_Name__c', 'Mobile__c', 'Location__c', 'Notes__c' },
        'Loan_Account__c' => new List<String>{ 'Loan_Code__c', 'Borrower__c', 'Repayment_Type__c', 'Principal__c', 'Interest_Rate__c', 'Total_Payable__c', 'Total_Paid__c', 'Outstanding_Due__c', 'Disbursement_Date__c', 'Status__c' },
        'Collection__c' => new List<String>{ 'Loan_Account__c', 'Borrower__c', 'Amount__c', 'Payment_Date__c', 'Payment_Method__c', 'Reference_No__c', 'Collected_By__c' },
        'Late_Fine__c' => new List<String>{ 'Loan_Account__c', 'Borrower__c', 'Fine_Amount__c', 'Reason__c', 'Fine_Date__c' }
    };

    /**
     * Seeds a Super Admin with login "admin" and a random one-time password (shown in the returned text).
     * @return setup report
     */
    public static String runDefault() {
        return run('admin', null);
    }

    /**
     * Verifies the data model, creates the config record and seeds a Super Admin if the login does not exist.
     * @param loginId Super Admin login id
     * @param password password (min 8 chars); when blank a random one is generated and returned
     * @return setup report
     */
    public static String run(String loginId, String password) {
        List<String> report = new List<String>();
        List<String> missing = verifyModel();
        if (!missing.isEmpty()) {
            report.add('STOP - deploy the metadata first. Missing: ' + String.join(missing, ', '));
            return String.join(report, '\n');
        }
        report.add('Data model verified: all objects and fields exist.');
        CRM_Config__c config = CrmConfig.getOrCreate();
        report.add('Config record ready (' + config.Id + '). Session tokens are signed with its secret.');

        String login = String.isBlank(loginId) ? 'admin' : loginId.trim();
        List<CRM_Staff_User__c> existing = [SELECT Id FROM CRM_Staff_User__c WHERE Login_ID__c = :login LIMIT 1];
        if (!existing.isEmpty()) {
            report.add('Super Admin "' + login + '" already exists; nothing changed.');
            return String.join(report, '\n');
        }
        Boolean generated = String.isBlank(password);
        String plain = generated ? EncodingUtil.convertToHex(Crypto.generateAesKey(128)).left(12) + 'Aa1' : password;
        if (plain.length() < 8) {
            report.add('STOP - password must be at least 8 characters.');
            return String.join(report, '\n');
        }
        insert new CRM_Staff_User__c(
            Name = 'Super Admin', Full_Name__c = 'Super Admin', Login_ID__c = login,
            Password_Hash__c = AuthController.hashPassword(plain), Role__c = 'Super Admin', Is_Active__c = true,
            Can_Add_Collection__c = true, Can_Edit_Records__c = true, Can_Add_Fines__c = true, Can_Delete_Loans__c = true
        );
        report.add('Super Admin created. Login ID: ' + login + (generated ? '  Temporary password: ' + plain + '  (change it after first login)' : ''));
        return String.join(report, '\n');
    }

    /**
     * @return names of missing objects/fields (empty when the model is complete)
     */
    public static List<String> verifyModel() {
        List<String> missing = new List<String>();
        Map<String, Schema.SObjectType> globalDescribe = Schema.getGlobalDescribe();
        for (String objectName : REQUIRED_FIELDS.keySet()) {
            Schema.SObjectType sobjectType = globalDescribe.get(objectName);
            if (sobjectType == null) {
                missing.add(objectName);
                continue;
            }
            Map<String, Schema.SObjectField> fields = sobjectType.getDescribe().fields.getMap();
            for (String fieldName : REQUIRED_FIELDS.get(objectName)) {
                if (!fields.containsKey(fieldName)) {
                    missing.add(objectName + '.' + fieldName);
                }
            }
        }
        return missing;
    }
}
