// A visitor's gangway pass is a self-contained QR — it carries their name,
// company and phone, so scanning it at the door signs them back in with no
// lookup and no re-typing (works even on a fresh day). Prefix distinguishes it
// from a crew pass (cargo-pass:<userId>).
const b64e = (s) => btoa(unescape(encodeURIComponent(s)));
const b64d = (b) => decodeURIComponent(escape(atob(b)));

export const encodeVisitorPass = (v) =>
  `cargo-visitor:${b64e(JSON.stringify({ n: v?.name || '', c: v?.company || '', p: v?.phone || '' }))}`;

export const decodeVisitorPass = (payload) => {
  try {
    const j = JSON.parse(b64d(String(payload || '')));
    return { name: j.n || '', company: j.c || '', phone: j.p || '' };
  } catch { return null; }
};
