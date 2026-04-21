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
      className="bg-card border border-border rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer"
      onClick={() => navigate('/pantry/standby')}
      role="link"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && navigate('/pantry/standby')}
      aria-label="Open pantry standby page"
    >
      {/* Cream header strip */}
      <div style={{ background: '#F5F1EA', borderBottom: '1px solid #DFD8CC', padding: '14px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{
              fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
              fontSize: 9, fontWeight: 600,
              letterSpacing: '1.8px', textTransform: 'uppercase',
              color: '#8B8478', marginBottom: 4,
            }}>
              Interior · Pantry
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{
                fontFamily: "'DM Serif Display', Georgia, serif",
                fontSize: 22, fontWeight: 500,
                letterSpacing: '-0.5px', color: '#1C1B3A',
                textTransform: 'uppercase',
              }}>
                {getGreeting().toUpperCase()},
              </span>
              <span style={{
                fontFamily: "'DM Serif Display', Georgia, serif",
                fontSize: 22, fontStyle: 'italic', fontWeight: 400,
                letterSpacing: '-0.5px', color: '#C65A1A',
              }}>
                Interior.
              </span>
            </div>
          </div>
          <ChevronRight size={16} style={{ color: '#8B8478', flexShrink: 0 }} />
        </div>
      </div>

      {/* Service presets */}
      <div style={{ padding: '12px 18px 14px' }}>
        <div style={{
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
          fontSize: 9, fontWeight: 600,
          letterSpacing: '1.8px', textTransform: 'uppercase',
          color: 'var(--color-muted-foreground)', marginBottom: 8,
        }}>
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
                border: '1px solid var(--color-border)',
                background: 'var(--color-background)',
                fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                fontSize: 11, fontWeight: 500,
                color: 'var(--color-foreground)',
                cursor: 'pointer',
                transition: 'border-color 120ms',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = '#C65A1A'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--color-border)'}
              aria-label={`Start ${p.label} service`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <button
          onClick={e => { e.stopPropagation(); navigate('/pantry/standby'); }}
          style={{
            marginTop: 12,
            width: '100%',
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid #C65A1A',
            background: 'transparent',
            fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
            fontSize: 12, fontWeight: 600,
            color: '#C65A1A',
            cursor: 'pointer',
            transition: 'background 120ms',
            textAlign: 'center',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#FAECE7'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          aria-label="Open pantry standby page"
        >
          Open Standby →
        </button>
      </div>
    </div>
  );
};

export default PantryWidget;
