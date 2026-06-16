import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { DEPT_ORDER, MlcTriangle } from '../trip-detail-view-with-guest-allocation/sections/SectionCrew';

function avatarColors(onDuty) {
  return onDuty
    ? { bg: '#FAECE7', fg: '#7A2E1E' }
    : { bg: '#ECE6DC', fg: '#5C5440' };
}

function pad2(n) { return String(n).padStart(2, '0'); }

// Decimal hours (overnight blocks run past 24) → "HH:MM", wrapped to a 24h clock.
function decToHHMM(dec) {
  if (dec == null) return '';
  let total = Math.round(dec * 60);
  total = ((total % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

// Break down a member's on-duty blocks into the three things a crew member
// actually wants: when they start, when (and for how long) they break, and
// when they finish. Blocks come from crew.shifts (decimal start/end, on-duty
// only, overnight already extended past 24). The gaps between blocks are breaks.
function dayBreakdown(crew) {
  const blocks = [...(crew.shifts || [])].sort((a, b) => a.start - b.start);
  if (blocks.length === 0) return null;
  const breaks = [];
  for (let i = 1; i < blocks.length; i += 1) {
    const s = blocks[i - 1].end;
    const e = blocks[i].start;
    if (e > s) breaks.push({ start: s, end: e });
  }
  return {
    start: blocks[0].start,
    finish: blocks[blocks.length - 1].end,
    breaks,
    blocks,
  };
}

// 24-hour mini-timeline. Each on-duty block is positioned by its start/end as a
// fraction of the day; the empty space between blocks reads as the break.
function DayTimeline({ blocks, warn }) {
  return (
    <>
      <div className="cl-tl">
        {[25, 50, 75].map(p => <span key={p} className="cl-tl-tick" style={{ left: `${p}%` }} />)}
        {blocks.map((b, i) => {
          const left = Math.max(0, Math.min(100, (b.start / 24) * 100));
          const width = Math.max(2, Math.min(100 - left, ((b.end - b.start) / 24) * 100));
          return (
            <span
              key={i}
              className={`cl-tl-block${warn ? ' warn' : ''}`}
              style={{ left: `${left}%`, width: `${width}%` }}
            >
              <span className="cl-tl-edge">{decToHHMM(b.start)}</span>
              <span className="cl-tl-edge">{decToHHMM(b.end)}</span>
            </span>
          );
        })}
      </div>
      <div className="cl-tl-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
    </>
  );
}

function CrewRow({ crew, onClick }) {
  const [open, setOpen] = useState(false);
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
    open ? 'is-open' : '',
  ].filter(Boolean).join(' ');

  const bd = isOff ? null : dayBreakdown(crew);
  const breakText = bd && bd.breaks.length
    ? bd.breaks.map(b => `${decToHHMM(b.start)}–${decToHHMM(b.end)}`).join(', ')
    : 'none';

  const toggle = () => setOpen(o => !o);

  return (
    <div className={`crew-list-item${open ? ' is-open' : ''}`}>
      <div
        className={rowCls}
        onClick={toggle}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
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
            <span className="crew-list-role-name">{crew.role}</span>
            {bd ? (
              <>
                <span className="cl-istat"><span className="cl-istat-cap">Start</span><span className="cl-istat-v">{decToHHMM(bd.start)}</span></span>
                <span className="cl-istat"><span className="cl-istat-cap">Break</span><span className={`cl-istat-v${breakText === 'none' ? ' muted' : ''}`}>{breakText}</span></span>
                <span className="cl-istat"><span className="cl-istat-cap">Finish</span><span className="cl-istat-v">{decToHHMM(bd.finish)}</span></span>
                <span className="cl-istat"><span className="cl-istat-cap">Worked</span><span className={`cl-istat-v${crew.mlcWarning ? ' warn' : ''}`}>{crew.workHours || '—'}</span></span>
              </>
            ) : (
              <span className="cl-istat-off">off today</span>
            )}
            {crew.mlcWarning && <span className="cl-istat-warn">rest below MLC</span>}
          </div>
        </div>

        <div className={`crew-list-pill ${pill.cls}`}>{pill.label}</div>

        <ChevronDown className="crew-list-chev" size={16} aria-hidden="true" />
      </div>

      {open && (
        <div className="crew-list-detail">
          {bd ? (
            <>
              <DayTimeline blocks={bd.blocks} warn={crew.mlcWarning} />
              <div className="cl-detail-foot">
                <button
                  type="button"
                  className="cl-detail-link"
                  onClick={(e) => { e.stopPropagation(); onClick?.(crew); }}
                >Rest &amp; MLC detail →</button>
              </div>
            </>
          ) : (
            <div className="cl-off-msg">Off today — no scheduled hours.</div>
          )}
        </div>
      )}
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
