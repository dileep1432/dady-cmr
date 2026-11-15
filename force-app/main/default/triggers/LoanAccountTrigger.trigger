trigger LoanAccountTrigger on Loan_Account__c (before insert, before update, after insert, after update) {
    if (Trigger.isBefore) {
        LoanRecalcService.beforeSave(Trigger.new, Trigger.isInsert);
    } else {
        SheetsSyncQueueable.enqueue('Loans', Trigger.newMap.keySet());
    }
}
