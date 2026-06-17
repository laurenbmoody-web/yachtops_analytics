# Cargo — project guidance for Claude

## Workflow rule — always land work on `main`

After completing a task and pushing the feature branch, **always get the work
onto `main`** (don't leave it sitting on the branch). Merges here go through a
PR, so: push the branch, then open and merge a PR into `main` unless the user
says otherwise.

## UI rule — always build in the editorial (Cargo) design system

Any new or rebuilt UI (page, modal, drawer, widget, card) MUST use the editorial
system below — never the old boxed tailwind look (`bg-card border border-border
rounded-lg`, grey chips, `bg-red-100` badges, `27 Jun 2026` dates). If you touch
an old-styled surface, bring it up to this system.

**Palette**
- Navy ink (text/headings): `#1C1B3A`
- Terracotta accent (primary actions, selected, emphasis): `#C65A1A` (hover `#B14E16`)
- Muted text: `#8B8478` / `#6B7280`; faint: `#AEB4C2`
- Soft borders / hairlines: `#ECEAE3`, `#E8E6DF`, `#E5E7EB`, `#F0F1F5`
- Soft field bg: `#FAFAF8` / `#F6F5F2`; tinted terracotta pill bg: `#FBEFE9`

**Type**
- Headings: `'DM Serif Display', 'DM Serif Text', Georgia, serif`
- Body/UI: `'Inter', system-ui, sans-serif`
- Section labels: tracked caps — `9px`, `font-weight:700`, `letter-spacing:1px`,
  `text-transform:uppercase`, color `#8B8478`. Mark optional/required inline
  (`required` in terracotta, `optional` in faint).

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
- Portaled modals: scope styles under a short prefix class (the panel is outside
  the page tree). Co-locate a small `*.css` next to the component.

**Reference implementations to copy from**
- Modal: `src/pages/crew-management/components/StatusChangeModal.css` (`scm-*`)
- Modal: `src/pages/crew-profile/components/breach-notes.css` (`bn-*`)
- Page: `src/pages/month-end/` (`me-*`, collapsible compliance packs)
- Broader locked design notes: `docs/design-decisions.md`
