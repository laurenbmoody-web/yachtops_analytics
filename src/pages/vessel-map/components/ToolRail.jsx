// The floating tool rail — desktop ≥1024px only (CSS-gated). A tool earns a
// slot only if it changes what clicking the canvas does; everything else is
// a payload and lives on pins. One mode active at a time. The rail renders
// for every tier — the furniture is universal — but the verbs are gated:
// crew see Navigate only.
import React from 'react';
import Icon from '../../../components/AppIcon';

const LIVE_MODES = [
  { key: 'navigate', icon: 'Hand', label: 'Navigate', kbd: 'V' },
  { key: 'pin', icon: 'MapPin', label: 'Pin', kbd: 'P', gated: true },
  { key: 'doorways', icon: 'DoorOpen', label: 'Doorways', kbd: 'D', gated: true },
  { key: 'measure', icon: 'Ruler', label: 'Measure', kbd: 'M' },
];

const FUTURE_MODES = [];

function RailButton({ icon, label, kbd, active, disabled, soon, onClick }) {
  return (
    <button
      type="button"
      className={`vm-rail-btn${active ? ' vm-rail-active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
    >
      <Icon name={icon} size={18} strokeWidth={1.75} />
      <span className="vm-rail-tip" role="tooltip">
        {label}
        {kbd && !soon && <kbd>{kbd}</kbd>}
        {soon && <span className="vm-rail-tip-soon">coming soon</span>}
      </span>
    </button>
  );
}

export default function ToolRail({ mode, onMode, canPin, pinReady }) {
  return (
    <div className="vm-rail" role="toolbar" aria-label="Canvas tools" aria-orientation="vertical">
      {LIVE_MODES.map((m) => {
        if (m.gated && !canPin) return null;
        return (
          <RailButton
            key={m.key}
            icon={m.icon}
            label={m.label}
            kbd={m.kbd}
            active={mode === m.key}
            disabled={m.key !== 'navigate' && !pinReady}
            onClick={() => onMode(m.key)}
          />
        );
      })}
      {FUTURE_MODES.length > 0 && <div className="vm-rail-divider" />}
      {FUTURE_MODES.map((m) => (
        <RailButton key={m.key} icon={m.icon} label={m.label} disabled soon />
      ))}
    </div>
  );
}
