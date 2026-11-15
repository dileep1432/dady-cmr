/**
 * Custom login, stateless signed session tokens, permission checks and staff management.
 * Runs without sharing on purpose: callers are authenticated by the custom token and every
 * method checks the CRM permission checkboxes before touching data.
 */
public without sharing class AuthController {
    public static final String PERM_ANY = 'ANY';
    public static final String PERM_ADD_COLLECTION = 'ADD_COLLECTION';
    public static final String PERM_EDIT_RECORDS = 'EDIT_RECORDS';
    public static final String PERM_ADD_FINES = 'ADD_FINES';
    public static final String PERM_DELETE_LOANS = 'DELETE_LOANS';
    public static final String PERM_SUPER_ADMIN = 'SUPER_ADMIN';

    private static final Integer HASH_ITERATIONS = 3000;
    private static final Integer SESSION_MINUTES = 720;
    private static final Integer MAX_FAILED_ATTEMPTS = 5;
    private static final Integer LOCK_MINUTES = 15;
    private static final String SESSION_EXPIRED = 'SESSION_EXPIRED: Please log in again.';

    /** Information returned to the browser after login. Never contains the password hash. */
    public class SessionInfo {
        @AuraEnabled public String token;
        @AuraEnabled public String userId;
        @AuraEnabled public String fullName;
        @AuraEnabled public String loginId;
        @AuraEnabled public String role;
        @AuraEnabled public Boolean isSuperAdmin;
        @AuraEnabled public Boolean viewOnly;
        @AuraEnabled public Boolean canAddCollection;
        @AuraEnabled public Boolean canEditRecords;
        @AuraEnabled public Boolean canAddFines;
        @AuraEnabled public Boolean canDeleteLoans;
    }

    /** Staff record as exchanged with the user management panel. */
    public class StaffDTO {
        @AuraEnabled public String id;
        @AuraEnabled public String fullName;
        @AuraEnabled public String loginId;
        @AuraEnabled public String password;
        @AuraEnabled public String role;
        @AuraEnabled public Boolean isActive;
        @AuraEnabled public Boolean canViewOnly;
        @AuraEnabled public Boolean canAddCollection;
        @AuraEnabled public Boolean canEditRecords;
        @AuraEnabled public Boolean canAddFines;
        @AuraEnabled public Boolean canDeleteLoans;
        @AuraEnabled public String lastLogin;
    }

    // ------------------------------------------------------------------ login

    /**
     * Verifies Login ID and password and returns a signed session token.
     * @param loginId staff login id
     * @param password plain text password
     * @return session information
     */
    @AuraEnabled
    public static SessionInfo login(String loginId, String password) {
        if (String.isBlank(loginId) || String.isBlank(password)) {
            CrmUtil.fail('Enter your Login ID and password.');
        }
        List<CRM_Staff_User__c> users = [
            SELECT Id, Full_Name__c, Login_ID__c, Password_Hash__c, Role__c, Is_Active__c, Can_View_Only__c,
                   Can_Add_Collection__c, Can_Edit_Records__c, Can_Add_Fines__c, Can_Delete_Loans__c,
                   Failed_Attempts__c, Locked_Until__c
            FROM CRM_Staff_User__c
            WHERE Login_ID__c = :loginId.trim()
            LIMIT 1
        ];
        if (users.isEmpty() || users[0].Is_Active__c != true) {
            CrmUtil.fail('Invalid Login ID or password.');
        }
        CRM_Staff_User__c user = users[0];
        if (user.Locked_Until__c != null && user.Locked_Until__c > System.now()) {
            CrmUtil.fail('Too many failed attempts. Try again in a few minutes.');
        }
        if (!verifyPassword(user.Password_Hash__c, password)) {
            Integer attempts = Integer.valueOf(user.Failed_Attempts__c == null ? 0 : user.Failed_Attempts__c) + 1;
            if (attempts >= MAX_FAILED_ATTEMPTS) {
                user.Locked_Until__c = System.now().addMinutes(LOCK_MINUTES);
                attempts = 0;
            }
            user.Failed_Attempts__c = attempts;
            update user;
            CrmUtil.fail('Invalid Login ID or password.');
        }
        user.Failed_Attempts__c = 0;
        user.Locked_Until__c = null;
        user.Last_Login__c = System.now();
        update user;
        return buildSession(user, issueToken(user.Id, SESSION_MINUTES, 'S', null));
    }

    /**
     * Checks that a token is still valid and refreshes the user's permissions.
     * @param token session token
     * @return session information with a fresh token
     */
    @AuraEnabled
    public static SessionInfo validateSession(String token) {
        CRM_Staff_User__c user = requireUser(token);
        return buildSession(user, issueToken(user.Id, SESSION_MINUTES, 'S', null));
    }

    /**
     * Lets a user change their own password.
     * @param token session token
     * @param oldPassword current password
     * @param newPassword new password (min 8 chars)
     */
    @AuraEnabled
    public static void changeMyPassword(String token, String oldPassword, String newPassword) {
        CRM_Staff_User__c user = requireUser(token);
        if (!verifyPassword(user.Password_Hash__c, oldPassword)) {
            CrmUtil.fail('Current password is incorrect.');
        }
        validatePasswordStrength(newPassword);
        user.Password_Hash__c = hashPassword(newPassword);
        update user;
    }

    // --------------------------------------------------------- permission API

    /**
     * Validates the token and the required permission.
     * @param token session token
     * @param permission one of the PERM_ constants
     * @return the active staff user
     */
    public static CRM_Staff_User__c require(String token, String permission) {
        CRM_Staff_User__c user = requireUser(token);
        if (!hasPermission(user, permission)) {
            CrmUtil.fail('You do not have permission to do this.');
        }
        return user;
    }

    /**
     * @param user staff user
     * @param permission PERM_ constant
     * @return true when allowed. Super Admin is always allowed; View Only blocks every write.
     */
    public static Boolean hasPermission(CRM_Staff_User__c user, String permission) {
        if (user.Role__c == 'Super Admin' || permission == PERM_ANY) {
            return true;
        }
        if (permission == PERM_SUPER_ADMIN || user.Can_View_Only__c == true) {
            return false;
        }
        if (permission == PERM_ADD_COLLECTION) {
            return user.Can_Add_Collection__c == true;
        }
        if (permission == PERM_EDIT_RECORDS) {
            return user.Can_Edit_Records__c == true;
        }
        if (permission == PERM_ADD_FINES) {
            return user.Can_Add_Fines__c == true;
        }
        if (permission == PERM_DELETE_LOANS) {
            return user.Can_Delete_Loans__c == true;
        }
        return false;
    }

    private static CRM_Staff_User__c requireUser(String token) {
        Map<String, Object> payload = verifyToken(token, 'S');
        Id userId = Id.valueOf(String.valueOf(payload.get('u')));
        List<CRM_Staff_User__c> users = [
            SELECT Id, Full_Name__c, Login_ID__c, Role__c, Is_Active__c, Can_View_Only__c,
                   Can_Add_Collection__c, Can_Edit_Records__c, Can_Add_Fines__c, Can_Delete_Loans__c, Password_Hash__c
            FROM CRM_Staff_User__c
            WHERE Id = :userId
            LIMIT 1
        ];
        if (users.isEmpty() || users[0].Is_Active__c != true) {
            CrmUtil.fail(SESSION_EXPIRED);
        }
        return users[0];
    }

    private static SessionInfo buildSession(CRM_Staff_User__c user, String token) {
        SessionInfo info = new SessionInfo();
        info.token = token;
        info.userId = user.Id;
        info.fullName = user.Full_Name__c;
        info.loginId = user.Login_ID__c;
        info.role = user.Role__c;
        info.isSuperAdmin = user.Role__c == 'Super Admin';
        info.viewOnly = !info.isSuperAdmin && user.Can_View_Only__c == true;
        info.canAddCollection = hasPermission(user, PERM_ADD_COLLECTION);
        info.canEditRecords = hasPermission(user, PERM_EDIT_RECORDS);
        info.canAddFines = hasPermission(user, PERM_ADD_FINES);
        info.canDeleteLoans = hasPermission(user, PERM_DELETE_LOANS);
        return info;
    }

    // ----------------------------------------------------------------- tokens

    /**
     * Issues an HMAC-signed token.
     * @param userId staff user id
     * @param minutes lifetime in minutes
     * @param type S for session, P for PDF statement
     * @param borrowerId optional borrower id (PDF tokens)
     * @return token string payload.signature
     */
    public static String issueToken(Id userId, Integer minutes, String type, Id borrowerId) {
        Map<String, Object> payload = new Map<String, Object>{
            'u' => userId,
            't' => type,
            'e' => System.now().getTime() + (minutes * 60000L)
        };
        if (borrowerId != null) {
            payload.put('b', borrowerId);
        }
        String body = base64Url(Blob.valueOf(JSON.serialize(payload)));
        return body + '.' + sign(body);
    }

    /**
     * Validates signature, type and expiry.
     * @param token token string
     * @param type expected type
     * @return decoded payload
     */
    public static Map<String, Object> verifyToken(String token, String type) {
        if (String.isBlank(token) || !token.contains('.')) {
            CrmUtil.fail(SESSION_EXPIRED);
        }
        List<String> parts = token.split('\\.');
        if (parts.size() != 2 || !constantTimeEquals(sign(parts[0]), parts[1])) {
            CrmUtil.fail(SESSION_EXPIRED);
        }
        Map<String, Object> payload;
        try {
            payload = (Map<String, Object>) JSON.deserializeUntyped(base64UrlDecode(parts[0]).toString());
        } catch (Exception e) {
            CrmUtil.fail(SESSION_EXPIRED);
        }
        Long expires = Long.valueOf(String.valueOf(payload.get('e')));
        if (expires < System.now().getTime() || String.valueOf(payload.get('t')) != type) {
            CrmUtil.fail(SESSION_EXPIRED);
        }
        return payload;
    }

    private static String sign(String body) {
        CRM_Config__c config = CrmConfig.get();
        if (config == null || String.isBlank(config.Token_Secret__c)) {
            CrmUtil.fail('CRM is not initialised. Run DatabaseInitializer.run() first.');
        }
        Blob mac = Crypto.generateMac('hmacSHA256', Blob.valueOf(body), Blob.valueOf(config.Token_Secret__c));
        return base64Url(mac);
    }

    private static String base64Url(Blob value) {
        return EncodingUtil.base64Encode(value).replace('+', '-').replace('/', '_').replace('=', '');
    }

    private static Blob base64UrlDecode(String value) {
        String padded = value.replace('-', '+').replace('_', '/');
        while (Math.mod(padded.length(), 4) != 0) {
            padded += '=';
        }
        return EncodingUtil.base64Decode(padded);
    }

    private static Boolean constantTimeEquals(String a, String b) {
        if (a == null || b == null || a.length() != b.length()) {
            return false;
        }
        Integer diff = 0;
        for (Integer i = 0; i < a.length(); i++) {
            diff += (a.charAt(i) == b.charAt(i)) ? 0 : 1;
        }
        return diff == 0;
    }

    // -------------------------------------------------------------- passwords

    /**
     * Creates a salted, iterated SHA-256 hash.
     * @param password plain text password
     * @return v1$iterations$salt$hash
     */
    public static String hashPassword(String password) {
        String salt = EncodingUtil.convertToHex(Crypto.generateAesKey(128));
        return 'v1$' + HASH_ITERATIONS + '$' + salt + '$' + derive(password, salt, HASH_ITERATIONS);
    }

    /**
     * @param stored stored hash text
     * @param password candidate password
     * @return true when the password matches
     */
    public static Boolean verifyPassword(String stored, String password) {
        if (String.isBlank(stored) || password == null) {
            return false;
        }
        List<String> parts = stored.split('\\$');
        if (parts.size() != 4 || parts[0] != 'v1') {
            return false;
        }
        return constantTimeEquals(derive(password, parts[2], Integer.valueOf(parts[1])), parts[3]);
    }

    private static String derive(String password, String salt, Integer iterations) {
        Blob digest = Crypto.generateDigest('SHA-256', Blob.valueOf(salt + password));
        for (Integer i = 1; i < iterations; i++) {
            digest = Crypto.generateDigest('SHA-256', Blob.valueOf(EncodingUtil.convertToHex(digest) + password));
        }
        return EncodingUtil.convertToHex(digest);
    }

    private static void validatePasswordStrength(String password) {
        if (String.isBlank(password) || password.length() < 8) {
            CrmUtil.fail('Password must be at least 8 characters.');
        }
    }

    // ------------------------------------------------------- staff management

    /**
     * Lists staff accounts (Super Admin only).
     * @param token session token
     * @return staff list without password hashes
     */
    @AuraEnabled
    public static List<StaffDTO> listStaff(String token) {
        require(token, PERM_SUPER_ADMIN);
        List<StaffDTO> result = new List<StaffDTO>();
        for (CRM_Staff_User__c u : [
            SELECT Id, Full_Name__c, Login_ID__c, Role__c, Is_Active__c, Can_View_Only__c, Can_Add_Collection__c,
                   Can_Edit_Records__c, Can_Add_Fines__c, Can_Delete_Loans__c, Last_Login__c
            FROM CRM_Staff_User__c
            ORDER BY Full_Name__c
            LIMIT 500
        ]) {
            StaffDTO dto = new StaffDTO();
            dto.id = u.Id;
            dto.fullName = u.Full_Name__c;
            dto.loginId = u.Login_ID__c;
            dto.role = u.Role__c;
            dto.isActive = u.Is_Active__c;
            dto.canViewOnly = u.Can_View_Only__c;
            dto.canAddCollection = u.Can_Add_Collection__c;
            dto.canEditRecords = u.Can_Edit_Records__c;
            dto.canAddFines = u.Can_Add_Fines__c;
            dto.canDeleteLoans = u.Can_Delete_Loans__c;
            dto.lastLogin = u.Last_Login__c == null ? '' : CrmUtil.formatDate(u.Last_Login__c.date());
            result.add(dto);
        }
        return result;
    }

    /**
     * Creates or updates a staff account (Super Admin only). A blank password keeps the existing one.
     * @param token session token
     * @param staff staff data
     * @return record id
     */
    @AuraEnabled
    public static String saveStaff(String token, StaffDTO staff) {
        CRM_Staff_User__c admin = require(token, PERM_SUPER_ADMIN);
        if (staff == null || String.isBlank(staff.fullName) || String.isBlank(staff.loginId)) {
            CrmUtil.fail('Full name and Login ID are required.');
        }
        if (staff.role != 'Super Admin' && staff.role != 'Staff') {
            CrmUtil.fail('Choose a valid role.');
        }
        CRM_Staff_User__c record = new CRM_Staff_User__c();
        Boolean isNew = String.isBlank(staff.id);
        if (!isNew) {
            record.Id = staff.id;
            if (record.Id == admin.Id && (staff.isActive != true || staff.role != 'Super Admin')) {
                CrmUtil.fail('You cannot deactivate or demote your own account.');
            }
        }
        if (isNew || String.isNotBlank(staff.password)) {
            validatePasswordStrength(staff.password);
            record.Password_Hash__c = hashPassword(staff.password);
        }
        record.Name = staff.fullName.trim().left(80);
        record.Full_Name__c = staff.fullName.trim();
        record.Login_ID__c = staff.loginId.trim();
        record.Role__c = staff.role;
        record.Is_Active__c = staff.isActive == true;
        record.Can_View_Only__c = staff.canViewOnly == true;
        record.Can_Add_Collection__c = staff.canAddCollection == true;
        record.Can_Edit_Records__c = staff.canEditRecords == true;
        record.Can_Add_Fines__c = staff.canAddFines == true;
        record.Can_Delete_Loans__c = staff.canDeleteLoans == true;
        if (!isNew && record.Is_Active__c == true) {
            record.Failed_Attempts__c = 0;
            record.Locked_Until__c = null;
        }
        try {
            upsert record;
        } catch (DmlException e) {
            CrmUtil.fail(e.getDmlMessage(0));
        }
        return record.Id;
    }
}
