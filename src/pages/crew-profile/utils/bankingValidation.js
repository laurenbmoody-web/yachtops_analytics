// Light, non-blocking format checks for banking fields — they surface a
// warning to catch typos that would otherwise bounce a wage payment.
// They never block saving (formats vary by country / edge cases).

const clean = (v) => String(v || '').replace(/\s+/g, '').toUpperCase();

/** Heuristic: a value that opens with two letters is treated as an IBAN. */
export const looksLikeIBAN = (v) => /^[A-Z]{2}/.test(clean(v));

/** Structural + mod-97 checksum validation of an IBAN. */
export const isValidIBAN = (v) => {
  const s = clean(v);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  // Move the first four chars to the end, convert letters → numbers, mod 97.
  const rearranged = s.slice(4) + s.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => (c.charCodeAt(0) - 55).toString());
  let remainder = 0;
  for (const ch of numeric) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder === 1;
};

/** SWIFT/BIC: 8 or 11 chars — 6 letters, 2 alphanumeric, optional 3. */
export const isValidSWIFT = (v) => /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(clean(v));

/** Returns a warning string for the account/IBAN field, or '' if fine. */
export const ibanWarning = (v) => {
  if (!v) return '';
  if (looksLikeIBAN(v) && !isValidIBAN(v)) return "Doesn't look like a valid IBAN — check for typos.";
  return '';
};

/** Returns a warning string for the SWIFT/BIC field, or '' if fine. */
export const swiftWarning = (v) => {
  if (!v) return '';
  if (!isValidSWIFT(v)) return "Doesn't look like a valid SWIFT/BIC (8 or 11 characters).";
  return '';
};
