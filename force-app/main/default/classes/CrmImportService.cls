/**
 * Validates and saves rows coming from Excel/CSV uploads or Google Sheets.
 * Entities: BORROWERS, LOANS, COLLECTIONS, FINES. Rows are maps keyed by column header.
 * Header matching ignores case, spaces, dots and underscores (so "S.No", "S_No" and "sno" all match).
 */
public without sharing class CrmImportService {
    public static final String BORROWERS = 'BORROWERS';
    public static final String LOANS = 'LOANS';
    public static final String COLLECTIONS = 'COLLECTIONS';
    public static final String FINES = 'FINES';
    private static final Set<String> METHODS = new Set<String>{ 'Cash', 'UPI', 'Bank Transfer', 'Other' };

    public class RowResult {
        @AuraEnabled public Integer rowNumber;
        @AuraEnabled public String status;
        @AuraEnabled public String action;
        @AuraEnabled public String message;
        @AuraEnabled public String summary;
    }

    public class ImportResult {
        @AuraEnabled public List<RowResult> rows = new List<RowResult>();
        @AuraEnabled public Integer okCount = 0;
        @AuraEnabled public Integer errorCount = 0;
        @AuraEnabled public Integer skipCount = 0;
        @AuraEnabled public Integer insertedCount = 0;
        @AuraEnabled public Integer updatedCount = 0;
    }

    /**
     * Required permission for an entity.
     * @param entity BORROWERS, LOANS, COLLECTIONS or FINES
     * @return AuthController permission constant
     */
    public static String permissionFor(String entity) {
        if (entity == COLLECTIONS) {
            return AuthController.PERM_ADD_COLLECTION;
        }
        if (entity == FINES) {
            return AuthController.PERM_ADD_FINES;
        }
        return AuthController.PERM_EDIT_RECORDS;
    }

    /**
     * Parses rows from JSON text (array of objects with string-able values).
     * @param rowsJson JSON array
     * @return list of normalised-key maps
     */
    public static List<Map<String, String>> parseRows(String rowsJson) {
        List<Map<String, String>> rows = new List<Map<String, String>>();
        if (String.isBlank(rowsJson)) {
            return rows;
        }
        for (Object item : (List<Object>) JSON.deserializeUntyped(rowsJson)) {
            Map<String, Object> raw = (Map<String, Object>) item;
            Map<String, String> row = new Map<String, String>();
            for (String key : raw.keySet()) {
                Object value = raw.get(key);
                row.put(normaliseKey(key), value == null ? '' : String.valueOf(value).trim());
            }
            rows.add(row);
        }
        return rows;
    }

    /**
     * Validates (and optionally saves) rows.
     * @param entity BORROWERS, LOANS, COLLECTIONS or FINES
     * @param rows parsed rows (see parseRows)
     * @param dryRun true to validate only
     * @param firstRowNumber number shown for the first row in messages
     * @return per-row results
     */
    public static ImportResult process(String entity, List<Map<String, String>> rows, Boolean dryRun, Integer firstRowNumber) {
        if (entity == BORROWERS) {
            return processBorrowers(rows, dryRun, firstRowNumber);
        } else if (entity == LOANS) {
            return processLoans(rows, dryRun, firstRowNumber);
        } else if (entity == COLLECTIONS) {
            return processChildren(rows, dryRun, firstRowNumber, true);
        } else if (entity == FINES) {
            return processChildren(rows, dryRun, firstRowNumber, false);
        }
        throw new CrmException('Unknown import type: ' + entity);
    }

    // ---------------------------------------------------------------- borrowers

    private static ImportResult processBorrowers(List<Map<String, String>> rows, Boolean dryRun, Integer firstRowNumber) {
        ImportResult result = new ImportResult();
        Set<String> keys = new Set<String>();
        for (Map<String, String> row : rows) {
            keys.add(CrmUtil.stripLeadingZeros(value(row, new List<String>{ 'sno', 'serialno', 'serial' })));
        }
        Map<String, Id> existing = new Map<String, Id>();
        for (Borrower__c b : [SELECT Id, S_No__c FROM Borrower__c WHERE S_No__c IN :keys]) {
            existing.put(b.S_No__c.toLowerCase(), b.Id);
        }
        List<Borrower__c> toSave = new List<Borrower__c>();
        List<RowResult> pending = new List<RowResult>();
        Set<String> seen = new Set<String>();
        for (Integer i = 0; i < rows.size(); i++) {
            Map<String, String> row = rows.get(i);
            RowResult rr = newRow(firstRowNumber + i);
            result.rows.add(rr);
            String sNo = CrmUtil.stripLeadingZeros(value(row, new List<String>{ 'sno', 'serialno', 'serial' }));
            String name = value(row, new List<String>{ 'fullname', 'name', 'customername', 'borrowername' });
            String mobile = value(row, new List<String>{ 'mobile', 'phone', 'mobileno', 'mobilenumber' });
            rr.summary = sNo + ' ' + name;
            if (String.isBlank(sNo) || String.isBlank(name) || String.isBlank(mobile)) {
                error(rr, 'S.No, Full Name and Mobile are required.');
                continue;
            }
            if (!seen.add(sNo.toLowerCase())) {
                error(rr, 'Duplicate S.No in this file: ' + sNo);
                continue;
            }
            Borrower__c b = new Borrower__c(
                S_No__c = sNo, Full_Name__c = name, Name = name.left(80), Mobile__c = mobile,
                Location__c = value(row, new List<String>{ 'location', 'address', 'area' }),
                Notes__c = value(row, new List<String>{ 'notes', 'note', 'remarks' })
            );
            Id existingId = existing.get(sNo.toLowerCase());
            rr.action = existingId == null ? 'INSERT' : 'UPDATE';
            if (existingId != null) {
                b.Id = existingId;
            }
            toSave.add(b);
            pending.add(rr);
            ok(rr);
        }
        if (!dryRun && !toSave.isEmpty()) {
            List<Database.UpsertResult> saved = Database.upsert(toSave, false);
            collect(saved, pending, result);
        }
        return finish(result, dryRun);
    }

    // -------------------------------------------------------------------- loans

    private static ImportResult processLoans(List<Map<String, String>> rows, Boolean dryRun, Integer firstRowNumber) {
        ImportResult result = new ImportResult();
        Set<String> sNos = new Set<String>();
        Set<String> codes = new Set<String>();
        for (Map<String, String> row : rows) {
            sNos.add(CrmUtil.stripLeadingZeros(value(row, new List<String>{ 'sno', 'borrowersno', 'customersno' })));
            codes.add(value(row, new List<String>{ 'loancode', 'code' }));
        }
        Map<String, Id> borrowers = new Map<String, Id>();
        for (Borrower__c b : [SELECT Id, S_No__c FROM Borrower__c WHERE S_No__c IN :sNos]) {
            borrowers.put(b.S_No__c.toLowerCase(), b.Id);
        }
        Map<String, Id> existing = new Map<String, Id>();
        for (Loan_Account__c l : [SELECT Id, Loan_Code__c FROM Loan_Account__c WHERE Loan_Code__c IN :codes]) {
            existing.put(l.Loan_Code__c.toLowerCase(), l.Id);
        }
        List<Loan_Account__c> inserts = new List<Loan_Account__c>();
        List<RowResult> insertRows = new List<RowResult>();
        List<Loan_Account__c> updates = new List<Loan_Account__c>();
        List<RowResult> updateRows = new List<RowResult>();
        for (Integer i = 0; i < rows.size(); i++) {
            Map<String, String> row = rows.get(i);
            RowResult rr = newRow(firstRowNumber + i);
            result.rows.add(rr);
            String sNo = CrmUtil.stripLeadingZeros(value(row, new List<String>{ 'sno', 'borrowersno', 'customersno' }));
            String code = value(row, new List<String>{ 'loancode', 'code' });
            String loanType = value(row, new List<String>{ 'repaymenttype', 'type' }).toUpperCase();
            rr.summary = (String.isBlank(code) ? sNo : code) + ' ' + loanType;
            try {
                Decimal principal = CrmUtil.parseDecimal(value(row, new List<String>{ 'principal', 'amount' }));
                Date disbursed = CrmUtil.parseDate(value(row, new List<String>{ 'disbursementdate', 'date' }));
                if (loanType != 'DAILY' && loanType != 'WEEKLY') {
                    throw new CrmException('Repayment Type must be DAILY or WEEKLY.');
                }
                if (principal == null || principal <= 0) {
                    throw new CrmException('Principal must be greater than zero.');
                }
                Loan_Account__c loan = new Loan_Account__c(
                    Repayment_Type__c = loanType, Principal__c = principal, Disbursement_Date__c = disbursed == null ? Date.today() : disbursed
                );
                Id existingId = String.isBlank(code) ? null : existing.get(code.toLowerCase());
                if (existingId != null) {
                    loan.Id = existingId;
                    rr.action = 'UPDATE';
                    updates.add(loan);
                    updateRows.add(rr);
                } else {
                    Id borrowerId = borrowers.get(String.isBlank(sNo) ? '' : sNo.toLowerCase());
                    if (borrowerId == null) {
                        throw new CrmException('Customer with S.No "' + sNo + '" not found. Import customers first.');
                    }
                    loan.Borrower__c = borrowerId;
                    loan.Loan_Code__c = String.isBlank(code) ? null : code;
                    rr.action = 'INSERT';
                    inserts.add(loan);
                    insertRows.add(rr);
                }
                ok(rr);
            } catch (CrmException e) {
                error(rr, e.getMessage());
            }
        }
        if (!dryRun) {
            if (!inserts.isEmpty()) {
                collect(Database.insert(inserts, false), insertRows, result);
            }
            if (!updates.isEmpty()) {
                collect(Database.update(updates, false), updateRows, result);
            }
        }
        return finish(result, dryRun);
    }

    // --------------------------------------------------- collections and fines

    private static ImportResult processChildren(List<Map<String, String>> rows, Boolean dryRun, Integer firstRowNumber, Boolean isCollection) {
        ImportResult result = new ImportResult();
        Set<String> codes = new Set<String>();
        for (Map<String, String> row : rows) {
            codes.add(loanCodeOf(row));
        }
        Map<String, Loan_Account__c> loans = new Map<String, Loan_Account__c>();
        for (Loan_Account__c l : [SELECT Id, Loan_Code__c, Borrower__c FROM Loan_Account__c WHERE Loan_Code__c IN :codes]) {
            loans.put(l.Loan_Code__c.toLowerCase(), l);
        }
        Set<Id> loanIds = new Set<Id>();
        for (Loan_Account__c l : loans.values()) {
            loanIds.add(l.Id);
        }
        Set<String> existingKeys = new Set<String>();
        Set<Id> existingIds = new Set<Id>();
        if (isCollection) {
            for (Collection__c c : [SELECT Id, Loan_Account__c, Amount__c, Payment_Date__c, Reference_No__c FROM Collection__c WHERE Loan_Account__c IN :loanIds]) {
                existingKeys.add(dupKey(c.Loan_Account__c, c.Payment_Date__c, c.Amount__c, c.Reference_No__c));
                existingIds.add(c.Id);
            }
        } else {
            for (Late_Fine__c f : [SELECT Id, Loan_Account__c, Fine_Amount__c, Fine_Date__c, Reason__c FROM Late_Fine__c WHERE Loan_Account__c IN :loanIds]) {
                existingKeys.add(dupKey(f.Loan_Account__c, f.Fine_Date__c, f.Fine_Amount__c, f.Reason__c));
                existingIds.add(f.Id);
            }
        }
        List<SObject> inserts = new List<SObject>();
        List<RowResult> insertRows = new List<RowResult>();
        List<SObject> updates = new List<SObject>();
        List<RowResult> updateRows = new List<RowResult>();
        Set<String> seenInFile = new Set<String>();
        for (Integer i = 0; i < rows.size(); i++) {
            Map<String, String> row = rows.get(i);
            RowResult rr = newRow(firstRowNumber + i);
            result.rows.add(rr);
            String code = loanCodeOf(row);
            rr.summary = code;
            try {
                Loan_Account__c loan = loans.get(code.toLowerCase());
                if (loan == null) {
                    throw new CrmException('Loan "' + code + '" not found. Import loans first.');
                }
                Decimal amount = CrmUtil.parseDecimal(value(row, isCollection ? new List<String>{ 'amount' } : new List<String>{ 'fineamount', 'amount' }));
                Date eventDate = CrmUtil.parseDate(value(row, isCollection ? new List<String>{ 'paymentdate', 'date' } : new List<String>{ 'finedate', 'date' }));
                if (amount == null || amount <= 0 || eventDate == null) {
                    throw new CrmException('Amount (greater than zero) and date are required.');
                }
                SObject record;
                String text;
                if (isCollection) {
                    String method = value(row, new List<String>{ 'paymentmethod', 'method' });
                    text = value(row, new List<String>{ 'referenceno', 'reference', 'refno' });
                    record = new Collection__c(
                        Loan_Account__c = loan.Id, Borrower__c = loan.Borrower__c, Amount__c = amount, Payment_Date__c = eventDate,
                        Payment_Method__c = METHODS.contains(method) ? method : (String.isBlank(method) ? 'Cash' : 'Other'),
                        Reference_No__c = text,
                        Collected_By__c = value(row, new List<String>{ 'collectedby' })
                    );
                } else {
                    text = value(row, new List<String>{ 'reason', 'why' });
                    if (String.isBlank(text)) {
                        throw new CrmException('Reason is required for a fine.');
                    }
                    record = new Late_Fine__c(Loan_Account__c = loan.Id, Borrower__c = loan.Borrower__c, Fine_Amount__c = amount, Reason__c = text.left(255), Fine_Date__c = eventDate);
                }
                rr.summary = code + ' ' + CrmUtil.formatDate(eventDate) + ' ' + amount;
                Id rowId = asId(value(row, new List<String>{ 'id' }));
                if (rowId != null && existingIds.contains(rowId)) {
                    record.Id = rowId;
                    rr.action = 'UPDATE';
                    updates.add(record);
                    updateRows.add(rr);
                    ok(rr);
                    continue;
                }
                String key = dupKey(loan.Id, eventDate, amount, text);
                if (existingKeys.contains(key) || !seenInFile.add(key)) {
                    rr.status = 'SKIP';
                    rr.action = '-';
                    rr.message = 'Duplicate of an existing record; skipped.';
                    continue;
                }
                rr.action = 'INSERT';
                inserts.add(record);
                insertRows.add(rr);
                ok(rr);
            } catch (CrmException e) {
                error(rr, e.getMessage());
            }
        }
        if (!dryRun) {
            if (!inserts.isEmpty()) {
                collect(Database.insert(inserts, false), insertRows, result);
            }
            if (!updates.isEmpty()) {
                collect(Database.update(updates, false), updateRows, result);
            }
        }
        return finish(result, dryRun);
    }

    // ------------------------------------------------------------------ helpers

    private static Id asId(String raw) {
        if (String.isBlank(raw) || raw.length() < 15) {
            return null;
        }
        try {
            return (Id) raw;
        } catch (Exception e) {
            return null;
        }
    }

    private static String loanCodeOf(Map<String, String> row) {
        String code = value(row, new List<String>{ 'loancode', 'code' });
        return String.isBlank(code) ? CrmUtil.stripLeadingZeros(value(row, new List<String>{ 'sno', 'borrowersno' })) : code;
    }

    private static String dupKey(Id loanId, Date d, Decimal amount, String text) {
        return loanId + '|' + d + '|' + (amount == null ? '' : amount.setScale(2).toPlainString()) + '|' + (text == null ? '' : text.toLowerCase());
    }

    public static String normaliseKey(String header) {
        return header == null ? '' : header.toLowerCase().replaceAll('[^a-z0-9]', '');
    }

    private static String value(Map<String, String> row, List<String> aliases) {
        for (String alias : aliases) {
            String found = row.get(alias);
            if (String.isNotBlank(found)) {
                return found.trim();
            }
        }
        return '';
    }

    private static RowResult newRow(Integer number) {
        RowResult rr = new RowResult();
        rr.rowNumber = number;
        rr.status = 'OK';
        rr.action = '-';
        return rr;
    }

    private static void ok(RowResult rr) {
        rr.status = 'OK';
    }

    private static void error(RowResult rr, String message) {
        rr.status = 'ERROR';
        rr.action = '-';
        rr.message = message;
    }

    private static void collect(List<Database.UpsertResult> saved, List<RowResult> rows, ImportResult result) {
        for (Integer i = 0; i < saved.size(); i++) {
            if (!saved[i].isSuccess()) {
                error(rows[i], saved[i].getErrors()[0].getMessage());
            } else if (saved[i].isCreated()) {
                result.insertedCount++;
            } else {
                result.updatedCount++;
            }
        }
    }

    private static void collect(List<Database.SaveResult> saved, List<RowResult> rows, ImportResult result) {
        for (Integer i = 0; i < saved.size(); i++) {
            if (!saved[i].isSuccess()) {
                error(rows[i], saved[i].getErrors()[0].getMessage());
            } else if (rows[i].action == 'INSERT') {
                result.insertedCount++;
            } else {
                result.updatedCount++;
            }
        }
    }

    private static ImportResult finish(ImportResult result, Boolean dryRun) {
        for (RowResult rr : result.rows) {
            if (rr.status == 'OK') {
                result.okCount++;
            } else if (rr.status == 'ERROR') {
                result.errorCount++;
            } else {
                result.skipCount++;
            }
        }
        return result;
    }
}
