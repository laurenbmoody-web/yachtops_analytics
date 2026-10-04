import React from 'react';
import Icon from '../../../components/AppIcon';
import './safety-briefing.css';

// Post-sign-in safety induction. The visitor is already signed in; this is the
// acknowledgment step — they read the briefing and tap "I understand", which
// marks the visit inducted. Shown only for first-time visitors (returning
// visitors with a pass / recent record skip it).
const POINTS = [
  { icon: 'AlertTriangle', title: 'Emergency signal', body: 'Seven short blasts and one long = general alarm. Stop work and go to the muster station.' },
  { icon: 'MapPin', title: 'Muster station', body: 'A crew member will show you the nearest muster point and escape route on arrival.' },
  { icon: 'UserCheck', title: 'Stay escorted', body: "Remain in your work area. Don't enter cabins, the bridge or engine spaces without a crew escort." },
  { icon: 'HardHat', title: 'PPE & hazards', body: 'Wear required PPE. No smoking except in designated areas. Report any spill or hazard to crew at once.' },
  { icon: 'LifeBuoy', title: 'Man overboard', body: 'Shout "man overboard", point continuously, and raise a crew member immediately.' },
];

const SafetyBriefingModal = ({ name, busy, onConfirm, onClose }) => (
  <div className="sbrief-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
    <div className="sbrief" role="dialog" aria-modal="true" aria-label="Safety briefing">
      <div className="sbrief-head">
        <div>
          <p className="sbrief-eyebrow"><span className="dot">●</span> Signed in · {name}</p>
          <h2 className="sbrief-title">Safety <em>briefing</em>.</h2>
        </div>
        {onClose && (
          <button type="button" className="sbrief-x" onClick={onClose} title="Close"><Icon name="X" size={18} /></button>
        )}
      </div>
      <p className="sbrief-lead">Please read before going aboard. Ask any crew member if anything is unclear.</p>
      <ul className="sbrief-list">
        {POINTS.map((p) => (
          <li key={p.title} className="sbrief-item">
            <span className="sbrief-ic"><Icon name={p.icon} size={18} /></span>
            <span className="sbrief-txt">
              <span className="sbrief-h">{p.title}</span>
              <span className="sbrief-b">{p.body}</span>
            </span>
          </li>
        ))}
      </ul>
      <button type="button" className="sbrief-cta" onClick={onConfirm} disabled={busy}>
        <Icon name="Check" size={18} /> I understand
      </button>
    </div>
  </div>
);

export default SafetyBriefingModal;
