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
    badgeClassName: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
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
