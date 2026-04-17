import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { getStatusCellClass, getStatusLabel, buildStatusPeriods, getStatusForDay, CREW_STATUSES } from '../../../utils/crewStatus';

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

const CrewCalendar = ({ members, tenantId }) => {
  const today = new Date();
  const [calYear,  setCalYear]  = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [historyByUser, setHistoryByUser] = useState({});
  const [loading, setLoading] = useState(false);

  const totalDays = daysInMonth(calYear, calMonth);
  const memberIds = members.map(m => m.user_id).filter(Boolean);

  // Fetch all history up to end of this month for all active members
  useEffect(() => {
    if (!tenantId || memberIds.length === 0) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      const monthEnd = new Date(calYear, calMonth + 1, 0, 23, 59, 59).toISOString();

      const { data, error } = await supabase
        .from('crew_status_history')
        .select('user_id, new_status, old_status, changed_at, notes')
        .eq('tenant_id', tenantId)
        .in('user_id', memberIds)
        .lte('changed_at', monthEnd)
        .order('changed_at', { ascending: false });

      if (!cancelled) {
        if (!error) {
          // Group by user_id (history is already newest-first)
          const grouped = {};
          for (const row of (data || [])) {
            if (!grouped[row.user_id]) grouped[row.user_id] = [];
            grouped[row.user_id].push(row);
          }
          setHistoryByUser(grouped);
        }
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [tenantId, calYear, calMonth, memberIds.join(',')]);

  const prev = () => {
    if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); }
    else { setCalMonth(m => m - 1); }
  };
  const next = () => {
    if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); }
    else { setCalMonth(m => m + 1); }
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-5">
        <button
          onClick={prev}
          className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
        >
          ‹
        </button>
        <span className="text-base font-semibold text-foreground min-w-[150px] text-center">
          {MONTHS[calMonth]} {calYear}
        </span>
        <button
          onClick={next}
          className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
        >
          ›
        </button>

        {loading && (
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary ml-2" />
        )}
      </div>

      {/* Grid */}
      <div className="overflow-x-auto">
        <div style={{ minWidth: totalDays * 22 + 150 }}>
          {/* Day header row */}
          <div className="flex items-center gap-0.5 mb-1 pl-[150px]">
            {Array.from({ length: totalDays }, (_, i) => {
              const d = new Date(calYear, calMonth, i + 1);
              const isToday = d.toDateString() === today.toDateString();
              return (
                <div
                  key={i}
                  className={`w-5 text-center text-[9px] select-none font-mono ${
                    isToday ? 'text-primary font-bold' : 'text-muted-foreground'
                  }`}
                >
                  {i + 1}
                </div>
              );
            })}
          </div>

          {/* One row per member */}
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No crew members to display.</p>
          ) : (
            members.map(member => {
              const memberHistory = historyByUser[member.user_id] || [];
              const periods = buildStatusPeriods(memberHistory);

              return (
                <div key={member.user_id} className="flex items-center gap-0.5 mb-1">
                  {/* Member name */}
                  <div
                    className="w-[146px] flex-shrink-0 text-xs font-medium text-foreground truncate pr-1 mr-1"
                    title={member.fullName}
                  >
                    {member.fullName || '—'}
                  </div>

                  {/* Day cells */}
                  {Array.from({ length: totalDays }, (_, i) => {
                    const day  = new Date(calYear, calMonth, i + 1);
                    const stat = getStatusForDay(periods, day);
                    const isFuture = day > today;
                    return (
                      <div
                        key={i}
                        title={stat ? `${member.fullName}: ${getStatusLabel(stat)} on ${i + 1} ${MONTHS[calMonth]}` : undefined}
                        className={`w-5 h-6 rounded-sm flex-shrink-0 ${
                          isFuture ? 'opacity-30' : ''
                        } ${stat ? getStatusCellClass(stat) : 'bg-muted/30'}`}
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
      <div className="flex flex-wrap gap-3 mt-5 pt-4 border-t border-border">
        {CREW_STATUSES.map(({ value, label }) => (
          <div key={value} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`w-3 h-3 rounded-sm flex-shrink-0 ${getStatusCellClass(value)}`} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
};

export default CrewCalendar;
