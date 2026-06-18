import React, { useEffect, useState } from 'react';
import { useRotaRestData } from './useRotaRestData';

// Rest-panel data is computed live from rota_shifts (useRotaRestData).
// Identity (name/role/department/status) comes from the passed `crew`
// object (a useRotaShifts-derived member). Trip insights + AI
// suggestions remain hardcoded placeholders in the hook — trip + AI
// engine are later steps.

const CHART_SCALE = 100; // y-axis tops out at 100h
const MLC_WEEKLY = 77;
const MLC_DAILY = 10;

// dd/mm/yyyy (zero-padded) per the Cargo date convention.
function fmtDMY(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

function SectionHead({ label, tag, tagState }) {
  return (
    <div className="rest-section-head">
      <div className="rest-section-label">{label}</div>
      {tag && <div className={`rest-section-tag ${tagState || ''}`}>{tag}</div>}
    </div>
  );
}

export default function RestPanelPopover({ crew, onClose, onViewSchedule, onOpenHor, onLogReason, onApplySuggestion, roster = [], windowShifts = [], anchorDate = null }) {
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

  // Hook must run unconditionally (before the early return). It no-ops
  // when crew is null and returns null data while the query is in flight.
  const { data: restData, suggestions, suggestionsLoading } = useRotaRestData(
    crew?.id, crew?.name, crew?.role, crew?.department, anchorDate,
    { sourceMember: crew, roster, windowShifts },
  );

  // Locally dismissed suggestions (reset when the panel switches crew).
  const [dismissed, setDismissed] = useState([]);
  useEffect(() => { setDismissed([]); }, [crew?.id]);
  const visibleCount = suggestions.filter((_, i) => !dismissed.includes(i)).length;
  // True only if at least one still-visible option actually clears the breach.
  // When none do (e.g. a structural breach from already-worked hours), the
  // summary must not promise to bring the crew "into compliance".
  const anyResolves = suggestions.some((s, i) => !dismissed.includes(i) && s.resolves);

  if (!crew) return null;

  if (!restData) {
    return (
      <>
        <div className="rest-popover-backdrop" onClick={onClose} />
        <div className="rest-popover-panel" role="dialog" aria-modal="true" aria-label="Loading rest panel">
          <div style={{
            padding: '40px 0', textAlign: 'center',
            fontFamily: 'var(--font-sans)', fontSize: 13,
            color: 'var(--ink-muted)', fontStyle: 'italic',
          }}>
            Loading rest data…
          </div>
        </div>
      </>
    );
  }

  const data = { ...restData, fullName: crew.name };
  const warn = data.mlcWarning;
  // Proactive path: today is compliant, but the 2-day projection dips below
  // 77h. The suggestions section still opens — framed as staying ahead of a
  // breach rather than clearing a present one.
  const lookaheadLow = data.lookaheadLow;
  const showSuggestions = warn || lookaheadLow;
  const firstName = data.fullName.split(' ')[0];
  // A reason already recorded for this breach day — shown instead of the
  // suggestions, so a justified breach isn't re-prompted to be re-logged.
  const loggedReason = warn ? data.loggedReason : null;

  const initials = crew.initials || crew.name?.slice(0, 2).toUpperCase() || '??';
  // Status segment of the role line, driven by the live crew flags:
  //  - off today        → OFF DUTY
  //  - on now           → ON DUTY NOW [UNTIL hh:mm] (until time from crew)
  //  - otherwise        → OFF NOW (shift finished earlier today)
  const statusLabel = crew.offToday
    ? 'OFF DUTY'
    : crew.onNow
      ? (crew.onUntil ? `ON DUTY NOW UNTIL ${crew.onUntil}` : 'ON DUTY NOW')
      : 'OFF NOW';
  const roleLine = [
    crew.department,
    crew.role,
    statusLabel,
  ].filter(Boolean).join(' · ').toUpperCase();

  // Per-section MLC compliance tags, each scoped to the rule's window:
  //  · Daily covers the 10h-rest rule + today's rest-split rule.
  //  · Weekly covers the 77h rolling rule + the 14h continuous-duty rule
  //    (both assessed across the 7-day window). The hours shortfall takes
  //    precedence over the structural note when both apply.
  const dailyBad = data.dailyBelow || data.splitBreach;
  const dailyTag = data.dailyBelow
    ? `${MLC_DAILY - data.dailyHours}h short of ${MLC_DAILY}h minimum`
    : data.splitBreach
      ? 'rest split breaches MLC'
      : `meets ${MLC_DAILY}h minimum ✓`;
  const weeklyBad = data.weeklyBelow || data.stretchBreach;
  const weeklyTag = data.weeklyBelow
    ? `${MLC_WEEKLY - data.weeklyHours}h short of ${MLC_WEEKLY}h minimum`
    : data.stretchBreach
      ? 'over 14h continuous on duty'
      : `meets ${MLC_WEEKLY}h minimum ✓`;

  const tripSummaryHtml = data.daysWorked > 0
    ? `<em>${data.fullName}</em> worked <strong>${data.onDutyWeekLabel}</strong> on duty across <strong>${data.daysWorked}</strong> day${data.daysWorked === 1 ? '' : 's'} in the last 7 days.`
    : `<em>${data.fullName}</em> has no on-duty hours rostered in the last 7 days.`;

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
              {warn && <span className="rest-id-pill">{data.mlcChip || 'Below MLC'}</span>}
            </div>
            <div className="rest-id-role">{roleLine}</div>
            {/* The chip names the breach; the per-section MLC tags below carry
               the numbers, so breaching crew need no extra header summary.
               Compliant crew keep the quick rest/week sub-line. */}
            {!warn && (
              <div className="rest-id-sub">
                Today · <b>{data.rest24hLabel}</b> · <b>{data.pastWeekLabel}</b>
              </div>
            )}
          </div>
          <button type="button" className="rest-close" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        {/* 3 · Daily rest — 24h timeline with shift-type sub-labels */}
        <div className="rest-section">
          <SectionHead
            label="DAILY REST · TODAY"
            tag={dailyTag}
            tagState={dailyBad ? 'bad' : 'ok'}
          />
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
          </div>
          <div className="rest-timeline-axis">
            <span>{data.timelineStart}</span>
            <span>{data.timelineEnd}</span>
          </div>
        </div>

        {/* 4 · Weekly rest — rolling 7-day chart */}
        <div className="rest-section">
          <SectionHead
            label="WEEKLY REST · ROLLING 7 DAYS"
            tag={weeklyTag}
            tagState={weeklyBad ? 'bad' : 'ok'}
          />
          {/* Shortfall now lives in the section tag; summary stays the trend line. */}
          <div className="rest-section-summary">{data.chartSummary}</div>
          {/* Columns are data-driven: 7 trailing bars + 2 projected forward days.
             A hairline divider before the projected pair separates record from
             forecast without crowding the modal. */}
          <div
            className="rest-chart-row"
            style={{ gridTemplateColumns: `40px repeat(${data.weekChart.length}, 1fr)`, gap: 6 }}
          >
            <div className="rest-chart-axis">
              <span>{CHART_SCALE}h</span>
              <span className="mlc">{MLC_WEEKLY}h</span>
              <span>0h</span>
            </div>
            {data.weekChart.map((d, i) => {
              const pct = Math.min(100, (d.hours / CHART_SCALE) * 100);
              const compliant = d.hours >= MLC_WEEKLY;
              // First projected day gets a hairline rule before it, splitting
              // the worked record (left) from the 2-day forecast (right).
              const firstProjected = d.projected && !data.weekChart[i - 1]?.projected;
              const barCls = [
                'rest-chart-bar',
                d.isToday ? 'today' : '',
                d.projected ? 'projected' : '',
              ].filter(Boolean).join(' ');
              return (
                <div
                  key={i}
                  className={`rest-chart-col${firstProjected ? ' proj-start' : ''}`}
                >
                  <div className={barCls}>
                    <div className="rest-mlc-line" />
                    {/* Neutral fill; a THIN outline encodes compliance (green ≥77h,
                        terracotta below). Today also gets a tinted fill. */}
                    <div
                      className={`rest-chart-fill ${compliant ? 'ok' : 'low'}${d.isToday ? ' today' : ''}`}
                      style={{ height: `${pct}%` }}
                    >
                      <span className="rest-chart-value">
                        {d.hours}h{d.confirmed ? ' ✓' : ''}
                      </span>
                    </div>
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

        {/* 6 · Reason already logged — supersedes the suggestions for a breach
           the chief has accepted and justified. */}
        {loggedReason && (
          <div className="rest-section">
            <SectionHead
              label="VIOLATION REASON"
              tag={loggedReason.signedOff ? 'signed off ✓' : 'recorded'}
              tagState="ok"
            />
            <div className="rest-reason-note">“{loggedReason.note}”</div>
            <div className="rest-reason-meta">
              {loggedReason.signedOff ? 'Signed off' : 'Recorded'}
              {loggedReason.by ? ` by ${loggedReason.by}` : ''}
              {loggedReason.at ? ` · ${fmtDMY(loggedReason.at)}` : ''}
            </div>
          </div>
        )}

        {/* 6b · AI suggestions — present breach OR a projected forward dip */}
        {!loggedReason && showSuggestions && (suggestionsLoading || visibleCount > 0) && (
          <div className="rest-section">
            <SectionHead label="WORTH CONSIDERING" accent />
            <div className="rest-section-summary">
              {suggestionsLoading
                ? (lookaheadLow
                    ? `Looking for ways to keep ${firstName} above the line over the next 2 days…`
                    : `Looking for ways to bring ${firstName} back into compliance…`)
                : lookaheadLow
                  ? `${visibleCount === 1 ? 'A way' : `${visibleCount} ways`} to ease the days ahead so ${firstName} stays above 77h — trim now, while there's still time.`
                  : anyResolves
                    ? `${visibleCount === 1 ? 'A way' : `${visibleCount} ways`} to bring ${firstName} into compliance without losing coverage.`
                    : `${visibleCount === 1 ? 'One option' : `${visibleCount} options`} to ease ${firstName}’s load — but the current breach can’t be cleared by rescheduling alone.`}
            </div>
            {suggestions.map((sg, i) => (dismissed.includes(i) ? null : (
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
                  <button
                    type="button"
                    className="rest-btn primary"
                    onClick={() => (sg.freedBlock && onApplySuggestion
                      ? onApplySuggestion(sg)
                      : onViewSchedule())}
                  >{sg.primaryAction}</button>
                  <button type="button" className="rest-btn ghost" onClick={() => setDismissed((d) => [...d, i])}>{sg.secondaryAction}</button>
                </div>
              </div>
            )))}
            <div className="rest-suggestion-why">
              Suggested from this rota — the before/after rest figures are calculated by
              Cargo’s MLC engine. Always confirm coverage before applying.
            </div>
          </div>
        )}

        {/* 6c · Honest empty state — breach (or projected dip) stands but
           nothing actionable to offer */}
        {!loggedReason && showSuggestions && !suggestionsLoading && visibleCount === 0 && (
          <div className="rest-section">
            <SectionHead label="WORTH CONSIDERING" accent />
            <div className="rest-empty-note">
              {lookaheadLow
                ? `The projected dip comes from shifts that can’t be eased without leaving
                   the watch short — no coverage-safe trim to suggest. Keep an eye on it,
                   or adjust ${firstName}’s upcoming rota manually.`
                : `No coverage-safe fix to suggest — the department is fully on duty during
                   ${firstName}’s watches, and this breach is from hours already worked. Log a
                   reason or adjust the rota manually.`}
            </div>
          </div>
        )}

        {/* 7 · Action buttons + footer */}
        <div className="rest-actions">
          {warn ? (
            <>
              <button type="button" className="rest-btn primary" onClick={onViewSchedule}>Adjust shift</button>
              <button type="button" className="rest-btn ghost" onClick={onLogReason || onOpenHor}>
                {loggedReason ? 'Update reason' : 'Log violation reason'}
              </button>
            </>
          ) : (
            <button type="button" className="rest-btn primary" onClick={onViewSchedule}>View full schedule</button>
          )}
          <button type="button" className="rest-btn ghost push" onClick={onOpenHor}>Hours of rest log →</button>
        </div>

      </div>
    </>
  );
}
