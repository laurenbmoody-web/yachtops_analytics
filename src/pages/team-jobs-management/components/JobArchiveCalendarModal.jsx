import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import ModalShell from '../../../components/ui/ModalShell';
import { supabase } from '../../../lib/supabaseClient';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isToday, parseISO } from 'date-fns';
import { normalizeTier } from '../utils/tierPermissions';
import '../job-modals.css';
import '../team-jobs.css';

// Helper: detect if a string looks like a UUID
const isUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i?.test(str);

// Priority → the shared jm-tag tone used across the Jobs modals
const priorityTagClass = (priority) => {
  switch (priority) {
    case 'high': return 'danger';
    case 'medium': return 'warn';
    case 'low': return 'success';
    default: return '';
  }
};

const JobHistoryDetailPanel = ({ job, onBack }) => {
  const metadata = Array.isArray(job?.metadata) ? job?.metadata : [];
  const checklistItems = metadata?.filter(m => m?.type === 'checklist' || m?.field === 'checklist');
  const historyItems = metadata?.filter(m => m?.timestamp && m?.field !== 'checklist');

  return (
    <div className="ar-detail">
      <div className="ar-detail-back">
        <button onClick={onBack} className="ar-backbtn">
          <Icon name="ChevronLeft" size={14} />
          Back to the day
        </button>
      </div>
      <div className="ar-detail-body">
        <div className="jm-section">
          {job?.priority && (
            <span className={`jm-tag ${priorityTagClass(job?.priority)}`} style={{ marginBottom: 8 }}>
              {job?.priority} priority
            </span>
          )}
          <h3 className="ar-detail-title">{job?.title || 'Untitled'}</h3>
          {job?.description && <p className="ar-detail-desc">{job?.description}</p>}
        </div>

        {(job?.board_name || (!isUUID(job?.department) && job?.department)) && (
          <div className="jm-section ar-facts">
            {job?.board_name && (
              <span><Icon name="LayoutDashboard" size={13} />{job?.board_name}</span>
            )}
            {!isUUID(job?.department) && job?.department && (
              <span><Icon name="Building2" size={13} />{job?.department}</span>
            )}
          </div>
        )}

        <div className="jm-section">
          <div className="ar-done">
            <span className="t"><Icon name="Check" size={13} />Completed</span>
            {job?.completed_at && (
              <span className="w">{format(parseISO(job?.completed_at), 'EEE dd/MM/yyyy, HH:mm')}</span>
            )}
          </div>
        </div>

        {historyItems?.length > 0 ? (
          <div className="jm-section">
            <p className="jm-label">Change history</p>
            <div className="ar-history">
              {historyItems?.map((entry, i) => (
                <div key={i} className="ar-hist">
                  <div className="ar-hist-top">
                    <span className="who">{entry?.user_name || 'Unknown'}</span>
                    {entry?.timestamp && (
                      <span className="when">{format(parseISO(entry?.timestamp), 'dd/MM HH:mm')}</span>
                    )}
                  </div>
                  {entry?.field && (
                    <p className="what">
                      Changed <strong>{entry?.field}</strong>
                      {entry?.old_value && <> from “{entry?.old_value}”</>}
                      {entry?.new_value && <> to “{entry?.new_value}”</>}
                    </p>
                  )}
                  {entry?.user_tier && <span className="tier">{entry?.user_tier}</span>}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="jm-empty" style={{ padding: '26px 16px' }}>
            <div className="jm-empty-ico"><Icon name="FileText" size={18} /></div>
            <p className="jm-empty-s">No change history recorded.</p>
          </div>
        )}
      </div>
    </div>
  );
};

const JobArchiveCalendarModal = ({ onClose, activeTenantId, effectiveTier, userDepartmentId, currentUserId }) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [historyByDate, setHistoryByDate] = useState({});
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedJobs, setSelectedJobs] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const tier = normalizeTier(effectiveTier);

  useEffect(() => {
    if (activeTenantId) fetchHistory();
  }, [activeTenantId, currentMonth]);

  const fetchHistory = async () => {
    setLoading(true);
    setError(null);
    try {
      const start = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
      const end = format(endOfMonth(currentMonth), 'yyyy-MM-dd');

      let query = supabase
        ?.from('job_history')
        ?.select('*')
        ?.eq('tenant_id', activeTenantId)
        ?.gte('completion_date', start)
        ?.lte('completion_date', end)
        ?.order('completed_at', { ascending: false });

      // Apply tier-based filtering
      if (tier === 'COMMAND') {
        // COMMAND: sees all departments' completed jobs — no extra filter
      } else if (tier === 'CHIEF' || tier === 'HOD') {
        // CHIEF / HOD: only their own department's completed jobs
        if (userDepartmentId) {
          query = query?.eq('department_id', userDepartmentId);
        }
      } else {
        // CREW / VIEW_ONLY: only jobs they were assigned to or created themselves
        if (currentUserId) {
          query = query?.or(`assigned_to.eq.${currentUserId},created_by.eq.${currentUserId}`);
        }
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw new Error(fetchError.message);

      // Group by date
      const grouped = {};
      (data || [])?.forEach(job => {
        const dateKey = job?.completion_date;
        if (!grouped?.[dateKey]) grouped[dateKey] = [];
        grouped?.[dateKey]?.push(job);
      });
      setHistoryByDate(grouped);
    } catch (err) {
      setError(err?.message || 'Failed to load history');
    } finally {
      setLoading(false);
    }
  };

  const handleDayClick = (date) => {
    const dateKey = format(date, 'yyyy-MM-dd');
    const jobs = historyByDate?.[dateKey] || [];
    setSelectedDate(date);
    setSelectedJobs(jobs);
    setSelectedJob(null); // reset detail view
  };

  const prevMonth = () => setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  const nextMonth = () => setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));

  const daysInMonth = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });

  // Pad start of month
  const startPad = startOfMonth(currentMonth)?.getDay();
  const paddingDays = Array(startPad)?.fill(null);

  // Subtitle describing what the user can see
  const scopeLabel = tier === 'COMMAND' ? 'All departments'
    : (tier === 'CHIEF' || tier === 'HOD')
    ? 'Your department only' : 'Your assigned jobs only';

  return (
    <ModalShell onClose={onClose} panelClassName="jm-panel ar-panel">
      <div className="jm-head">
        <div>
          <p className="jm-eyebrow">Jobs</p>
          <h2 className="jm-title">Job history</h2>
          <p className="jm-sub">Completed jobs by day · {scopeLabel}</p>
        </div>
        <button onClick={onClose} className="jm-x" title="Close">
          <Icon name="X" size={18} />
        </button>
      </div>

      <div className="ar-body">
        {/* Calendar */}
        <div className="ar-cal">
          <div className="jm-cal-head">
            <button onClick={prevMonth} className="jm-cal-nav" title="Previous month">
              <Icon name="ChevronLeft" size={16} />
            </button>
            <h3 className="jm-cal-month">{format(currentMonth, 'MMMM yyyy')}</h3>
            <button onClick={nextMonth} className="jm-cal-nav" title="Next month">
              <Icon name="ChevronRight" size={16} />
            </button>
          </div>

          <div className="jm-cal-grid" style={{ marginBottom: 4 }}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']?.map(d => (
              <div key={d} className="jm-cal-dow">{d}</div>
            ))}
          </div>

          {loading ? (
            <div className="jm-loading">
              <div className="jm-spin" />
              <p>Loading history…</p>
            </div>
          ) : error ? (
            <div className="jm-notice danger" style={{ marginTop: 12 }}>
              <Icon name="AlertTriangle" size={15} />
              <span>{error}</span>
            </div>
          ) : (
            <div className="jm-cal-grid">
              {paddingDays?.map((_, i) => (
                <div key={`pad-${i}`} className="jm-cal-day blank" />
              ))}
              {daysInMonth?.map(day => {
                const dateKey = format(day, 'yyyy-MM-dd');
                const jobs = historyByDate?.[dateKey] || [];
                const hasJobs = jobs?.length > 0;
                const isSelected = selectedDate && format(selectedDate, 'yyyy-MM-dd') === dateKey;
                const today = isToday(day);
                return (
                  <button
                    key={dateKey}
                    onClick={() => handleDayClick(day)}
                    className={`jm-cal-day${isSelected ? ' on' : ''}${today && !isSelected ? ' today' : ''}`}
                    title={hasJobs ? `${jobs?.length} completed` : 'No completed jobs'}
                  >
                    {format(day, 'd')}
                    {hasJobs && <span className="pip" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Day detail */}
        <div className="ar-side">
          {selectedJob ? (
            <JobHistoryDetailPanel job={selectedJob} onBack={() => setSelectedJob(null)} />
          ) : selectedDate ? (
            <>
              <div className="ar-side-head">
                <h4>{format(selectedDate, 'EEEE dd/MM/yyyy')}</h4>
                <p>{selectedJobs?.length} job{selectedJobs?.length !== 1 ? 's' : ''} completed</p>
              </div>
              <div className="ar-side-body">
                {selectedJobs?.length === 0 ? (
                  <div className="jm-empty" style={{ padding: '30px 16px' }}>
                    <div className="jm-empty-ico"><Icon name="Inbox" size={18} /></div>
                    <p className="jm-empty-s">Nothing was completed on this day.</p>
                  </div>
                ) : (
                  selectedJobs?.map(job => (
                    <button key={job?.id} onClick={() => setSelectedJob(job)} className="ar-job">
                      <span className={`tj-dot ${['high', 'medium', 'low']?.includes(job?.priority) ? job?.priority : 'none'}`} />
                      <span className="main">
                        <span className="t">{job?.title || 'Untitled'}</span>
                        {job?.department && !isUUID(job?.department) && (
                          <span className="s">{job?.department}</span>
                        )}
                        {job?.board_name && <span className="b">{job?.board_name}</span>}
                        <span className="w">
                          <Icon name="Check" size={11} />
                          {job?.completed_at ? format(parseISO(job?.completed_at), 'HH:mm') : ''}
                        </span>
                      </span>
                      <Icon name="ChevronRight" size={13} />
                    </button>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="jm-empty">
              <div className="jm-empty-ico"><Icon name="CalendarDays" size={20} /></div>
              <p className="jm-empty-t">Pick a day</p>
              <p className="jm-empty-s">Dotted days have completed jobs.</p>
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
};

export default JobArchiveCalendarModal;
