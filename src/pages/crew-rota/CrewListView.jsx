import React from 'react';
import { DEPT_ORDER, MlcTriangle } from '../trip-detail-view-with-guest-allocation/sections/SectionCrew';

function avatarColors(onDuty) {
  return onDuty
    ? { bg: '#FAECE7', fg: '#7A2E1E' }
    : { bg: '#ECE6DC', fg: '#5C5440' };
}

// "today 08:00–14:00, 18:00–22:00" → "08:00–14:00 · 18:00–22:00"
// Strips the leading "today ", swaps comma separators for middots,
// normalises hyphen ranges to en-dashes. Non-time shift text
// (e.g. "off today, back Saturday 08:00") is left readable.
function formatShift(shiftText) {
  if (!shiftText) return '';
  const cleaned = shiftText.replace(/^today\s+/i, '');
  return cleaned
    .split(', ')
    .map(s => s.replace(/-/g, '–'))
    .join(' · ');
}

function CrewRow({ crew, onClick }) {
  const isOff = crew.offToday;
  const onDuty = crew.onNow && !isOff;
  const { bg, fg } = avatarColors(onDuty);

  const pill = isOff
    ? { cls: 'off', label: 'Off' }
    : onDuty
      ? { cls: 'on', label: 'On now' }
      : { cls: 'off', label: 'Off now' };

  const rowCls = [
    'crew-list-row',
    isOff ? 'off-day' : '',
    crew.mlcWarning ? 'mlc-warn' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={rowCls}
      onClick={() => onClick?.(crew)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(crew); }
      }}
    >
      <div className="crew-list-avatar" style={{ background: bg, color: fg }}>
        {crew.initials}
      </div>

      <div>
        <div className="crew-list-name">
          {crew.name}
          {crew.mlcWarning && <MlcTriangle />}
        </div>
        <div className="crew-list-role">
          {crew.role} · {formatShift(crew.shiftText)}
          {crew.mlcWarning && (
            <span style={{ color: '#C65A1A', fontWeight: 500 }}> · rest below MLC</span>
          )}
        </div>
      </div>

      {isOff ? (
        <div />
      ) : (
        <div className="crew-list-rest">
          <div className={`crew-list-rest-num ${crew.mlcWarning ? 'warning' : ''}`}>
            {crew.workHours || '—'} <span className="crew-list-rest-on">on</span>
          </div>
          <div className="crew-list-rest-cap">{crew.offHours || '—'} off</div>
        </div>
      )}

      <div className={`crew-list-pill ${pill.cls}`}>{pill.label}</div>
    </div>
  );
}

export default function CrewListView({ crew = [], onCrewClick }) {
  const byDept = new Map();
  for (const c of crew) {
    const d = c.department || 'Other';
    if (!byDept.has(d)) byDept.set(d, []);
    byDept.get(d).push(c);
  }
  const orderedDepts = [
    ...DEPT_ORDER.filter(d => byDept.has(d)),
    ...Array.from(byDept.keys()).filter(d => !DEPT_ORDER.includes(d)),
  ];

  return (
    <div>
      {orderedDepts.map((dept, idx) => (
        <div key={dept}>
          <div className={`crew-list-dept${idx === 0 ? ' first' : ''}`}>
            <span className="crew-list-dept-label">{dept} · {byDept.get(dept).length} crew</span>
            <span className="crew-list-dept-rule" />
          </div>
          {byDept.get(dept).map(c => (
            <CrewRow key={c.id} crew={c} onClick={onCrewClick} />
          ))}
        </div>
      ))}
    </div>
  );
}
