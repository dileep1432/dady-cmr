trigger BorrowerTrigger on Borrower__c (before insert, before update, after insert, after update) {
    if (Trigger.isBefore) {
        for (Borrower__c borrower : Trigger.new) {
            borrower.S_No__c = CrmUtil.stripLeadingZeros(borrower.S_No__c);
            if (String.isNotBlank(borrower.Full_Name__c)) {
                borrower.Name = borrower.Full_Name__c.left(80);
            }
        }
    } else {
        SheetsSyncQueueable.enqueue('Customers', Trigger.newMap.keySet());
    }
}
