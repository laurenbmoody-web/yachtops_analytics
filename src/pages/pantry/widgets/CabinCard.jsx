import React from 'react';
import GuestAvatar from './GuestAvatar';

function cabinShortLabel(path) {
  if (!path) return 'Cabin';
  const parts = path.split('>').map(s => s.trim());
  return parts[parts.length - 1];
}

function cabinParentLabel(path) {
  if (!path) return '';
  const parts = path.split('>').map(s => s.trim());
  return parts.length > 1 ? parts.slice(0, -1).join(' › ') : '';
}

function cabinAllAshore(guests) {
  return guests.every(g => (g.current_state ?? 'awake') === 'ashore');
}

export default function CabinCard({ cabin, onToggleState, onLongPress }) {
  const allAshore = cabinAllAshore(cabin.guests);
  const parentLabel = cabinParentLabel(cabin.path);
  const shortLabel  = cabinShortLabel(cabin.label ?? cabin.path);

  return (
    <div className={`p-cabin-card${allAshore ? ' ashore' : ''}`}>
      <div className="p-cabin-head">
        <div>
          <div className="p-caps-sm">{shortLabel}</div>
          {parentLabel && (
            <div style={{ fontSize: 9, color: 'var(--ink-tertiary)', marginTop: 1 }}>
              {parentLabel}
            </div>
          )}
        </div>
        <div className={`p-cabin-status${allAshore ? ' ashore' : ''}`}>
          {allAshore ? 'Ashore' : 'Onboard'}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        {cabin.guests.map(g => (
          <GuestAvatar
            key={g.id}
            guest={g}
            onToggleState={onToggleState}
            onLongPress={onLongPress}
          />
        ))}
      </div>
    </div>
  );
}
