import { useState, useCallback } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { useAuth } from '../../contexts/AuthContext';
import { WIDGET_META, DEFAULT_LAYOUT } from './widgetRegistry';

// v3: reset saved layouts once so the Vessel-status widget surfaces for existing
// command/chief users (absence in a saved layout otherwise means "removed", so
// it can't be auto-appended without resurrecting removals).
const STORAGE_KEY = 'cargo_dashboard_layout_v3_';
const COLUMNS = ['left', 'center', 'right'];

// Per-user auto-inject: newly-added widgets appear for existing users without
// resetting their layout. We track a "known" set per user; any accessible
// widget not yet known is injected once at its default position, then marked
// known (so removing it later won't resurrect it). KNOWN is seeded on first
// run from PRE_AUTOINJECT + the user's currently-visible widgets, so a widget
// the user had previously REMOVED isn't wrongly treated as new.
const KNOWN_KEY = 'cargo_dashboard_known_v1_';
const PRE_AUTOINJECT = [
  'teamJobs', 'rota', 'todaySnapshot', 'recentActivity', 'vesselStatus',
  'vesselView', 'laundry', 'quickActions', 'charterAccounts', 'ownerAccounts',
  'inventoryHealth', 'provisioning', 'pantry', 'vesselDocRenewals',
];

export const useDashboardLayout = () => {
  const { user, tenantRole } = useAuth();
  const userTier = (tenantRole || '').toUpperCase().trim();

  // Widgets this user is permitted to see
  const accessibleIds = Object.keys(WIDGET_META).filter((id) => {
    const meta = WIDGET_META[id];
    // If no tier resolved yet (still loading), be permissive — filtering
    // will happen again once tenantRole is populated.
    if (!userTier) return true;
    return meta.allowedTiers.includes(userTier);
  });

  const getDefaultLayout = useCallback(() => ({
    left:   DEFAULT_LAYOUT.left.filter(id => accessibleIds.includes(id)),
    center: DEFAULT_LAYOUT.center.filter(id => accessibleIds.includes(id)),
    right:  DEFAULT_LAYOUT.right.filter(id => accessibleIds.includes(id)),
  }), [accessibleIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const storageKey = user?.id ? `${STORAGE_KEY}${user.id}` : null;

  const [layout, setLayout] = useState(() => {
    if (!storageKey) return getDefaultLayout();
    const clean = (arr) =>
      (arr || []).filter((id) => accessibleIds.includes(id) && WIDGET_META[id]);

    // Base layout — saved if present, else the default.
    let base;
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : null;
      base = parsed
        ? { left: clean(parsed.left), center: clean(parsed.center), right: clean(parsed.right) }
        : getDefaultLayout();
    } catch {
      base = getDefaultLayout();
    }

    // The "known" set — what this user has already been offered.
    const knownKey = `${KNOWN_KEY}${user.id}`;
    let known;
    try { known = JSON.parse(localStorage.getItem(knownKey)); } catch { known = null; }
    if (!Array.isArray(known)) {
      const visible = [...base.left, ...base.center, ...base.right];
      known = [...new Set([...PRE_AUTOINJECT, ...visible])];
    }

    // Inject any accessible widget not yet known at its default slot.
    let result = base;
    let changed = false;
    for (const id of accessibleIds) {
      if (known.includes(id)) continue;
      known.push(id);
      changed = true;
      const present = new Set([...result.left, ...result.center, ...result.right]);
      if (present.has(id)) continue; // already placed (new-user default)
      const col = WIDGET_META[id]?.defaultColumn || 'right';
      const defIdx = (DEFAULT_LAYOUT[col] || []).indexOf(id);
      const arr = [...result[col]];
      if (defIdx >= 0 && defIdx <= arr.length) arr.splice(defIdx, 0, id); else arr.push(id);
      result = { ...result, [col]: arr };
    }
    if (changed) {
      try {
        localStorage.setItem(knownKey, JSON.stringify(known));
        localStorage.setItem(storageKey, JSON.stringify(result));
      } catch { /* storage full / disabled — non-fatal */ }
    }
    return result;
  });

  const persist = useCallback((newLayout) => {
    setLayout(newLayout);
    if (storageKey) {
      localStorage.setItem(storageKey, JSON.stringify(newLayout));
    }
  }, [storageKey]);

  const resetLayout = useCallback(() => persist(getDefaultLayout()), [persist, getDefaultLayout]);

  const addWidget = useCallback((widgetId, column = 'right') => {
    if (!COLUMNS.includes(column)) return;
    persist({ ...layout, [column]: [...layout[column], widgetId] });
  }, [layout, persist]);

  const removeWidget = useCallback((widgetId) => {
    persist({
      left:   layout.left.filter(id => id !== widgetId),
      center: layout.center.filter(id => id !== widgetId),
      right:  layout.right.filter(id => id !== widgetId),
    });
  }, [layout, persist]);

  // Called from DndContext's onDragEnd.
  // `overId` may be a widget ID or a column key ('left'|'center'|'right').
  const moveWidget = useCallback((activeId, overId) => {
    const activeCol = COLUMNS.find(c => layout[c].includes(activeId));
    if (!activeCol) return;

    const isColumnTarget = COLUMNS.includes(overId);
    const overCol = isColumnTarget
      ? overId
      : COLUMNS.find(c => layout[c].includes(overId));

    if (!overCol) return;

    const draft = {
      left:   [...layout.left],
      center: [...layout.center],
      right:  [...layout.right],
    };

    if (activeCol === overCol && !isColumnTarget) {
      // Reorder within the same column
      const oldIdx = draft[activeCol].indexOf(activeId);
      const newIdx = draft[activeCol].indexOf(overId);
      if (oldIdx !== -1 && newIdx !== -1) {
        draft[activeCol] = arrayMove(draft[activeCol], oldIdx, newIdx);
      }
    } else {
      // Move to a different column
      draft[activeCol] = draft[activeCol].filter(id => id !== activeId);
      if (isColumnTarget) {
        // Dropped directly on the column container — append
        draft[overCol] = [...draft[overCol], activeId];
      } else {
        // Dropped on a widget in another column — insert before it
        const overIdx = draft[overCol].indexOf(overId);
        draft[overCol].splice(overIdx >= 0 ? overIdx : draft[overCol].length, 0, activeId);
      }
    }

    persist(draft);
  }, [layout, persist]);

  // Widgets the user can access but has currently hidden
  const visibleSet = new Set([...layout.left, ...layout.center, ...layout.right]);
  const hiddenWidgets = accessibleIds
    .filter(id => !visibleSet.has(id))
    .map(id => WIDGET_META[id]);

  return {
    layout,
    resetLayout,
    addWidget,
    removeWidget,
    moveWidget,
    hiddenWidgets,
    accessibleIds,
    userTier,
  };
};
