// Row ids made on the device, so a record created offline has its real id at
// once (edits, steps, comments can point at it before it syncs). Every Cargo
// table uses uuid ids with a gen_random_uuid() default, so a client v4 uuid is
// accepted as-is. crypto.randomUUID needs a secure context, which an app web
// view may not count as — fall back to getRandomValues.

export function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try { return crypto.randomUUID(); } catch { /* not a secure context */ }
  }
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
