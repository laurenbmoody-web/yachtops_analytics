import React from 'react';
import Icon from '../../../components/AppIcon';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, startOfWeek, endOfWeek } from 'date-fns';

// Editorial calendar: days are coloured by MCA service type (icon + letter, never
// colour alone) with a small verification mark (check = captain-signed, clock =
// pending). Styles live in sea-time.css (.stt-* scope).

const TYPE_META = {
  seagoing: { letter: 'S', label: 'Seagoing', icon: 'Ship' },
  watchkeeping: { letter: 'W', label: 'Watchkeeping', icon: 'Compass' },
  standby: { letter: 'SB', label: 'Standby', icon: 'Anchor' },
  yard: { letter: 'Y', label: 'Shipyard', icon: 'Wrench' }
};

const SeaTimeCalendar = ({ currentMonth, onMonthChange, onDateSelect, calendarData }) => {
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const vMark = (status) => {
    if (status === 'VERIFIED') return <Icon name="Check" size={11} style={{ color: 'var(--d-sage-deep)' }} className="stt-day-vmark" />;
    if (status === 'SUBMITTED') return <Icon name="Clock" size={11} style={{ color: 'var(--d-warn)' }} className="stt-day-vmark" />;
    return null;
  };

  return (
    <div>
      <div className="stt-cal-head">
        <div className="stt-cal-nav">
          <button className="stt-iconbtn" aria-label="Previous month" onClick={() => onMonthChange(subMonths(currentMonth, 1))}>
            <Icon name="ChevronLeft" size={17} />
          </button>
          <h3 className="stt-serif" style={{ fontSize: 19, minWidth: 150, textAlign: 'center' }}>
            {format(currentMonth, 'MMMM yyyy')}
          </h3>
          <button className="stt-iconbtn" aria-label="Next month" onClick={() => onMonthChange(addMonths(currentMonth, 1))}>
            <Icon name="ChevronRight" size={17} />
          </button>
        </div>
        <button className="stt-btn stt-ghost" onClick={() => onMonthChange(new Date())}>Today</button>
      </div>

      <div className="stt-cal" role="grid" aria-label="Sea service calendar">
        {dayNames.map(d => <div key={d} className="dh" role="columnheader">{d}</div>)}
        {calendarDays.map((day, i) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const data = calendarData?.[dateStr];
          const inMonth = isSameMonth(day, currentMonth);
          const meta = data?.serviceType ? TYPE_META[data.serviceType] : null;
          return (
            <button
              key={i}
              role="gridcell"
              aria-label={`${format(day, 'd MMMM yyyy')}${meta ? ', ' + meta.label : ', no service'}`}
              className={`stt-day ${!inMonth ? 'dim' : ''} ${meta ? data.serviceType : ''}`}
              onClick={() => inMonth && onDateSelect(day, data)}
            >
              <span className="d">{format(day, 'd')}</span>
              {data && meta && (
                <span className="t">
                  <Icon name={meta.icon} size={10} /> {meta.letter}
                  <span className="vmark">{vMark(data.verificationStatus)}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="stt-cal-legend">
        {Object.entries(TYPE_META).map(([k, m]) => (
          <span key={k}>
            <span className="stt-dot" style={{ background: `var(--t-${k === 'watchkeeping' ? 'watch' : k})` }}></span>
            <Icon name={m.icon} size={12} /> {m.label}
          </span>
        ))}
      </div>
    </div>
  );
};

export default SeaTimeCalendar;
