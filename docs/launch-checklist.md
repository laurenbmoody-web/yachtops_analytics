# Launch checklist

Things that must change when Cargo moves off the temporary Netlify URL onto the
production domain. Keep this list current as launch-blocking config accrues.

## Passkeys — switch the WebAuthn relying party to the real domain

Passkeys are cryptographically bound to the **Relying Party (RP) ID**. They are
currently configured against the temporary `*.netlify.app` URL for testing, which
means every enrolled passkey is throwaway — changing the RP ID invalidates them
(fine for now: the only enrolled passkey is the developer's own).

**At launch (app served from `app.cargotechnology.co.uk`):**

Supabase Dashboard → **Authentication → Passkeys**:

| Field | Testing (now) | Production (launch) |
| --- | --- | --- |
| RP Display Name | `Cargo` | `Cargo` |
| RP ID | `<your-site>.netlify.app` | `cargotechnology.co.uk` |
| RP Origins | `https://<your-site>.netlify.app` | `https://app.cargotechnology.co.uk` |

Notes:
- **RP ID = the bare apex `cargotechnology.co.uk`**, *not* `app.cargotechnology.co.uk`.
  Scoping to the apex keeps passkeys valid across the apex and every subdomain, so
  they survive any future subdomain move. `app.…` is a subdomain of the apex, which
  is exactly the relationship WebAuthn requires.
- **RP Origins lists only the app origin** (`https://app.cargotechnology.co.uk`).
  The marketing site on the apex never runs a WebAuthn ceremony, so it's never
  involved.
- Change **both** RP ID and RP Origins together. Doing so invalidates the test
  passkey enrolled against Netlify — expected.
- No code change needed: the client opt-in (`auth.experimental.passkey`) and the
  register / sign-in / list / delete wiring are already in place. This is
  dashboard config only.
