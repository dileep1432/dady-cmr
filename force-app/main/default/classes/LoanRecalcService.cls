/**
 * Single source of truth for loan maths: interest rate, Total Payable, Total Paid, Status and Loan Code.
 * Total Payable = Principal * (1 + Rate/100) + sum(Late_Fine__c).
 */
public without sharing class LoanRecalcService {
    private static final Map<String, Decimal> RATE_BY_TYPE = new Map<String, Decimal>{ 'DAILY' => 20, 'WEEKLY' => 26 };

    /**
     * Before insert/update handler for Loan_Account__c.
     * @param loans Trigger.new
     * @param isInsert true on insert
     */
    public static void beforeSave(List<Loan_Account__c> loans, Boolean isInsert) {
        Map<Id, Decimal> finesByLoan = new Map<Id, Decimal>();
        Map<Id, Decimal> paidByLoan = new Map<Id, Decimal>();
        if (!isInsert) {
            Set<Id> loanIds = new Map<Id, Loan_Account__c>(loans).keySet();
            for (AggregateResult ar : [SELECT Loan_Account__c l, SUM(Fine_Amount__c) s FROM Late_Fine__c WHERE Loan_Account__c IN :loanIds GROUP BY Loan_Account__c]) {
                finesByLoan.put((Id) ar.get('l'), (Decimal) ar.get('s'));
            }
            for (AggregateResult ar : [SELECT Loan_Account__c l, SUM(Amount__c) s FROM Collection__c WHERE Loan_Account__c IN :loanIds GROUP BY Loan_Account__c]) {
                paidByLoan.put((Id) ar.get('l'), (Decimal) ar.get('s'));
            }
        } else {
            assignLoanCodes(loans);
        }
        for (Loan_Account__c loan : loans) {
            Decimal rate = RATE_BY_TYPE.get(loan.Repayment_Type__c);
            if (rate != null) {
                loan.Interest_Rate__c = rate;
            }
            Decimal principal = loan.Principal__c == null ? 0 : loan.Principal__c;
            Decimal interestRate = loan.Interest_Rate__c == null ? 0 : loan.Interest_Rate__c;
            Decimal fines = isInsert ? 0 : (finesByLoan.get(loan.Id) ?? 0);
            Decimal paid = isInsert ? 0 : (paidByLoan.get(loan.Id) ?? 0);
            loan.Total_Payable__c = CrmUtil.round2(principal * (1 + interestRate / 100) + fines);
            loan.Total_Paid__c = CrmUtil.round2(paid);
            loan.Status__c = (loan.Total_Payable__c > 0 && loan.Total_Paid__c >= loan.Total_Payable__c) ? 'COMPLETED' : 'ACTIVE';
        }
    }

    /**
     * Forces recalculation of the given loans by issuing a no-op update (the before-update trigger does the maths).
     * @param loanIds loans to recalculate
     */
    public static void touch(Set<Id> loanIds) {
        if (CrmTriggerGuard.skipRecalc || loanIds == null || loanIds.isEmpty()) {
            return;
        }
        List<Loan_Account__c> loans = new List<Loan_Account__c>();
        for (Id loanId : loanIds) {
            loans.add(new Loan_Account__c(Id = loanId));
        }
        Database.update(loans, false);
    }

    /**
     * Fills Borrower__c on collections/fines from their loan.
     * @param records Collection__c or Late_Fine__c records (before insert)
     */
    public static void fillBorrower(List<SObject> records) {
        Set<Id> loanIds = new Set<Id>();
        for (SObject rec : records) {
            if (rec.get('Loan_Account__c') != null) {
                loanIds.add((Id) rec.get('Loan_Account__c'));
            }
        }
        Map<Id, Loan_Account__c> loans = new Map<Id, Loan_Account__c>([SELECT Id, Borrower__c FROM Loan_Account__c WHERE Id IN :loanIds]);
        for (SObject rec : records) {
            Loan_Account__c loan = loans.get((Id) rec.get('Loan_Account__c'));
            if (loan != null) {
                rec.put('Borrower__c', loan.Borrower__c);
            }
        }
    }

    /**
     * Collects the loan ids referenced by changed collection/fine rows.
     * @param records trigger rows
     * @return loan ids
     */
    public static Set<Id> loanIdsOf(List<SObject> records) {
        Set<Id> ids = new Set<Id>();
        for (SObject rec : records) {
            if (rec.get('Loan_Account__c') != null) {
                ids.add((Id) rec.get('Loan_Account__c'));
            }
        }
        return ids;
    }

    private static void assignLoanCodes(List<Loan_Account__c> loans) {
        Set<Id> borrowerIds = new Set<Id>();
        for (Loan_Account__c loan : loans) {
            if (String.isBlank(loan.Loan_Code__c) && loan.Borrower__c != null) {
                borrowerIds.add(loan.Borrower__c);
            }
        }
        if (borrowerIds.isEmpty()) {
            return;
        }
        Map<Id, Borrower__c> borrowers = new Map<Id, Borrower__c>([SELECT Id, S_No__c FROM Borrower__c WHERE Id IN :borrowerIds]);
        Set<String> usedCodes = new Set<String>();
        for (Loan_Account__c existing : [SELECT Loan_Code__c FROM Loan_Account__c WHERE Borrower__c IN :borrowerIds AND Loan_Code__c != null]) {
            usedCodes.add(existing.Loan_Code__c.toLowerCase());
        }
        for (Loan_Account__c loan : loans) {
            if (String.isNotBlank(loan.Loan_Code__c) || !borrowers.containsKey(loan.Borrower__c)) {
                continue;
            }
            String sNo = borrowers.get(loan.Borrower__c).S_No__c;
            String code = sNo;
            Integer counter = 2;
            while (usedCodes.contains(code.toLowerCase())) {
                code = sNo + '-' + counter;
                counter++;
            }
            usedCodes.add(code.toLowerCase());
            loan.Loan_Code__c = code;
        }
    }
}
