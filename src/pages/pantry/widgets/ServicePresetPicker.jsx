import React from 'react';
import { useNavigate } from 'react-router-dom';

const PRESETS = [
  { type: 'breakfast', name: 'Breakfast', ctx: 'Morning service' },
  { type: 'lunch',     name: 'Lunch',     ctx: 'Plated · 13:00' },
  { type: 'dinner',    name: 'Dinner',    ctx: 'Formal · 19:30' },
  { type: 'drinks',    name: 'Drinks',    ctx: 'Cocktail hour' },
  { type: 'turndown',  name: 'Turndown',  ctx: 'Evening service' },
];

// v1: "dinner" is next upcoming based on current time heuristic
function getNextType() {
  const h = new Date().getHours();
  if (h < 10) return 'breakfast';
  if (h < 13) return 'lunch';
  if (h < 18) return 'dinner';
  if (h < 20) return 'drinks';
  return 'turndown';
}

export default function ServicePresetPicker() {
  const navigate = useNavigate();
  const nextType = getNextType();

  return (
    <div style={{ marginBottom: 12 }}>
      <div className="p-section-label">Start a service</div>
      <div className="p-preset-row">
        {PRESETS.map(p => (
          <div
            key={p.type}
            className="p-preset-card"
            role="button"
            tabIndex={0}
            onClick={() => navigate(`/pantry/service/${p.type}`)}
            onKeyDown={e => e.key === 'Enter' && navigate(`/pantry/service/${p.type}`)}
            aria-label={`Start ${p.name} service`}
          >
            {p.type === nextType && <div className="p-preset-next">NEXT</div>}
            <div className="p-preset-ctx">{p.ctx}</div>
            <div className="p-preset-name">{p.name}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
