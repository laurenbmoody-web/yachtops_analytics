import React from 'react';
import { MOCK_CREW, DEPT_ORDER, MlcTriangle } from '../trip-detail-view-with-guest-allocation/sections/SectionCrew';

function avatarColors(onDuty) {
  return onDuty
    ? { bg: '#FAECE7', fg: '#7A2E1E' }
    : { bg: '#ECE6DC', fg: '#5C5440' };
}

function CrewRow({ crew, onClick }) {
  const isOff = crew.offToday;
  const onDuty = crew.onNow && !isOff;
  const { bg, fg } = avatarColors(onDuty);
  const restColor = crew.mlcWarning ? 'warning' : '';

  const pill = isOff
    ? { cls: 'off', label: 'Off' }
    : onDuty
      ? { cls: 'on', label: 'On now' }
      : { cls: 'off', label: 'Off now' };

  return (
    <div
      className={`crew-list-row${isOff ? ' off-day' : ''}`}
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
          {crew.role} · {crew.shiftText}
          {crew.mlcWarning && (
            <span style={{ color: '#C65A1A', fontWeight: 500 }}> · rest below MLC</span>
          )}
        </div>
      </div>

      {isOff ? (
        <div />
      ) : (
        <div className="crew-list-rest">
          <div className={`crew-list-rest-num ${restColor}`}>{crew.rest24h || '—'}</div>
          <div className="crew-list-rest-cap">Rest 24h</div>
        </div>
      )}

      <div className={`crew-list-pill ${pill.cls}`}>{pill.label}</div>
    </div>
  );
}

export default function CrewListView({ onCrewClick }) {
  const crew = MOCK_CREW;

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
      {orderedDepts.map(dept => (
        <div key={dept}>
          <div className="crew-list-dept">
            <span className="crew-list-dept-label">{dept} · {byDept.get(dept).length} crew</span>
            <span className="crew-list-dept-rule" />
          </div>
          {byDept.get(dept).map(c => (
            <CrewRow key={c.id} crew={c} onClick={onCrewClick} />
          ))}
        </div>
      ))}

      <div className="crew-rota-foot">
        <span>Tap a crew member for their week.</span>
        <span style={{ fontStyle: 'italic' }}>
          1 pending correction · <a href="#review" onClick={(e) => e.preventDefault()}>review</a>
        </span>
      </div>
    </div>
  );
}
