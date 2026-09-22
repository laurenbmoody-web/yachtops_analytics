import React from 'react';
import { Plus, RotateCcw, Check } from 'lucide-react';
import './dashboard-editbar.css';

/**
 * Floating bottom bar shown during dashboard edit mode (editorial / Cargo UI).
 * Lists hidden-but-accessible widgets to add back, plus Reset and Done.
 */
const DashboardEditBar = ({ hiddenWidgets, onAdd, onReset, onDone }) => {
  return (
    <div className="deb-wrap">
      <div className="deb-bar">
        <span className="deb-label">Add widgets</span>

        <div className="deb-chips">
          {hiddenWidgets.length === 0 ? (
            <span className="deb-empty">All available widgets are visible</span>
          ) : (
            hiddenWidgets.map((widget) => (
              <button key={widget.id} onClick={() => onAdd(widget.id)} className="deb-chip">
                <Plus className="deb-ico" />
                {widget.title}
              </button>
            ))
          )}
        </div>

        <div className="deb-actions">
          <button onClick={onReset} className="deb-btn ghost" title="Reset to default layout">
            <RotateCcw className="deb-ico" />
            Reset
          </button>
          <button onClick={onDone} className="deb-btn prim">
            <Check className="deb-ico" />
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default DashboardEditBar;
