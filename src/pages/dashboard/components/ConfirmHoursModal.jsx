import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import TimeWheel from '../../../components/editorial/TimeWheel';
import { upsertWorkEntryDay } from '../../crew-profile/utils/horWorkEntries';
import './confirm-hours-modal.css';

// End-of-day "confirm your hours" sheet. Opens the same iPhone-alarm wheel the
// HOR log uses (TimeWheel), pre-filled with the scheduled On/Off. Confirming
// writes the actual on-duty blocks to hor_work_entries for the day — which
// overrides the planned shift in the rest calc. No sign-off needed to log your
// own day (that's the month/breach-reason step, per vessels.hor_* settings).

const toIdx = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 2 + (m >= 30 ? 1 : 0);
};

// Build the 30-min block indices [start, end) + a type map. If end <= start the
// shift wraps past midnight; log to the end of this day (48) — the post-midnight
// portion belongs to the next day, which the full HOR page handles precisely.
function buildSegments(start, end, type) {
  const s = toIdx(start);
  let e = toIdx(end);
  if (e <= s) e = 48;
  const segs = [];
  const types = {};
  for (let i = s; i < e && i < 48; i += 1) { segs.push(i); types[i] = type; }
  return { segs, types };
}

const Arrow = () => (
  <svg width="34" height="10" viewBox="0 0 40 10" fill="none" aria-hidden="true">
    <path d="M0 5h34m0 0-5-4m5 4-5 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function ConfirmHoursModal({
  date, dateLabel, defaultStart, defaultEnd, type = 'duty',
  tenantId, subjectUserId, onClose, onSaved,
}) {
  const [start, setStart] = useState(defaultStart || '08:00');
  const [end, setEnd] = useState(defaultEnd || '12:00');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const { segs, types } = buildSegments(start, end, type);
      await upsertWorkEntryDay({ tenantId, subjectUserId, date, workSegments: segs, segmentTypes: types });
      onSaved?.();
      onClose?.();
    } catch (e) {
      console.error('[ConfirmHoursModal] save failed:', e);
      setErr('Couldn’t save — try again.');
      setSaving(false);
    }
  };

  return createPortal(
    <div className="chm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="chm-sheet" role="dialog" aria-label="Confirm your hours" aria-modal="true">
        <div className="chm-title">Your hours{dateLabel ? ` · ${dateLabel}` : ''}</div>
        <div className="chm-sub">Scroll to your actual start &amp; finish</div>
        <div className="chm-wheels">
          <div className="chm-col">
            <div className="chm-lb">On</div>
            <TimeWheel value={start} onChange={setStart} ariaLabel="Actual start time" className="chm-time" />
          </div>
          <span className="chm-ar"><Arrow /></span>
          <div className="chm-col">
            <div className="chm-lb">Off</div>
            <TimeWheel value={end} onChange={setEnd} ariaLabel="Actual finish time" className="chm-time" />
          </div>
        </div>
        {err && <div className="chm-err">{err}</div>}
        <button type="button" className="chm-confirm" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Confirm — updates Hours of Rest'}
        </button>
        <button type="button" className="chm-cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>,
    document.body,
  );
}
