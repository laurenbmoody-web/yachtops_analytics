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
  // Supplier has returned at least one quote — board lives in this
  // state until the chief (or approver) decides on every line.
  quote_received: {
    label: 'Quote in',
    color: '#C65A1A',
    badgeClassName: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400',
  },
  // Mix of confirmed + still-pending lines (e.g. the supplier has
  // confirmed 12 of 17). Used by the partial-confirm flow.
  partially_confirmed: {
    label: 'Partially confirmed',
    color: '#D4A24C',
    badgeClassName: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  },
  // Board fully confirmed by the supplier (every line agreed /
  // substituted / unavailable). Identical UX to quote_approved
  // until we wire the approval flow — for now they live side by
  // side so the missing label doesn't drop the chip back to the
  // snake_case fallback.
  confirmed: {
    label: 'Confirmed',
    color: '#2E7D5A',
    badgeClassName: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
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
  'returned',
  'invoiced',
  'paid',
];

// FILTER source — every state that can appear on an item, including
// derive-only ones. Iteration order tracks the lifecycle so the
// dropdown reads chronologically. partially_returned slots after
// returned (both are post-receipt return states); the supplier-response
// triad (confirmed/unavailable/substituted) slots between ordered and
// received (where the supplier reply lives in the timeline). Financial
// states sit at the end (terminal close-out).
export const ITEM_STATUS_FILTER_ORDER = [
  'draft',
  'ordered',
  'confirmed',
  'unavailable',
  'substituted',
  'received',
  'partial',
  'not_received',
  'returned',
  'partially_returned',
  'invoiced',
  'paid',
];

// Two iteration orders, two purposes:
//
//   ITEM_STATUS_ORDER         — PICKER source. Crew-controllable states
//                               only. Used by BulkEditModal, ItemDrawer
//                               pills, and the inline status select on
//                               item rows. Anything excluded here never
//                               appears as a manual choice.
//
//   ITEM_STATUS_FILTER_ORDER  — FILTER source. Every state that can
//                               appear on an item, including derive-only
//                               ones (supplier-side, order-financial,
//                               partially-returned). Used by the "All
//                               statuses" dropdowns above the items list.
//                               Filter logic applies to the DERIVED
//                               status (via deriveDisplayStatus), not
//                               the raw item.status column — so a filter
//                               === 'confirmed' matches items where the
//                               derive function returns 'confirmed'
//                               even though item.status is still 'ordered'.
//
// Derive-only states (not in ORDER, but in FILTER_ORDER + CONFIG):
//   partially_returned  ← provisioning_items.returns_qty > 0 AND
//                          < quantity_received
//   confirmed           ← supplier_order_items.status
//   unavailable         ← supplier_order_items.status
//   substituted         ← supplier_order_items.status
//
// invoiced and paid are picker-controllable (in ORDER) — users with
// non-Cargo suppliers manually mark items as invoiced/paid themselves.
// The derive function also surfaces them from the order-level
// supplier_orders.status enum for the Cargo-supplier path.

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
  // Terminal post-receipt state: returns_qty >= quantity_received. Picker-
  // selectable (a stew can manually mark "this is all going back"). Visual
  // is neutral slate — "removed from inventory" reads as terminal, not as
  // failure (which would conflict with not_received's red).
  returned: {
    label: 'Returned',
    badge: { bg: '#F1F5F9', color: '#475569', border: '#CBD5E1', dot: '#94A3B8' },
    cell:  { bg: 'rgba(100,116,139,0.18)', color: '#475569' },
    dotClassName: 'bg-slate-500',
  },
  // DERIVE-ONLY display state. Not in ITEM_STATUS_ORDER, not in any
  // picker. Produced by the derive function when returns_qty > 0 but
  // < quantity_received. Distinct orange hue intentionally separates it
  // visually from `partial` (amber receipt) — same "partial" word but
  // different timeline phase.
  partially_returned: {
    label: 'Partially returned',
    badge: { bg: '#FFEDD5', color: '#C2410C', border: '#FED7AA', dot: '#FB923C' },
    cell:  { bg: 'rgba(249,115,22,0.15)', color: '#C2410C' },
    dotClassName: 'bg-orange-500',
  },
  // DERIVE-ONLY — read from supplier_order_items.status. The supplier
  // confirmed they can fulfil. Green palette matches the SUPPLIER_BADGE
  // it replaces in ProvisioningBoardDetail; same visual semantic
  // (success / confirmed).
  confirmed: {
    label: 'Confirmed',
    badge: { bg: '#D1FAE5', color: '#065F46', border: '#A7F3D0', dot: '#34D399' },
    cell:  { bg: 'rgba(52,211,153,0.18)', color: '#059669' },
    dotClassName: 'bg-emerald-500',
  },
  // DERIVE-ONLY — supplier said no. Lighter red than not_received so the
  // two reds read as distinct phases (supplier-side refusal vs delivery
  // failure). Same hue family, different lightness.
  unavailable: {
    label: 'Unavailable',
    badge: { bg: '#FEE2E2', color: '#991B1B', border: '#FECACA', dot: '#FCA5A5' },
    cell:  { bg: 'rgba(252,165,165,0.25)', color: '#991B1B' },
    dotClassName: 'bg-red-400',
  },
  // DERIVE-ONLY — supplier sent a substitute. Yellow-amber, lighter than
  // partial so the two reads as distinct phases.
  substituted: {
    label: 'Substituted',
    badge: { bg: '#FEF3C7', color: '#92400E', border: '#FDE68A', dot: '#FCD34D' },
    cell:  { bg: 'rgba(252,211,77,0.20)', color: '#92400E' },
    dotClassName: 'bg-yellow-400',
  },
  // DERIVE-ONLY — read from supplier_orders.status. Order-level (all items
  // on the same order share this). Indigo palette — admin/document
  // semantic distinct from the green/red of physical states.
  invoiced: {
    label: 'Invoiced',
    badge: { bg: '#EEF2FF', color: '#4338CA', border: '#C7D2FE', dot: '#818CF8' },
    cell:  { bg: 'rgba(129,140,248,0.18)', color: '#4338CA' },
    dotClassName: 'bg-indigo-500',
  },
  // DERIVE-ONLY — read from supplier_orders.status. Deeper emerald than
  // `confirmed` (same hue family, terminal close-out).
  paid: {
    label: 'Paid',
    badge: { bg: '#ECFDF5', color: '#047857', border: '#A7F3D0', dot: '#34D399' },
    cell:  { bg: 'rgba(52,211,153,0.18)', color: '#047857' },
    dotClassName: 'bg-emerald-600',
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

// Derive the single status value to display for an item, reading across
// three source tables. Produces one of the 11 ITEM_STATUS_CONFIG keys.
// Callers pipe this through getItemStatusConfig to get the rendered pill.
//
// Precedence (highest first):
//
//   1. Manual stew choice for terminal/financial states wins. If the
//      stew has explicitly set item.status to 'paid' / 'invoiced' /
//      'returned' / 'not_received', that's the authoritative state
//      regardless of order-level signal (covers non-Cargo suppliers
//      where the stew tracks the financial flow themselves).
//
//   2. returns_qty signal — derives 'partially_returned'.
//
//   3. Order-level financial close-out (Cargo supplier path) replaces
//      'received'/'partial' as the latest stage: supplier_orders.status
//      = 'paid' or 'invoiced'.
//
//   4. Physical receipt without close-out: 'received', 'partial'.
//
//   5. Supplier response (pre-delivery): 'confirmed', 'unavailable',
//      'substituted' from supplier_order_items.status.
//
//   6. Pre-response: raw item.status (ordered / draft).
//
// supplierOrderItem and supplierOrder are both optional — items not
// linked to an order pass undefined and the function falls through.
export const deriveDisplayStatus = (item, supplierOrderItem, supplierOrder) => {
  if (!item) return 'draft';

  // 1. Manual stew choice for terminal/financial states.
  if (['paid', 'invoiced', 'returned', 'not_received'].includes(item.status)) {
    return item.status;
  }

  // 2. Returns_qty signal — partial returns.
  if (Number(item.returns_qty) > 0) return 'partially_returned';

  // 3. Order-level financial close-out (Cargo supplier path).
  if (supplierOrder?.status === 'paid')     return 'paid';
  if (supplierOrder?.status === 'invoiced') return 'invoiced';

  // 4. Physical receipt state.
  if (item.status === 'received') return 'received';
  if (item.status === 'partial')  return 'partial';

  // 5. Supplier response — only relevant before delivery.
  if (supplierOrderItem && ['confirmed', 'unavailable', 'substituted'].includes(supplierOrderItem.status)) {
    return supplierOrderItem.status;
  }

  // 6. Pre-response: ordered (dispatched, awaiting supplier) or draft (on board).
  return item.status;
};
