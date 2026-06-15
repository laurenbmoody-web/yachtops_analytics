// Centralised European date formatting + parsing (dd/mm/yyyy).
// Storage/transport stays ISO (yyyy-mm-dd); only display/entry is localised.

/** ISO 'yyyy-mm-dd' (or any Date-parseable value) → 'dd/mm/yyyy'. */
export const isoToUK = (iso) => {
  if (!iso) return '';
  const s = String(iso).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

/** 'dd/mm/yyyy' → ISO 'yyyy-mm-dd' ('' if incomplete/invalid). */
export const ukToISO = (uk) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(uk || '').trim());
  if (!m) return '';
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  const yyyy = m[3];
  const day = Number(dd);
  const mon = Number(mm);
  if (mon < 1 || mon > 12 || day < 1 || day > 31) return '';
  return `${yyyy}-${mm}-${dd}`;
};

/** Any date value → 'dd/mm/yyyy' (en-GB). Empty/invalid → ''. */
export const formatDate = (value) => {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

/** Any date value → 'dd Mon yyyy' (en-GB). Empty/invalid → ''. */
export const formatDateLong = (value) => {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
