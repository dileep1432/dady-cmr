/**
 * Unit tests for the Microfinance CRM. The RSA key below is a throw-away key generated only for tests.
 */
@IsTest
private class CrmTests {
    private static final String TEST_KEY = 'MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDhaEugr0rla/4JqP8kjALpHxzHBwbNvU+U3QVAGUczsboRN60uqvxD5uPmq3d2ZI+jctCHK7m87Z7NZopJiWQJAgTkZYlqw2t59oneJWQBVMAZlJ8t6380Hj63ETL6DNGSah6sZ0t2Sm4H0CkBvV4E6w9GN8PC9s+NYdgq+cA2p3nFq01jeLaNp/2tdQqN8kgbtFBKMgm16k74Gd1P0ENDBAMawG0iKPaNMPvzQ7OvyW0TXHcLN8SDDQKkB1dMFb1MLPHhfQ6fjMFtOpJUezXbNXcYBeSmbkAOgpOOfG5mDsMOIPnAbEUECQJ/e66MlQQmQ3KZofqJkKr0+Rd6gw4dAgMBAAECggEAMkZ6c9UVTfWX3Fy6x9KIxalgWE4LaPE8IlZn2OOqe2+9MiDqejm9+YEyvNzq0NfeJ9UwiK2qiGaxoFuqJXvE+bNfFvhEvbDntHTWTFunohpenHYHSQ05Oo0ybM+jwJ0CU3di7w49CR3Ry+FUfCRaJ5usNPu0KLS3F3BG8FLzWdz2lMYoE1FaXULDc0rZJKFjOx6O9ZJXV+v2913Z1h8b6yItUjEh3g909CYnIGTQ7KbiQxU9vcruanXdtnnKs5Gd/Byp0lCW1S2SqLetxmjRjOVa+Yt6604vKxbdVgNA/Cuur15KKzyqFGpGSCnyBBIzKo2i+wrK74a079ly/O1lAQKBgQD/DipeQCPFtjiy2Rolt5BHPitDN/GfQaDgizNz2nRk26Lz3Uekx59wfLhmCCPwtOiIjhlD7lttwqiCxxTdDmBxpp+C6Nk1tZTbFrbB/3m8GQPad72ZsdUf6qyeZXf2gvAii2KuMf6BVcRCpscr4755i6QX6OtsdD5J29AXdugPnQKBgQDiPgTPw3KvEYqeN8gFJlbMHYYSirqSgKDXivt1ljtxONGHy38RoDDEKhvLqnLZAyFuNdk9ITWwFqqsCwQFzn5SCPbAJ4HOxyCct0UL4mN9P6tOEDpYGBq92c6Bz7LCoFayvbp6AoJxJevx6wCjKfEmDlPGdHiy1ojGrtSWybDwgQKBgQCe/p+evXEPUParVvcbyABiyPiDIJ643lqBX4UllWq1bM16I9kDeYWEw9rXj/+Hj97dMWfClxXbqFsPmzcATnQEpRAOtUSiXJ18rf4jlTS38wgZ6kcBRoBLMymEXFCaFSnI/wb2/CdhTKvZuMm0LHaSomAan5ISu6wQsrxXxEIJaQKBgQDFAnaUKUE7vA22eyKdgWZB9k+i49VV79af+3G/UmRO0sh69LShN5pfp79ume3KldRNsWyLs9iZjxNuH2WQXOFZNF8SsxRxaKs4bMsebzRtg7z7jFwSDGN1AS63kZK7sn3sxhSVXIwUVY5hql9ytfo9RmqjPRdBvFl8kg+jgtymgQKBgBx3QiFIwRVb49qvvQR+JPMGO73+whI+1wP3U79iuF3poUIIGSwmmJqqvrNpTB9vrvpUO5bV1QW6we6BlMjf3oMc6/f/NoNhx03GObQ8/9Orm8DqezFsDVDSgowpdFFYrpr37OuQkM7yqhyXqhAbTeO1NI/+pmwr2JuP48iyTN1F';
    private static final String ADMIN_PASSWORD = 'Admin#Pass1';

    private class SheetsMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(200);
            String url = req.getEndpoint();
            if (url.contains('oauth2.googleapis.com')) {
                res.setBody('{"access_token":"test-token"}');
            } else if (url.contains('fields=sheets.properties.title')) {
                res.setBody('{"sheets":[{"properties":{"title":"Customers"}},{"properties":{"title":"Loans"}},{"properties":{"title":"Payments"}},{"properties":{"title":"Fines"}}]}');
            } else if (req.getMethod() == 'GET' && url.contains('Customers') && url.contains('FORMATTED_VALUE')) {
                res.setBody('{"values":[["S.No","Full Name","Mobile"],["077","Imported Person","9000000001"]]}');
            } else {
                res.setBody('{}');
            }
            return res;
        }
    }

    @TestSetup
    static void setup() {
        CrmConfig.getOrCreate();
        insert new List<CRM_Staff_User__c>{
            new CRM_Staff_User__c(Name = 'Boss', Full_Name__c = 'Boss', Login_ID__c = 'boss', Password_Hash__c = AuthController.hashPassword(ADMIN_PASSWORD), Role__c = 'Super Admin', Is_Active__c = true),
            new CRM_Staff_User__c(Name = 'Viewer', Full_Name__c = 'Viewer', Login_ID__c = 'viewer', Password_Hash__c = AuthController.hashPassword('Viewer#Pass1'), Role__c = 'Staff', Is_Active__c = true, Can_View_Only__c = true, Can_Add_Collection__c = true),
            new CRM_Staff_User__c(Name = 'Collector', Full_Name__c = 'Collector', Login_ID__c = 'collector', Password_Hash__c = AuthController.hashPassword('Collect#Pass1'), Role__c = 'Staff', Is_Active__c = true, Can_Add_Collection__c = true)
        };
        Borrower__c borrower = new Borrower__c(S_No__c = '008', Full_Name__c = 'Test Borrower', Mobile__c = '9999999999');
        insert borrower;
    }

    private static String login(String id, String password) {
        return AuthController.login(id, password).token;
    }

    @IsTest
    static void loginAndPermissions() {
        AuthController.SessionInfo admin = AuthController.login('boss', ADMIN_PASSWORD);
        System.assert(admin.isSuperAdmin);
        String viewerToken = login('viewer', 'Viewer#Pass1');
        Boolean blocked = false;
        LoanCrmController.PaymentDTO payment = new LoanCrmController.PaymentDTO();
        payment.amount = 10;
        try {
            LoanCrmController.recordPayment(viewerToken, payment);
        } catch (AuraHandledException e) {
            blocked = true;
        }
        System.assert(blocked, 'View-only staff must not add collections');
        try {
            AuthController.login('boss', 'wrong-password');
            System.assert(false, 'Wrong password must fail');
        } catch (AuraHandledException e) {
            System.assertEquals('Invalid Login ID or password.', e.getMessage());
        }
        try {
            AuthController.validateSession('not.a-token');
            System.assert(false, 'Bad token must fail');
        } catch (AuraHandledException e) {
            System.assert(e.getMessage().startsWith('SESSION_EXPIRED'));
        }
    }

    @IsTest
    static void staffManagementIsSuperAdminOnly() {
        String adminToken = login('boss', ADMIN_PASSWORD);
        String collectorToken = login('collector', 'Collect#Pass1');
        AuthController.StaffDTO dto = new AuthController.StaffDTO();
        dto.fullName = 'New Staff';
        dto.loginId = 'newstaff';
        dto.password = 'NewStaff#1';
        dto.role = 'Staff';
        dto.isActive = true;
        dto.canEditRecords = true;
        AuthController.saveStaff(adminToken, dto);
        System.assertEquals(4, AuthController.listStaff(adminToken).size());
        try {
            AuthController.listStaff(collectorToken);
            System.assert(false, 'Staff must not list users');
        } catch (AuraHandledException e) {
            System.assert(e.getMessage().contains('permission'));
        }
        System.assertNotEquals(null, login('newstaff', 'NewStaff#1'));
    }

    @IsTest
    static void loanMathCodesAndStatus() {
        Borrower__c borrower = [SELECT Id FROM Borrower__c LIMIT 1];
        System.assertEquals('8', [SELECT S_No__c FROM Borrower__c WHERE Id = :borrower.Id].S_No__c, 'Leading zeros stripped');
        String adminToken = login('boss', ADMIN_PASSWORD);

        LoanCrmController.LoanDTO daily = new LoanCrmController.LoanDTO();
        daily.borrowerId = borrower.Id;
        daily.repaymentType = 'DAILY';
        daily.principal = 10000;
        Id dailyId = LoanCrmController.issueLoan(adminToken, daily);
        LoanCrmController.LoanDTO weekly = new LoanCrmController.LoanDTO();
        weekly.borrowerId = borrower.Id;
        weekly.repaymentType = 'WEEKLY';
        weekly.principal = 10000;
        Id weeklyId = LoanCrmController.issueLoan(adminToken, weekly);

        Loan_Account__c d = [SELECT Loan_Code__c, Interest_Rate__c, Total_Payable__c, Status__c FROM Loan_Account__c WHERE Id = :dailyId];
        Loan_Account__c w = [SELECT Loan_Code__c, Interest_Rate__c, Total_Payable__c FROM Loan_Account__c WHERE Id = :weeklyId];
        System.assertEquals('8', d.Loan_Code__c);
        System.assertEquals('8-2', w.Loan_Code__c);
        System.assertEquals(20, d.Interest_Rate__c);
        System.assertEquals(26, w.Interest_Rate__c);
        System.assertEquals(12000, d.Total_Payable__c);
        System.assertEquals(12600, w.Total_Payable__c);

        LoanCrmController.PaymentDTO payment = new LoanCrmController.PaymentDTO();
        payment.loanId = dailyId;
        payment.amount = 100;
        payment.paymentDate = Date.today();
        LoanCrmController.recordPayment(adminToken, payment);

        LoanCrmController.FineDTO fine = new LoanCrmController.FineDTO();
        fine.loanId = dailyId;
        fine.amount = 50;
        fine.reason = 'Missed payment';
        LoanCrmController.addFine(adminToken, fine);

        d = [SELECT Total_Payable__c, Total_Paid__c, Outstanding_Due__c FROM Loan_Account__c WHERE Id = :dailyId];
        System.assertEquals(12050, d.Total_Payable__c);
        System.assertEquals(100, d.Total_Paid__c);
        System.assertEquals(11950, d.Outstanding_Due__c);

        LoanCrmController.LoanListResult paid = LoanCrmController.getLoans(adminToken, 'DAILY', 'PAID');
        System.assertEquals(1, paid.rows.size());
        System.assertEquals(100, paid.rows[0].periodPaid);
        System.assertEquals(0, LoanCrmController.getLoans(adminToken, 'DAILY', 'NOT_PAID').rows.size());
        System.assertEquals(1, LoanCrmController.getLoans(adminToken, 'WEEKLY', 'NOT_PAID').rows.size());

        // overpayment rejected
        payment.amount = 999999;
        try {
            LoanCrmController.recordPayment(adminToken, payment);
            System.assert(false, 'Overpayment must be rejected');
        } catch (AuraHandledException e) {
            System.assert(e.getMessage().contains('outstanding'));
        }

        // paying the remainder completes the loan
        payment.amount = 11950;
        LoanCrmController.recordPayment(adminToken, payment);
        System.assertEquals('COMPLETED', [SELECT Status__c FROM Loan_Account__c WHERE Id = :dailyId].Status__c);
        System.assertEquals(1, LoanCrmController.getLoans(adminToken, 'DAILY', 'CLEARED').rows.size());

        LoanCrmController.ProfileResult profile = LoanCrmController.getCustomerProfile(adminToken, borrower.Id);
        System.assertEquals(2, profile.loans.size());
        System.assertEquals(50, profile.totalFines);
    }

    @IsTest
    static void installmentDefaults() {
        LoanCrmController.LoanRow row = new LoanCrmController.LoanRow();
        row.repaymentType = 'DAILY';
        row.principal = 15000;
        row.outstanding = 18000;
        System.assertEquals(150, LoanCrmController.defaultInstallment(row));
        row.repaymentType = 'WEEKLY';
        System.assertEquals(900, LoanCrmController.defaultInstallment(row));
        row.outstanding = 400;
        System.assertEquals(400, LoanCrmController.defaultInstallment(row), 'Capped to outstanding');
    }

    @IsTest
    static void weekStartIsSunday() {
        Date sunday = Date.newInstance(2026, 11, 8);
        System.assertEquals(sunday, CrmUtil.weekStart(Date.newInstance(2026, 11, 14)));
        System.assertEquals(sunday, CrmUtil.weekStart(sunday));
        System.assertEquals(Date.newInstance(2026, 11, 14), CrmUtil.parseDate('14-11-2026'));
        System.assertEquals('14-11-2026', CrmUtil.formatDate(Date.newInstance(2026, 11, 14)));
    }

    @IsTest
    static void importAndDelete() {
        String adminToken = login('boss', ADMIN_PASSWORD);
        String rows = '[{"S.No":"0012","Full Name":"Imported One","Mobile":"9111111111"},{"S.No":"13","Full Name":"","Mobile":"1"}]';
        CrmImportService.ImportResult preview = CrmImportController.previewImport(adminToken, 'BORROWERS', rows, 2);
        System.assertEquals(1, preview.okCount);
        System.assertEquals(1, preview.errorCount);
        CrmImportController.commitImport(adminToken, 'BORROWERS', rows, 2);
        System.assertEquals(1, [SELECT COUNT() FROM Borrower__c WHERE S_No__c = '12']);

        String loanRows = '[{"S.No":"12","Repayment Type":"weekly","Principal":"10,000","Disbursement Date":"01-11-2026"}]';
        CrmImportController.commitImport(adminToken, 'LOANS', loanRows, 2);
        Loan_Account__c loan = [SELECT Id, Loan_Code__c, Total_Payable__c FROM Loan_Account__c WHERE Borrower__r.S_No__c = '12'];
        System.assertEquals('12', loan.Loan_Code__c);
        System.assertEquals(12600, loan.Total_Payable__c);

        String payRows = '[{"Loan Code":"12","Amount":"600","Payment Date":"08-11-2026","Method":"UPI"}]';
        CrmImportController.commitImport(adminToken, 'COLLECTIONS', payRows, 2);
        CrmImportService.ImportResult again = CrmImportController.commitImport(adminToken, 'COLLECTIONS', payRows, 2);
        System.assertEquals(1, again.skipCount, 'Re-import of the same payment is skipped');
        System.assertEquals(1, [SELECT COUNT() FROM Collection__c WHERE Loan_Account__c = :loan.Id]);

        // only users with Delete Loans may delete
        String collectorToken = login('collector', 'Collect#Pass1');
        try {
            LoanCrmController.deleteLoan(collectorToken, loan.Id);
            System.assert(false, 'Collector must not delete');
        } catch (AuraHandledException e) {
            System.assert(e.getMessage().contains('permission'));
        }
        LoanCrmController.deleteLoan(adminToken, loan.Id);
        System.assertEquals(0, [SELECT COUNT() FROM Loan_Account__c WHERE Id = :loan.Id]);
        System.assertEquals(0, [SELECT COUNT() FROM Collection__c]);
    }

    @IsTest
    static void statementPdfController() {
        String adminToken = login('boss', ADMIN_PASSWORD);
        Borrower__c borrower = [SELECT Id FROM Borrower__c LIMIT 1];
        String pdfToken = LoanCrmController.getStatementToken(adminToken, borrower.Id);
        PageReference page = new PageReference('/apex/CustomerStatementPDF');
        page.getParameters().put('t', pdfToken);
        Test.setCurrentPage(page);
        CustomerStatementController controller = new CustomerStatementController();
        System.assertEquals(null, controller.errorMessage);
        System.assertEquals('Test Borrower', controller.customerName);

        page.getParameters().put('t', adminToken);
        controller = new CustomerStatementController();
        System.assertNotEquals(null, controller.errorMessage, 'A session token must not open a statement');
    }

    @IsTest
    static void initializerSeedsAdmin() {
        delete [SELECT Id FROM CRM_Staff_User__c];
        String report = DatabaseInitializer.run('owner', 'Owner#Pass12');
        System.assert(report.contains('Super Admin created'));
        System.assertEquals(1, [SELECT COUNT() FROM CRM_Staff_User__c WHERE Login_ID__c = 'owner' AND Role__c = 'Super Admin']);
        System.assertEquals(0, DatabaseInitializer.verifyModel().size());
    }

    @IsTest
    static void googleSheetsSync() {
        String adminToken = login('boss', ADMIN_PASSWORD);
        SheetsController.saveConfig(adminToken, 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit', 'svc@project.iam.gserviceaccount.com', TEST_KEY, false);
        SheetsController.SheetsConfigDTO config = SheetsController.getConfig(adminToken);
        System.assertEquals('1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', config.spreadsheetId);
        System.assert(config.hasPrivateKey);

        Test.setMock(HttpCalloutMock.class, new SheetsMock());
        Test.startTest();
        System.assert(SheetsController.testConnection(adminToken).startsWith('Connected'));
        System.assert(SheetsController.syncAllToSheet(adminToken).contains('Customers: 1 rows'));
        Test.stopTest();

        String collectorToken = login('collector', 'Collect#Pass1');
        try {
            SheetsController.getConfig(collectorToken);
            System.assert(false, 'Only Super Admin may view sheet settings');
        } catch (AuraHandledException e) {
            System.assert(e.getMessage().contains('permission'));
        }
    }

    @IsTest
    static void importFromGoogleSheet() {
        String adminToken = login('boss', ADMIN_PASSWORD);
        SheetsController.saveConfig(adminToken, '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', 'svc@project.iam.gserviceaccount.com', TEST_KEY, false);
        Test.setMock(HttpCalloutMock.class, new SheetsMock());
        Test.startTest();
        SheetsController.importFromSheet(adminToken);
        Test.stopTest();
        System.assertEquals(1, [SELECT COUNT() FROM Borrower__c WHERE S_No__c = '77']);
    }

    @IsTest
    static void pushRecordsUsesAppendForNewRows() {
        String adminToken = login('boss', ADMIN_PASSWORD);
        SheetsController.saveConfig(adminToken, '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', 'svc@project.iam.gserviceaccount.com', TEST_KEY, false);
        Test.setMock(HttpCalloutMock.class, new SheetsMock());
        Test.startTest();
        GoogleSheetsSyncService.pushRecords('Customers', new Map<Id, Borrower__c>([SELECT Id FROM Borrower__c]).keySet());
        Test.stopTest();
        System.assertEquals(1, [SELECT COUNT() FROM Borrower__c]);
    }
}
