/**
 * Google Sheets API v4 integration using a service account (JWT bearer flow signed in Apex).
 * Tabs: Customers, Loans, Payments, Fines. Column A of every tab holds the Salesforce record Id so that
 * updates overwrite the right row. Values are written with valueInputOption=RAW so that text such as
 * "=1+1" in a note is stored as text and never evaluated as a formula.
 */
public without sharing class GoogleSheetsSyncService {
    private static final String API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets/';
    private static final String TOKEN_URL = 'https://oauth2.googleapis.com/token';
    private static final Integer CHUNK_SIZE = 1000;
    private static final Integer MAX_ROWS = 10000;
    private static final Integer IMPORT_ROW_CAP = 1000;

    public static final List<String> TABS = new List<String>{ 'Customers', 'Loans', 'Payments', 'Fines' };

    private static final Map<String, List<String>> HEADERS = new Map<String, List<String>>{
        'Customers' => new List<String>{ 'Id', 'S_No', 'Full_Name', 'Mobile', 'Location', 'Notes' },
        'Loans' => new List<String>{ 'Id', 'Loan_Code', 'S_No', 'Repayment_Type', 'Principal', 'Interest_Rate', 'Total_Payable', 'Total_Paid', 'Outstanding_Due', 'Disbursement_Date', 'Status' },
        'Payments' => new List<String>{ 'Id', 'Loan_Code', 'S_No', 'Amount', 'Payment_Date', 'Payment_Method', 'Reference_No', 'Collected_By' },
        'Fines' => new List<String>{ 'Id', 'Loan_Code', 'S_No', 'Fine_Amount', 'Reason', 'Fine_Date' }
    };

    private static final Map<String, String> SELECTS = new Map<String, String>{
        'Customers' => 'SELECT Id, S_No__c, Full_Name__c, Mobile__c, Location__c, Notes__c FROM Borrower__c',
        'Loans' => 'SELECT Id, Loan_Code__c, Borrower__r.S_No__c, Repayment_Type__c, Principal__c, Interest_Rate__c, Total_Payable__c, Total_Paid__c, Outstanding_Due__c, Disbursement_Date__c, Status__c FROM Loan_Account__c',
        'Payments' => 'SELECT Id, Loan_Account__r.Loan_Code__c, Borrower__r.S_No__c, Amount__c, Payment_Date__c, Payment_Method__c, Reference_No__c, Collected_By__c FROM Collection__c',
        'Fines' => 'SELECT Id, Loan_Account__r.Loan_Code__c, Borrower__r.S_No__c, Fine_Amount__c, Reason__c, Fine_Date__c FROM Late_Fine__c'
    };

    private static final Map<String, String> ENTITY_BY_TAB = new Map<String, String>{
        'Customers' => CrmImportService.BORROWERS,
        'Loans' => CrmImportService.LOANS,
        'Payments' => CrmImportService.COLLECTIONS,
        'Fines' => CrmImportService.FINES
    };

    private static String accessToken;
    private static Boolean tabsEnsured = false;

    // ------------------------------------------------------------ public API

    /**
     * Verifies credentials and that the spreadsheet is reachable; creates missing tabs.
     * @return human readable result
     */
    public static String testConnection() {
        ensureTabs();
        return 'Connected. Tabs ready: ' + String.join(TABS, ', ');
    }

    /**
     * Upserts the given records into their tab (update by Id in column A, otherwise append).
     * @param tab Customers, Loans, Payments or Fines
     * @param ids record ids
     */
    public static void pushRecords(String tab, Set<Id> ids) {
        validateTab(tab);
        ensureTabs();
        List<SObject> records = load(tab, ids);
        if (records.isEmpty()) {
            return;
        }
        Map<String, Integer> rowById = existingRows(tab);
        String lastColumn = columnLetter(HEADERS.get(tab).size());
        List<Object> updates = new List<Object>();
        List<List<Object>> appends = new List<List<Object>>();
        for (SObject rec : records) {
            List<Object> row = toRow(tab, rec);
            Integer rowNumber = rowById.get(String.valueOf(rec.Id));
            if (rowNumber == null) {
                appends.add(row);
            } else {
                updates.add(new Map<String, Object>{
                    'range' => tab + '!A' + rowNumber + ':' + lastColumn + rowNumber,
                    'values' => new List<Object>{ row }
                });
            }
        }
        if (!updates.isEmpty()) {
            call('POST', spreadsheetUrl() + '/values:batchUpdate',
                new Map<String, Object>{ 'valueInputOption' => 'RAW', 'data' => updates });
        }
        if (!appends.isEmpty()) {
            call('POST', valuesUrl(tab + '!A1') + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
                new Map<String, Object>{ 'values' => appends });
        }
    }

    /**
     * Rewrites all four tabs from Salesforce data (header row + up to 10,000 rows per tab).
     * @return summary text
     */
    public static String syncAll() {
        ensureTabs();
        List<String> summary = new List<String>();
        for (String tab : TABS) {
            List<SObject> records = load(tab, null);
            call('POST', valuesUrl(tab + '!A:Z') + ':clear', new Map<String, Object>());
            List<List<Object>> chunk = new List<List<Object>>{ HEADERS.get(tab) };
            Boolean first = true;
            for (SObject rec : records) {
                chunk.add(toRow(tab, rec));
                if (chunk.size() >= CHUNK_SIZE) {
                    writeChunk(tab, chunk, first);
                    first = false;
                    chunk = new List<List<Object>>();
                }
            }
            if (!chunk.isEmpty()) {
                writeChunk(tab, chunk, first);
            }
            summary.add(tab + ': ' + records.size() + ' rows');
        }
        return String.join(summary, '; ');
    }

    /**
     * Imports Customers, Loans, Payments and Fines from the sheet (in that order).
     * Up to 1,000 rows per tab per run; larger loads should use the file uploader in batches.
     * @return summary text
     */
    public static String importFromSheet() {
        Map<String, List<Map<String, String>>> rowsByTab = new Map<String, List<Map<String, String>>>();
        // All callouts first: no callout is allowed once DML has happened.
        for (String tab : TABS) {
            rowsByTab.put(tab, readTab(tab));
        }
        List<String> summary = new List<String>();
        Boolean previous = CrmTriggerGuard.skipSheetSync;
        CrmTriggerGuard.skipSheetSync = true;
        try {
            for (String tab : TABS) {
                List<Map<String, String>> rows = rowsByTab.get(tab);
                Integer inserted = 0;
                Integer updated = 0;
                Integer errors = 0;
                Integer skipped = 0;
                for (Integer start = 0; start < rows.size(); start += 500) {
                    Integer stop = Math.min(start + 500, rows.size());
                    List<Map<String, String>> part = new List<Map<String, String>>();
                    for (Integer i = start; i < stop; i++) {
                        part.add(rows.get(i));
                    }
                    CrmImportService.ImportResult res = CrmImportService.process(ENTITY_BY_TAB.get(tab), part, false, start + 2);
                    inserted += res.insertedCount;
                    updated += res.updatedCount;
                    errors += res.errorCount;
                    skipped += res.skipCount;
                }
                summary.add(tab + ': ' + inserted + ' new, ' + updated + ' updated, ' + skipped + ' duplicates skipped, ' + errors + ' errors');
            }
        } finally {
            CrmTriggerGuard.skipSheetSync = previous;
        }
        return String.join(summary, '; ');
    }

    // ------------------------------------------------------------- internals

    private static void validateTab(String tab) {
        if (!HEADERS.containsKey(tab)) {
            throw new CrmException('Unknown sheet tab: ' + tab);
        }
    }

    private static void writeChunk(String tab, List<List<Object>> rows, Boolean first) {
        Map<String, Object> body = new Map<String, Object>{ 'values' => rows };
        if (first) {
            call('PUT', valuesUrl(tab + '!A1') + '?valueInputOption=RAW', body);
        } else {
            call('POST', valuesUrl(tab + '!A1') + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', body);
        }
    }

    private static List<Map<String, String>> readTab(String tab) {
        Map<String, Object> data = call('GET', valuesUrl(tab + '!A1:Z' + (IMPORT_ROW_CAP + 1)) + '?valueRenderOption=FORMATTED_VALUE', null);
        List<Map<String, String>> rows = new List<Map<String, String>>();
        List<Object> values = (List<Object>) data.get('values');
        if (values == null || values.size() < 2) {
            return rows;
        }
        List<String> headers = new List<String>();
        for (Object header : (List<Object>) values[0]) {
            headers.add(CrmImportService.normaliseKey(String.valueOf(header)));
        }
        for (Integer i = 1; i < values.size(); i++) {
            List<Object> cells = (List<Object>) values[i];
            Map<String, String> row = new Map<String, String>();
            Boolean hasData = false;
            for (Integer c = 0; c < headers.size(); c++) {
                String cell = c < cells.size() && cells[c] != null ? String.valueOf(cells[c]).trim() : '';
                row.put(headers[c], cell);
                hasData = hasData || String.isNotBlank(cell);
            }
            if (hasData) {
                rows.add(row);
            }
        }
        return rows;
    }

    private static Map<String, Integer> existingRows(String tab) {
        Map<String, Integer> rowById = new Map<String, Integer>();
        Map<String, Object> data = call('GET', valuesUrl(tab + '!A2:A') + '?majorDimension=COLUMNS', null);
        List<Object> columns = (List<Object>) data.get('values');
        if (columns != null && !columns.isEmpty()) {
            List<Object> ids = (List<Object>) columns[0];
            for (Integer i = 0; i < ids.size(); i++) {
                String id = String.valueOf(ids[i]);
                if (String.isNotBlank(id)) {
                    rowById.put(id, i + 2);
                }
            }
        }
        return rowById;
    }

    private static void ensureTabs() {
        if (tabsEnsured) {
            return;
        }
        Map<String, Object> meta = call('GET', spreadsheetUrl() + '?fields=sheets.properties.title', null);
        Set<String> existing = new Set<String>();
        List<Object> sheets = (List<Object>) meta.get('sheets');
        if (sheets != null) {
            for (Object sheet : sheets) {
                Map<String, Object> props = (Map<String, Object>) ((Map<String, Object>) sheet).get('properties');
                existing.add(String.valueOf(props.get('title')));
            }
        }
        List<Object> requests = new List<Object>();
        List<String> created = new List<String>();
        for (String tab : TABS) {
            if (!existing.contains(tab)) {
                requests.add(new Map<String, Object>{
                    'addSheet' => new Map<String, Object>{ 'properties' => new Map<String, Object>{ 'title' => tab } }
                });
                created.add(tab);
            }
        }
        if (!requests.isEmpty()) {
            call('POST', spreadsheetUrl() + ':batchUpdate', new Map<String, Object>{ 'requests' => requests });
            for (String tab : created) {
                call('PUT', valuesUrl(tab + '!A1') + '?valueInputOption=RAW',
                    new Map<String, Object>{ 'values' => new List<Object>{ HEADERS.get(tab) } });
            }
        }
        tabsEnsured = true;
    }

    private static List<SObject> load(String tab, Set<Id> ids) {
        String base = SELECTS.get(tab);
        if (ids == null) {
            return Database.query(base + ' ORDER BY CreatedDate, Id LIMIT ' + MAX_ROWS);
        }
        return Database.query(base + ' WHERE Id IN :ids');
    }

    private static List<Object> toRow(String tab, SObject r) {
        if (tab == 'Customers') {
            return new List<Object>{ String.valueOf(r.Id), nz(r.get('S_No__c')), nz(r.get('Full_Name__c')), nz(r.get('Mobile__c')), nz(r.get('Location__c')), nz(r.get('Notes__c')) };
        } else if (tab == 'Loans') {
            return new List<Object>{
                String.valueOf(r.Id), nz(r.get('Loan_Code__c')), related(r, 'Borrower__r', 'S_No__c'), nz(r.get('Repayment_Type__c')),
                nz(r.get('Principal__c')), nz(r.get('Interest_Rate__c')), nz(r.get('Total_Payable__c')), nz(r.get('Total_Paid__c')),
                nz(r.get('Outstanding_Due__c')), dateText(r.get('Disbursement_Date__c')), nz(r.get('Status__c'))
            };
        } else if (tab == 'Payments') {
            return new List<Object>{
                String.valueOf(r.Id), related(r, 'Loan_Account__r', 'Loan_Code__c'), related(r, 'Borrower__r', 'S_No__c'), nz(r.get('Amount__c')),
                dateText(r.get('Payment_Date__c')), nz(r.get('Payment_Method__c')), nz(r.get('Reference_No__c')), nz(r.get('Collected_By__c'))
            };
        }
        return new List<Object>{
            String.valueOf(r.Id), related(r, 'Loan_Account__r', 'Loan_Code__c'), related(r, 'Borrower__r', 'S_No__c'),
            nz(r.get('Fine_Amount__c')), nz(r.get('Reason__c')), dateText(r.get('Fine_Date__c'))
        };
    }

    private static Object nz(Object value) {
        return value == null ? '' : value;
    }

    private static Object related(SObject r, String relationship, String field) {
        SObject parent = r.getSObject(relationship);
        return parent == null ? '' : nz(parent.get(field));
    }

    private static String dateText(Object value) {
        return value == null ? '' : CrmUtil.formatDate((Date) value);
    }

    private static String columnLetter(Integer index) {
        return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.substring(index - 1, index);
    }

    private static String spreadsheetUrl() {
        return API_BASE + requireConfig().Spreadsheet_Id__c;
    }

    private static String valuesUrl(String range) {
        return spreadsheetUrl() + '/values/' + EncodingUtil.urlEncode(range, 'UTF-8');
    }

    private static CRM_Config__c requireConfig() {
        CRM_Config__c config = CrmConfig.get();
        if (config == null || String.isBlank(config.Spreadsheet_Id__c) || String.isBlank(config.Service_Account_Email__c) || String.isBlank(config.Private_Key__c)) {
            throw new CrmException('Google Sheets is not configured. Save the Spreadsheet ID, service account email and private key in Settings.');
        }
        return config;
    }

    // ------------------------------------------------------------------ HTTP

    private static Map<String, Object> call(String method, String url, Object body) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint(url);
        req.setMethod(method);
        req.setTimeout(60000);
        req.setHeader('Authorization', 'Bearer ' + token());
        if (body != null) {
            req.setHeader('Content-Type', 'application/json');
            req.setBody(JSON.serialize(body));
        }
        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() >= 300) {
            throw new CrmException('Google Sheets error ' + res.getStatusCode() + ': ' + googleError(res.getBody()));
        }
        if (String.isBlank(res.getBody())) {
            return new Map<String, Object>();
        }
        return (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
    }

    private static String googleError(String body) {
        try {
            Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(body);
            Object err = parsed.get('error');
            if (err instanceof Map<String, Object>) {
                return String.valueOf(((Map<String, Object>) err).get('message'));
            }
            return String.valueOf(parsed.get('error_description') ?? err);
        } catch (Exception e) {
            return body == null ? 'unknown' : body.left(200);
        }
    }

    private static String token() {
        if (accessToken != null) {
            return accessToken;
        }
        CRM_Config__c config = requireConfig();
        Long now = System.now().getTime() / 1000;
        String header = base64Url(Blob.valueOf('{"alg":"RS256","typ":"JWT"}'));
        String claims = base64Url(Blob.valueOf(JSON.serialize(new Map<String, Object>{
            'iss' => config.Service_Account_Email__c,
            'scope' => 'https://www.googleapis.com/auth/spreadsheets',
            'aud' => TOKEN_URL,
            'iat' => now,
            'exp' => now + 3600
        })));
        String unsigned = header + '.' + claims;
        Blob signature;
        try {
            signature = Crypto.sign('RSA-SHA256', Blob.valueOf(unsigned), EncodingUtil.base64Decode(cleanKey(config.Private_Key__c)));
        } catch (Exception e) {
            throw new CrmException('The private key is not a valid PKCS8 key: ' + e.getMessage());
        }
        HttpRequest req = new HttpRequest();
        req.setEndpoint(TOKEN_URL);
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/x-www-form-urlencoded');
        req.setTimeout(60000);
        req.setBody('grant_type=' + EncodingUtil.urlEncode('urn:ietf:params:oauth:grant-type:jwt-bearer', 'UTF-8') + '&assertion=' + unsigned + '.' + base64Url(signature));
        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() != 200) {
            throw new CrmException('Google sign-in failed: ' + googleError(res.getBody()));
        }
        accessToken = String.valueOf(((Map<String, Object>) JSON.deserializeUntyped(res.getBody())).get('access_token'));
        return accessToken;
    }

    private static String cleanKey(String pem) {
        return pem.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '')
            .replace('\\n', '').replaceAll('\\s', '');
    }

    private static String base64Url(Blob value) {
        return EncodingUtil.base64Encode(value).replace('+', '-').replace('/', '_').replace('=', '');
    }
}
