import React from 'react';
import { useAllergies } from '../hooks/useAllergies';

function splitPills(text) {
  if (!text) return [];
  return text.split(',').map(s => s.trim()).filter(Boolean);
}

export default function AllergiesWidget() {
  const { withRestrictions, withoutRestrictions, loading, error } = useAllergies();

  return (
    <div className="p-card top-navy">
      <div className="p-card-head">
        <div>
          <div className="p-caps">Live · from preferences</div>
          <div className="p-card-headline">What to <em>avoid</em>.</div>
        </div>
      </div>

      {loading && (
        <div style={{ color: 'var(--ink-tertiary)', fontSize: 13, padding: '8px 0' }}>Loading…</div>
      )}
      {error && (
        <div style={{ color: 'var(--accent)', fontSize: 12, padding: '8px 0' }}>Failed to load: {error}</div>
      )}

      {!loading && !error && (
        <>
          {withRestrictions.map(g => (
            <div key={g.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
              <span style={{ fontFamily: 'var(--font-serif)', fontSize: 14, color: 'var(--ink)', flexShrink: 0 }}>
                {g.first_name} {g.last_name}
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {splitPills(g.allergies).map((pill, i) => (
                  <span key={i} className="p-pill-allergy" aria-label={`Allergy: ${pill}`}>{pill}</span>
                ))}
                {splitPills(g.health_conditions).map((pill, i) => (
                  <span key={i} className="p-pill-diet" aria-label={`Health condition: ${pill}`}>{pill}</span>
                ))}
              </div>
            </div>
          ))}

          {withRestrictions.length === 0 && (
            <p style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 14, color: 'var(--ink-muted)' }}>
              No allergies or restrictions on record.
            </p>
          )}

          {withoutRestrictions.length > 0 && (
            <div style={{
              marginTop: 8, paddingTop: 10,
              borderTop: '0.5px solid var(--p-border)',
              fontFamily: 'var(--font-sans)', fontSize: 11,
              color: 'var(--ink-tertiary)',
            }}>
              {withoutRestrictions.map(g => `${g.first_name}`).join(' · ')} — no restrictions
            </div>
          )}
        </>
      )}
    </div>
  );
}
