/**
 * Transaction-scoped switches used to avoid redundant work (recalculation or Google Sheets sync).
 */
public without sharing class CrmTriggerGuard {
    public static Boolean skipRecalc = false;
    public static Boolean skipSheetSync = false;
}
