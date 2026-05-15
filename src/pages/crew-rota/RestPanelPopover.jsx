import React, { useEffect } from 'react';

// Hardcoded MLC rest mock data keyed by crew id. Real hours-of-rest
// math lands when the shifts table exists. Emma is the violation case;
// everyone else falls back to a compliant `_default`.
const MOCK_REST_DATA = {
  emma: {
    fullName: 'Emma Larsen',
    rest24h: '7h', required24h: '10h', short24h: '3h',
    longestBlock: '5h', secondBlock: '2h',
    rest7d: '58h', required7d: '77h', short7d: '19h',
    timeline: [
      { label: '5h rest', flex: 5, type: 'rest' },
      { label: '2h off', flex: 2, type: 'off' },
      { label: '2h rest', flex: 2, type: 'rest' },
      { label: '7h on duty', flex: 7, type: 'on' },
      { label: '4h sched', flex: 4, type: 'scheduled' },
      { label: '4h proj', flex: 4, type: 'projected' },
    ],
    weekDays: [
      { day: 'Sat', hours: 9, status: 'ok' },
      { day: 'Sun', hours: 11, status: 'ok' },
      { day: 'Mon', hours: 10, status: 'ok' },
      { day: 'Tue', hours: 8, status: 'low' },
      { day: 'Wed', hours: 9, status: 'ok' },
      { day: 'Thu', hours: 4, status: 'critical' },
      { day: 'Fri', hours: 7, status: 'critical', isToday: true },
    ],
    mlcWarning: true,
    onUntil: '22:00',
    nextSafe: '05:00 Saturday',
  },
  _default: {
    fullName: '',
    rest24h: '10h', required24h: '10h', short24h: null,
    longestBlock: '8h', secondBlock: '2h',
    rest7d: '72h', required7d: '77h', short7d: '5h',
    timeline: [
      { label: '8h rest', flex: 8, type: 'rest' },
      { label: '8h on duty', flex: 8, type: 'on' },
      { label: '4h sched', flex: 4, type: 'scheduled' },
      { label: '4h rest', flex: 4, type: 'rest' },
    ],
    weekDays: [
      { day: 'Sat', hours: 10, status: 'ok' },
      { day: 'Sun', hours: 11, status: 'ok' },
      { day: 'Mon', hours: 10, status: 'ok' },
      { day: 'Tue', hours: 10, status: 'ok' },
      { day: 'Wed', hours: 11, status: 'ok' },
      { day: 'Thu', hours: 10, status: 'ok' },
      { day: 'Fri', hours: 10, status: 'ok', isToday: true },
    ],
    mlcWarning: false,
    onUntil: null,
    nextSafe: null,
  },
};

const WarnTriangle = ({ size = 16, color = '#7A2E1E' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0 }}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
);

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const MAX_BAR_HOURS = 12;

export default function RestPanelPopover({ crew, onClose }) {
  // Body scroll lock + Escape close while the panel is mounted.
  useEffect(() => {
    if (!crew) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [crew, onClose]);

  if (!crew) return null;

  const base = MOCK_REST_DATA[crew.id] || MOCK_REST_DATA._default;
  const data = { ...base, fullName: base.fullName || crew.name };
  const warn = data.mlcWarning;

  const initials = crew.initials
    || crew.name?.slice(0, 2).toUpperCase()
    || '??';

  const roleLine = [
    crew.department,
    crew.role,
    warn && data.onUntil ? `ON NOW UNTIL ${data.onUntil}` : (crew.onNow ? 'ON NOW' : 'OFF NOW'),
  ].filter(Boolean).join(' · ').toUpperCase();

  const firstName = data.fullName.split(' ')[0];

  return (
    <>
      <div className="rest-popover-backdrop" onClick={onClose} />
      <div
        className={`rest-popover-panel${warn ? '' : ' compliant'}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${data.fullName} rest`}
      >

        {/* Identity header */}
        <div className="rest-id-row">
          <div className="rest-id-avatar">{initials}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="rest-id-name">
              {data.fullName}
              {warn && <span className="rest-id-pill">Below MLC</span>}
            </div>
            <div className="rest-id-role">{roleLine}</div>
          </div>
          <button type="button" className="rest-close" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        {/* Summary cards */}
        <div className="rest-cards">
          <div className={`rest-card ${warn ? 'warn' : 'sage'}`}>
            <div className="rest-card-label">Rest in the last 24h</div>
            <div className="rest-card-num">
              {data.rest24h}
              <span className="rest-card-req">/ {data.required24h} required</span>
            </div>
            <div className="rest-card-detail">
              {data.short24h
                ? `${data.short24h} short · longest block ${data.longestBlock}, second ${data.secondBlock}`
                : `Compliant · longest block ${data.longestBlock}, second ${data.secondBlock}`}
            </div>
          </div>
          <div className="rest-card plain">
            <div className="rest-card-label">Rest in the last 7 days</div>
            <div className="rest-card-num">
              {data.rest7d}
              <span className="rest-card-req">/ {data.required7d} required</span>
            </div>
            <div className="rest-card-detail">
              {data.short7d
                ? `${data.short7d} short · catching up on Sunday`
                : 'Compliant for the week'}
            </div>
          </div>
        </div>

        {/* 24h timeline strip */}
        <div className="rest-timeline-wrap">
          <div className="rest-timeline-label">Last 24 hours</div>
          <div className="rest-timeline">
            {data.timeline.map((seg, i) => (
              <div
                key={i}
                className={`rest-timeline-seg ${seg.type}`}
                style={{ flex: seg.flex }}
              >{seg.label}</div>
            ))}
          </div>
          <div className="rest-timeline-axis">
            <span>18:30 yesterday</span>
            <span>now</span>
            <span>18:30 tomorrow</span>
          </div>
        </div>

        {/* 7-day bar chart */}
        <div className="rest-week">
          <div className="rest-timeline-label">Rest by day · last 7</div>
          <div className="rest-week-grid">
            {/* Axis column — "10h" marker aligned to each bar's dashed line */}
            <div className="rest-week-col axis">
              <div className="rest-week-spacer-day" />
              <div className="rest-week-axis-box">
                <span className="rest-week-axis-10h">10h</span>
              </div>
              <div className="rest-week-spacer-hours" />
            </div>

            {data.weekDays.map((d) => {
              const pct = Math.min(100, (d.hours / MAX_BAR_HOURS) * 100);
              const fillClass =
                d.status === 'critical' ? 'critical' :
                d.status === 'low'      ? 'low'      : 'ok';
              const below10 = d.hours < 10;
              return (
                <div key={d.day} className={`rest-week-col${d.isToday ? ' today' : ''}`}>
                  <div className="rest-week-day">{d.day}</div>
                  <div className={`rest-week-bar${d.isToday ? ' today' : ''}`}>
                    <div className="rest-week-mlc-line" />
                    <div
                      className={`rest-week-fill ${fillClass}`}
                      style={{ height: `${pct}%` }}
                    />
                  </div>
                  <div className={`rest-week-hours${below10 ? ' warn' : ''}`}>
                    {d.hours}h{d.isToday ? ' so far' : ''}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* MLC warning banner — only when below MLC */}
        {warn && (
          <div className="rest-banner">
            <WarnTriangle />
            <div>
              <div className="rest-banner-title">MLC daily rest below 10 hours.</div>
              <div className="rest-banner-body">
                {firstName} cannot start her next shift before {data.nextSafe} without a
                logged operational reason. The system will require an approver and
                reason on save.
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="rest-actions">
          <button type="button" className="rest-btn primary">
            {warn ? 'Adjust shift' : 'View full schedule'}
          </button>
          {warn && (
            <button type="button" className="rest-btn ghost">Log violation reason</button>
          )}
          <button type="button" className="rest-btn ghost push">Hours of rest log →</button>
        </div>

      </div>
    </>
  );
}
