import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import BottleVisualizer from './BottleVisualizer';

/**
 * PartialBottleModal
 * @param {number|null} initialValue - current partialBottle value (0–1) or null if not set
 * @param {string} itemName - item name for the modal title
 * @param {function} onSave - called with value (0–1) when user saves
 * @param {function} onClear - called when user clears the partial bottle record
 * @param {function} onClose - called to close without saving
 */
const PartialBottleModal = ({ initialValue, itemName, onSave, onClear, onClose }) => {
  const [value, setValue] = useState(initialValue != null ? initialValue : 0.5);

  const handleSave = () => {
    onSave?.(value);
  };

  const handleClear = () => {
    onClear?.();
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 200, padding: 16
      }}
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div style={{
        background: 'white',
        borderRadius: 20,
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        width: '100%',
        maxWidth: 360,
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 20px 14px',
          borderBottom: '1px solid #E8EDF2',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1E3A5F', margin: 0 }}>
              Partial Bottle
            </h2>
            <p style={{ fontSize: 12, color: '#7B8EA0', margin: '2px 0 0' }}>
              {itemName}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 4, color: '#94A3B8', display: 'flex', alignItems: 'center'
            }}
          >
            <Icon name="X" size={20} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <p style={{ fontSize: 13, color: '#7B8EA0', textAlign: 'center', marginBottom: 12 }}>
            Drag the bottle to set how full it is
          </p>
          <BottleVisualizer value={value} onChange={setValue} size={120} />
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px 20px',
          display: 'flex', flexDirection: 'column', gap: 8
        }}>
          <button
            onClick={handleSave}
            style={{
              width: '100%', padding: '12px',
              background: '#1E3A5F', color: 'white',
              border: 'none', borderRadius: 10, cursor: 'pointer',
              fontSize: 14, fontWeight: 600
            }}
          >
            Save Partial Bottle
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                flex: 1, padding: '10px',
                background: 'none', color: '#7B8EA0',
                border: '1px solid #E2E8F0', borderRadius: 10, cursor: 'pointer',
                fontSize: 13, fontWeight: 500
              }}
            >
              Cancel
            </button>
            {initialValue != null && (
              <button
                onClick={handleClear}
                style={{
                  flex: 1, padding: '10px',
                  background: 'none', color: '#E53E3E',
                  border: '1px solid #FED7D7', borderRadius: 10, cursor: 'pointer',
                  fontSize: 13, fontWeight: 500
                }}
              >
                Clear Record
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PartialBottleModal;
