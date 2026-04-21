import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import LogoSpinner from '../../../components/LogoSpinner';
import {
  getStatusLabel, getStatusDotClass, getStatusCellClass,
  buildStatusPeriods, getStatusForDay,
} from '../../../utils/crewStatus';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function fmtDate(dateStr) {
  const d = new Date(dateStr);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

// ─── Calendar sub-component ───────────────────────────────────────────────────

function MonthCalendar({ periods }) {
  const today = new Date();
  const [calYear,  setCalYear]  = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());

  const totalDays = daysInMonth(calYear, calMonth);

  const prev = () => {
    if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); }
    else                { setCalMonth(m => m - 1); }
  };
  const next = () => {
    if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); }
    else                 { setCalMonth(m => m + 1); }
  };

  return (
    <div>
      {/* Month navigation */}
      <div className="flex items-center gap-4 mb-3">
        <button
          onClick={prev}
          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        >
          ‹
        </button>
        <span className="text-sm font-medium text-foreground min-w-[120px] text-center">
          {MONTHS[calMonth]} {calYear}
        </span>
        <button
          onClick={next}
          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        >
          ›
        </button>
      </div>

      {/* Day labels */}
      <div className="flex gap-0.5 mb-0.5">
        {Array.from({ length: totalDays }, (_, i) => (
          <div
            key={i}
            className="flex-1 text-center text-[10px] text-muted-foreground select-none"
          >
            {i + 1}
          </div>
        ))}
      </div>

      {/* Status cells */}
      <div className="flex gap-0.5">
        {Array.from({ length: totalDays }, (_, i) => {
          const day  = new Date(calYear, calMonth, i + 1);
          const stat = getStatusForDay(periods, day);
          const isFuture = day > today;
          return (
            <div
              key={i}
              title={stat ? `${i + 1} ${MONTHS[calMonth]}: ${getStatusLabel(stat)}` : `${i + 1} ${MONTHS[calMonth]}: No data`}
              className={`flex-1 h-7 rounded-sm ${
                isFuture ? 'opacity-30' : ''
              } ${stat ? getStatusCellClass(stat) : 'bg-muted/40'}`}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-4">
        {[
          { status: 'active',           label: 'Active' },
          { status: 'on_leave',         label: 'On Leave' },
          { status: 'rotational_leave', label: 'Rotational Leave' },
          { status: 'medical_leave',    label: 'Medical Leave' },
          { status: 'training',         label: 'Training' },
          { status: 'invited',          label: 'Invited' },
        ].map(({ status, label }) => (
          <div key={status} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`w-3 h-3 rounded-sm ${getStatusCellClass(status)}`} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const StatusHistoryTab = ({ userId, tenantId }) => {
  const [history,    setHistory]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [subTab,     setSubTab]     = useState('timeline'); // 'timeline' | 'calendar'

  useEffect(() => {
    if (!userId || !tenantId) { setLoading(false); return; }
    let cancelled = false;

    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('crew_status_history')
        .select('*')
        .eq('user_id', userId)
        .eq('tenant_id', tenantId)
        .order('changed_at', { ascending: true });

      if (!cancelled) {
        if (!error) setHistory(data || []);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userId, tenantId]);

  const periods = buildStatusPeriods(history);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LogoSpinner size={32} />
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-semibold text-foreground">Status History</h3>
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          {['timeline', 'calendar'].map(tab => (
            <button
              key={tab}
              onClick={() => setSubTab(tab)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
                subTab === tab
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* ── Calendar tab ── */}
      {subTab === 'calendar' && (
        <MonthCalendar periods={periods} />
      )}

      {/* ── Timeline tab ── */}
      {subTab === 'timeline' && (
        <>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No status history yet.
            </p>
          ) : (
            <div className="relative">
              {/* Vertical line */}
              <div className="absolute left-[9px] top-2 bottom-2 w-px bg-border" />

              <div className="space-y-6">
                {[...history].reverse().map((entry, i) => (
                  <div key={entry.id} className="flex gap-4">
                    {/* Dot */}
                    <div className="relative flex-shrink-0 mt-1">
                      <span
                        className={`block w-5 h-5 rounded-full border-2 border-card ${getStatusDotClass(entry.new_status)}`}
                      />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {getStatusLabel(entry.new_status)}
                        </span>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {fmtDate(entry.changed_at)}
                        </span>
                      </div>

                      {entry.old_status ? (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Changed by {entry.changed_by_name || 'Unknown'}
                          {' '}from{' '}
                          <span className="italic">{getStatusLabel(entry.old_status)}</span>
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {entry.changed_by_name ? `Joined — ${entry.changed_by_name}` : 'Initial status on joining vessel'}
                        </p>
                      )}

                      {entry.notes && (
                        <p className="text-xs text-muted-foreground mt-1 italic bg-muted/40 rounded px-2 py-1">
                          "{entry.notes}"
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default StatusHistoryTab;
