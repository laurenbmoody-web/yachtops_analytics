// Centralised date/time formatting + parsing.
// Storage/transport stays ISO (yyyy-mm-dd); only display/entry is localised.
//
// Display respects the user's Regional settings (Settings → Regional):
//   date_format  'dmy' (default, dd/mm/yyyy) | 'mdy' (mm/dd/yyyy)
//   time_24h     'true' → 24-hour clock, else 12-hour with am/pm
//   first_day    'mon' (default) | 'sun'
// These are read from localStorage and cached; the cache refreshes when the
// settings page dispatches 'cargo:prefs-changed' or another tab writes them.
// NOTE: date ENTRY (isoToUK/ukToISO masked inputs) stays dd/mm/yyyy regardless,
// so changing the display format never breaks date typing.

let _datePref = null;
let _timePref = null;
const _readDate = () => {
  try { return localStorage.getItem('date_format') || 'dmy'; } catch { return 'dmy'; }
};
const _read24 = () => {
  try { return localStorage.getItem('time_24h') === 'true'; } catch { return false; }
};
const datePref = () => (_datePref == null ? (_datePref = _readDate()) : _datePref);
const is24h = () => (_timePref == null ? (_timePref = _read24()) : _timePref);

/** 0 = Sunday, 1 = Monday (default) — for calendars/week grids. */
export const weekStartsOn = () => {
  try { return localStorage.getItem('first_day') === 'sun' ? 0 : 1; } catch { return 1; }
};

/** Short weekday header labels ordered by the user's first-day setting,
 *  e.g. ['Mon',…,'Sun'] or ['Sun',…,'Sat']. */
export const weekdayLabelsShort = () => {
  const base = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const s = weekStartsOn();
  return Array.from({ length: 7 }, (_, i) => base[(i + s) % 7]);
};

if (typeof window !== 'undefined') {
  const refresh = () => { _datePref = _readDate(); _timePref = _read24(); };
  window.addEventListener('cargo:prefs-changed', refresh);
  window.addEventListener('storage', (e) => {
    if (!e || e.key == null || e.key === 'date_format' || e.key === 'time_24h') refresh();
  });
}

/** Locale that matches the date-order preference — 'en-GB' (dd/mm) or
 *  'en-US' (mm/dd). Pass to toLocaleDateString so a display keeps its chosen
 *  option set (numeric, short-month, weekday…) while the order follows the pref. */
export const dateLocale = () => (datePref() === 'mdy' ? 'en-US' : 'en-GB');

/** The order the masked date inputs use — for placeholders. */
export const datePlaceholder = () => (datePref() === 'mdy' ? 'mm/dd/yyyy' : 'dd/mm/yyyy');

/** date-fns display/parse pattern matching the date-order preference. */
export const dateFnsFormat = () => (datePref() === 'mdy' ? 'MM/dd/yyyy' : 'dd/MM/yyyy');

/** ISO 'yyyy-mm-dd' (or any Date-parseable value) → masked local order
 *  ('dd/mm/yyyy' or 'mm/dd/yyyy' per the date pref). */
export const isoToUK = (iso) => {
  if (!iso) return '';
  const s = String(iso).slice(0, 10);
  let yyyy, mm, dd;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) { yyyy = m[1]; mm = m[2]; dd = m[3]; }
  else {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    yyyy = String(d.getFullYear());
    mm = String(d.getMonth() + 1).padStart(2, '0');
    dd = String(d.getDate()).padStart(2, '0');
  }
  return datePref() === 'mdy' ? `${mm}/${dd}/${yyyy}` : `${dd}/${mm}/${yyyy}`;
};

/** Masked local order ('dd/mm/yyyy' or 'mm/dd/yyyy' per pref) → ISO
 *  'yyyy-mm-dd' ('' if incomplete/invalid). Parsing follows the same pref so
 *  typing in the user's own order round-trips correctly. */
export const ukToISO = (uk) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(uk || '').trim());
  if (!m) return '';
  const yyyy = m[3];
  // First/second field are day/month in DMY, month/day in MDY.
  const dd = (datePref() === 'mdy' ? m[2] : m[1]).padStart(2, '0');
  const mm = (datePref() === 'mdy' ? m[1] : m[2]).padStart(2, '0');
  const day = Number(dd);
  const mon = Number(mm);
  if (mon < 1 || mon > 12 || day < 1 || day > 31) return '';
  return `${yyyy}-${mm}-${dd}`;
};

/** Any date value → 'dd/mm/yyyy' (or 'mm/dd/yyyy' if the user chose MDY). */
export const formatDate = (value) => {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(dateLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' });
};

/** Any date value → 'dd Mon yyyy' (month/day order follows the date pref). */
export const formatDateLong = (value) => {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(dateLocale(), { day: '2-digit', month: 'short', year: 'numeric' });
};

/** Any date value → 'HH:MM' (24h) or 'H:MM am/pm' (12h) per the time pref. */
export const formatTime = (value) => {
  if (value == null || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: !is24h() });
};

/** Date + time, e.g. 'dd/mm/yyyy · 15:42'. Empty/invalid → ''. */
export const formatDateTime = (value) => {
  const date = formatDate(value);
  const time = formatTime(value);
  if (!date) return '';
  return time ? `${date} · ${time}` : date;
};
