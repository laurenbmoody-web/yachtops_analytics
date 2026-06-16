import React, { useState } from 'react';

/**
 * Profile-completion affordance for the crew header. The percentage now lives
 * on the ring around the avatar; this renders the status badge (passed as
 * children) alongside an "outstanding" toggle that expands the list of missing
 * mandatory items — clicking an item jumps to the relevant tab.
 */
const ProfileCompletionMeter = ({ percent = 0, missing = [], onJump, children }) => {
  const [open, setOpen] = useState(false);
  const complete = percent >= 100;
  const hasMissing = missing.length > 0;

  return (
    <div className="cp-completion">
      <div className="cp-completion-row">
        {children}
        {complete ? (
          <span className="cp-complete-note">✓ Profile complete</span>
        ) : hasMissing ? (
          <button type="button" className="cp-outstanding" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide' : `· ${missing.length} outstanding ›`}
          </button>
        ) : null}
      </div>
      {open && hasMissing && (
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
