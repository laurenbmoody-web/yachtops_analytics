import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

const PRESETS = [
  { type: 'breakfast', label: 'Breakfast' },
  { type: 'lunch',     label: 'Lunch' },
  { type: 'dinner',    label: 'Dinner' },
  { type: 'drinks',    label: 'Drinks' },
  { type: 'turndown',  label: 'Turndown' },
];

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Morning';
  if (h < 18) return 'Afternoon';
  return 'Evening';
}

const PantryWidget = () => {
  const navigate = useNavigate();

  return (
    <div
      className="ce-card rounded-xl cursor-pointer"
      onClick={() => navigate('/pantry/standby')}
      role="link"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && navigate('/pantry/standby')}
      aria-label="Open pantry standby page"
    >
      {/* Header — editorial eyebrow + two-tone serif greeting on the cool
          card surface (Pantry's beige strip dropped; type/treatment kept). */}
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--d-border-soft)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div className="ce-eyebrow">
              Interior <span className="dot">·</span> Pantry
            </div>
            <div className="ce-title">
              {getGreeting().toUpperCase()}, <span className="accent">Interior.</span>
            </div>
          </div>
          <ChevronRight size={16} className="ce-fg-muted" style={{ flexShrink: 0 }} />
        </div>
      </div>

      {/* Service presets */}
      <div style={{ padding: '12px 18px 14px' }}>
        <div className="ce-eyebrow" style={{ marginBottom: 8 }}>
          Start a service
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PRESETS.map(p => (
            <button
              key={p.type}
              onClick={e => { e.stopPropagation(); navigate(`/pantry/service/${p.type}`); }}
              style={{
                padding: '5px 12px',
                borderRadius: 999,
                border: '1px solid var(--d-border)',
                background: 'transparent',
                fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                fontSize: 11, fontWeight: 500,
                color: 'var(--d-navy)',
                cursor: 'pointer',
                transition: 'border-color 120ms',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--d-orange)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--d-border)'}
              aria-label={`Start ${p.label} service`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <button
          onClick={e => { e.stopPropagation(); navigate('/pantry/standby'); }}
          className="ce-action"
          style={{ marginTop: 12, width: '100%' }}
          aria-label="Open pantry standby page"
        >
          Open Standby →
        </button>
      </div>
    </div>
  );
};

export default PantryWidget;
