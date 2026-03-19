import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabaseClient';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isToday, parseISO } from 'date-fns';
import { normalizeTier } from '../utils/tierPermissions';

// Helper: detect if a string looks like a UUID
const isUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i?.test(str);

const JobHistoryDetailPanel = ({ job, onBack }) => {
  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'text-red-500 bg-red-500/10';
      case 'medium': return 'text-yellow-500 bg-yellow-500/10';
      case 'low': return 'text-green-500 bg-green-500/10';
      default: return 'text-muted-foreground bg-muted';
    }
  };

  const metadata = Array.isArray(job?.metadata) ? job?.metadata : [];
  const checklistItems = metadata?.filter(m => m?.type === 'checklist' || m?.field === 'checklist');
  const historyItems = metadata?.filter(m => m?.timestamp && m?.field !== 'checklist');

  return (
    <div className="flex flex-col h-full">
      {/* Back button */}
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Icon name="ChevronLeft" size={14} />
          Back
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Title & Priority */}
        <div>
          <div className="flex items-start gap-2 mb-1">
            {job?.priority && (
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${getPriorityColor(job?.priority)}`}>
                {job?.priority}
              </span>
            )}
          </div>
          <h3 className="text-base font-semibold text-foreground leading-snug">{job?.title || 'Untitled'}</h3>
          {job?.description && (
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{job?.description}</p>
          )}
        </div>

        {/* Board / Department */}
        {(job?.board_name || (!isUUID(job?.department) && job?.department)) && (
          <div className="space-y-1.5">
            {job?.board_name && (
              <div className="flex items-center gap-2">
                <Icon name="LayoutDashboard" size={13} className="text-muted-foreground flex-shrink-0" />
                <span className="text-xs text-foreground">{job?.board_name}</span>
              </div>
            )}
            {!isUUID(job?.department) && job?.department && (
              <div className="flex items-center gap-2">
                <Icon name="Building2" size={13} className="text-muted-foreground flex-shrink-0" />
                <span className="text-xs text-foreground">{job?.department}</span>
              </div>
            )}
          </div>
        )}

        {/* Completion Info */}
        <div className="p-3 rounded-xl bg-green-500/8 border border-green-500/20 space-y-2">
          <div className="flex items-center gap-2">
            <Icon name="CheckCircle" size={14} className="text-green-500 flex-shrink-0" />
            <span className="text-xs font-medium text-green-600 dark:text-green-400">Completed</span>
          </div>
          {job?.completed_at && (
            <div className="flex items-center gap-2 pl-5">
              <Icon name="Clock" size={12} className="text-muted-foreground flex-shrink-0" />
              <span className="text-xs text-muted-foreground">
                {format(parseISO(job?.completed_at), 'EEE d MMM yyyy, HH:mm')}
              </span>
            </div>
          )}
        </div>

        {/* Change History */}
        {historyItems?.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Change History</p>
            <div className="space-y-1.5">
              {historyItems?.map((entry, i) => (
                <div key={i} className="p-2.5 rounded-lg bg-muted/30 border border-border">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[11px] font-medium text-foreground">{entry?.user_name || 'Unknown'}</span>
                    {entry?.timestamp && (
                      <span className="text-[10px] text-muted-foreground">
                        {format(parseISO(entry?.timestamp), 'dd/MM HH:mm')}
                      </span>
                    )}
                  </div>
                  {entry?.field && (
                    <p className="text-[11px] text-muted-foreground">
                      Changed <span className="text-foreground">{entry?.field}</span>
                      {entry?.old_value && <span> from "{entry?.old_value}"</span>}
                      {entry?.new_value && <span> to "{entry?.new_value}"</span>}
                    </p>
                  )}
                  {entry?.user_tier && (
                    <span className="text-[10px] text-muted-foreground/60">{entry?.user_tier}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* No extra info */}
        {historyItems?.length === 0 && (
          <div className="flex flex-col items-center justify-center py-4 text-center">
            <Icon name="FileText" size={20} className="text-muted-foreground/30 mb-2" />
            <p className="text-xs text-muted-foreground">No change history recorded</p>
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

  const getPriorityDot = (priority) => {
    switch (priority) {
      case 'high': return 'bg-red-500';
      case 'medium': return 'bg-yellow-500';
      case 'low': return 'bg-green-500';
      default: return 'bg-gray-400';
    }
  };

  // Subtitle describing what the user can see
  const scopeLabel = tier === 'COMMAND' ? 'All departments'
    : (tier === 'CHIEF' || tier === 'HOD')
    ? 'Your department only' : 'Your assigned jobs only';

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[400] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e?.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Icon name="Archive" size={18} className="text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Job History Archive</h2>
              <p className="text-xs text-muted-foreground">Completed jobs by day · {scopeLabel}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
          >
            <Icon name="X" size={18} className="text-muted-foreground" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Calendar Panel */}
          <div className="flex-1 p-6 overflow-y-auto">
            {/* Month Navigation */}
            <div className="flex items-center justify-between mb-5">
              <button
                onClick={prevMonth}
                className="p-2 hover:bg-muted rounded-lg transition-colors"
              >
                <Icon name="ChevronLeft" size={18} className="text-foreground" />
              </button>
              <h3 className="text-base font-semibold text-foreground">
                {format(currentMonth, 'MMMM yyyy')}
              </h3>
              <button
                onClick={nextMonth}
                className="p-2 hover:bg-muted rounded-lg transition-colors"
              >
                <Icon name="ChevronRight" size={18} className="text-foreground" />
              </button>
            </div>

            {/* Day Headers */}
            <div className="grid grid-cols-7 mb-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']?.map(d => (
                <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
              ))}
            </div>

            {/* Calendar Grid */}
            {loading ? (
              <div className="flex items-center justify-center h-48">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : error ? (
              <div className="flex items-center justify-center h-48">
                <p className="text-sm text-red-500">{error}</p>
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-1">
                {paddingDays?.map((_, i) => (
                  <div key={`pad-${i}`} className="h-16" />
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
                      className={`h-16 rounded-xl border p-1.5 flex flex-col items-start transition-all ${
                        isSelected
                          ? 'border-primary bg-primary/10'
                          : hasJobs
                          ? 'border-green-500/40 bg-green-500/5 hover:bg-green-500/10 cursor-pointer' : 'border-border bg-muted/20 hover:bg-muted/40 cursor-pointer'
                      }`}
                    >
                      <span className={`text-xs font-medium ${
                        today ? 'text-primary font-bold' : 'text-foreground'
                      }`}>
                        {format(day, 'd')}
                      </span>
                      {hasJobs && (
                        <div className="mt-auto w-full">
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-green-500/20 text-green-600 dark:text-green-400 text-[10px] font-semibold">
                            <Icon name="CheckCircle" size={9} />
                            {jobs?.length}
                          </span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Day Detail Panel */}
          <div className="w-80 border-l border-border flex flex-col">
            {selectedJob ? (
              <JobHistoryDetailPanel job={selectedJob} onBack={() => setSelectedJob(null)} />
            ) : selectedDate ? (
              <>
                <div className="px-5 py-4 border-b border-border">
                  <h4 className="text-sm font-semibold text-foreground">
                    {format(selectedDate, 'EEEE, MMMM d yyyy')}
                  </h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {selectedJobs?.length} job{selectedJobs?.length !== 1 ? 's' : ''} completed
                  </p>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  {selectedJobs?.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-center">
                      <Icon name="Inbox" size={24} className="text-muted-foreground/40 mb-2" />
                      <p className="text-sm text-muted-foreground">No completed jobs</p>
                    </div>
                  ) : (
                    selectedJobs?.map(job => (
                      <button
                        key={job?.id}
                        onClick={() => setSelectedJob(job)}
                        className="w-full text-left p-3 rounded-xl border border-border bg-background hover:bg-muted/40 hover:border-primary/30 transition-all cursor-pointer group"
                      >
                        <div className="flex items-start gap-2">
                          {job?.priority && (
                            <div className={`w-2 h-2 rounded-full ${getPriorityDot(job?.priority)} flex-shrink-0 mt-1.5`} />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground line-clamp-2 group-hover:text-primary transition-colors">
                              {job?.title || 'Untitled'}
                            </p>
                            {/* Only show department if it's NOT a UUID */}
                            {job?.department && !isUUID(job?.department) && (
                              <p className="text-xs text-muted-foreground mt-0.5">{job?.department}</p>
                            )}
                            {job?.board_name && (
                              <p className="text-xs text-primary/70 mt-0.5">{job?.board_name}</p>
                            )}
                            <div className="flex items-center justify-between mt-1.5">
                              <div className="flex items-center gap-1">
                                <Icon name="CheckCircle" size={11} className="text-green-500" />
                                <span className="text-xs text-muted-foreground">
                                  {job?.completed_at ? format(parseISO(job?.completed_at), 'HH:mm') : ''}
                                </span>
                              </div>
                              <Icon name="ChevronRight" size={12} className="text-muted-foreground/40 group-hover:text-primary/60 transition-colors" />
                            </div>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center flex-1 text-center p-6">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                  <Icon name="CalendarDays" size={22} className="text-muted-foreground/50" />
                </div>
                <p className="text-sm font-medium text-foreground mb-1">Select a day</p>
                <p className="text-xs text-muted-foreground">Click any day to see completed jobs</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default JobArchiveCalendarModal;
