import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import Header from '../../../components/navigation/Header';
import StandbyLayoutHeader from '../widgets/StandbyLayoutHeader';
import { useGuests } from '../hooks/useGuests';
import { useInventoryThisWeek } from '../hooks/useInventoryThisWeek';
import { useInventoryInsights } from '../hooks/useInventoryInsights';
import { useInventoryConsumables } from '../hooks/useInventoryConsumables';
import { stripSentinels } from '../utils/emergencyDevices';
import { formatDistanceToNow } from 'date-fns';
import '../pantry.css';

// Preference keys whose value is ambiguous standalone ("Yorkshire Gold",
// "Iced americano", "Sushi") get the key prefixed for the guest-attribution
// line beneath each item row. Values are the short label to display —
// "Favourite Meals" reads as "Meals · Sushi", not "Favourite Meals · Sushi".
// Specific items (Tignanello, Molton Brown) render clearly on their own
// and don't appear here.
const KEYS_THAT_NEED_PREFIX = new Map([
  ['Tea',                 'Tea'],
  ['Coffee',              'Coffee'],
  ['Favourite Meals',     'Meals'],
  ['Favourite Cuisines',  'Cuisines'],
  ['Favourite Snacks',    'Snacks'],
  ['Snacks to Pre-Order', 'Snacks'],
  ['Dessert Preferences', 'Dessert'],
  ['Evening Drink',       'Evening drink'],
  ['Morning Drink',       'Morning drink'],
  ['Cocktail',            'Cocktail'],
]);

// Compose a per-guest preference label for the attribution line. Used in
// "for John (Tea · Yorkshire Gold), Jane (Coffee · Iced americano)".
function formatPreferenceLabel(key, value) {
  if (!value) return key ?? '';
  if (KEYS_THAT_NEED_PREFIX.has(key)) {
    return `${KEYS_THAT_NEED_PREFIX.get(key)} · ${value}`;
  }
  return value;
}

// "John, Jane and Susan" / "John and Jane" / "John". Keeps the attribution
// line readable when 3+ guests contribute.
function formatNameList(names) {
  const clean = names.filter(Boolean);
  if (clean.length === 0) return '';
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`;
}

// Citations from the AI-insights edge function — resolve slugs to guest
// or item rows for tap-through on the insights banner.
function slugify(s) {
  return String(s ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function resolveCitation(slug, guests, items) {
  if (!slug) return null;
  const s = slug.toLowerCase().trim();
  for (const g of guests ?? []) {
    if (slugify(g.first_name) === s) return { kind: 'guest', target: g };
    if (slugify(`${g.first_name} ${g.last_name}`) === s) return { kind: 'guest', target: g };
  }
  for (const it of items ?? []) {
    if (slugify(it.name) === s) return { kind: 'item', target: it };
  }
  for (const it of items ?? []) {
    if (slugify(it.name).includes(s) || s.includes(slugify(it.name))) {
      return { kind: 'item', target: it };
    }
  }
  return null;
}

function citationLabel(slug, resolved) {
  if (resolved?.kind === 'guest') return resolved.target.first_name ?? slug;
  if (resolved?.kind === 'item')  return resolved.target.name ?? slug;
  return String(slug).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Row components ─────────────────────────────────────────────────────────

// AT RISK row. Item name + qty/par on the right, guest attribution line
// beneath — "for John (Tea · Yorkshire Gold), Jane (Tea · Yorkshire Gold)".
// Terracotta count when below par. Clickable → selects the item.
function InventoryRow({ row, onClick, selected }) {
  const name = stripSentinels(row.item?.name) || '';
  const unit = stripSentinels(row.item?.unit) || '';
  const qty  = row.item?.qty ?? 0;
  const par  = row.item?.par ?? null;
  const belowPar = par != null && qty < par;

  const attribution = row.guests.map(g => {
    const label = formatPreferenceLabel(g.original_preference_key, '');
    return { first_name: g.first_name, label };
  });

  return (
    <div
      className={`p-stock-row p-consumable-row p-consumable-inventory${selected ? ' selected' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onClick?.(row.item)}
      onKeyDown={e => e.key === 'Enter' && onClick?.(row.item)}
      aria-label={`${name}: ${qty} ${unit}, ${row.reason}`}
    >
      <div className="p-consumable-main">
        <span className="p-stock-name">{name}</span>
        <div className="p-consumable-right">
          <span className={`p-stock-count${belowPar ? ' critical' : ''}`}>{qty}</span>
          {par != null && <span className="p-stock-unit">/ par {par}</span>}
          <span className="p-consumable-reason">· {row.reason}</span>
        </div>
      </div>
      <div className="p-consumable-attribution">
        for{' '}
        {attribution.map((a, i) => (
          <span key={i}>
            {a.first_name}
            {a.label && <span className="p-consumable-attr-label"> ({a.label})</span>}
            {i < attribution.length - 1 && (i === attribution.length - 2 ? ' and ' : ', ')}
          </span>
        ))}
      </div>
    </div>
  );
}

// NOT TRACKED row. Preference summary on the left, model note italic on
// the right. Attribution line beneath listing contributing guests.
function GapRow({ row }) {
  const label = stripSentinels(row.preference_summary) || 'Preference';
  const names = row.guests.map(g => g.first_name);
  return (
    <div className="p-stock-row p-consumable-row p-consumable-gap">
      <div className="p-consumable-main">
        <span className="p-stock-name">{label}</span>
        {row.model_note && (
          <span className="p-consumable-nontrack-reason">{row.model_note}</span>
        )}
      </div>
      <div className="p-consumable-attribution">for {formatNameList(names)}</div>
    </div>
  );
}

// EMERGENCY row. One row per device, aggregating guests needing that device.
// "Jext 0.3mg — 1 / par 2 · for John (nut allergy), Jane (peanut allergy)".
function EmergencyGroupRow({ group, onClick, selected }) {
  const name = stripSentinels(group.device?.name) || '';
  const unit = stripSentinels(group.device?.unit) || '';
  const qty  = group.device?.total_qty ?? 0;
  const par  = group.device?.par_level ?? null;
  const belowPar = par != null && qty < par;

  return (
    <div
      className={`p-stock-row p-consumable-row p-consumable-emergency${selected ? ' selected' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onClick?.(group.device)}
      onKeyDown={e => e.key === 'Enter' && onClick?.(group.device)}
      aria-label={`${name}: ${qty} ${unit}, ${group.guests.length} guest${group.guests.length === 1 ? '' : 's'}`}
    >
      <div className="p-consumable-main">
        <span className="p-stock-name">{name}</span>
        <div className="p-consumable-right">
          <span className={`p-stock-count${belowPar ? ' critical' : ''}`}>{qty}</span>
          {par != null && <span className="p-stock-unit">/ par {par}</span>}
        </div>
      </div>
      <div className="p-consumable-attribution">
        for{' '}
        {group.guests.map((g, i) => (
          <span key={`${g.guest_id}-${g.condition}`}>
            {g.first_name}
            <span className="p-consumable-attr-label"> ({g.condition_label})</span>
            {i < group.guests.length - 1 && (i === group.guests.length - 2 ? ' and ' : ', ')}
          </span>
        ))}
      </div>
    </div>
  );
}

// Skeleton rows while the hook's in flight.
function SkeletonRows({ count = 3 }) {
  return (
    <div className="p-consumable-skeleton-wrap" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="p-consumable-skeleton" />
      ))}
    </div>
  );
}

// ─── AI insights banner (unchanged) ─────────────────────────────────────────

function InsightCard({ insight, guests, items, onOpenGuest, onOpenItem }) {
  const { severity, sentence, citations = [] } = insight;
  const hasCitations = citations.length > 0;
  const resolvedCitations = citations.map(c => ({
    slug: c,
    resolved: resolveCitation(c, guests, items),
  }));

  return (
    <div
      className={`p-insight p-insight-${severity}${hasCitations ? '' : ' no-citation'}`}
      aria-label={`${severity} insight: ${sentence}`}
    >
      <div className="p-insight-row">
        <span className={`p-insight-dot p-insight-dot-${severity}`} aria-hidden="true" />
        <div className="p-insight-severity">{severity}</div>
        <div className="p-insight-sentence">{sentence}</div>
      </div>
      <div className="p-insight-meta-row">
        {!hasCitations && (
          <span className="p-insight-uncited" title="This insight didn't cite a specific item or guest — treat with scepticism.">
            ⚠ no citation
          </span>
        )}
        {resolvedCitations.map(({ slug, resolved }, i) => (
          <button
            key={`${slug}-${i}`}
            type="button"
            className="p-insight-citation"
            onClick={() => {
              if (resolved?.kind === 'guest') onOpenGuest?.(resolved.target);
              if (resolved?.kind === 'item')  onOpenItem?.(resolved.target);
            }}
            disabled={!resolved}
            aria-label={`Open ${citationLabel(slug, resolved)}`}
            title={resolved ? `Open ${citationLabel(slug, resolved)}` : 'No matching record for this citation'}
          >
            {citationLabel(slug, resolved)}
          </button>
        ))}
      </div>
    </div>
  );
}

function InsightsBanner({ insights, loading, error, fetchedAt, onRefresh }) {
  const hasAny = insights.length > 0;
  return (
    <div className="p-insights-banner">
      <div className="p-insights-head">
        <div>
          <div className="p-caps">AI signals · updated{fetchedAt ? ` ${formatDistanceToNow(new Date(fetchedAt), { addSuffix: true })}` : ' —'}</div>
          <div className="p-card-headline">What to <em>anticipate</em>.</div>
        </div>
        <button
          className="p-card-link"
          onClick={onRefresh}
          disabled={loading}
          aria-label="Regenerate insights"
        >
          <RefreshCw size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          {loading ? 'Thinking…' : 'Refresh'}
        </button>
      </div>
      {loading && insights.length === 0 && <p className="p-insights-empty">Generating insights…</p>}
      {error && <p className="p-insights-error">Insights unavailable — showing last snapshot.</p>}
      {!loading && !error && !hasAny && (
        <p className="p-insights-empty">All clear this week. Nothing to flag.</p>
      )}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function InventoryWeeklyPage() {
  const navigate = useNavigate();
  const { guests } = useGuests();
  const { items, loading: itemsLoading, error: itemsError } = useInventoryThisWeek({ limit: null });
  const { insights, loading, error, fetchedAt, refetch: refetchInsights } = useInventoryInsights({ guests, items });

  // Item-first hook: one call for the whole page, cross-guest aggregated.
  const consumables = useInventoryConsumables();

  const [selectedItemId, setSelectedItemId] = useState(null);

  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = '#F5F1EA';
    return () => { document.body.style.background = prev; };
  }, []);

  const handleOpenGuest = (guest) => {
    navigate('/pantry/standby', { state: { openDrawerForGuestId: guest.id } });
  };
  const handleOpenItem = (item) => {
    setSelectedItemId(item?.id ?? null);
  };

  // Split the item-first list into the two subsections.
  const { atRisk, notTracked } = useMemo(() => {
    const ar = [];
    const nt = [];
    for (const row of consumables.items ?? []) {
      if (row.type === 'inventory') ar.push(row);
      else if (row.type === 'gap')  nt.push(row);
    }
    return { atRisk: ar, notTracked: nt };
  }, [consumables.items]);

  // Group emergency responses by device id so "Jext 0.3mg" appears once
  // even when John, Jane, and the child all trigger it.
  const emergencyGroups = useMemo(() => {
    const map = new Map();
    for (const resp of consumables.emergency ?? []) {
      const id = resp.device?.id;
      if (!id) continue;
      if (!map.has(id)) {
        map.set(id, { device: resp.device, guests: [] });
      }
      map.get(id).guests.push(resp);
    }
    return Array.from(map.values());
  }, [consumables.emergency]);

  const hasAny = atRisk.length > 0 || notTracked.length > 0 || emergencyGroups.length > 0;

  return (
    <>
      <Header />
      <div id="pantry-root" className="pantry-page">
        <StandbyLayoutHeader
          title="Inventory"
          subtitle="What matters for the guests on trip."
          backTo="/pantry/standby"
        />

        {/* AI insights banner */}
        <div className="p-card top-navy" style={{ marginBottom: 12 }}>
          <InsightsBanner
            insights={insights}
            loading={loading}
            error={error}
            fetchedAt={fetchedAt}
            onRefresh={refetchInsights}
          />
          {insights.length > 0 && (
            <div className="p-insights-list">
              {insights.map((ins, i) => (
                <InsightCard
                  key={`${ins.severity}-${i}`}
                  insight={ins}
                  guests={guests}
                  items={items}
                  onOpenGuest={handleOpenGuest}
                  onOpenItem={handleOpenItem}
                />
              ))}
            </div>
          )}
        </div>

        {/* Item-first consumables */}
        <div className="p-card top-navy">
          <div className="p-card-head">
            <div>
              <div className="p-caps">Consumables · this trip</div>
              <div className="p-card-headline">What to <em>source or reorder</em>.</div>
            </div>
            <button
              type="button"
              className="p-card-link"
              onClick={consumables.refetch}
              disabled={consumables.loading}
              aria-label="Re-run preference analysis"
            >
              <RefreshCw size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              {consumables.loading ? 'Thinking…' : 'Refresh'}
            </button>
          </div>

          {itemsError && (
            <div style={{ color: 'var(--accent)', fontSize: 12 }}>
              Failed to load inventory: {itemsError}
            </div>
          )}

          {consumables.loading && <SkeletonRows count={4} />}

          {!consumables.loading && consumables.error && (
            <p className="p-insights-error">
              Partial results — the preference analyser failed for one or more guests.
            </p>
          )}

          {!consumables.loading && !hasAny && !consumables.error && (
            <p className="p-consumable-empty">
              All interior provisioning covered for this trip.
            </p>
          )}

          {!consumables.loading && atRisk.length > 0 && (
            <div className="p-consumable-sub">
              <div className="p-caps p-consumable-subhead">At risk — source or reorder</div>
              {atRisk.map(row => (
                <InventoryRow
                  key={`ar-${row.item.id}`}
                  row={row}
                  onClick={handleOpenItem}
                  selected={selectedItemId === row.item.id}
                />
              ))}
            </div>
          )}

          {!consumables.loading && notTracked.length > 0 && (
            <div className="p-consumable-sub">
              <div className="p-caps p-consumable-subhead">Not tracked — source before service</div>
              {notTracked.map((row, i) => (
                <GapRow key={`nt-${slugify(row.preference_summary)}-${i}`} row={row} />
              ))}
            </div>
          )}

          {!consumables.loading && emergencyGroups.length > 0 && (
            <div className="p-consumable-sub">
              <div className="p-caps p-consumable-subhead">Emergency</div>
              {emergencyGroups.map(group => (
                <EmergencyGroupRow
                  key={`em-${group.device.id}`}
                  group={group}
                  onClick={handleOpenItem}
                  selected={selectedItemId === group.device.id}
                />
              ))}
            </div>
          )}

          <div className="p-consumable-footer">
            <button
              type="button"
              className="p-card-link"
              onClick={() => navigate('/inventory')}
              aria-label="Open the full inventory"
            >
              View full inventory →
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
