import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import Header from '../../../components/navigation/Header';
import StandbyLayoutHeader from '../widgets/StandbyLayoutHeader';
import { useGuests } from '../hooks/useGuests';
import { useInventoryThisWeek } from '../hooks/useInventoryThisWeek';
import { useInventoryInsights } from '../hooks/useInventoryInsights';
import { usePreferenceLinks } from '../hooks/usePreferenceLinks';
import { stripSentinels } from '../utils/emergencyDevices';
import { formatDistanceToNow } from 'date-fns';
import '../pantry.css';

// Citation slugs come from the inventory-insights edge function as
// lowercased machine strings (susan, oat_milk, tignanello_2017). Map
// back to guest / item rows for tap-through.
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

// ─── Small row components ───────────────────────────────────────────────────

// Emergency rows + anything else where we just render "name — qty/par".
function ItemRow({ item, onClick, selected }) {
  const name = stripSentinels(item?.name) || '';
  const unit = stripSentinels(item?.unit) || '';
  const qty = item?.total_qty ?? 0;
  const par = item?.par_level ?? null;
  return (
    <div
      className={`p-stock-row p-consumable-row${selected ? ' selected' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onClick?.(item)}
      onKeyDown={e => e.key === 'Enter' && onClick?.(item)}
      aria-label={`${name}: ${qty} ${unit}`}
    >
      <span className="p-stock-name">{name}</span>
      <div className="p-consumable-right">
        <span className="p-stock-count">{qty}</span>
        {par != null && <span className="p-stock-unit">/ par {par}</span>}
      </div>
    </div>
  );
}

// AT RISK rows: item name left; qty + reason right. Terracotta count when
// below par / stocked out; neutral when only trip-need risk (still
// important but less urgent than below-par).
function AtRiskRow({ row, onClick, selected }) {
  const { link, item, reason } = row;
  const name = stripSentinels(item?.name ?? link?.preference_value) || '';
  const qty = item?.total_qty ?? 0;
  const par = item?.par_level ?? null;
  const belowPar = par != null && qty < par;
  return (
    <div
      className={`p-stock-row p-consumable-row${selected ? ' selected' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onClick?.(item)}
      onKeyDown={e => e.key === 'Enter' && onClick?.(item)}
      aria-label={`${name}: ${qty}, ${reason}`}
    >
      <span className="p-stock-name">{name}</span>
      <div className="p-consumable-right">
        <span className={`p-stock-count${belowPar ? ' critical' : ''}`}>{qty}</span>
        <span className="p-consumable-reason">· {reason}</span>
      </div>
    </div>
  );
}

// NOT TRACKED rows: preference value left, note on the right in muted text.
function NotTrackedRow({ row }) {
  const { link, reason } = row;
  const label = stripSentinels(link?.preference_value) || link?.preference_key || 'Preference';
  return (
    <div className="p-stock-row p-consumable-row p-consumable-nontrack">
      <span className="p-stock-name">{label}</span>
      <span className="p-consumable-nontrack-reason">{reason}</span>
    </div>
  );
}

// Skeleton rows while the per-guest hook is in flight.
function SkeletonRows({ count = 2 }) {
  return (
    <div className="p-consumable-skeleton-wrap" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="p-consumable-skeleton" />
      ))}
    </div>
  );
}

// ─── GuestSection — calls the per-guest hook ───────────────────────────────

function GuestSection({ guest, onOpenGuest, onOpenItem, selectedItemId }) {
  const {
    atRisk, notTracked, emergency,
    hasConsumablePreferences, loading, error, refetch,
  } = usePreferenceLinks(guest.id);

  const roleLabel = [guest.guest_type].filter(Boolean).join(' · ');
  const hasAnyRow = atRisk.length > 0 || notTracked.length > 0 || emergency.length > 0;

  return (
    <div className="p-consumable-guest">
      <div className="p-consumable-guest-head">
        <button
          type="button"
          className="p-consumable-guest-name"
          onClick={() => onOpenGuest(guest)}
          aria-label={`Open ${guest.first_name}'s drawer`}
          title={`Open ${guest.first_name}'s drawer`}
        >
          {guest.first_name} <em>{guest.last_name ?? ''}</em>
        </button>
        {roleLabel && <span className="p-consumable-guest-role">· {roleLabel}</span>}
      </div>

      {loading && <SkeletonRows />}

      {!loading && error && (
        <p className="p-consumable-empty-inline">
          Couldn't analyse {guest.first_name}'s preferences right now.{' '}
          <button type="button" className="p-card-link" onClick={refetch}>Retry</button>
        </p>
      )}

      {!loading && (
        <>
          {atRisk.length > 0 && (
            <div className="p-consumable-sub">
              <div className="p-consumable-subhead">At risk</div>
              {atRisk.map((row, i) => (
                <AtRiskRow
                  key={`ar-${guest.id}-${row.item?.id ?? i}`}
                  row={row}
                  onClick={onOpenItem}
                  selected={selectedItemId === row.item?.id}
                />
              ))}
            </div>
          )}

          {notTracked.length > 0 && (
            <div className="p-consumable-sub">
              <div className="p-consumable-subhead">Not tracked</div>
              {notTracked.map((row, i) => (
                <NotTrackedRow
                  key={`nt-${guest.id}-${row.link?.preference_key}-${i}`}
                  row={row}
                />
              ))}
            </div>
          )}

          {emergency.length > 0 && (
            <div className="p-consumable-sub">
              <div className="p-consumable-subhead">Emergency</div>
              {emergency.map(item => (
                <ItemRow
                  key={`em-${guest.id}-${item.id}`}
                  item={item}
                  onClick={onOpenItem}
                  selected={selectedItemId === item.id}
                />
              ))}
            </div>
          )}

          {!hasAnyRow && !error && (
            <p className="p-consumable-empty-inline">
              {hasConsumablePreferences
                ? `All ${guest.first_name}'s preferences covered for this trip.`
                : `No tracked consumable preferences for ${guest.first_name}.`}
            </p>
          )}
        </>
      )}
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

        {/* Guest-specific consumables */}
        <div className="p-card top-navy">
          <div className="p-card-head">
            <div>
              <div className="p-caps">Consumables · by guest</div>
              <div className="p-card-headline">What each guest <em>needs</em>.</div>
            </div>
          </div>

          {itemsLoading && (
            <div style={{ color: 'var(--ink-tertiary)', fontSize: 13 }}>Loading…</div>
          )}
          {itemsError && (
            <div style={{ color: 'var(--accent)', fontSize: 12 }}>Failed to load: {itemsError}</div>
          )}

          {!itemsLoading && !itemsError && (guests ?? []).length === 0 && (
            <p className="p-consumable-empty">
              No active charter guests. Add guests to the trip to see their tracked consumables here.
            </p>
          )}

          {!itemsLoading && !itemsError && (guests ?? []).map(guest => (
            <GuestSection
              key={guest.id}
              guest={guest}
              onOpenGuest={handleOpenGuest}
              onOpenItem={handleOpenItem}
              selectedItemId={selectedItemId}
            />
          ))}

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
