import React from 'react';
import { EditorialPageShell } from '../../../components/editorial';
import NowAndDutyStack from '../../pantry/widgets/NowAndDutyStack';
import {
  TRIP_PHASE,
  computeTripPhase,
  tripTypeQualifier,
  principalName,
  buildHeaderMeta,
  dayOfTrip,
  totalTripDays,
  daysBetween,
  sameDay,
} from '../utils/tripPhase';

function pickHeaderLocation(trip, days, phase, now = new Date()) {
  if (!Array.isArray(days) || days.length === 0) return null;
  if (phase === TRIP_PHASE.PLANNING) return days[0]?.location || null;
  if (phase === TRIP_PHASE.ABOARD) {
    const todayDay = days.find(d => d?.event_date && sameDay(d.event_date, now));
    return todayDay?.location || days[0]?.location || null;
  }
  return days[days.length - 1]?.location || null;
}

function buildSubtitle({ trip, phase, days, dayN, totalDays, now = new Date() }) {
  const guestCount = Array.isArray(trip?.guests) ? trip.guests.length : 0;
  const startLoc = days?.[0]?.location;
  const endLoc   = days?.[days.length - 1]?.location;
  const route = (startLoc && endLoc && startLoc !== endLoc)
    ? `${startLoc} to ${endLoc}.`
    : startLoc ? `${startLoc}.` : '';

  if (phase === TRIP_PHASE.PLANNING) {
    const dOut = trip?.startDate ? daysBetween(now, trip.startDate) : null;
    const arriveLine = dOut != null
      ? (dOut === 0 ? 'Guests arrive today.' : dOut === 1 ? 'Guests arrive tomorrow.' : `Guests arrive in ${dOut} days.`)
      : '';
    return [route, arriveLine].filter(Boolean).join(' ');
  }

  if (phase === TRIP_PHASE.ABOARD) {
    const todayDay = days?.find(d => d?.event_date && sameDay(d.event_date, now));
    const nextActivity = (todayDay?.activities || [])
      .filter(a => a?.start_time)
      .find(a => a.start_time >= now.toTimeString().slice(0, 5));
    const nextLine = nextActivity
      ? `${nextActivity.title} comes up next.`
      : (todayDay?.stop_detail ? `${todayDay.stop_detail}.` : '');
    const guestLine = guestCount > 0
      ? `Party of ${guestCount} aboard.`
      : '';
    return [route, guestLine, nextLine].filter(Boolean).join(' ');
  }

  if (phase === TRIP_PHASE.SETTLING) {
    const photoCount = Array.isArray(trip?.photos) ? trip.photos.length : 0;
    const openReminders = Array.isArray(trip?.reminders)
      ? trip.reminders.filter(r => !r?.completed).length
      : 0;
    return `Just closed. ${photoCount} photos, ${openReminders} reminders open.`;
  }

  if (phase === TRIP_PHASE.ARCHIVED) {
    if (trip?.endDate) {
      const monthsAgo = Math.max(1, Math.round(daysBetween(trip.endDate, now) / 30));
      return `Closed ${monthsAgo} ${monthsAgo === 1 ? 'month' : 'months'} ago. The trip log is the record now.`;
    }
    return 'The trip log is the record now.';
  }

  return '';
}

function PhaseRightRail({ phase, trip, days, now = new Date() }) {
  if (phase === TRIP_PHASE.ABOARD) return <NowAndDutyStack />;
  if (phase === TRIP_PHASE.PLANNING) {
    const dOut = trip?.startDate ? daysBetween(now, trip.startDate) : null;
    const guestCount = Array.isArray(trip?.guests) ? trip.guests.length : 0;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
        <div className="p-card" style={{ padding: '12px 18px', minWidth: 140 }}>
          <div className="p-caps" style={{ marginBottom: 4 }}>Days out</div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 28, fontWeight: 500, color: 'var(--ink)', lineHeight: 1 }}>
            {dOut ?? '—'}
          </div>
        </div>
        <div className="p-card" style={{ padding: '12px 18px', minWidth: 140 }}>
          <div className="p-caps" style={{ marginBottom: 4 }}>Guests</div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 500, color: 'var(--ink)', lineHeight: 1 }}>
            {guestCount}
          </div>
        </div>
      </div>
    );
  }
  if (phase === TRIP_PHASE.SETTLING) {
    const photoCount = Array.isArray(trip?.photos) ? trip.photos.length : 0;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
        <div className="p-card" style={{ padding: '12px 18px', minWidth: 140 }}>
          <div className="p-caps" style={{ marginBottom: 4 }}>Photos</div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 28, fontWeight: 500, color: 'var(--ink)', lineHeight: 1 }}>
            {photoCount}
          </div>
        </div>
        <div className="p-card" style={{ padding: '12px 18px', minWidth: 140 }}>
          <div className="p-caps" style={{ marginBottom: 4 }}>APA</div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 14, fontStyle: 'italic', color: 'var(--ink-muted)', lineHeight: 1.2 }}>
            pending
          </div>
        </div>
      </div>
    );
  }
  return null;
}

function TripSummaryBand({ phase, trip, days, now = new Date() }) {
  if (phase === TRIP_PHASE.ARCHIVED) return null;

  const guestCount = Array.isArray(trip?.guests) ? trip.guests.length : 0;

  if (phase === TRIP_PHASE.ABOARD) {
    const todayDay = days?.find(d => d?.event_date && sameDay(d.event_date, now));
    const stopType = todayDay?.stop_type
      ? `${todayDay.stop_type.toLowerCase().replace(/_/g, ' ')}.`
      : 'underway.';
    const nextActivity = (todayDay?.activities || [])
      .filter(a => a?.start_time)
      .find(a => a.start_time >= now.toTimeString().slice(0, 5));
    return (
      <div className="v2-summary-band">
        <div className="v2-summary-cell">
          <div className="v2-summary-cap">Aboard</div>
          <div>
            <span className="v2-summary-num">{guestCount}</span>
          </div>
          <div className="v2-summary-meta">{guestCount === 1 ? 'guest' : 'guests'} aboard</div>
        </div>
        <div className="v2-summary-cell">
          <div className="v2-summary-cap">Today</div>
          <div className="v2-summary-serif">{stopType}</div>
          <div className="v2-summary-meta">{todayDay?.location || '—'}</div>
        </div>
        <div className="v2-summary-cell">
          <div className="v2-summary-cap">Coming up</div>
          <div className="v2-summary-serif accent">
            {nextActivity?.title ? `${nextActivity.title.toLowerCase()}.` : 'nothing scheduled.'}
          </div>
          <div className="v2-summary-meta">
            {nextActivity?.start_time
              ? `${nextActivity.start_time}${nextActivity?.location ? ` · ${nextActivity.location}` : ''}`
              : '—'}
          </div>
        </div>
      </div>
    );
  }

  if (phase === TRIP_PHASE.PLANNING) {
    const dOut = trip?.startDate ? daysBetween(now, trip.startDate) : null;
    const dayCount = days?.length || 0;
    return (
      <div className="v2-summary-band">
        <div className="v2-summary-cell">
          <div className="v2-summary-cap">Days out</div>
          <div><span className="v2-summary-num">{dOut ?? '—'}</span></div>
          <div className="v2-summary-meta">until embark</div>
        </div>
        <div className="v2-summary-cell">
          <div className="v2-summary-cap">Guests confirmed</div>
          <div><span className="v2-summary-num">{guestCount}</span></div>
          <div className="v2-summary-meta">on the manifest</div>
        </div>
        <div className="v2-summary-cell">
          <div className="v2-summary-cap">Ready</div>
          <div className="v2-summary-serif">{dayCount} {dayCount === 1 ? 'day' : 'days'}.</div>
          <div className="v2-summary-meta">in the route</div>
        </div>
      </div>
    );
  }

  if (phase === TRIP_PHASE.SETTLING) {
    const photoCount = Array.isArray(trip?.photos) ? trip.photos.length : 0;
    const openReminders = Array.isArray(trip?.reminders)
      ? trip.reminders.filter(r => !r?.completed).length
      : 0;
    return (
      <div className="v2-summary-band">
        <div className="v2-summary-cell">
          <div className="v2-summary-cap">Closed out</div>
          <div className="v2-summary-serif">{openReminders === 0 ? 'all settled.' : `${openReminders} open.`}</div>
          <div className="v2-summary-meta">{openReminders === 0 ? 'reminders complete' : 'reminders to settle'}</div>
        </div>
        <div className="v2-summary-cell">
          <div className="v2-summary-cap">Photos</div>
          <div><span className="v2-summary-num">{photoCount}</span></div>
          <div className="v2-summary-meta">uploaded</div>
        </div>
        <div className="v2-summary-cell">
          <div className="v2-summary-cap">APA final</div>
          <div className="v2-summary-serif">pending.</div>
          <div className="v2-summary-meta">reconcile with broker</div>
        </div>
      </div>
    );
  }

  return null;
}

export default function SectionHeader({ trip, days = [] }) {
  const now = new Date();
  const phase = computeTripPhase(trip, now);
  const totalDays = totalTripDays(trip);
  const dayN = dayOfTrip(trip, now);
  const principal = principalName(trip);
  const qualifier = tripTypeQualifier(trip?.tripType);
  const location = pickHeaderLocation(trip, days, phase, now);
  const meta = buildHeaderMeta({ trip, phase, location, dayOfTrip: dayN, totalDays });
  const subtitle = buildSubtitle({ trip, phase, days, dayN, totalDays, now });
  const rightRail = <PhaseRightRail phase={phase} trip={trip} days={days} now={now} />;
  const summaryBand = <TripSummaryBand phase={phase} trip={trip} days={days} now={now} />;

  return (
    <EditorialPageShell
      title={principal}
      qualifier={qualifier}
      subtitle={subtitle}
      meta={meta}
      rightRail={rightRail}
      actionStrip={summaryBand}
      manageBodyBg={false}
    />
  );
}
