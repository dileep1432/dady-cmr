/**
 * Main data controller for the Microfinance CRM LWCs.
 * Every @AuraEnabled method takes the session token first and enforces the staff permission checkboxes.
 * Runs without sharing because access is governed by the custom login, not Salesforce sharing.
 */
public without sharing class LoanCrmController {
    private static final Integer ROW_LIMIT = 2000;
    private static final Set<String> VIEWS = new Set<String>{ 'NOT_PAID', 'PAID', 'ALL_ACTIVE', 'CLEARED' };
    private static final Set<String> TYPES = new Set<String>{ 'DAILY', 'WEEKLY' };
    private static final String LOAN_FIELDS =
        'Id, Loan_Code__c, Borrower__c, Borrower__r.Full_Name__c, Borrower__r.S_No__c, Borrower__r.Mobile__c, ' +
        'Borrower__r.Location__c, Repayment_Type__c, Principal__c, Interest_Rate__c, Total_Payable__c, Total_Paid__c, ' +
        'Outstanding_Due__c, Disbursement_Date__c, Status__c';

    // ------------------------------------------------------------- DTO classes

    public class LoanRow {
        @AuraEnabled public String id;
        @AuraEnabled public String loanCode;
        @AuraEnabled public String borrowerId;
        @AuraEnabled public String borrowerName;
        @AuraEnabled public String sNo;
        @AuraEnabled public String mobile;
        @AuraEnabled public String location;
        @AuraEnabled public String repaymentType;
        @AuraEnabled public Decimal principal;
        @AuraEnabled public Decimal interestRate;
        @AuraEnabled public Decimal totalPayable;
        @AuraEnabled public Decimal totalPaid;
        @AuraEnabled public Decimal outstanding;
        @AuraEnabled public Date disbursementDate;
        @AuraEnabled public String status;
        @AuraEnabled public Decimal periodPaid;
        @AuraEnabled public Decimal installment;
    }

    public class LoanListResult {
        @AuraEnabled public List<LoanRow> rows = new List<LoanRow>();
        @AuraEnabled public Date periodStart;
        @AuraEnabled public Date periodEnd;
        @AuraEnabled public Decimal totalOutstanding = 0;
        @AuraEnabled public Decimal totalPeriodPaid = 0;
        @AuraEnabled public Boolean truncated = false;
    }

    public class CollectionRow {
        @AuraEnabled public String id;
        @AuraEnabled public String loanCode;
        @AuraEnabled public String borrowerId;
        @AuraEnabled public String borrowerName;
        @AuraEnabled public String sNo;
        @AuraEnabled public Decimal amount;
        @AuraEnabled public Date paymentDate;
        @AuraEnabled public String method;
        @AuraEnabled public String referenceNo;
        @AuraEnabled public String collectedBy;
    }

    public class CollectionListResult {
        @AuraEnabled public List<CollectionRow> rows = new List<CollectionRow>();
        @AuraEnabled public Decimal total = 0;
        @AuraEnabled public Boolean truncated = false;
    }

    public class FineRow {
        @AuraEnabled public String id;
        @AuraEnabled public String loanCode;
        @AuraEnabled public Decimal amount;
        @AuraEnabled public String reason;
        @AuraEnabled public Date fineDate;
    }

    public class CustomerRow {
        @AuraEnabled public String id;
        @AuraEnabled public String sNo;
        @AuraEnabled public String name;
        @AuraEnabled public String mobile;
        @AuraEnabled public String location;
        @AuraEnabled public Integer activeLoans = 0;
        @AuraEnabled public Integer totalLoans = 0;
        @AuraEnabled public Decimal outstanding = 0;
    }

    public class BorrowerDTO {
        @AuraEnabled public String id;
        @AuraEnabled public String sNo;
        @AuraEnabled public String name;
        @AuraEnabled public String mobile;
        @AuraEnabled public String location;
        @AuraEnabled public String notes;
    }

    public class ProfileResult {
        @AuraEnabled public BorrowerDTO borrower;
        @AuraEnabled public List<LoanRow> loans = new List<LoanRow>();
        @AuraEnabled public List<CollectionRow> collections = new List<CollectionRow>();
        @AuraEnabled public List<FineRow> fines = new List<FineRow>();
        @AuraEnabled public Decimal totalPrincipal = 0;
        @AuraEnabled public Decimal totalPayable = 0;
        @AuraEnabled public Decimal totalPaid = 0;
        @AuraEnabled public Decimal totalOutstanding = 0;
        @AuraEnabled public Decimal totalFines = 0;
    }

    public class LoanDTO {
        @AuraEnabled public String id;
        @AuraEnabled public String borrowerId;
        @AuraEnabled public String repaymentType;
        @AuraEnabled public Decimal principal;
        @AuraEnabled public Date disbursementDate;
    }

    public class PaymentDTO {
        @AuraEnabled public String loanId;
        @AuraEnabled public Decimal amount;
        @AuraEnabled public Date paymentDate;
        @AuraEnabled public String method;
        @AuraEnabled public String referenceNo;
    }

    public class FineDTO {
        @AuraEnabled public String loanId;
        @AuraEnabled public Decimal amount;
        @AuraEnabled public String reason;
        @AuraEnabled public Date fineDate;
    }

    // -------------------------------------------------------- Daily / Weekly

    /**
     * Loads loans for the Daily or Weekly tab.
     * DAILY paid/not-paid is evaluated for today. WEEKLY is evaluated for the current Sunday-Saturday week.
     * @param token session token
     * @param repaymentType DAILY or WEEKLY
     * @param view NOT_PAID, PAID, ALL_ACTIVE or CLEARED
     * @return loan rows with totals
     */
    @AuraEnabled
    public static LoanListResult getLoans(String token, String repaymentType, String view) {
        AuthController.require(token, AuthController.PERM_ANY);
        if (!TYPES.contains(repaymentType) || !VIEWS.contains(view)) {
            CrmUtil.fail('Invalid view.');
        }
        Date today = Date.today();
        Date periodStart = repaymentType == 'WEEKLY' ? CrmUtil.weekStart(today) : today;
        Date periodEnd = repaymentType == 'WEEKLY' ? periodStart.addDays(6) : today;

        Map<Id, Decimal> paidInPeriod = new Map<Id, Decimal>();
        for (AggregateResult ar : [
            SELECT Loan_Account__c loanId, SUM(Amount__c) amt
            FROM Collection__c
            WHERE Payment_Date__c >= :periodStart AND Payment_Date__c <= :periodEnd
              AND Loan_Account__r.Repayment_Type__c = :repaymentType
            GROUP BY Loan_Account__c
        ]) {
            paidInPeriod.put((Id) ar.get('loanId'), (Decimal) ar.get('amt'));
        }
        Set<Id> paidIds = paidInPeriod.keySet();

        String soql = 'SELECT ' + LOAN_FIELDS + ' FROM Loan_Account__c WHERE Repayment_Type__c = :repaymentType';
        if (view == 'NOT_PAID') {
            soql += ' AND Status__c = \'ACTIVE\' AND Id NOT IN :paidIds';
        } else if (view == 'PAID') {
            soql += ' AND Id IN :paidIds';
        } else if (view == 'ALL_ACTIVE') {
            soql += ' AND Status__c = \'ACTIVE\'';
        } else {
            soql += ' AND Status__c = \'COMPLETED\'';
        }
        soql += ' ORDER BY Borrower__r.Full_Name__c, Loan_Code__c LIMIT ' + (ROW_LIMIT + 1);

        List<Loan_Account__c> loans = Database.query(soql);
        LoanListResult result = new LoanListResult();
        result.periodStart = periodStart;
        result.periodEnd = periodEnd;
        for (Loan_Account__c loan : loans) {
            if (result.rows.size() >= ROW_LIMIT) {
                result.truncated = true;
                break;
            }
            LoanRow row = toLoanRow(loan, paidInPeriod.get(loan.Id));
            result.rows.add(row);
            result.totalOutstanding += row.outstanding;
            result.totalPeriodPaid += row.periodPaid;
        }
        return result;
    }

    /**
     * Collections audit list with date range.
     * @param token session token
     * @param repaymentType DAILY or WEEKLY
     * @param fromDate first payment date
     * @param toDate last payment date
     * @return collections and their total
     */
    @AuraEnabled
    public static CollectionListResult getCollections(String token, String repaymentType, Date fromDate, Date toDate) {
        AuthController.require(token, AuthController.PERM_ANY);
        if (!TYPES.contains(repaymentType) || fromDate == null || toDate == null || fromDate > toDate) {
            CrmUtil.fail('Choose a valid date range.');
        }
        CollectionListResult result = new CollectionListResult();
        Integer queryLimit = ROW_LIMIT + 1;
        for (Collection__c c : [
            SELECT Id, Loan_Account__r.Loan_Code__c, Borrower__c, Borrower__r.Full_Name__c, Borrower__r.S_No__c,
                   Amount__c, Payment_Date__c, Payment_Method__c, Reference_No__c, Collected_By__c
            FROM Collection__c
            WHERE Loan_Account__r.Repayment_Type__c = :repaymentType
              AND Payment_Date__c >= :fromDate AND Payment_Date__c <= :toDate
            ORDER BY Payment_Date__c DESC, CreatedDate DESC
            LIMIT :queryLimit
        ]) {
            if (result.rows.size() >= ROW_LIMIT) {
                result.truncated = true;
                break;
            }
            result.rows.add(toCollectionRow(c));
            result.total += c.Amount__c == null ? 0 : c.Amount__c;
        }
        return result;
    }

    // ------------------------------------------------------------- Customers

    /**
     * Searches customers by name, S.No or mobile.
     * @param token session token
     * @param searchTerm optional search text
     * @return up to 200 customers with loan summary
     */
    @AuraEnabled
    public static List<CustomerRow> getCustomers(String token, String searchTerm) {
        AuthController.require(token, AuthController.PERM_ANY);
        String pattern = '%' + (searchTerm == null ? '' : searchTerm.trim()) + '%';
        List<Borrower__c> borrowers = [
            SELECT Id, S_No__c, Full_Name__c, Mobile__c, Location__c
            FROM Borrower__c
            WHERE Full_Name__c LIKE :pattern OR S_No__c LIKE :pattern OR Mobile__c LIKE :pattern
            ORDER BY Full_Name__c
            LIMIT 200
        ];
        Map<Id, CustomerRow> rows = new Map<Id, CustomerRow>();
        List<CustomerRow> ordered = new List<CustomerRow>();
        for (Borrower__c b : borrowers) {
            CustomerRow row = new CustomerRow();
            row.id = b.Id;
            row.sNo = b.S_No__c;
            row.name = b.Full_Name__c;
            row.mobile = b.Mobile__c;
            row.location = b.Location__c;
            rows.put(b.Id, row);
            ordered.add(row);
        }
        for (Loan_Account__c loan : [
            SELECT Borrower__c, Status__c, Total_Payable__c, Total_Paid__c
            FROM Loan_Account__c
            WHERE Borrower__c IN :rows.keySet()
        ]) {
            CustomerRow row = rows.get(loan.Borrower__c);
            row.totalLoans++;
            if (loan.Status__c == 'ACTIVE') {
                row.activeLoans++;
                row.outstanding += (loan.Total_Payable__c ?? 0) - (loan.Total_Paid__c ?? 0);
            }
        }
        return ordered;
    }

    /**
     * Full customer profile: loans, payment history and fines.
     * @param token session token
     * @param borrowerId borrower id
     * @return profile data
     */
    @AuraEnabled
    public static ProfileResult getCustomerProfile(String token, Id borrowerId) {
        AuthController.require(token, AuthController.PERM_ANY);
        List<Borrower__c> found = [SELECT Id, S_No__c, Full_Name__c, Mobile__c, Location__c, Notes__c FROM Borrower__c WHERE Id = :borrowerId LIMIT 1];
        if (found.isEmpty()) {
            CrmUtil.fail('Customer not found.');
        }
        ProfileResult result = new ProfileResult();
        BorrowerDTO dto = new BorrowerDTO();
        dto.id = found[0].Id;
        dto.sNo = found[0].S_No__c;
        dto.name = found[0].Full_Name__c;
        dto.mobile = found[0].Mobile__c;
        dto.location = found[0].Location__c;
        dto.notes = found[0].Notes__c;
        result.borrower = dto;

        for (Loan_Account__c loan : Database.query('SELECT ' + LOAN_FIELDS + ' FROM Loan_Account__c WHERE Borrower__c = :borrowerId ORDER BY Loan_Code__c')) {
            LoanRow row = toLoanRow(loan, 0);
            result.loans.add(row);
            result.totalPrincipal += row.principal;
            result.totalPayable += row.totalPayable;
            result.totalPaid += row.totalPaid;
            result.totalOutstanding += row.outstanding;
        }
        for (Collection__c c : [
            SELECT Id, Loan_Account__r.Loan_Code__c, Borrower__c, Borrower__r.Full_Name__c, Borrower__r.S_No__c,
                   Amount__c, Payment_Date__c, Payment_Method__c, Reference_No__c, Collected_By__c
            FROM Collection__c
            WHERE Loan_Account__r.Borrower__c = :borrowerId
            ORDER BY Payment_Date__c DESC, CreatedDate DESC
            LIMIT 1000
        ]) {
            result.collections.add(toCollectionRow(c));
        }
        for (Late_Fine__c f : [
            SELECT Id, Loan_Account__r.Loan_Code__c, Fine_Amount__c, Reason__c, Fine_Date__c
            FROM Late_Fine__c
            WHERE Loan_Account__r.Borrower__c = :borrowerId
            ORDER BY Fine_Date__c DESC, CreatedDate DESC
            LIMIT 500
        ]) {
            FineRow row = new FineRow();
            row.id = f.Id;
            row.loanCode = f.Loan_Account__r.Loan_Code__c;
            row.amount = f.Fine_Amount__c;
            row.reason = f.Reason__c;
            row.fineDate = f.Fine_Date__c;
            result.fines.add(row);
            result.totalFines += f.Fine_Amount__c ?? 0;
        }
        return result;
    }

    /**
     * Creates or updates a customer. Requires Edit Records.
     * @param token session token
     * @param borrower customer data
     * @return borrower id
     */
    @AuraEnabled
    public static String saveBorrower(String token, BorrowerDTO borrower) {
        AuthController.require(token, AuthController.PERM_EDIT_RECORDS);
        if (borrower == null || String.isBlank(borrower.sNo) || String.isBlank(borrower.name) || String.isBlank(borrower.mobile)) {
            CrmUtil.fail('S.No, name and mobile are required.');
        }
        Borrower__c record = new Borrower__c(
            S_No__c = CrmUtil.stripLeadingZeros(borrower.sNo),
            Full_Name__c = borrower.name.trim(),
            Name = borrower.name.trim().left(80),
            Mobile__c = borrower.mobile.trim(),
            Location__c = borrower.location,
            Notes__c = borrower.notes
        );
        if (String.isNotBlank(borrower.id)) {
            record.Id = borrower.id;
        }
        try {
            upsert record;
        } catch (DmlException e) {
            CrmUtil.fail(e.getDmlMessage(0));
        }
        return record.Id;
    }

    // ----------------------------------------------------------------- Loans

    /**
     * Issues a new loan. Loan code, interest rate and totals are set by the trigger. Requires Edit Records.
     * @param token session token
     * @param loan loan data
     * @return loan id
     */
    @AuraEnabled
    public static String issueLoan(String token, LoanDTO loan) {
        AuthController.require(token, AuthController.PERM_EDIT_RECORDS);
        if (loan == null || String.isBlank(loan.borrowerId) || !TYPES.contains(loan.repaymentType) || loan.principal == null || loan.principal <= 0) {
            CrmUtil.fail('Customer, repayment type and a positive principal are required.');
        }
        Loan_Account__c record = new Loan_Account__c(
            Borrower__c = loan.borrowerId,
            Repayment_Type__c = loan.repaymentType,
            Principal__c = loan.principal,
            Disbursement_Date__c = loan.disbursementDate == null ? Date.today() : loan.disbursementDate
        );
        try {
            insert record;
        } catch (DmlException e) {
            CrmUtil.fail(e.getDmlMessage(0));
        }
        return record.Id;
    }

    /**
     * Edits principal and disbursement date of a loan. Requires Edit Records.
     * @param token session token
     * @param loan loan data (id, principal, disbursementDate)
     */
    @AuraEnabled
    public static void updateLoan(String token, LoanDTO loan) {
        AuthController.require(token, AuthController.PERM_EDIT_RECORDS);
        if (loan == null || String.isBlank(loan.id) || loan.principal == null || loan.principal <= 0) {
            CrmUtil.fail('A positive principal is required.');
        }
        try {
            update new Loan_Account__c(Id = loan.id, Principal__c = loan.principal, Disbursement_Date__c = loan.disbursementDate);
        } catch (DmlException e) {
            CrmUtil.fail(e.getDmlMessage(0));
        }
    }

    /**
     * Records a payment. Requires Add Collection. Overpayment is rejected.
     * @param token session token
     * @param payment payment data
     */
    @AuraEnabled
    public static void recordPayment(String token, PaymentDTO payment) {
        CRM_Staff_User__c user = AuthController.require(token, AuthController.PERM_ADD_COLLECTION);
        if (payment == null || String.isBlank(payment.loanId) || payment.amount == null || payment.amount <= 0) {
            CrmUtil.fail('Enter a payment amount greater than zero.');
        }
        List<Loan_Account__c> loans = [
            SELECT Id, Borrower__c, Total_Payable__c, Total_Paid__c FROM Loan_Account__c WHERE Id = :payment.loanId FOR UPDATE
        ];
        if (loans.isEmpty()) {
            CrmUtil.fail('Loan not found.');
        }
        Decimal outstanding = (loans[0].Total_Payable__c ?? 0) - (loans[0].Total_Paid__c ?? 0);
        if (payment.amount > outstanding + 0.005) {
            CrmUtil.fail('Amount is more than the outstanding due (' + outstanding.setScale(2) + ').');
        }
        try {
            insert new Collection__c(
                Loan_Account__c = payment.loanId,
                Borrower__c = loans[0].Borrower__c,
                Amount__c = payment.amount,
                Payment_Date__c = payment.paymentDate == null ? Date.today() : payment.paymentDate,
                Payment_Method__c = String.isBlank(payment.method) ? 'Cash' : payment.method,
                Reference_No__c = payment.referenceNo,
                Collected_By__c = user.Full_Name__c
            );
        } catch (DmlException e) {
            CrmUtil.fail(e.getDmlMessage(0));
        }
    }

    /**
     * Adds a late fine, which also increases the loan's Total Payable. Requires Add Late Fines.
     * @param token session token
     * @param fine fine data
     */
    @AuraEnabled
    public static void addFine(String token, FineDTO fine) {
        AuthController.require(token, AuthController.PERM_ADD_FINES);
        if (fine == null || String.isBlank(fine.loanId) || fine.amount == null || fine.amount <= 0 || String.isBlank(fine.reason)) {
            CrmUtil.fail('Fine amount and reason are required.');
        }
        try {
            insert new Late_Fine__c(
                Loan_Account__c = fine.loanId,
                Fine_Amount__c = fine.amount,
                Reason__c = fine.reason.trim().left(255),
                Fine_Date__c = fine.fineDate == null ? Date.today() : fine.fineDate
            );
        } catch (DmlException e) {
            CrmUtil.fail(e.getDmlMessage(0));
        }
    }

    // ---------------------------------------------------------- Loan Manager

    /**
     * Lists loans for the delete manager. Requires Delete Loans.
     * @param token session token
     * @param searchTerm optional loan code / name / mobile
     * @return up to 300 loans
     */
    @AuraEnabled
    public static List<LoanRow> getLoansForDeletion(String token, String searchTerm) {
        AuthController.require(token, AuthController.PERM_DELETE_LOANS);
        String pattern = '%' + (searchTerm == null ? '' : searchTerm.trim()) + '%';
        List<LoanRow> rows = new List<LoanRow>();
        for (Loan_Account__c loan : Database.query(
            'SELECT ' + LOAN_FIELDS + ' FROM Loan_Account__c WHERE Loan_Code__c LIKE :pattern OR Borrower__r.Full_Name__c LIKE :pattern ' +
            'OR Borrower__r.Mobile__c LIKE :pattern ORDER BY CreatedDate DESC LIMIT 300'
        )) {
            rows.add(toLoanRow(loan, 0));
        }
        return rows;
    }

    /**
     * Permanently deletes a loan with its collections and fines. Requires Delete Loans.
     * @param token session token
     * @param loanId loan to delete
     */
    @AuraEnabled
    public static void deleteLoan(String token, Id loanId) {
        AuthController.require(token, AuthController.PERM_DELETE_LOANS);
        if (loanId == null) {
            CrmUtil.fail('Choose a loan to delete.');
        }
        Boolean previous = CrmTriggerGuard.skipRecalc;
        CrmTriggerGuard.skipRecalc = true;
        try {
            delete [SELECT Id FROM Collection__c WHERE Loan_Account__c = :loanId];
            delete [SELECT Id FROM Late_Fine__c WHERE Loan_Account__c = :loanId];
            delete [SELECT Id FROM Loan_Account__c WHERE Id = :loanId];
        } catch (DmlException e) {
            CrmUtil.fail(e.getDmlMessage(0));
        } finally {
            CrmTriggerGuard.skipRecalc = previous;
        }
    }

    // ----------------------------------------------------------------- PDF

    /**
     * Returns a 5-minute token that lets the statement PDF page render one customer.
     * @param token session token
     * @param borrowerId customer id
     * @return PDF token
     */
    @AuraEnabled
    public static String getStatementToken(String token, Id borrowerId) {
        CRM_Staff_User__c user = AuthController.require(token, AuthController.PERM_ANY);
        return AuthController.issueToken(user.Id, 5, 'P', borrowerId);
    }

    // -------------------------------------------------------------- mappers

    private static LoanRow toLoanRow(Loan_Account__c loan, Decimal periodPaid) {
        LoanRow row = new LoanRow();
        row.id = loan.Id;
        row.loanCode = loan.Loan_Code__c;
        row.borrowerId = loan.Borrower__c;
        row.borrowerName = loan.Borrower__r.Full_Name__c;
        row.sNo = loan.Borrower__r.S_No__c;
        row.mobile = loan.Borrower__r.Mobile__c;
        row.location = loan.Borrower__r.Location__c;
        row.repaymentType = loan.Repayment_Type__c;
        row.principal = loan.Principal__c ?? 0;
        row.interestRate = loan.Interest_Rate__c ?? 0;
        row.totalPayable = loan.Total_Payable__c ?? 0;
        row.totalPaid = loan.Total_Paid__c ?? 0;
        row.outstanding = CrmUtil.round2(row.totalPayable - row.totalPaid);
        row.disbursementDate = loan.Disbursement_Date__c;
        row.status = loan.Status__c;
        row.periodPaid = periodPaid ?? 0;
        row.installment = defaultInstallment(row);
        return row;
    }

    /**
     * Proportional installment: 1% of principal for DAILY, 6% for WEEKLY, capped to the outstanding balance.
     * @param row loan row
     * @return suggested payment amount
     */
    @TestVisible
    private static Decimal defaultInstallment(LoanRow row) {
        Decimal percent = row.repaymentType == 'WEEKLY' ? 6 : 1;
        Decimal installment = CrmUtil.round2(row.principal * percent / 100);
        Decimal outstanding = row.outstanding < 0 ? 0 : row.outstanding;
        return installment > outstanding ? outstanding : installment;
    }

    private static CollectionRow toCollectionRow(Collection__c c) {
        CollectionRow row = new CollectionRow();
        row.id = c.Id;
        row.loanCode = c.Loan_Account__r.Loan_Code__c;
        row.borrowerId = c.Borrower__c;
        row.borrowerName = c.Borrower__r.Full_Name__c;
        row.sNo = c.Borrower__r.S_No__c;
        row.amount = c.Amount__c;
        row.paymentDate = c.Payment_Date__c;
        row.method = c.Payment_Method__c;
        row.referenceNo = c.Reference_No__c;
        row.collectedBy = c.Collected_By__c;
        return row;
    }
}
