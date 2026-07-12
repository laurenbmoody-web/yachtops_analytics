// Stock movements are logged as inventory-ITEM events, so they surface on the
// item's own history — the same activity_events feed the inventory pages read
// (getActivityForEntity) — and are NEVER dumped into the map pin drawer.
// entityType matches inventory's 'inventoryItem' exactly, so map-driven and
// inventory-page-driven writes share one timeline per item.
//
// Summaries are written action-first, past tense, with NO actor prefix: the
// history UI already shows the actor as its own chip, so "Received 6 × …"
// reads cleanly beside it. logActivity is fire-and-forget (never throws, never
// blocks), so a logging hiccup can't fail a stock write.
import { logActivity, InventoryActions } from '../../../utils/activityStorage';

const emit = ({ item, action, summary, meta }) => {
  if (!item?.id) return;
  logActivity({
    module: 'inventory',
    action,
    entityType: 'inventoryItem',
    entityId: item.id,
    departmentScope: item.usage_department || null,
    summary,
    meta: { itemName: item.name || '', source: 'vessel-map', ...meta },
  });
};

// New stock arrived at the pin (raises the total).
export function logReceived(item, { qty, pinName, nodeId }) {
  if (!(qty > 0)) return;
  emit({
    item, action: InventoryActions.STOCK_RECEIVED,
    summary: `Received ${qty} × ${item.name} at ${pinName}`,
    meta: { qtyDelta: qty, locationName: pinName, toNodeId: nodeId },
  });
}

// Existing stock moved in from another place (total unchanged).
export function logMoved(item, { qty, fromLabel, fromKey, pinName, nodeId }) {
  if (!(qty > 0)) return;
  emit({
    item, action: InventoryActions.STOCK_TRANSFERRED,
    summary: `Moved ${qty} × ${item.name} — ${fromLabel} → ${pinName}`,
    meta: { qty, fromLabel, fromKey, locationName: pinName, toNodeId: nodeId },
  });
}

// Recounted what's on the pin (the −/+); the delta hits the total.
export function logCounted(item, { from, to, pinName, nodeId }) {
  if (from === to) return;
  emit({
    item, action: InventoryActions.STOCK_ADJUSTED,
    summary: `Counted ${item.name} at ${pinName}: ${from} → ${to}`,
    meta: { qtyDelta: to - from, locationName: pinName, toNodeId: nodeId },
  });
}

// Item taken off the pin — its pin stock drops back to unplaced (not deleted).
export function logRemoved(item, { qty, pinName, nodeId }) {
  emit({
    item, action: InventoryActions.ITEM_LOCATION_CHANGED,
    summary: `Removed ${item.name} from ${pinName}`,
    meta: { qtyDelta: qty ? -qty : undefined, locationName: pinName, fromNodeId: nodeId },
  });
}

// Brand-new item created, received at the pin.
export function logCreated(item, { qty, pinName, nodeId }) {
  emit({
    item, action: InventoryActions.ITEM_CREATED,
    summary: qty > 0 ? `Created ${item.name} — ${qty} at ${pinName}` : `Created ${item.name}`,
    meta: { qtyDelta: qty || undefined, locationName: pinName, toNodeId: nodeId },
  });
}
