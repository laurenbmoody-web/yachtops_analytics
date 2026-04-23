import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import Header from '../../../components/navigation/Header';
import StandbyLayoutHeader from '../widgets/StandbyLayoutHeader';
import { useGuests } from '../hooks/useGuests';
import { useInventoryThisWeek } from '../hooks/useInventoryThisWeek';
import { useInventoryInsights } from '../hooks/useInventoryInsights';
import { formatDistanceToNow } from 'date-fns';
import '../pantry.css';

// Citation slugs come from the edge function as lowercased machine strings
// (susan, oat_milk, tignanello_2017). Map them back to guest / item rows
// for tap-through. The model generates them from natural language so we
// canonicalise both sides to compare.
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

  // Guest match: try first name, then first_last combined.
  for (const g of guests ?? []) {
    if (slugify(g.first_name) === s) return { kind: 'guest', target: g };
    if (slugify(`${g.first_name} ${g.last_name}`) === s) return { kind: 'guest', target: g };
  }
  // Item match: exact slug on item name.
  for (const it of items ?? []) {
    if (slugify(it.name) === s) return { kind: 'item', target: it };
  }
  // Loose fallback: substring contains — catches "tignanello" vs "tignanello_2017".
  for (const it of items ?? []) {
    if (slugify(it.name).includes(s) || s.includes(slugify(it.name))) {
      return { kind: 'item', target: it };
    }
  }
  return null;
}

// Human-readable label for a citation chip. Uses the real data row when
// matched; falls back to the raw slug (un-snake-cased) when not.
function citationLabel(slug, resolved) {
  if (resolved?.kind === 'guest') return resolved.target.first_name ?? slug;
  if (resolved?.kind === 'item')  return resolved.target.name ?? slug;
  return String(slug).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

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

      {loading && insights.length === 0 && (
        <p className="p-insights-empty">Generating insights…</p>
      )}

      {error && (
        <p className="p-insights-error">
          Insights unavailable — showing last snapshot.
        </p>
      )}

      {!loading && !error && !hasAny && (
        <p className="p-insights-empty">
          All clear this week. Nothing to flag.
        </p>
      )}
    </div>
  );
}

export default function InventoryWeeklyPage() {
  const navigate = useNavigate();
  const { guests } = useGuests();
  const { items, loading: itemsLoading, error: itemsError } = useInventoryThisWeek({ limit: null });
  const { insights, loading, error, fetchedAt, refetch } = useInventoryInsights({ guests, items });

  // TODO(phase-4d): item detail popover. For now, tapping an item (or an
  // item-citation chip on an insight) logs + focuses — no popover yet.
  const [selectedItemId, setSelectedItemId] = useState(null);

  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = '#F5F1EA';
    return () => { document.body.style.background = prev; };
  }, []);

  const handleOpenGuest = (guest) => {
    // Reuses the nav-state drawer-open plumbing from Section 3's NotesHistoryPage.
    navigate('/pantry/standby', { state: { openDrawerForGuestId: guest.id } });
  };
  const handleOpenItem = (item) => {
    // TODO(phase-4d): replace this with the detail popover.
    setSelectedItemId(item.id);
  };

  // Split items so the list renders critical first, then watch, then the rest.
  const sorted = useMemo(() => {
    const copy = [...(items ?? [])];
    copy.sort((a, b) => {
      if (a.critical && !b.critical) return -1;
      if (!a.critical && b.critical) return 1;
      return (a.total_qty ?? 0) - (b.total_qty ?? 0);
    });
    return copy;
  }, [items]);

  return (
    <>
      <Header />
      <div id="pantry-root" className="pantry-page">
        <StandbyLayoutHeader
          title="Inventory"
          subtitle="What to watch and restock this week."
          backTo="/pantry/standby"
        />

        {/* AI insights banner */}
        <div className="p-card top-navy" style={{ marginBottom: 12 }}>
          <InsightsBanner
            insights={insights}
            loading={loading}
            error={error}
            fetchedAt={fetchedAt}
            onRefresh={refetch}
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

        {/* Full item list */}
        <div className="p-card top-navy">
          <div className="p-card-head">
            <div>
              <div className="p-caps">
                {itemsLoading ? '…' : `${sorted.length} item${sorted.length === 1 ? '' : 's'} tracked`}
              </div>
              <div className="p-card-headline">Everything on the <em>shelf</em>.</div>
            </div>
            {/* TODO(phase-4e): link out to the canonical inventory detail page. */}
          </div>

          {itemsLoading && (
            <div style={{ color: 'var(--ink-tertiary)', fontSize: 13 }}>Loading…</div>
          )}
          {itemsError && (
            <div style={{ color: 'var(--accent)', fontSize: 12 }}>Failed to load: {itemsError}</div>
          )}
          {!itemsLoading && !itemsError && sorted.length === 0 && (
            <p style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 14, color: 'var(--ink-muted)' }}>
              No stock items found.
            </p>
          )}

          {!itemsLoading && !itemsError && sorted.map(item => (
            <div
              key={item.id}
              className={`p-stock-row${selectedItemId === item.id ? ' selected' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => handleOpenItem(item)}
              onKeyDown={e => e.key === 'Enter' && handleOpenItem(item)}
              aria-label={`${item.name}: ${item.total_qty} ${item.unit ?? ''}`}
            >
              <span className="p-stock-name">{item.name}</span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span className={`p-stock-count${item.critical ? ' critical' : ''}`}>
                  {item.total_qty ?? 0}
                </span>
                <span className="p-stock-unit">{item.unit ?? ''}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
