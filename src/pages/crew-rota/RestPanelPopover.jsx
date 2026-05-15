import React, { useEffect } from 'react';

// ── Mock rest data (Section 3 locked reference) ─────────────────────────────
//
// Hardcoded per crew id. Emma is the MLC-violation case (all 7 sections);
// everyone else falls back to `_default` (compliant variant — sections 2
// and 6 hidden). Real MLC math / AI suggestions land when the shifts
// table exists. HTML in *Headline/*Body/*Summary fields is intentional
// (em/strong) and rendered via dangerouslySetInnerHTML into classed spans.

const MOCK_REST_DATA = {
  emma: {
    fullName: 'Emma Larsen',
    mlcWarning: true,
    onUntil: '22:00',
    rest24hLabel: '7h rest so far',
    pastWeekLabel: 'Past week 63h',
    bannerHeadline: 'Emma\'s rest in the last 24 hours came in <em>two short blocks</em> — 5 hours, then 2 hours.',
    bannerBody: 'MLC requires <strong>10 hours of rest in any 24-hour window, with at least one block of 6 hours</strong>. She\'s 3h short on total rest, and her longest block (5h) is below the 6h minimum. To return to compliance, her next shift cannot start before <strong>05:00 Saturday</strong> without a logged operational reason.',
    timelineMeta: '18:30 yesterday → now',
    timelineSummary: '7h rest · 13h on duty · 4h other off-time',
    timeline: [
      { label: '4h off-duty', sub: '18:30 — 22:30 yest', flex: 4, type: 'off' },
      { label: '5h rest', sub: '22:30 yest — 03:30', flex: 5, type: 'rest' },
      { label: '4h on duty', sub: 'duty · early service', flex: 4, type: 'on' },
      { label: '2h rest', sub: null, flex: 2, type: 'rest' },
      { label: '9h on duty', sub: 'duty · service · still on', flex: 9, type: 'on' },
    ],
    chartMeta: 'Rolling 7d rest · evolving by day',
    chartSummary: '63h projected by tonight',
    chartShort: '14h short',
    chartShortOf: '77h weekly minimum',
    weekChart: [
      { day: 'Sat', hours: 75, status: 'ok' },
      { day: 'Sun', hours: 79, status: 'ok' },
      { day: 'Wed', hours: 75, status: 'low', confirmed: true },
      { day: 'Thu', hours: 68, status: 'low', confirmed: true },
      { day: 'Fri', hours: 63, status: 'low', isToday: true },
      { day: 'Sat', hours: 66, status: 'low', projected: true, label: 'Sat · proj' },
      { day: 'Sun', hours: 79, status: 'ok', projected: true, label: 'Sun · proj' },
    ],
    tripMeta: 'This trip so far · day 3 of 5',
    tripSummary: 'Emma has worked <em>41 hours</em> across the first three days of the Marchetti charter.',
    tripStats: [
      { num: '29h', label: 'Duty', sub: '71% of her trip work' },
      { num: '8h', label: 'Standby · support', sub: '19% · scheduled forward' },
      { num: '4h', label: 'Watch · anchor', sub: '10% · overnight cover' },
      { num: '2', label: 'Logged violations', sub: 'Wed + Thu · acknowledged', warn: true },
    ],
    suggestions: [
      {
        type: 'confident',
        pill: 'Confident swap',
        headline: 'Move Emma\'s <em>Saturday 8h standby · support</em> to Marco.',
        body: 'Marco has 19h spare across the rolling week and is qualified to cover bridge support. Emma takes the day clear, recovers fully by Sunday.',
        effects: [
          { name: 'Emma · 3rd stew', from: '63h', to: '79h ✓', fromColor: '#7A2E1E', toColor: '#2D5A3A', note: 'By Sunday · compliant' },
          { name: 'Marco · 2nd stew', from: '96h', to: '88h ✓', fromColor: '#2D5A3A', toColor: '#2D5A3A', note: 'By Sunday · still compliant' },
        ],
        primaryAction: 'Apply this swap',
        secondaryAction: 'Preview on rota',
      },
      {
        type: 'judgment',
        pill: 'Needs your judgment',
        headline: 'Extend Emma\'s Sunday off back into <em>Saturday afternoon</em> — 4h reduction.',
        body: 'Saturday afternoon turn-down currently runs Emma — needs reassigning to Claire or Sophie. Lighter cover but not zero.',
        effects: [
          { name: 'Emma · 3rd stew', from: '63h', to: '73h ✓', fromColor: '#7A2E1E', toColor: '#2D5A3A', note: 'By Sunday · just compliant' },
          { name: 'Coverage gap', from: null, to: 'Saturday turn-down', fromColor: null, toColor: '#7A2E1E', note: 'Needs reassignment', noteColor: '#7A2E1E' },
        ],
        primaryAction: 'Reassign & apply',
        secondaryAction: 'Preview on rota',
      },
    ],
  },
  _default: {
    fullName: '',
    mlcWarning: false,
    onUntil: null,
    rest24hLabel: '10h rest today',
    pastWeekLabel: 'Past week 82h',
    bannerHeadline: null,
    bannerBody: null,
    timelineMeta: '18:30 yesterday → now',
    timelineSummary: '10h rest · 8h on duty · 6h other off-time',
    timeline: [
      { label: '6h rest', sub: '18:30 — 00:30', flex: 6, type: 'rest' },
      { label: '4h rest', sub: '00:30 — 04:30', flex: 4, type: 'rest' },
      { label: '8h on duty', sub: 'duty · service', flex: 8, type: 'on' },
      { label: '4h sched', sub: 'duty · scheduled', flex: 4, type: 'scheduled' },
      { label: '2h rest', sub: null, flex: 2, type: 'rest' },
    ],
    chartMeta: 'Rolling 7d rest · evolving by day',
    chartSummary: '82h projected by tonight',
    chartShort: null,
    chartShortOf: null,
    weekChart: [
      { day: 'Sat', hours: 80, status: 'ok' },
      { day: 'Sun', hours: 82, status: 'ok' },
      { day: 'Wed', hours: 81, status: 'ok' },
      { day: 'Thu', hours: 80, status: 'ok' },
      { day: 'Fri', hours: 82, status: 'ok', isToday: true },
      { day: 'Sat', hours: 83, status: 'ok', projected: true, label: 'Sat · proj' },
      { day: 'Sun', hours: 84, status: 'ok', projected: true, label: 'Sun · proj' },
    ],
    tripMeta: 'This trip so far · day 3 of 5',
    tripSummary: null,
    tripStats: [
      { num: '24h', label: 'Duty', sub: '80% of trip work' },
      { num: '4h', label: 'Standby', sub: '13% · scheduled' },
      { num: '2h', label: 'Training', sub: '7% · safety drill' },
    ],
    suggestions: [],
  },
};

const CHART_SCALE = 100; // y-axis tops out at 100h
const MLC_WEEKLY = 77;

const WarnTriangle = ({ size = 20, color = '#7A2E1E' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0, marginTop: 2 }}>
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

function SectionHead({ label }) {
  return <div className="rest-section-label">{label}</div>;
}

export default function RestPanelPopover({ crew, onClose }) {
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

  const initials = crew.initials || crew.name?.slice(0, 2).toUpperCase() || '??';
  const roleLine = [
    crew.department,
    crew.role,
    warn && data.onUntil ? `ON DUTY NOW UNTIL ${data.onUntil}` : (crew.onNow ? 'ON DUTY NOW' : 'OFF DUTY'),
  ].filter(Boolean).join(' · ').toUpperCase();

  const tripSummaryHtml = data.tripSummary
    || `<em>${data.fullName}</em> has worked steadily across the first three days of the Marchetti charter.`;

  return (
    <>
      <div className="rest-popover-backdrop" onClick={onClose} />
      <div
        className={`rest-popover-panel${warn ? '' : ' compliant'}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${data.fullName} rest`}
      >

        {/* 1 · Identity header */}
        <div className="rest-id-row">
          <div className="rest-id-avatar">{initials}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="rest-id-name">
              {data.fullName}
              {warn && <span className="rest-id-pill">Below MLC daily</span>}
            </div>
            <div className="rest-id-role">{roleLine}</div>
            <div className="rest-id-sub">
              Today · <b>{data.rest24hLabel}</b> · <b>{data.pastWeekLabel}</b>
            </div>
          </div>
          <button type="button" className="rest-close" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        {/* 2 · Narrative compliance banner (violation only) */}
        {warn && data.bannerHeadline && (
          <div className="rest-banner">
            <WarnTriangle />
            <div>
              <div
                className="rest-banner-headline"
                dangerouslySetInnerHTML={{ __html: data.bannerHeadline }}
              />
              <div
                className="rest-banner-body"
                dangerouslySetInnerHTML={{ __html: data.bannerBody }}
              />
            </div>
          </div>
        )}

        {/* 3 · 24h timeline with shift-type sub-labels */}
        <div className="rest-section">
          <SectionHead label={`LAST 24 HOURS · ${data.timelineMeta.toUpperCase()}`} />
          <div className="rest-section-summary">{data.timelineSummary}</div>
          <div className="rest-timeline-strip">
            {data.timeline.map((seg, i) => (
              <div
                key={i}
                className={`rest-seg ${seg.type}`}
                style={{ flex: seg.flex }}
              >
                <div className="rest-seg-label">{seg.label}</div>
                {seg.sub && <div className="rest-seg-sub">{seg.sub}</div>}
              </div>
            ))}
            <div className="rest-timeline-now" />
          </div>
          <div className="rest-timeline-axis">
            <span>18:30 yesterday</span>
            <span style={{ color: '#C65A1A', fontWeight: 500 }}>↑ now</span>
          </div>
        </div>

        {/* 4 · Rolling 7-day rest chart */}
        <div className="rest-section">
          <SectionHead label={data.chartMeta.toUpperCase()} />
          <div className="rest-section-summary">
            {data.chartSummary}
            {data.chartShort && (
              <> · <span style={{ color: '#7A2E1E' }}>{data.chartShort}</span> of {data.chartShortOf}</>
            )}
          </div>
          <div className="rest-chart-row">
            <div className="rest-chart-axis">
              <span>{CHART_SCALE}h</span>
              <span className="mlc">{MLC_WEEKLY}h</span>
              <span>0h</span>
            </div>
            {data.weekChart.map((d, i) => {
              const pct = Math.min(100, (d.hours / CHART_SCALE) * 100);
              const compliant = d.hours >= MLC_WEEKLY;
              const barCls = [
                'rest-chart-bar',
                d.isToday ? 'today' : '',
                d.projected ? 'projected' : '',
              ].filter(Boolean).join(' ');
              return (
                <div key={i} className="rest-chart-col">
                  <div className={barCls}>
                    {d.isToday && <span className="rest-chart-today">TODAY</span>}
                    <div className="rest-mlc-line" />
                    <div
                      className={`rest-chart-fill ${compliant ? 'ok' : 'low'}`}
                      style={{ height: `${pct}%` }}
                    />
                    <span
                      className="rest-chart-value"
                      style={{ color: compliant ? '#2D5A3A' : '#7A2E1E' }}
                    >
                      {d.hours}h{d.confirmed ? ' ✓' : ''}
                    </span>
                  </div>
                  <div className={`rest-chart-day${d.isToday ? ' today' : ''}${d.projected ? ' proj' : ''}`}>
                    {d.label || (d.isToday ? `${d.day} · today` : d.day)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 5 · Trip insights with shift-type breakdown */}
        <div className="rest-section">
          <SectionHead label={data.tripMeta.toUpperCase()} />
          <div
            className="rest-section-summary"
            dangerouslySetInnerHTML={{ __html: tripSummaryHtml }}
          />
          <div
            className="rest-insight-grid"
            style={{ gridTemplateColumns: `repeat(${data.tripStats.length}, 1fr)` }}
          >
            {data.tripStats.map((s, i) => (
              <div key={i} className={`rest-insight-stat${s.warn ? ' warn' : ''}`}>
                <div className="rest-insight-num">{s.num}</div>
                <div className="rest-insight-label">{s.label}</div>
                <div className="rest-insight-sub">{s.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 6 · AI suggestions (violation only) */}
        {warn && data.suggestions.length > 0 && (
          <div className="rest-section">
            <SectionHead label="WORTH CONSIDERING" accent />
            <div className="rest-section-summary">
              Two ways to bring {data.fullName.split(' ')[0]} into compliance without losing coverage.
            </div>
            {data.suggestions.map((sg, i) => (
              <div key={i} className={`rest-suggestion ${sg.type}`}>
                <span className={`rest-conf-pill ${sg.type}`}>{sg.pill}</span>
                <div
                  className="rest-suggestion-headline"
                  dangerouslySetInnerHTML={{ __html: sg.headline }}
                />
                <div className="rest-suggestion-body">{sg.body}</div>
                <div className="rest-effect-row">
                  {sg.effects.map((ef, j) => (
                    <div key={j} className="rest-effect">
                      <div className="rest-effect-name">{ef.name}</div>
                      <div className="rest-effect-change">
                        {ef.from && (
                          <>
                            <span style={{ color: ef.fromColor }}>{ef.from}</span>
                            <span style={{ color: '#8B8478' }}> → </span>
                          </>
                        )}
                        <span style={{ color: ef.toColor }}>{ef.to}</span>
                      </div>
                      <div
                        className="rest-effect-note"
                        style={ef.noteColor ? { color: ef.noteColor } : undefined}
                      >{ef.note}</div>
                    </div>
                  ))}
                </div>
                <div className="rest-actions">
                  <button type="button" className="rest-btn primary">{sg.primaryAction}</button>
                  <button type="button" className="rest-btn ghost">{sg.secondaryAction}</button>
                </div>
              </div>
            ))}
            <div className="rest-suggestion-why">
              Suggestions weigh MLC compliance against guest service coverage and crew
              qualifications.{' '}
              <a href="#why" onClick={(e) => e.preventDefault()}>Why these two?</a>
            </div>
          </div>
        )}

        {/* 7 · Action buttons + footer */}
        <div className="rest-actions">
          {warn ? (
            <>
              <button type="button" className="rest-btn primary">Adjust shift</button>
              <button type="button" className="rest-btn ghost">Log violation reason</button>
              <button type="button" className="rest-btn ghost">Add note</button>
            </>
          ) : (
            <button type="button" className="rest-btn primary">View full schedule</button>
          )}
          <button type="button" className="rest-btn ghost push">Hours of rest log →</button>
        </div>
        <div className="rest-footer-prose">
          Once the rota is locked for tomorrow, {data.fullName.split(' ')[0]} sees her
          next 24 hours and any pending corrections she's submitted.
        </div>

      </div>
    </>
  );
}
