/**
 * Pushes changed records to Google Sheets asynchronously (callouts are not allowed in triggers).
 */
public without sharing class SheetsSyncQueueable implements Queueable, Database.AllowsCallouts {
    private final String tab;
    private final Set<Id> recordIds;

    public SheetsSyncQueueable(String tab, Set<Id> recordIds) {
        this.tab = tab;
        this.recordIds = recordIds;
    }

    /**
     * Enqueues a sync job when Auto Sync is enabled and the context allows it.
     * @param tab Customers, Loans, Payments or Fines
     * @param ids changed record ids
     */
    public static void enqueue(String tab, Set<Id> ids) {
        if (CrmTriggerGuard.skipSheetSync || ids == null || ids.isEmpty()) {
            return;
        }
        if (System.isBatch() || System.isFuture() || System.isQueueable()) {
            return;
        }
        if (Limits.getQueueableJobs() >= Limits.getLimitQueueableJobs()) {
            return;
        }
        CRM_Config__c config = CrmConfig.get();
        if (config == null || config.Auto_Sync__c != true || String.isBlank(config.Spreadsheet_Id__c)) {
            return;
        }
        System.enqueueJob(new SheetsSyncQueueable(tab, ids));
    }

    /** @param context queueable context */
    public void execute(QueueableContext context) {
        String status = 'Auto-sync OK (' + tab + ': ' + recordIds.size() + ')';
        try {
            GoogleSheetsSyncService.pushRecords(tab, recordIds);
        } catch (Exception e) {
            status = 'Auto-sync FAILED (' + tab + '): ' + e.getMessage();
        }
        CrmConfig.recordSyncStatus(status);
    }
}
