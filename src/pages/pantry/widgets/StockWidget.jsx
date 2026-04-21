import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useInventoryThisWeek } from '../hooks/useInventoryThisWeek';

export default function StockWidget({ guestCount = 0 }) {
  const navigate = useNavigate();
  const { items, loading, error } = useInventoryThisWeek({ limit: 4 });

  const label = guestCount > 0
    ? `Based on ${guestCount} guest${guestCount === 1 ? '' : 's'} onboard`
    : 'Weekly priorities';

  return (
    <div className="p-card top-navy">
      <div className="p-card-head">
        <div>
          <div className="p-caps">{label}</div>
          <div className="p-card-headline">What matters <em>this week</em>.</div>
        </div>
        <button className="p-card-link" onClick={() => navigate('/inventory/weekly')}
          aria-label="Open full inventory view">
          Open →
        </button>
      </div>

      {loading && (
        <div style={{ color: 'var(--ink-tertiary)', fontSize: 13 }}>Loading…</div>
      )}
      {error && (
        <div style={{ color: 'var(--accent)', fontSize: 12 }}>Failed to load: {error}</div>
      )}

      {!loading && !error && items.length === 0 && (
        <p style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 14, color: 'var(--ink-muted)' }}>
          No stock items found.
        </p>
      )}

      {!loading && !error && items.map(item => (
        <div key={item.id} className="p-stock-row"
          role="button" tabIndex={0}
          onClick={() => navigate('/inventory/weekly')}
          onKeyDown={e => e.key === 'Enter' && navigate('/inventory/weekly')}
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
  );
}
