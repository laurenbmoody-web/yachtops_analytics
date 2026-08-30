import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabaseClient';
import { groupDutyTasks, MONTHLY_DUE_AFTER_DAYS } from '../utils/dutyTasks';
import '../job-modals.css';

/**
 * The working checklist for a duty set job.
 *
 * A rotation job resolves to its template through
 * team_jobs.rotation_assignment_id -> rotation_assignments.duty_set_template_id,
 * so the whole area's task list is available here. It is shown split the way
 * the round is actually worked: today's dailies, then only this weekday's
 * weeklies, then the monthlies that are falling due.
 *
 * Ticks and per-task notes are stored per (job, task) in duty_task_progress,
 * so each day's job keeps its own state.
 */
const DutySetChecklist = ({ job, activeTenantId, currentUserId, canInteract = true }) => {
  const [template, setTemplate] = useState(null);
  const [progress, setProgress] = useState({});      // taskId -> { done, note }
  const [lastDone, setLastDone] = useState({});      // taskId -> ISO of last completion
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openNote, setOpenNote] = useState(null);    // taskId whose note field is open
  const [savingId, setSavingId] = useState(null);

  const jobId = job?.supabase_id || job?.id || null;
  const rotationAssignmentId = job?.rotation_assignment_id || job?.rotationAssignmentId || null;
  const dueDate = job?.dueDate || job?.due_date || null;

  // ── Load the template behind this job, plus its saved progress ──
  useEffect(() => {
    let cancelled = false;
    if (!rotationAssignmentId || !activeTenantId) { setLoading(false); return undefined; }

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: assignment, error: aErr } = await supabase
          ?.from('rotation_assignments')
          ?.select('duty_set_template_id')
          ?.eq('id', rotationAssignmentId)
          ?.single();
        if (aErr) throw aErr;

        const templateId = assignment?.duty_set_template_id;
        if (!templateId) { if (!cancelled) { setTemplate(null); setLoading(false); } return; }

        const [{ data: tpl, error: tErr }, { data: rows }] = await Promise.all([
          supabase?.from('duty_set_templates')
            ?.select('id, name, tasks')?.eq('id', templateId)?.single(),
          jobId
            ? supabase?.from('duty_task_progress')
                ?.select('task_id, done, note')?.eq('job_id', jobId)
            : Promise.resolve({ data: [] }),
        ]);
        if (tErr) throw tErr;

        // Most recent completion per task across the vessel — drives the
        // "falling due" split on monthlies.
        const { data: history } = await supabase
          ?.from('duty_task_progress')
          ?.select('task_id, done_at')
          ?.eq('tenant_id', activeTenantId)
          ?.eq('template_id', templateId)
          ?.eq('done', true)
          ?.order('done_at', { ascending: false });

        if (cancelled) return;

        const seen = {};
        (history || []).forEach(h => { if (!seen[h?.task_id]) seen[h.task_id] = h?.done_at; });

        const prog = {};
        (rows || []).forEach(r => { prog[r?.task_id] = { done: !!r?.done, note: r?.note || '' }; });

        setTemplate(tpl || null);
        setProgress(prog);
        setLastDone(seen);
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Could not load this duty set.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [rotationAssignmentId, activeTenantId, jobId]);

  const grouped = useMemo(
    () => groupDutyTasks(template?.tasks, dueDate, lastDone),
    [template, dueDate, lastDone],
  );

  const persist = useCallback(async (taskId, patch) => {
    if (!jobId || !activeTenantId) return;
    setSavingId(taskId);
    const next = { ...(progress?.[taskId] || { done: false, note: '' }), ...patch };
    setProgress(prev => ({ ...prev, [taskId]: next }));
    try {
      const { error: upErr } = await supabase
        ?.from('duty_task_progress')
        ?.upsert({
          tenant_id: activeTenantId,
          job_id: jobId,
          template_id: template?.id || null,
          task_id: taskId,
          done: next?.done,
          done_at: next?.done ? new Date()?.toISOString() : null,
          done_by: next?.done ? (currentUserId || null) : null,
          note: next?.note || null,
          updated_at: new Date()?.toISOString(),
        }, { onConflict: 'job_id,task_id' });
      if (upErr) throw upErr;
    } catch (err) {
      console.warn('[DutySetChecklist] save failed:', err);
      setError('That change did not save. Check your connection and try again.');
    } finally {
      setSavingId(null);
    }
  }, [jobId, activeTenantId, template, currentUserId, progress]);

  if (!rotationAssignmentId) return null;

  if (loading) {
    return (
      <div className="jm-loading">
        <div className="jm-spin" />
        <p>Loading the duty set…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="jm-notice danger">
        <Icon name="AlertCircle" size={15} />
        <span>{error}</span>
      </div>
    );
  }

  // The job points at a duty set that has since been deleted or renamed away.
  // Rendering nothing here looks exactly like the checklist not existing, so
  // say what is actually wrong.
  if (!template) {
    return (
      <div className="jm-notice warn">
        <Icon name="AlertTriangle" size={15} />
        <span>
          This job came from a duty set that no longer exists, so its task list
          can’t be shown. Re-assign the day from Manage rotation to relink it.
        </span>
      </div>
    );
  }

  const total = (grouped?.today?.length || 0) + (grouped?.weekly?.tasks?.length || 0) + (grouped?.monthlyDue?.length || 0);
  const doneCount = [...(grouped?.today || []), ...(grouped?.weekly?.tasks || []), ...(grouped?.monthlyDue || [])]
    ?.filter(t => progress?.[t?.id]?.done)?.length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  const renderTask = (task, tone) => {
    const state = progress?.[task?.id] || { done: false, note: '' };
    const noteOpen = openNote === task?.id;
    return (
      <div key={task?.id} className={`dc-task${state?.done ? ' done' : ''}`}>
        <label className="dc-check">
          <input
            type="checkbox"
            checked={!!state?.done}
            disabled={!canInteract || savingId === task?.id}
            onChange={(e) => persist(task?.id, { done: e?.target?.checked })}
          />
          <span className="box"><Icon name="Check" size={11} /></span>
          <span className="t">{task?.text}</span>
        </label>

        <div className="dc-task-side">
          {tone === 'monthly' && (
            <span className="dc-age">
              {task?.daysSinceDone === null
                ? 'never done'
                : `${task?.daysSinceDone}d ago`}
            </span>
          )}
          <button
            type="button"
            className={`dc-notebtn${state?.note ? ' has' : ''}`}
            onClick={() => setOpenNote(noteOpen ? null : task?.id)}
            title={state?.note ? 'Edit note' : 'Add a note'}
          >
            <Icon name="MessageSquare" size={13} />
          </button>
        </div>

        {(noteOpen || state?.note) && (
          <div className="dc-note">
            {noteOpen ? (
              <textarea
                autoFocus
                className="jm-textarea"
                rows={2}
                placeholder="Note for today — what you found, what you left"
                defaultValue={state?.note}
                disabled={!canInteract}
                onBlur={(e) => {
                  const v = e?.target?.value;
                  setOpenNote(null);
                  if (v !== state?.note) persist(task?.id, { note: v });
                }}
              />
            ) : (
              <p className="dc-note-read" onClick={() => canInteract && setOpenNote(task?.id)}>
                {state?.note}
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="dc">
      <div className="jm-secthead-row">
        <p className="jm-secthead">
          <Icon name="ListChecks" size={14} />
          {template?.name} — today
        </p>
        <span className="cd-progress-count">{doneCount}/{total}</span>
      </div>
      <div className="cd-progress"><div className="bar" style={{ width: `${pct}%` }} /></div>

      {/* Dailies — always */}
      {grouped?.today?.length > 0 && (
        <div className="dc-group">
          <p className="dc-grouphead">
            <span>Daily</span>
            <span className="n">{grouped?.today?.length}</span>
          </p>
          {grouped?.today?.map(t => renderTask(t, 'daily'))}
        </div>
      )}

      {/* This weekday's weeklies only */}
      {grouped?.weekly?.tasks?.length > 0 && (
        <div className="dc-group">
          <p className="dc-grouphead">
            <span>Weekly — {grouped?.weekly?.label}</span>
            <span className="n">{grouped?.weekly?.tasks?.length}</span>
          </p>
          {grouped?.weekly?.tasks?.map(t => renderTask(t, 'weekly'))}
        </div>
      )}

      {/* Monthlies that have gone long enough to need doing */}
      {grouped?.monthlyDue?.length > 0 && (
        <div className="dc-group due">
          <p className="dc-grouphead">
            <span>Suggested before month end</span>
            <span className="n">{grouped?.monthlyDue?.length}</span>
          </p>
          <p className="dc-groupnote">
            Not done in over {MONTHLY_DUE_AFTER_DAYS} days — pick these up when you have time in the round.
          </p>
          {grouped?.monthlyDue?.map(t => renderTask(t, 'monthly'))}
        </div>
      )}

      {/* Monthlies recently done — collapsed out of the way */}
      {grouped?.monthlyRecent?.length > 0 && (
        <details className="dc-recent">
          <summary>
            {grouped?.monthlyRecent?.length} monthly {grouped?.monthlyRecent?.length === 1 ? 'task' : 'tasks'} done recently
          </summary>
          <div className="dc-group">
            {grouped?.monthlyRecent?.map(t => renderTask(t, 'monthly'))}
          </div>
        </details>
      )}

      {total === 0 && grouped?.monthlyRecent?.length === 0 && (
        <p className="jm-hint">Nothing scheduled for this duty set today.</p>
      )}
    </div>
  );
};

export default DutySetChecklist;
