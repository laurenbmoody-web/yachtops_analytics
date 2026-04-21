import React, { useState } from 'react';
import { useGuests } from '../hooks/useGuests';
import CabinCard from './CabinCard';
import GuestDrawer from '../drawers/GuestDrawer';

export default function GuestsWidget() {
  const { guests, cabins, loading, error, updateGuestState, updateGuestMood } = useGuests();
  const [drawerGuest, setDrawerGuest] = useState(null);

  const onboard  = guests.filter(g => (g.current_state ?? 'awake') !== 'ashore');
  const ashore   = guests.filter(g => (g.current_state ?? 'awake') === 'ashore');
  const nextBack  = ashore.find(g => g.ashore_context?.return_time);

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
                {nextBack.first_name} back {nextBack.ashore_context.return_time}
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
                onLongPress={setDrawerGuest}
              />
            ))}
          </div>
        )}
      </div>

      {drawerGuest && (
        <GuestDrawer
          guest={drawerGuest}
          allGuests={guests}
          onClose={() => setDrawerGuest(null)}
          onUpdateState={updateGuestState}
          onUpdateMood={updateGuestMood}
        />
      )}
    </>
  );
}
