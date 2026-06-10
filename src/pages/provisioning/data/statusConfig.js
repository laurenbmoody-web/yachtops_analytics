// Board status — unified source of truth.
//
// Replaces three divergent label maps that were drifting apart:
//   - BoardColumn.jsx STATUS_VISUALS    (cool-surface hex)
//   - StatusBadge.jsx STATUS_CONFIG     (legacy Tailwind pill)
//   - ProvisioningWidget.jsx STATUS_LABELS (partial, two-entry)
//
// Canonical capitalisation: sentence case. Matches the editorial
// cool-surface direction the rest of provisioning is migrating
// toward. The Tailwind badge surfaces inherit the sentence-case
// labels too — no separate copy fork.
//
// Each entry carries TWO styling primitives (color hex +
// badgeClassName Tailwind) because consumers split across two
// visual systems: cool-surface direct-style (BoardColumn, board-
// detail page) and legacy Tailwind pill (StatusBadge, Widget).
// When the legacy pill surfaces migrate to cool-surface, drop
// badgeClassName. Until then: BOTH must be updated when adding
// or changing a status.
//
// draft + pending_approval intentionally share the same cool-
// surface hex (#DFD7C8). The colour channel encodes the binary
// "sent vs not sent"; the verbal label ("Draft" / "Pending
// approval") carries the precision. The upcoming meta-bar
// surface will surface the precise state verbally too.

export const BOARD_STATUS_ORDER = [
  'draft',
  'pending_approval',
  'sent_to_supplier',
  'partially_delivered',
  'delivered_with_discrepancies',
  'delivered',
];

export const BOARD_STATUS_CONFIG = {
  draft: {
    label: 'Draft',
    color: '#DFD7C8',
    badgeClassName: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  },
  pending_approval: {
    label: 'Pending approval',
    color: '#DFD7C8',
    badgeClassName: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  },
  sent_to_supplier: {
    label: 'Sent to supplier',
    color: '#C65A1A',
    badgeClassName: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  },
  partially_delivered: {
    label: 'Partially delivered',
    color: '#5C9B6A',
    badgeClassName: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400',
  },
  delivered_with_discrepancies: {
    label: 'With discrepancies',
    color: '#5C9B6A',
    // Cool-surface token migration started on main (ProvisioningWidget
    // adopted ce-bg-danger / ce-fg-danger). When the other statuses
    // and the StatusBadge consumers migrate to ce-* tokens, swap their
    // entries too and eventually retire badgeClassName entirely.
    badgeClassName: 'ce-bg-danger ce-fg-danger',
  },
  delivered: {
    label: 'Delivered',
    color: '#5C9B6A',
    badgeClassName: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  },
};

// Safe accessor. Returns the canonical config for known statuses
// and a sand-coloured slate fallback for anything else. Unknown
// statuses surface via console.warn so a schema drift (new enum
// value not registered here, or a typo in a write path) is
// visible during development instead of silently rendering a
// blank pill — same standing-rule shape as the no-silent-catch
// rule (af56d06): fail gracefully but make it visible.
export const getBoardStatusConfig = (status) => {
  const config = BOARD_STATUS_CONFIG[status];
  if (config) return config;
  if (status) console.warn('[statusConfig] Unknown board status:', status);
  return {
    label: status || '—',
    color: '#DFD7C8',
    badgeClassName: 'bg-slate-100 text-slate-600',
  };
};

// Lifecycle-position helper for tier-aware matrix UIs and any
// "is the board past stage X yet?" render decisions. Indexes via
// BOARD_STATUS_ORDER so the comparison stays anchored to the
// canonical sequence even when new statuses are added between
// existing ones. Returns false when either status is unknown
// (-1 vs anything is never >).
export const isLifecycleAfter = (status, reference) =>
  BOARD_STATUS_ORDER.indexOf(status) > BOARD_STATUS_ORDER.indexOf(reference);

// =============================================================================
// Item status — provisioning_items.status. Lifecycle parallel to board status
// but with different downstream rendering. As with board status, the LABELS
// here are CANONICAL — the strings users actually see throughout the app, not
// just visual config. Locked here so they can't drift across surfaces.
//
// Three visual variants per entry because the three consumer surfaces speak
// different visual languages (not just different shades of the same palette):
//   - badge:        per-row pill in ProvisioningBoardDetail's items table.
//                   Full pastel pill — light bg + border + colored dot +
//                   dark (Tailwind-700-shade) text.
//   - cell:         inline edit-mode pill in DetailTableCells.StatusCell.
//                   Translucent rgba bg + mid (500-shade) text. No border,
//                   no dot.
//   - dotClassName: Tailwind class for the legacy StatusBadge surface
//                   (ItemDrawer dark-mode pill row). Retire when that
//                   surface migrates to cool-surface — same dual-visual-
//                   systems rationale as BOARD_STATUS_CONFIG above.
//
// All three update together when adding or changing an item status: drift
// between them is what we just consolidated AWAY from.

export const ITEM_STATUS_ORDER = [
  'draft',
  'ordered',
  'received',
  'partial',
  'not_received',
];

export const ITEM_STATUS_CONFIG = {
  draft: {
    label: 'Draft',
    badge: { bg: '#F8FAFC', color: '#94A3B8', border: '#E2E8F0', dot: '#CBD5E1' },
    cell:  { bg: 'rgba(100,116,139,0.15)', color: '#94A3B8' },
    dotClassName: 'bg-slate-400',
  },
  ordered: {
    label: 'Ordered',
    badge: { bg: '#F5F3FF', color: '#7C3AED', border: '#DDD6FE', dot: '#A78BFA' },
    cell:  { bg: 'rgba(139,92,246,0.15)', color: '#8B5CF6' },
    dotClassName: 'bg-purple-500',
  },
  received: {
    label: 'Received',
    badge: { bg: '#F0FDF4', color: '#15803D', border: '#BBF7D0', dot: '#4ADE80' },
    cell:  { bg: 'rgba(34,197,94,0.15)', color: '#22c55e' },
    dotClassName: 'bg-green-500',
  },
  partial: {
    label: 'Partial',
    badge: { bg: '#FFFBEB', color: '#B45309', border: '#FDE68A', dot: '#FCD34D' },
    cell:  { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b' },
    dotClassName: 'bg-amber-500',
  },
  not_received: {
    label: 'Not received',
    badge: { bg: '#FEF2F2', color: '#B91C1C', border: '#FECACA', dot: '#FCA5A5' },
    cell:  { bg: 'rgba(239,68,68,0.15)', color: '#ef4444' },
    dotClassName: 'bg-red-500',
  },
};

// Safe accessor — same console.warn shape as getBoardStatusConfig above.
// Falls back to the draft palette for unknown statuses so the render stays
// consistent (instead of throwing or rendering a blank pill).
export const getItemStatusConfig = (status) => {
  const config = ITEM_STATUS_CONFIG[status];
  if (config) return config;
  if (status) console.warn('[statusConfig] Unknown item status:', status);
  return {
    label: status || '—',
    badge: { bg: '#F8FAFC', color: '#94A3B8', border: '#E2E8F0', dot: '#CBD5E1' },
    cell:  { bg: 'rgba(100,116,139,0.15)', color: '#94A3B8' },
    dotClassName: 'bg-slate-400',
  };
};
