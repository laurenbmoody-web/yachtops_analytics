import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInventoryConsumables } from '../hooks/useInventoryConsumables';
import { stripSentinels } from '../utils/emergencyDevices';

// Cap on widget rows including the "+N more" tail. 4 keeps the card
// compact alongside the other standby cards. Anything beyond is folded
// into the +N tail and surfaced on tap-through to /inventory/weekly.
const MAX_ROWS = 4;

// Priority order for the widget preview. Lower number wins. Mirrors the
// brief: emergency first, then below-zero stock-outs, then trip-need,
// then below-par, then multi-guest gaps, then single-guest gaps.
function priorityFor(row) {
  if (row.kind === 'emergency') return 0;
  if (row.kind === 'inventory') {
    const qty  = row.item?.qty ?? 0;
    const par  = row.item?.par ?? null;
    const need = row.projected_total_need ?? null;
    if (qty === 0)                       return 1;
    if (need != null && qty < need)      return 2;
    if (par  != null && qty < par)       return 3;
    return 4;
  }
  if (row.kind === 'gap') {
    if ((row.guests?.length ?? 0) >= 2) return 5;
    return 6;
  }
  return 9;
}

function formatNameList(names) {
  const clean = names.filter(Boolean);
  if (clean.length === 0) return '';
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`;
}

function rowName(row) {
  if (row.kind === 'emergency') return stripSentinels(row.group.device?.name) || '';
  if (row.kind === 'inventory') return stripSentinels(row.item?.name) || '';
  if (row.kind === 'gap')       return stripSentinels(row.preference_summary) || 'Preference';
  return '';
}

function rowGuestNames(row) {
  if (row.kind === 'emergency') return row.group.guests.map(g => g.first_name);
  if (row.kind === 'inventory') return row.guests.map(g => g.first_name);
  if (row.kind === 'gap')       return row.guests.map(g => g.first_name);
  return [];
}

function rowKey(row) {
  if (row.kind === 'emergency') return `em-${row.group.device?.id}`;
  if (row.kind === 'inventory') return `inv-${row.item?.id}`;
  if (row.kind === 'gap')       return `gap-${row.preference_summary}`;
  return Math.random().toString(36);
}

export default function StockWidget({ guestCount = 0 }) {
  const navigate = useNavigate();
  const { items, emergency, loading, error } = useInventoryConsumables();

  const label = guestCount > 0
    ? `Based on ${guestCount} guest${guestCount === 1 ? '' : 's'} onboard`
    : 'Weekly priorities';

  const openModal = () => navigate('/inventory/weekly');

  const widget = useMemo(() => {
    // Emergency: collapse by device id (matches the modal). Widget shows
    // at most one emergency row to stay compact.
    const emergencyByDevice = new Map();
    for (const resp of emergency ?? []) {
      const id = resp.device?.id;
      if (!id) continue;
      if (!emergencyByDevice.has(id)) {
        emergencyByDevice.set(id, { device: resp.device, guests: [] });
      }
      emergencyByDevice.get(id).guests.push(resp);
    }
    const emergencyGroups = Array.from(emergencyByDevice.values());
    const emergencyRows = emergencyGroups.length > 0
      ? [{ kind: 'emergency', group: emergencyGroups[0] }]
      : [];

    const inventoryRows = (items ?? [])
      .filter(it => it.type === 'inventory')
      .map(it => ({ kind: 'inventory', ...it }));
    const gapRows = (items ?? [])
      .filter(it => it.type === 'gap')
      .map(it => ({ kind: 'gap', ...it }));

    const all = [...emergencyRows, ...inventoryRows, ...gapRows]
      .sort((a, b) => priorityFor(a) - priorityFor(b));

    const total = all.length;
    if (total === 0)         return { rows: [], more: 0, total };
    if (total <= MAX_ROWS)   return { rows: all, more: 0, total };
    return { rows: all.slice(0, MAX_ROWS - 1), more: total - (MAX_ROWS - 1), total };
  }, [items, emergency]);

  return (
    <div className="p-card top-navy">
      <div className="p-card-head">
        <div>
          <div className="p-caps">{label}</div>
          <div className="p-card-headline">What matters <em>this week</em>.</div>
        </div>
        <button className="p-card-link" onClick={openModal}
          aria-label="Open full inventory view">
          Open →
        </button>
      </div>

      {loading && (
        <div style={{ color: 'var(--ink-tertiary)', fontSize: 13 }}>Loading…</div>
      )}
      {error && !loading && (
        <div style={{ color: 'var(--accent)', fontSize: 12 }}>
          Couldn't analyse provisioning right now.
        </div>
      )}

      {!loading && !error && widget.total === 0 && (
        <p style={{
          fontFamily: 'var(--font-serif)',
          fontStyle:  'italic',
          fontSize:   14,
          color:      'var(--ink-muted)',
          padding:    '6px 0',
        }}>
          All covered for this trip.
        </p>
      )}

      {!loading && !error && widget.rows.map(row => {
        const name  = rowName(row);
        const names = rowGuestNames(row);
        return (
          <div key={rowKey(row)} className="p-stock-row p-stock-widget-row"
            role="button" tabIndex={0}
            onClick={openModal}
            onKeyDown={e => e.key === 'Enter' && openModal()}
            aria-label={`${name} for ${formatNameList(names)}`}
          >
            <span className="p-stock-name">{name}</span>
            <span className="p-stock-widget-attr">for {formatNameList(names)}</span>
          </div>
        );
      })}

      {!loading && !error && widget.more > 0 && (
        <div className="p-stock-row p-stock-widget-more"
          role="button" tabIndex={0}
          onClick={openModal}
          onKeyDown={e => e.key === 'Enter' && openModal()}
          aria-label={`Plus ${widget.more} more — open full inventory view`}
        >
          <span className="p-stock-name">+{widget.more} more</span>
        </div>
      )}
    </div>
  );
}
