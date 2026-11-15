/**
 * Controller for the clean customer-only PDF statement (CustomerStatementPDF page).
 * The page is opened with a short-lived signed token created by LoanCrmController.getStatementToken.
 */
public without sharing class CustomerStatementController {
    public class LoanLine {
        public String code { get; set; }
        public String repayType { get; set; }
        public String disbursed { get; set; }
        public String principal { get; set; }
        public String payable { get; set; }
        public String paid { get; set; }
        public String outstanding { get; set; }
        public String status { get; set; }
    }

    public class PayLine {
        public String payDate { get; set; }
        public String code { get; set; }
        public String amount { get; set; }
        public String method { get; set; }
        public String reference { get; set; }
    }

    public class FineLine {
        public String fineDate { get; set; }
        public String code { get; set; }
        public String amount { get; set; }
        public String reason { get; set; }
    }

    public String errorMessage { get; private set; }
    public String customerName { get; private set; }
    public String sNo { get; private set; }
    public String mobile { get; private set; }
    public String location { get; private set; }
    public String totalFines { get; private set; }
    public String totalPaid { get; private set; }
    public String totalOutstanding { get; private set; }
    public List<LoanLine> loanLines { get; private set; }
    public List<PayLine> payLines { get; private set; }
    public List<FineLine> fineLines { get; private set; }

    public CustomerStatementController() {
        loanLines = new List<LoanLine>();
        payLines = new List<PayLine>();
        fineLines = new List<FineLine>();
        try {
            Map<String, Object> payload = AuthController.verifyToken(ApexPages.currentPage().getParameters().get('t'), 'P');
            load(Id.valueOf(String.valueOf(payload.get('b'))));
        } catch (Exception e) {
            errorMessage = 'This statement link has expired. Please generate the statement again.';
        }
    }

    private void load(Id borrowerId) {
        Borrower__c borrower = [SELECT Id, S_No__c, Full_Name__c, Mobile__c, Location__c FROM Borrower__c WHERE Id = :borrowerId LIMIT 1];
        customerName = borrower.Full_Name__c;
        sNo = borrower.S_No__c;
        mobile = borrower.Mobile__c;
        location = borrower.Location__c;
        Decimal paidSum = 0;
        Decimal dueSum = 0;
        Decimal fineSum = 0;
        for (Loan_Account__c loan : [
            SELECT Loan_Code__c, Repayment_Type__c, Disbursement_Date__c, Principal__c, Total_Payable__c, Total_Paid__c, Status__c
            FROM Loan_Account__c WHERE Borrower__c = :borrowerId ORDER BY Loan_Code__c
        ]) {
            Decimal payable = loan.Total_Payable__c ?? 0;
            Decimal paid = loan.Total_Paid__c ?? 0;
            LoanLine line = new LoanLine();
            line.code = loan.Loan_Code__c;
            line.repayType = loan.Repayment_Type__c;
            line.disbursed = CrmUtil.formatDate(loan.Disbursement_Date__c);
            line.principal = money(loan.Principal__c);
            line.payable = money(payable);
            line.paid = money(paid);
            line.outstanding = money(payable - paid);
            line.status = loan.Status__c;
            loanLines.add(line);
            paidSum += paid;
            dueSum += payable - paid;
        }
        for (Collection__c c : [
            SELECT Loan_Account__r.Loan_Code__c, Amount__c, Payment_Date__c, Payment_Method__c, Reference_No__c
            FROM Collection__c WHERE Loan_Account__r.Borrower__c = :borrowerId
            ORDER BY Payment_Date__c DESC, CreatedDate DESC LIMIT 1000
        ]) {
            PayLine line = new PayLine();
            line.payDate = CrmUtil.formatDate(c.Payment_Date__c);
            line.code = c.Loan_Account__r.Loan_Code__c;
            line.amount = money(c.Amount__c);
            line.method = c.Payment_Method__c;
            line.reference = c.Reference_No__c;
            payLines.add(line);
        }
        for (Late_Fine__c f : [
            SELECT Loan_Account__r.Loan_Code__c, Fine_Amount__c, Reason__c, Fine_Date__c
            FROM Late_Fine__c WHERE Loan_Account__r.Borrower__c = :borrowerId
            ORDER BY Fine_Date__c DESC, CreatedDate DESC LIMIT 500
        ]) {
            FineLine line = new FineLine();
            line.fineDate = CrmUtil.formatDate(f.Fine_Date__c);
            line.code = f.Loan_Account__r.Loan_Code__c;
            line.amount = money(f.Fine_Amount__c);
            line.reason = f.Reason__c;
            fineLines.add(line);
            fineSum += f.Fine_Amount__c ?? 0;
        }
        totalPaid = money(paidSum);
        totalOutstanding = money(dueSum);
        totalFines = money(fineSum);
    }

    private static String money(Decimal value) {
        return 'Rs. ' + CrmUtil.round2(value).toPlainString();
    }
}
