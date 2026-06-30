import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../../lib/supabaseClient';
import { getStatusLabel, buildStatusPeriods, getStatusForDay, CREW_STATUSES } from '../../../utils/crewStatus';
import LogoSpinner from '../../../components/LogoSpinner';

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

// Editorial gantt palette — softer than the dashboard chips, keyed by status.
const CAL_COLORS = {
  active: '#7FCBA6',
  on_leave: '#E6C079',
  rotational_leave: '#C3AEEA',
  medical_leave: '#E8A29A',
  training_leave: '#9DBCF0',
  travelling: '#7FD3CA',
  invited: '#D8D6CF',
};
const calColor = (s) => CAL_COLORS[s] || '#F0F1F5';

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

const CrewCalendar = ({ members, tenantId, refreshToken, canNavigate }) => {
  const today = new Date();
  const [calYear,  setCalYear]  = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [historyByUser, setHistoryByUser] = useState({});
  const [loading, setLoading] = useState(false);

  const totalDays = daysInMonth(calYear, calMonth);
  const memberIds = members.map(m => m.user_id).filter(Boolean);

  useEffect(() => {
    if (!tenantId || memberIds.length === 0) return;
    let cancelled = false;

    (async () => {
      setLoading(true);

      console.log('[CrewCalendar] querying crew_status_history', { tenantId, memberIds });

      const { data, error } = await supabase
        .from('crew_status_history')
        .select('user_id, new_status, old_status, changed_at, notes')
        .eq('tenant_id', tenantId)
        .in('user_id', memberIds)
        .order('changed_at', { ascending: true });

      console.log('[CrewCalendar] result', { rows: data?.length ?? 0, error });

      if (!cancelled) {
        if (error) {
          console.error('[CrewCalendar] Supabase error:', error);
        } else {
          const grouped = {};
          for (const row of (data || [])) {
            if (!grouped[row.user_id]) grouped[row.user_id] = [];
            grouped[row.user_id].push(row);
          }
          console.log('[CrewCalendar] grouped users with history:', Object.keys(grouped).length);
          setHistoryByUser(grouped);
        }
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [tenantId, memberIds.join(','), refreshToken]);

  const prev = () => {
    if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); }
    else { setCalMonth(m => m - 1); }
  };
  const next = () => {
    if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); }
    else { setCalMonth(m => m + 1); }
  };

  return (
    <div className="cm-cal">
      {/* Month nav — editorial pill */}
      <div className="cm-cal-head">
        <div className="cm-monthnav">
          <button onClick={prev} aria-label="Previous month">‹</button>
          <span>{MONTHS[calMonth]} {calYear}</span>
          <button onClick={next} aria-label="Next month">›</button>
        </div>
        {loading && <LogoSpinner size={16} />}
      </div>

      {/* Grid */}
      <div className="cm-cal-scroll">
        <div style={{ minWidth: totalDays * 22 + 150 }}>
          {/* Day header row */}
          <div className="cm-cal-row" style={{ paddingLeft: 150 }}>
            {Array.from({ length: totalDays }, (_, i) => {
              const d = new Date(calYear, calMonth, i + 1);
              const isToday = d.toDateString() === today.toDateString();
              return (
                <div key={i} className={`cm-cal-daynum${isToday ? ' is-today' : ''}`}>{i + 1}</div>
              );
            })}
          </div>

          {/* One row per member */}
          {members.length === 0 ? (
            <p className="cm-cal-empty">No crew members to display.</p>
          ) : (
            members.map(member => {
              const memberHistory = historyByUser[member.user_id] || [];
              const periods = buildStatusPeriods(memberHistory);

              return (
                <div key={member.user_id} className="cm-cal-row">
                  {/* Member name */}
                  {canNavigate ? (
                    <Link
                      to={`/profile/${member.user_id}?tab=history`}
                      className="cm-cal-name"
                      title={`${member.fullName} — view status history`}
                    >
                      {member.fullName || '—'}
                    </Link>
                  ) : (
                    <div className="cm-cal-name" title={member.fullName}>{member.fullName || '—'}</div>
                  )}

                  {/* Day cells */}
                  {Array.from({ length: totalDays }, (_, i) => {
                    const day  = new Date(calYear, calMonth, i + 1);
                    const stat = getStatusForDay(periods, day);
                    const isFuture = day > today;
                    return (
                      <div
                        key={i}
                        title={stat ? `${member.fullName}: ${getStatusLabel(stat)} on ${i + 1} ${MONTHS[calMonth]}` : undefined}
                        className={`cm-cal-cell${isFuture ? ' is-future' : ''}`}
                        style={stat ? { background: calColor(stat) } : undefined}
                      />
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="cm-cal-legend">
        {CREW_STATUSES.map(({ value, label }) => (
          <div key={value} className="cm-cal-leg">
            <span style={{ background: calColor(value) }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
};

export default CrewCalendar;
