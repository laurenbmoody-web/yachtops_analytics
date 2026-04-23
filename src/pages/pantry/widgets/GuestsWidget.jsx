import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useGuests } from '../hooks/useGuests';
import CabinCard from './CabinCard';
import GuestDrawer from '../drawers/GuestDrawer';

function formatAshoreReturnDisplay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export default function GuestsWidget() {
  const location = useLocation();
  const {
    guests, cabins, loading, error,
    updateGuestState, updateGuestMood, updateAshoreContext,
  } = useGuests();
  const [drawerGuestId, setDrawerGuestId] = useState(null);

  // The drawer mirrors state from `guests` — sourcing by ID means the drawer
  // re-renders whenever the underlying guest changes (mood, state, ashore
  // context), without needing GuestDrawer to re-fetch.
  const drawerGuest = useMemo(
    () => (drawerGuestId ? guests.find(g => g.id === drawerGuestId) ?? null : null),
    [drawerGuestId, guests]
  );

  // Open the drawer for a specific guest when navigated here with location state
  // (e.g. from NotesHistoryPage's guest chip). Consumed once — replaceState clears it
  // so a back-nav or re-render doesn't reopen.
  useEffect(() => {
    const targetId = location.state?.openDrawerForGuestId;
    if (!targetId || guests.length === 0) return;
    const match = guests.find(g => g.id === targetId);
    if (match) {
      setDrawerGuestId(match.id);
      window.history.replaceState({}, '', location.pathname);
    }
  }, [location.state, location.pathname, guests]);

  const onboard  = guests.filter(g => (g.current_state ?? 'awake') !== 'ashore');
  const ashore   = guests.filter(g => (g.current_state ?? 'awake') === 'ashore');
  const nextBack  = ashore.find(g => g.ashore_context?.returning_at);

  return (
    <>
      <div className="p-card top-navy" style={{ marginBottom: 12 }}>
        <div className="p-card-head">
          <div>
            <div className="p-caps">
              By cabin · {cabins.length} cabin{cabins.length !== 1 ? 's' : ''}
            </div>
            <div className="p-card-headline">Who's <em>aboard</em>.</div>
          </div>
          <div className="p-guests-hint">tap · hold</div>
        </div>

        {/* Stats row */}
        {!loading && !error && (
          <div className="p-guests-stats">
            <div className="p-stat">
              <div className="p-stat-num">{onboard.length}</div>
              <div className="p-stat-label">onboard</div>
            </div>
            {ashore.length > 0 && (
              <div className="p-stat">
                <div className="p-stat-num">{ashore.length}</div>
                <div className="p-stat-label">ashore</div>
              </div>
            )}
            {nextBack && (
              <div className="p-guests-context">
                {nextBack.first_name} back {formatAshoreReturnDisplay(nextBack.ashore_context.returning_at)}
              </div>
            )}
          </div>
        )}

        {loading && (
          <div style={{ color: 'var(--ink-tertiary)', fontSize: 13, padding: '12px 0' }}>
            Loading guests…
          </div>
        )}
        {error && (
          <div style={{ color: 'var(--accent)', fontSize: 12, padding: '8px 0' }}>
            Failed to load guests: {error}
          </div>
        )}
        {!loading && !error && guests.length === 0 && (
          <p style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 14, color: 'var(--ink-muted)' }}>
            No active charter guests found.
          </p>
        )}

        {!loading && !error && cabins.length > 0 && (
          <div className="p-guests-grid">
            {cabins.map(cabin => (
              <CabinCard
                key={cabin.id}
                cabin={cabin}
                onToggleState={updateGuestState}
                onLongPress={(g) => setDrawerGuestId(g.id)}
              />
            ))}
          </div>
        )}
      </div>

      {drawerGuest && (
        <GuestDrawer
          guest={drawerGuest}
          allGuests={guests}
          onClose={() => setDrawerGuestId(null)}
          onUpdateState={updateGuestState}
          onUpdateMood={updateGuestMood}
          onUpdateAshoreContext={updateAshoreContext}
        />
      )}
    </>
  );
}
