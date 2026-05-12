import React from 'react';
import { Link } from 'react-router-dom';
import SectionCard from './_SectionCard';
import { capsDate, daysBetween, sameDay } from '../utils/tripPhase';

function stopTypeLabel(stopType, stopDetail) {
  if (stopDetail) return `${stopDetail}.`;
  const t = (stopType || '').toLowerCase().replace(/_/g, ' ');
  if (!t) return '';
  if (t === 'marina' || t === 'dock')        return 'at the marina.';
  if (t === 'anchor' || t === 'anchorage')   return 'at anchor.';
  if (t === 'underway' || t === 'transit')   return 'underway.';
  return `${t}.`;
}

function formatTimeRange(start, end) {
  if (start && end) return `underway ${start.slice(0, 5)} — ${end.slice(0, 5)}`;
  if (start)        return `underway from ${start.slice(0, 5)}`;
  if (end)          return `underway until ${end.slice(0, 5)}`;
  return 'underway.';
}

function DayChip({ day, isPast, isToday, hasForecastFlag }) {
  const date = day?.event_date;
  const activities = Array.isArray(day?.activities) ? day.activities : [];
  const isTransit = activities.length >= 2 && activities.some(a => a?.location && a.location !== day.location);

  const classes = ['v2-chip'];
  if (isPast)            classes.push('past');
  if (isToday)           classes.push('today');
  if (hasForecastFlag)   classes.push('flagged');

  const dayLabel = isToday
    ? `Today · ${capsDate(date).split(' ').slice(0, 2).join(' ')}`
    : capsDate(date);

  if (!isTransit) {
    return (
      <div className={classes.join(' ')}>
        {hasForecastFlag && <ForecastBadge />}
        <div className="v2-chip-daylabel">{dayLabel}</div>
        <div className="v2-chip-loc">{day?.location || 'Location TBD'}</div>
        <div className="v2-chip-stoptype">{stopTypeLabel(day?.stop_type, day?.stop_detail)}</div>
        {day?.notes && <div className="v2-chip-sub">{day.notes}</div>}
      </div>
    );
  }

  const sortedActivities = [...activities].sort((a, b) =>
    (a?.start_time || '').localeCompare(b?.start_time || '')
  );

  return (
    <div className={classes.join(' ')}>
      {hasForecastFlag && <ForecastBadge />}
      <div className="v2-chip-daylabel">{dayLabel}</div>
      <div className="v2-chip-loc stack">{day?.location || 'Location TBD'}</div>
      {sortedActivities.map((a, i) => (
        <React.Fragment key={a?.id || i}>
          <div className="v2-chip-transit">
            <span className="arr">↓</span>
            <span>{formatTimeRange(a?.start_time, null)}</span>
          </div>
          {a?.location && a.location !== day.location && (
            <div className="v2-chip-loc stack">{a.location}</div>
          )}
        </React.Fragment>
      ))}
      {day?.notes && <div className="v2-chip-sub" style={{ marginTop: 8 }}>{day.notes}</div>}
    </div>
  );
}

function ForecastBadge() {
  return (
    <div className="v2-chip-flag">
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <span>Forecast</span>
    </div>
  );
}

export default function SectionRoute({ trip, days = [], loading }) {
  const now = new Date();
  const sorted = [...days].sort((a, b) => (a?.event_date || '').localeCompare(b?.event_date || ''));
  const stopCount = sorted.reduce((acc, d) => acc + Math.max(1, (d?.activities?.length || 0)), 0);
  const firstLoc = sorted[0]?.location;
  const lastLoc  = sorted[sorted.length - 1]?.location;
  const headRange = sorted.length > 0
    ? `${sorted.length} days · ${stopCount} stops${firstLoc ? ` · ${firstLoc}${lastLoc && lastLoc !== firstLoc ? ` → ${lastLoc}` : ''}` : ''}`
    : 'No days planned yet';

  const editPath = trip?.id ? `/trips/${trip.id}/itinerary` : '/trips-management-dashboard';

  return (
    <SectionCard
      accent="navy"
      meta={headRange}
      titleNode={<>The <em>route</em>.</>}
      actions={
        <>
          <Link to={editPath} className="v2-btn-ghost" style={{ textDecoration: 'none' }}>
            Add a day
          </Link>
          <button className="v2-btn-filled" disabled title="Phase 2 — map view coming later">
            Map view
          </button>
        </>
      }
    >
      {loading && sorted.length === 0 ? (
        <div className="v2-route-empty">Loading the route…</div>
      ) : sorted.length === 0 ? (
        <div className="v2-route-empty">
          No route yet. <Link to={editPath} style={{ color: 'var(--accent)', textDecoration: 'underline', textUnderlineOffset: 3 }}>Plan the first day →</Link>
        </div>
      ) : (
        <div className="v2-route-grid" style={{
          gridTemplateColumns: `repeat(${Math.min(5, Math.max(1, sorted.length))}, 1fr)`,
        }}>
          {sorted.map((d) => {
            const isToday = sameDay(d?.event_date, now);
            const isPast  = !isToday && d?.event_date && daysBetween(now, d.event_date) < 0;
            return (
              <DayChip
                key={d?.id || d?.event_date}
                day={d}
                isPast={isPast}
                isToday={isToday}
                hasForecastFlag={false}
              />
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}
