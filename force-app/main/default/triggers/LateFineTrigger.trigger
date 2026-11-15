trigger LateFineTrigger on Late_Fine__c (before insert, after insert, after update, after delete, after undelete) {
    if (Trigger.isBefore) {
        LoanRecalcService.fillBorrower(Trigger.new);
        return;
    }
    List<SObject> changed = Trigger.isDelete ? Trigger.old : Trigger.new;
    LoanRecalcService.touch(LoanRecalcService.loanIdsOf(changed));
    if (Trigger.isDelete) {
        return;
    }
    SheetsSyncQueueable.enqueue('Fines', Trigger.newMap.keySet());
}
