import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTodaySchedule } from '../hooks/useTodaySchedule';

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

export default function TodayTimeline() {
  const navigate = useNavigate();
  const { events } = useTodaySchedule();
  const today = DAY_NAMES[new Date().getDay()];

  // Find insert point for "you are here" marker
  const nowIdx = events.findIndex(e => !e.isPast);
  const nowMarkerAfter = nowIdx === -1 ? events.length - 1 : nowIdx - 1;

  return (
    <div className="p-card top-navy">
      <div className="p-card-head">
        <div>
          <div className="p-caps">{today} · a log</div>
          <div className="p-card-headline">The day <em>ahead</em>.</div>
        </div>
        <button className="p-card-link" onClick={() => navigate('/pantry/today')}
          aria-label="View full day schedule">
          View full day →
        </button>
      </div>

      <div className="p-timeline">
        <div className="p-timeline-rule" />

        {events.map((ev, i) => (
          <React.Fragment key={ev.id}>
            <div className={`p-timeline-entry${ev.isPast ? ' past' : ''}`}>
              <div className="p-tl-time">{ev.time}</div>
              <div className="p-tl-dot" />
              <div className="p-tl-title">{ev.title}</div>
              {ev.sub && <div className="p-tl-sub">{ev.sub}</div>}
            </div>

            {i === nowMarkerAfter && (
              <div className="p-timeline-entry" key="now-marker" aria-label="Current time">
                <div className="p-tl-time now">Now</div>
                <div className="p-tl-dot now" />
                <div className="p-tl-title now-marker">— you are here —</div>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
