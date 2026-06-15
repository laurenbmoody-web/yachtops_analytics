import React, { useState } from 'react';

/**
 * Compact "profile completion" meter for the crew header.
 * Shows % complete + an expandable list of outstanding mandatory items;
 * clicking an item jumps to the relevant tab.
 */
const ProfileCompletionMeter = ({ percent = 0, missing = [], onJump }) => {
  const [open, setOpen] = useState(false);
  const complete = percent >= 100;

  return (
    <div className="cp-completion">
      <div className="cp-completion-top">
        <span className="cp-completion-pct">{complete ? 'Profile complete' : `${percent}% complete`}</span>
        {missing.length > 0 && (
          <button type="button" className="cp-completion-toggle" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide' : `${missing.length} outstanding`}
          </button>
        )}
      </div>
      <div className="cp-completion-bar">
        <div className={`cp-completion-fill${complete ? ' is-complete' : ''}`} style={{ width: `${percent}%` }} />
      </div>
      {open && missing.length > 0 && (
        <div className="cp-completion-missing">
          {missing.map((m) => (
            <button key={m.key} type="button" className="cp-completion-chip" onClick={() => onJump?.(m.tab)}>
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProfileCompletionMeter;
