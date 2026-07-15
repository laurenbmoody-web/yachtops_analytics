// Charter-readiness gate. A vessel isn't charter-ready while an open High/Critical
// defect sits in a guest area — this banner surfaces that at a glance and lists the
// blockers so they can be cleared before guests step aboard. Self-contained on the
// defect data (guest-area + priority + status); no external calendar coupling.
import React from 'react';
import './CharterReadinessBanner.css';

const BLOCKING_PRIORITIES = ['Critical', 'High'];
const isBlocker = (d) => d?.affectsGuestAreas
  && BLOCKING_PRIORITIES.includes(d?.priority)
  && d?.status !== 'Closed' && d?.status !== 'declined';

export default function CharterReadinessBanner({ defects = [], onOpenDefect }) {
  const blockers = (defects || []).filter(isBlocker);
  const ready = blockers.length === 0;

  return (
    <div className={`crg${ready ? ' crg-ready' : ' crg-blocked'}`}>
      <div className="crg-head">
        <span className="crg-icon" aria-hidden="true">{ready ? '⚓' : '⚠'}</span>
        <div className="crg-headtext">
          <div className="crg-title">{ready ? 'Charter-ready' : `Not charter-ready — ${blockers.length} guest-area blocker${blockers.length === 1 ? '' : 's'}`}</div>
          <div className="crg-sub">
            {ready
              ? 'No open High or Critical defects in guest areas.'
              : 'Clear these High/Critical guest-area defects before guests are aboard.'}
          </div>
        </div>
      </div>
      {!ready && (
        <ul className="crg-list">
          {blockers.map((d) => (
            <li key={d.id}>
              <button className="crg-blocker" onClick={() => onOpenDefect?.(d.id)}>
                <span className={`crg-dot crg-${d.priority}`} />
                <span className="crg-b-title">{d.title}</span>
                <span className="crg-b-loc">{d.locationPathLabel || d.locationFreeText || '—'}</span>
                <span className="crg-b-open">Open ↗</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
