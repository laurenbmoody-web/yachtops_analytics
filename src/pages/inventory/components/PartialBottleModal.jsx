import { useState } from 'react';
import BottleVisualizer from './BottleVisualizer';

/**
 * PartialBottleModal
 *
 * @param {string}        itemName      – displayed in header
 * @param {number|null}   initialValue  – current partialBottle (0–1) or null if unset
 * @param {function}      onSave        – called with fraction (0–1)
 * @param {function}      onClear       – called to remove the partial record
 * @param {function}      onClose       – called to dismiss without saving
 */
const PartialBottleModal = ({ itemName, initialValue, onSave, onClear, onClose }) => {
  const [value, setValue] = useState(initialValue != null ? initialValue : 0.5);

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9000, padding: 16,
      }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div
        style={{
          background: 'var(--color-card, #fff)',
          borderRadius: 20,
          boxShadow: '0 24px 64px rgba(0,0,0,0.22)',
          width: '100%', maxWidth: 380,
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '18px 20px 14px',
          borderBottom: '1px solid var(--color-border, #E2E8F0)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
        }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-foreground, #1E3A5F)', margin: 0, lineHeight: 1.2 }}>
              Partial Bottle
            </h2>
            <p style={{ fontSize: 12, color: 'var(--color-muted-foreground, #7B8EA0)', margin: '3px 0 0', lineHeight: 1.3 }}>
              {itemName}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 4, lineHeight: 0,
              color: 'var(--color-muted-foreground, #94A3B8)', flexShrink: 0,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{
          padding: '20px 20px 8px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        }}>
          <p style={{ fontSize: 13, color: 'var(--color-muted-foreground, #94A3B8)', textAlign: 'center', marginBottom: 8 }}>
            Drag the bottle to show how full it is
          </p>
          <BottleVisualizer value={value} onChange={setValue} size={160} />
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={() => onSave?.(value)}
            style={{
              width: '100%', padding: '12px 0',
              background: '#1E3A5F', color: '#fff',
              border: 'none', borderRadius: 10, cursor: 'pointer',
              fontSize: 14, fontWeight: 600, letterSpacing: '0.01em',
            }}
          >
            Save
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                flex: 1, padding: '10px 0',
                background: 'none', color: 'var(--color-muted-foreground, #7B8EA0)',
                border: '1px solid var(--color-border, #E2E8F0)', borderRadius: 10, cursor: 'pointer',
                fontSize: 13, fontWeight: 500,
              }}
            >
              Cancel
            </button>
            {initialValue != null && (
              <button
                onClick={onClear}
                style={{
                  flex: 1, padding: '10px 0',
                  background: 'none', color: '#E53E3E',
                  border: '1px solid #FED7D7', borderRadius: 10, cursor: 'pointer',
                  fontSize: 13, fontWeight: 500,
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PartialBottleModal;
