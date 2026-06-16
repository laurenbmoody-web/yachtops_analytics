import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { MlcTriangle } from '../trip-detail-view-with-guest-allocation/sections/SectionCrew';
import { getContrastText } from './crewDisplay';
import { groupAndOrderCrew } from './crewOrder';
import { useAuth } from '../../contexts/AuthContext';

const DEPT_BADGE_LABEL = { draft: 'Draft', pending_approval: 'Pending', published: 'Published' };

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

// Human-readable reason for a single failed MLC rule (from assessMlc's breach
// rows). Names the rest-based cause so the worked-hours figure isn't blamed.
function formatBreach(b) {
  const r = (v) => Math.round(Number(v) || 0);
  switch (b.rule) {
    case 'daily_rest_10h':
      return `only ${r(b.actual)}h rest in 24h (min ${b.limit}h)`;
    case 'weekly_rest_77h':
      return `only ${r(b.actual)}h rest in 7 days (min ${b.limit}h)`;
    case 'rest_period_split':
      return `rest split across ${b.actual?.periodCount} periods`;
    case 'max_work_stretch_14h':
      return `${r(b.actual)}h continuous on duty (max ${b.limit}h)`;
    default:
      return b.label || null;
  }
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

  // Spell out WHICH MLC rule is breaching — the breach is driven by the rest
  // pattern / rolling week, not by the hours worked, so name the actual rule.
  const breachReasons = (crew.mlcReport?.breaches || []).map(formatBreach).filter(Boolean);

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
                <span className="cl-istat"><span className="cl-istat-cap">Worked</span><span className="cl-istat-v">{crew.workHours || '—'}</span></span>
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
          {crew.mlcWarning && breachReasons.length > 0 && (
            <div className="cl-breach">
              <MlcTriangle size={11} />
              <span>MLC breach — {breachReasons.join(' · ')}</span>
            </div>
          )}
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

export default function CrewListView({ crew = [], onCrewClick, deptStatus = null }) {
  const { user, currentUser, tenantRole } = useAuth();
  const viewerTier = String(user?.permission_tier || tenantRole || '').toUpperCase();
  const viewerDeptId = currentUser?.department_id || null;

  // Identical ordering to the day grid: own department first, signed-in user
  // pinned to the top of their department, then canonical department order.
  const orderedGroups = groupAndOrderCrew(crew, {
    userId: user?.id || null,
    ownDeptId: viewerDeptId,
  });

  return (
    <div className="crew-list-view">
      {orderedGroups.map(([dept, members]) => {
        const color = members[0]?.departmentColor || '#5F5E5A';
        const deptId = members[0]?.departmentId || null;
        const statusRow = deptId && deptStatus ? deptStatus.get(deptId) : null;
        const badge = statusRow?.status
          ? (DEPT_BADGE_LABEL[statusRow.status] || statusRow.status)
          : null;
        const canSeeUnpublished = viewerTier === 'COMMAND' || (!!viewerDeptId && viewerDeptId === deptId);
        const showUnpublished = statusRow?.status === 'published'
          && statusRow?.hasUnpublishedChanges
          && canSeeUnpublished;

        return (
          <div key={dept} className="rota-dept-group">
            {(badge || showUnpublished) && (
              <div className="rota-dept-badges">
                {badge && <div className={`rota-dept-badge st-${statusRow.status}`}>{badge}</div>}
                {showUnpublished && (
                  <div className="rota-dept-badge st-unpublished" title="Edits made since this rota was published — not yet re-published">
                    Unpublished changes
                  </div>
                )}
              </div>
            )}
            <div className="rota-dept-body">
              <div
                className="rota-dept-strip"
                style={{ background: color, color: getContrastText(color) }}
                role="rowheader"
                aria-label={`${dept} department${badge ? ` — ${badge}` : ''}`}
              >
                <span className="rota-dept-strip-text">{dept}</span>
              </div>
              <div className="rota-dept-rows">
                {members.map(c => (
                  <CrewRow key={c.id} crew={c} onClick={onCrewClick} />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
