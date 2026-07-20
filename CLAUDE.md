# Cargo — project guidance for Claude

## Workflow rule — always land work on `main`

After completing a task and pushing the feature branch, **always get the work
onto `main`** (don't leave it sitting on the branch). Merges here go through a
PR, so: push the branch, then open and merge a PR into `main` unless the user
says otherwise.

Once the PR is merged, **resync the feature branch so it shows 0 ahead / 0
behind `main`** — don't leave the branch diverged. After a squash merge:
`git fetch origin main && git reset --hard origin/main && git push
--force-with-lease`, then confirm with `git rev-list --left-right --count
origin/main...HEAD` (expect `0  0`).

## Migrations rule — no clashing version timestamps

Two migration files sharing the same 14-digit version prefix break `supabase db
push` (it keys migrations by version). This happens constantly when two branches
cut a migration at the same timestamp. **Before pushing any new migration**, run:

```
ls supabase/migrations | grep -E '^[0-9]{14}_' | sed -E 's/_.*//' | sort | uniq -d
```

If it prints anything, bump your migration's 14-digit timestamp so it is unique
**and later than every existing file**, then update its `schema_migrations`
ledger row to match. Re-run the check after every `git reset --hard origin/main`
resync — a concurrent branch may have taken your timestamp. The
`migration-version-guard` CI workflow enforces this on PRs, but catch it locally
first. When you apply a migration via the Supabase MCP, also insert its ledger
row (`insert into supabase_migrations.schema_migrations (version, name) …`) so CI
skips it instead of re-running.

## UI rule — always build in the editorial (Cargo) design system

Any new or rebuilt UI (page, modal, drawer, widget, card) MUST use the editorial
system below — never the old boxed tailwind look (`bg-card border border-border
rounded-lg`, grey chips, `bg-red-100` badges, `27 Jun 2026` dates). If you touch
an old-styled surface, bring it up to this system.

**Palette**
- Navy ink (text/headings): `#1C1B3A`
- Terracotta accent (primary actions, selected, emphasis): `#C65A1A` (hover `#B14E16`)
- Muted text: `#8B8478` / `#6B7280`; faint: `#AEB4C2`
- Soft borders / hairlines: `#E5E7EB`, `#EEF0F4`, `#F0F1F5` on page surfaces;
  `#ECEAE3` is fine as the thin hairline on portaled modals/panels.
- Soft field bg: `#FAFAF8`; tinted terracotta pill/chip bg: `#FBEFE9`
- **Page canvas: `#F8FAFC`** ("clean maritime white", cool) — this is the ONLY
  page background. Cards on it are `#FFFFFF` with a `#E5E7EB` border.

**Never warm beige/cream backgrounds.** The app's canvas is cool (navy + maritime
white + terracotta accent). Do NOT fill a page or card with a warm background
(`#F7F6F3`, `#F4F1EA`, `#FAF8F4`, cream, beige) — it reads as a different product.
`#FBEFE9` is fine only as the small terracotta accent tint on chips/icon badges,
never as a page or card fill.

**Type**
- Headings: `'DM Serif Display', 'DM Serif Text', Georgia, serif`
- Body/UI: `'Inter', system-ui, sans-serif`
- Section labels: tracked caps — `9px`, `font-weight:700`, `letter-spacing:1px`,
  `text-transform:uppercase`, color `#8B8478`. Mark optional/required inline
  (`required` in terracotta, `optional` in faint).

**Page headers — ALWAYS the canonical editorial pair, never a bespoke title.**
Every top-level page AND every drill-in sub-view (a folder, a person's wardrobe,
a tab that owns the viewport) leads with the same two elements — do NOT invent
`*-h1` / `*-eyebrow` / `*-title` classes for a page heading:
- **Meta strip**: `<p className="editorial-meta">` — a terracotta `●` dot, the
  section word, then `<span className="bar" />` separators between `<span
  className="muted">` context/quick-stat segments. E.g. `● HOUSEKEEPING | TODAY |
  3 IN THE WASH`, `● WARDROBE | CREW | 6 ISSUED`. Put live quick info here, not
  a repeat of the title.
- **Big serif headline**: `<h1 className="editorial-greeting">` in the shape
  `SUBJECT<span className="period">,</span> <em>state</em><span
  className="period">.</span>` — the subject renders UPPERCASE navy (`#1C1B3A`,
  the class transforms it), the `<em>` accent is terracotta italic (`#C65A1A`),
  and the comma/period `.period` spans are navy. E.g. `LAUNDRY, in motion.`,
  `WARDROBE, managed.`, `CREW, in uniform.`. Both classes live in
  `src/styles/editorial.css` — import it, don't reimplement.

**Shape & layout**
- No heavy boxed cards. Separate items with hairline rules (`border-bottom:1px
  solid #F0F1F5`) and whitespace — editorial sections, not boxed widgets.
- Panels/modals: radius `12–16px`, border `1px solid #ECEAE3`, soft shadow
  (`0 24px 60px -16px rgba(28,27,58,0.32)`).
- Pills are fully rounded (`border-radius:999px`) — tags, chips, statuses.
  Selected pill = filled terracotta, white text.
- Inputs: soft field card, focus halo = `border-color:#C65A1A; box-shadow:0 0 0
  3px #FAECE7`.
- Primary button: terracotta fill, radius `10px`. Ghost: white, soft border.

**Conventions**
- Dates render `dd/mm/yyyy` (zero-padded). Not `27 Jun 2026`.
- New top-level pages render the Cargo `<Header />`
  (`src/components/navigation/Header.jsx`) and clear the fixed 64px nav
  (`padding-top: ~92px` or `min-height: calc(100vh - 64px)`).
- **Top-level pages are full-width** — the content wrap is `max-width: none;
  width: 100%` with horizontal padding (`~40px`), NOT a narrow centered column.
  Mirror `.lm-page` / `.lm-wrap` in `src/pages/laundry-management-dashboard/
  laundry.css` (canvas `#F8FAFC`, `padding: 26px 40px 80px`).
- Icons: use a real lucide icon that matches the concept (e.g. wardrobe →
  `Shirt`, not a `DoorClosed`). Unknown names silently fall back to `HelpCircle`.
- Portaled modals: scope styles under a short prefix class (the panel is outside
  the page tree). Co-locate a small `*.css` next to the component.

**Reference implementations to copy from**
- Modal: `src/pages/crew-management/components/StatusChangeModal.css` (`scm-*`)
- Modal: `src/pages/crew-profile/components/breach-notes.css` (`bn-*`)
- Page: `src/pages/month-end/` (`me-*`, collapsible compliance packs)
- Broader locked design notes: `docs/design-decisions.md`
