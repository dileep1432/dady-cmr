/**
 * @AuraEnabled entry points for the Excel/CSV uploader.
 */
public without sharing class CrmImportController {
    /**
     * Validates rows without saving.
     * @param token session token
     * @param entity BORROWERS, LOANS, COLLECTIONS or FINES
     * @param rowsJson JSON array of row objects
     * @param firstRowNumber row number of the first row (for messages)
     * @return validation result
     */
    @AuraEnabled
    public static CrmImportService.ImportResult previewImport(String token, String entity, String rowsJson, Integer firstRowNumber) {
        AuthController.require(token, CrmImportService.permissionFor(entity));
        return run(entity, rowsJson, true, firstRowNumber);
    }

    /**
     * Saves rows (valid rows are saved; invalid rows are reported).
     * @param token session token
     * @param entity BORROWERS, LOANS, COLLECTIONS or FINES
     * @param rowsJson JSON array of row objects
     * @param firstRowNumber row number of the first row (for messages)
     * @return save result
     */
    @AuraEnabled
    public static CrmImportService.ImportResult commitImport(String token, String entity, String rowsJson, Integer firstRowNumber) {
        AuthController.require(token, CrmImportService.permissionFor(entity));
        return run(entity, rowsJson, false, firstRowNumber);
    }

    private static CrmImportService.ImportResult run(String entity, String rowsJson, Boolean dryRun, Integer firstRowNumber) {
        try {
            List<Map<String, String>> rows = CrmImportService.parseRows(rowsJson);
            if (rows.size() > 500) {
                CrmUtil.fail('Send at most 500 rows per request.');
            }
            return CrmImportService.process(entity, rows, dryRun, firstRowNumber == null ? 2 : firstRowNumber);
        } catch (CrmException e) {
            CrmUtil.fail(e.getMessage());
        } catch (JSONException e) {
            CrmUtil.fail('Could not read the uploaded rows.');
        }
        return null;
    }
}
