import React from 'react';
import SectionCard from './_SectionCard';
import {
  TRIP_PHASE,
  computeTripPhase,
  daysBetween,
  sameDay,
  relativeDayLabel,
  capsDate,
  dayOfTrip,
  totalTripDays,
} from '../utils/tripPhase';

// Group special dates + reminders by the date that matters for them.
// Returns map keyed by YYYY-MM-DD with arrays of `{kind, item}`. Reminders
// without a dueDate land in the synthetic "later" bucket.
function groupByDate(trip) {
  const buckets = new Map();
  const later = [];
  const push = (key, value) => {
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(value);
  };

  (trip?.specialDates || []).forEach((s) => {
    if (!s?.date) { later.push({ kind: 'occasion', item: s }); return; }
    const key = new Date(s.date).toISOString().slice(0, 10);
    push(key, { kind: 'occasion', item: s });
  });

  (trip?.reminders || []).forEach((r) => {
    if (r?.completed) return;
    if (!r?.dueDate) { later.push({ kind: 'reminder', item: r }); return; }
    const key = new Date(r.dueDate).toISOString().slice(0, 10);
    push(key, { kind: 'reminder', item: r });
  });

  return { buckets, later };
}

// Build the canonical day list for the rows:
//  - During Aboard: today + each remaining itinerary day until end
//  - During Planning: every itinerary day from start to end
//  - During Settling: ~7 days post-disembark with a "Later" tail row
function buildRowDates({ trip, phase, days, now = new Date() }) {
  if (phase === TRIP_PHASE.PLANNING) {
    const sorted = [...days].sort((a, b) => (a?.event_date || '').localeCompare(b?.event_date || ''));
    return sorted.map(d => new Date(d.event_date));
  }
  if (phase === TRIP_PHASE.ABOARD) {
    if (!trip?.endDate) return [now];
    const out = [];
    const cursor = new Date(now); cursor.setHours(0, 0, 0, 0);
    const end = new Date(trip.endDate); end.setHours(0, 0, 0, 0);
    while (cursor <= end) {
      out.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  }
  if (phase === TRIP_PHASE.SETTLING) {
    const out = [];
    const cursor = new Date(now); cursor.setHours(0, 0, 0, 0);
    for (let i = 0; i < 7; i += 1) {
      out.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  }
  return [];
}

function ServiceMoment({ activity, isUpNext }) {
  return (
    <div className={`v2-cu-moment${isUpNext ? ' upnext' : ''}`}>
      <div className="v2-cu-moment-time">{activity?.start_time?.slice(0, 5) || '—'}</div>
      <div>
        <span className="v2-cu-moment-line">{activity?.title || 'Service moment'}{activity?.location ? ` — ${activity.location}.` : '.'}</span>
        {isUpNext
          ? <span className="v2-cu-moment-meta upnext"> Up next</span>
          : (activity?.description && <span className="v2-cu-moment-meta"> {activity.description}</span>)
        }
      </div>
    </div>
  );
}

function CompressedDayLine({ activitiesCount, firstTime, planned }) {
  if (activitiesCount === 0) return null;
  const verb = planned ? 'planned' : '';
  return (
    <div className="v2-cu-compressed">
      {activitiesCount} service {activitiesCount === 1 ? 'moment' : 'moments'}
      {verb ? ` ${verb}` : ''} — first at {firstTime?.slice(0, 5) || '—'}.{' '}
      <span className="v2-cu-openday">Open day</span>
    </div>
  );
}

function OccasionLine({ occ }) {
  const noun = (occ?.type || 'event').toLowerCase();
  const owner = occ?.title?.split(/['']s\s+/)[0] || occ?.title || '';
  const isPossessive = occ?.title && /['']s\s+/.test(occ.title);
  return (
    <div className="v2-cu-occasion">
      <div className="v2-cu-occasion-title">
        {isPossessive
          ? <>{owner}'s <em>{noun}</em>.</>
          : <><em>{occ?.title || noun}</em>.</>}
      </div>
      {occ?.notes && <div className="v2-cu-occasion-meta">{occ.notes}</div>}
    </div>
  );
}

function ReminderLine({ rem }) {
  const due = rem?.dueDate ? new Date(rem.dueDate) : null;
  const whenLabel = (() => {
    if (!due) return '—';
    const h = due.getHours();
    if (h === 0) return 'AM';
    if (h < 12) return `By ${h}`;
    if (h === 12) return 'PM';
    return `${h - 12} PM`;
  })();
  return (
    <div className="v2-cu-reminder">
      <span className="v2-cu-reminder-when">{whenLabel}</span>
      <span className="v2-cu-reminder-title">{rem?.title}.</span>
    </div>
  );
}

function AboardRow({ date, isToday, day, items, totalDays, trip, now }) {
  const dayN = dayOfTrip({ startDate: trip?.startDate }, date);
  const isFinal = trip?.endDate && sameDay(date, trip.endDate);
  const occasions = items.filter(i => i.kind === 'occasion');
  const reminders = items.filter(i => i.kind === 'reminder');

  if (isToday) {
    const sortedActs = [...(day?.activities || [])]
      .filter(a => a?.start_time)
      .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
    const nowHHMM = now.toTimeString().slice(0, 5);
    const upcoming = sortedActs.filter(a => a.start_time >= nowHHMM);
    const done = sortedActs.filter(a => a.start_time < nowHHMM);
    const upNext = upcoming[0];
    const restOfDay = upcoming.slice(1, 3);
    return (
      <div className="v2-cu-row today">
        <div>
          <div className="v2-cu-datehero today">Today</div>
          <div className="v2-cu-datesub">{capsDate(date)}</div>
          {dayN && totalDays && (
            <div className="v2-cu-datesub">Day {dayN} of {totalDays}</div>
          )}
        </div>
        <div>
          {upNext && <ServiceMoment activity={upNext} isUpNext />}
          {restOfDay.map((a, i) => <ServiceMoment key={a?.id || i} activity={a} />)}
          {occasions.map((o) => <OccasionLine key={o.item.id} occ={o.item} />)}
          {reminders.map((r) => <ReminderLine key={r.item.id} rem={r.item} />)}
          {done.length > 0 && (
            <div className="v2-cu-earlier">
              + {done.length} service {done.length === 1 ? 'moment' : 'moments'} earlier today, all done.
            </div>
          )}
        </div>
      </div>
    );
  }

  const activitiesCount = (day?.activities || []).length;
  const firstTime = (day?.activities || []).map(a => a?.start_time).filter(Boolean).sort()[0];

  return (
    <div className="v2-cu-row">
      <div>
        <div className="v2-cu-datehero">{relativeDayLabel(date, now)}</div>
        <div className="v2-cu-datesub">{capsDate(date)}</div>
        {isFinal
          ? <div className="v2-cu-datesub accent">Final · disembark</div>
          : (dayN && totalDays && <div className="v2-cu-datesub">Day {dayN} of {totalDays}</div>)
        }
      </div>
      <div>
        {occasions.map((o) => <OccasionLine key={o.item.id} occ={o.item} />)}
        {reminders.map((r) => <ReminderLine key={r.item.id} rem={r.item} />)}
        <CompressedDayLine activitiesCount={activitiesCount} firstTime={firstTime} />
      </div>
    </div>
  );
}

function PlanningRow({ date, day, items, totalDays, trip, now }) {
  const dayN = dayOfTrip({ startDate: trip?.startDate }, date);
  const isFirst = trip?.startDate && sameDay(date, trip.startDate);
  const isFinal = trip?.endDate && sameDay(date, trip.endDate);
  const occasions = items.filter(i => i.kind === 'occasion');
  const reminders = items.filter(i => i.kind === 'reminder');
  const activitiesCount = (day?.activities || []).length;
  const firstTime = (day?.activities || []).map(a => a?.start_time).filter(Boolean).sort()[0];
  const qualifier = isFirst ? 'Day 1 · embark' : isFinal ? 'Final · disembark' : `Day ${dayN} of ${totalDays}`;

  return (
    <div className="v2-cu-row">
      <div>
        <div className="v2-cu-datehero">{capsDate(date)}</div>
        <div className={`v2-cu-datesub${isFirst || isFinal ? ' accent' : ''}`}>{qualifier}</div>
      </div>
      <div>
        {occasions.map((o) => <OccasionLine key={o.item.id} occ={o.item} />)}
        {reminders.map((r) => <ReminderLine key={r.item.id} rem={r.item} />)}
        <CompressedDayLine activitiesCount={activitiesCount} firstTime={firstTime} planned />
      </div>
    </div>
  );
}

function SettlingRow({ date, daysAfter, items, isAnchor }) {
  const occasions = items.filter(i => i.kind === 'occasion');
  const reminders = items.filter(i => i.kind === 'reminder');
  const label = daysAfter === 1 ? '1 day after' : `${daysAfter} days after`;
  return (
    <div className={`v2-cu-row${isAnchor ? ' today' : ''}`}>
      <div>
        <div className="v2-cu-datehero">{capsDate(date)}</div>
        <div className={`v2-cu-datesub${isAnchor ? ' accent' : ''}`}>{label}</div>
      </div>
      <div>
        {reminders.map((r) => <ReminderLine key={r.item.id} rem={r.item} />)}
        {occasions.map((o) => <OccasionLine key={o.item.id} occ={o.item} />)}
      </div>
    </div>
  );
}

function LaterRow({ items }) {
  if (items.length === 0) return null;
  return (
    <div className="v2-cu-row">
      <div>
        <div className="v2-cu-datehero later">Later</div>
        <div className="v2-cu-datesub">No date · —</div>
      </div>
      <div>
        {items.map((it) =>
          it.kind === 'occasion'
            ? <OccasionLine key={it.item.id} occ={it.item} />
            : <ReminderLine key={it.item.id} rem={it.item} />
        )}
      </div>
    </div>
  );
}

function ArchivedVariant({ trip }) {
  return (
    <SectionCard
      accent="archived"
      meta={trip?.endDate ? `Closed · ${capsDate(trip.endDate)}` : 'Closed'}
      titleNode={<>Nothing <em>left to do</em>.</>}
    >
      <p style={{ fontSize: 13, color: 'var(--ink-muted)', lineHeight: 1.6, margin: '0 0 14px' }}>
        All occasions noted. All reminders settled. The trip log is the record now.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="v2-btn-ghost">Read the trip log</button>
        <button className="v2-btn-ghost muted">Reopen the trip</button>
      </div>
    </SectionCard>
  );
}

export default function SectionComingUp({ trip, days = [] }) {
  const now = new Date();
  const phase = computeTripPhase(trip, now);
  const totalDays = totalTripDays(trip);

  if (phase === TRIP_PHASE.ARCHIVED) return <ArchivedVariant trip={trip} />;

  const { buckets, later } = groupByDate(trip);
  const rowDates = buildRowDates({ trip, phase, days, now });

  const dayByDate = new Map(
    (days || []).filter(d => d?.event_date).map(d => [new Date(d.event_date).toISOString().slice(0, 10), d])
  );

  const occasionCount = (trip?.specialDates || []).length;
  const reminderCount = (trip?.reminders || []).filter(r => !r?.completed).length;
  const dayCount = rowDates.length;
  const metaLine = `${occasionCount} ${occasionCount === 1 ? 'occasion' : 'occasions'} · ${reminderCount} ${reminderCount === 1 ? 'reminder' : 'reminders'} · service across ${dayCount} ${dayCount === 1 ? 'day' : 'days'}`;

  const isEmpty = occasionCount === 0 && reminderCount === 0 && (days?.length || 0) === 0;

  return (
    <SectionCard
      accent="accent"
      meta={isEmpty ? null : metaLine}
      titleNode={<>What's <em>coming up</em>.</>}
      actions={!isEmpty && <button className="v2-btn-ghost">Add</button>}
    >
      {isEmpty ? (
        <p style={{
          fontFamily: 'var(--font-serif)',
          fontStyle: 'italic',
          fontSize: 16,
          color: 'var(--ink-muted)',
          margin: 0,
        }}>
          Nothing to remember yet. <span style={{ color: 'var(--accent)', textDecoration: 'underline', textUnderlineOffset: 3, cursor: 'pointer' }}>Add something to remember →</span>
        </p>
      ) : (
        <>
          {rowDates.map((date, idx) => {
            const key = date.toISOString().slice(0, 10);
            const items = buckets.get(key) || [];
            const day = dayByDate.get(key);
            const isToday = sameDay(date, now);

            if (phase === TRIP_PHASE.PLANNING) {
              return (
                <PlanningRow
                  key={key}
                  date={date}
                  day={day}
                  items={items}
                  totalDays={totalDays}
                  trip={trip}
                  now={now}
                />
              );
            }
            if (phase === TRIP_PHASE.SETTLING) {
              const daysAfter = trip?.endDate ? daysBetween(trip.endDate, date) : idx;
              if (daysAfter <= 0) return null;
              return (
                <SettlingRow
                  key={key}
                  date={date}
                  daysAfter={daysAfter}
                  items={items}
                  isAnchor={daysAfter === 1}
                />
              );
            }
            return (
              <AboardRow
                key={key}
                date={date}
                isToday={isToday}
                day={day}
                items={items}
                totalDays={totalDays}
                trip={trip}
                now={now}
              />
            );
          })}
          <LaterRow items={later} />
        </>
      )}
    </SectionCard>
  );
}
