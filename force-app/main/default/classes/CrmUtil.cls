/**
 * Shared helpers: dates (DD-MM-YYYY), numbers, S.No normalisation, error raising.
 */
public without sharing class CrmUtil {
    private static final Pattern DMY = Pattern.compile('^(\\d{1,2})[-/.](\\d{1,2})[-/.](\\d{4})$');
    private static final Pattern YMD = Pattern.compile('^(\\d{4})-(\\d{1,2})-(\\d{1,2}).*$');
    private static final Pattern SERIAL = Pattern.compile('^\\d{5}(\\.\\d+)?$');

    /**
     * Raises an AuraHandledException whose message reaches the browser.
     * @param message user facing message
     */
    public static void fail(String message) {
        AuraHandledException ex = new AuraHandledException(message);
        ex.setMessage(message);
        throw ex;
    }

    /**
     * Removes leading zeros from an S.No (e.g. 008 becomes 8, W009 is unchanged).
     * @param sNo raw serial number
     * @return normalised serial number
     */
    public static String stripLeadingZeros(String sNo) {
        if (sNo == null) {
            return null;
        }
        String trimmed = sNo.trim();
        if (trimmed.length() > 1 && trimmed.startsWith('0')) {
            trimmed = trimmed.replaceFirst('^0+(?=.)', '');
        }
        return trimmed;
    }

    /**
     * Parses DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD or an Excel serial number.
     * @param raw text to parse
     * @return the date, or null when blank
     * @throws CrmException when the text is not a valid date
     */
    public static Date parseDate(String raw) {
        if (String.isBlank(raw)) {
            return null;
        }
        String text = raw.trim();
        try {
            Matcher dmy = DMY.matcher(text);
            if (dmy.matches()) {
                return Date.newInstance(Integer.valueOf(dmy.group(3)), Integer.valueOf(dmy.group(2)), Integer.valueOf(dmy.group(1)));
            }
            Matcher ymd = YMD.matcher(text);
            if (ymd.matches()) {
                return Date.newInstance(Integer.valueOf(ymd.group(1)), Integer.valueOf(ymd.group(2)), Integer.valueOf(ymd.group(3)));
            }
            if (SERIAL.matcher(text).matches()) {
                Integer serial = Integer.valueOf(text.substringBefore('.'));
                return Date.newInstance(1899, 12, 30).addDays(serial);
            }
        } catch (Exception e) {
            throw new CrmException('Invalid date: ' + text);
        }
        throw new CrmException('Invalid date (use DD-MM-YYYY): ' + text);
    }

    /**
     * @param d a date
     * @return DD-MM-YYYY text, or empty string
     */
    public static String formatDate(Date d) {
        if (d == null) {
            return '';
        }
        return String.valueOf(d.day()).leftPad(2, '0') + '-' + String.valueOf(d.month()).leftPad(2, '0') + '-' + d.year();
    }

    /**
     * Parses a decimal, ignoring commas, spaces and currency symbols.
     * @param raw text
     * @return decimal or null when blank
     * @throws CrmException when not numeric
     */
    public static Decimal parseDecimal(String raw) {
        if (String.isBlank(raw)) {
            return null;
        }
        String cleaned = raw.replaceAll('[,\\s\\u20B9]', '').replace('Rs.', '').replace('Rs', '');
        try {
            return Decimal.valueOf(cleaned);
        } catch (Exception e) {
            throw new CrmException('Invalid number: ' + raw);
        }
    }

    /**
     * @param value decimal
     * @return value rounded to 2 places (null becomes 0)
     */
    public static Decimal round2(Decimal value) {
        return (value == null ? 0 : value).setScale(2, RoundingMode.HALF_UP);
    }

    /**
     * Start of the current week, where weeks run Sunday to Saturday (locale independent).
     * @param d any date
     * @return the Sunday on or before d
     */
    public static Date weekStart(Date d) {
        Integer dayOfWeek = Math.mod(Date.newInstance(1900, 1, 7).daysBetween(d), 7);
        return d.addDays(-dayOfWeek);
    }
}
