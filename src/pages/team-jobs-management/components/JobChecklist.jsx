import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { MONTHLY_DUE_AFTER_DAYS, groupDutyTasks } from '../utils/dutyTasks';
import { loadDutySetForJob, rotationAssignmentIdOf, jobIdOf } from '../utils/dutyProgress';
import {
  ORIGIN, STATUS, ITEM_TYPE, SECTION_TODAY,
  loadChecklist, ensureChecklist, saveItem, addManualItem, removeItem,
  autoTickDailies, clearAutoTicks, bySection, isOutOfRange,
} from '../utils/jobChecklist';
import { fetchSchedule } from '../../upkeep/utils/upkeepStorage';
import '../job-modals.css';

/**
 * The checklist on a job — whatever raised it.
 *
 * A job is a card and a checklist is something a card has, so one component
 * serves all of them. What differs is only who fills the list:
 *
 *   duty    the duty set template, sliced to this job's own day — today's
 *           dailies, this weekday's weeklies, the monthlies falling due
 *   upkeep  an upkeep schedule's typed steps, readings and all
 *   manual  whatever someone types on the card
 *
 * Items are stored with their wording frozen, so editing a template later
 * cannot rewrite what a past job says it covered.
 */
const JobChecklist = ({ job, tenantId, actor, canInteract = true }) => {
  const [items, setItems] = useState([]);
  const [template, setTemplate] = useState(null);
  const [recentlyDone, setRecentlyDone] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [missingTemplate, setMissingTemplate] = useState(false);
  const [openNote, setOpenNote] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [newItemText, setNewItemText] = useState('');

  const jobId = jobIdOf(job);
  const jobStatus = job?.status || null;
  const source = job?.source || null;
  const isDuty = !!rotationAssignmentIdOf(job);
  const isUpkeep = source === ORIGIN.UPKEEP;
  const scheduleId = job?.upkeep_schedule_id || job?.upkeepScheduleId || null;

  // Keyed on jobStatus too: completing the job ticks its dailies server-side,
  // so a checklist left open has to pick that up rather than keep showing zero.
  const load = useCallback(async () => {
    if (!jobId || !tenantId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    setMissingTemplate(false);
    try {
      if (isDuty) {
        const loaded = await loadDutySetForJob({ job, tenantId });
        if (!loaded?.template) { setMissingTemplate(true); setItems([]); return; }
        setTemplate(loaded.template);
        setItems(loaded.items || []);
        // The monthlies done recently are shown collapsed, for reassurance
        // rather than action, so they are never materialised onto the job.
        const grouped = groupDutyTasks(loaded.template?.tasks, job?.dueDate || job?.due_date, loaded.lastDone);
        setRecentlyDone(grouped?.monthlyRecent || []);
      } else if (isUpkeep && scheduleId) {
        const schedule = await fetchSchedule(scheduleId);
        setItems(await ensureChecklist({
          jobId, tenantId, origin: ORIGIN.UPKEEP, steps: schedule?.steps || [],
        }));
      } else {
        setItems(await loadChecklist(jobId));
      }
    } catch (err) {
      setError(err?.message || 'Could not load this checklist.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, tenantId, isDuty, isUpkeep, scheduleId, jobStatus]);

  useEffect(() => { load(); }, [load]);

  const sections = useMemo(() => bySection(items), [items]);
  const total = items.length;
  const doneCount = items.filter((i) => i.status === STATUS.DONE).length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  const dailies = items.filter((i) => i.section === SECTION_TODAY);
  const allDailiesDone = dailies.length > 0 && dailies.every((i) => i.status === STATUS.DONE);

  const patch = async (item, changes) => {
    if (!canInteract) return;
    setSavingId(item.id);
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...changes } : i)));
    try {
      const saved = await saveItem(item.id, {
        ...changes,
        minNormal: item.minNormal,
        maxNormal: item.maxNormal,
      }, actor);
      setItems((prev) => prev.map((i) => (i.id === saved.id ? saved : i)));
    } catch (err) {
      setError(err?.message || 'Could not save that.');
      await load();
    } finally {
      setSavingId(null);
    }
  };

  const toggle = (item, checked) =>
    patch(item, { status: checked ? STATUS.DONE : STATUS.PENDING });

  const handleBulk = async () => {
    setBulkSaving(true);
    try {
      if (allDailiesDone) await clearAutoTicks(jobId);
      else await autoTickDailies({ jobId, tenantId, userId: actor?.userId, userName: actor?.userName });
      setItems(await loadChecklist(jobId));
    } catch (err) {
      setError(err?.message || 'Could not update the round.');
    } finally {
      setBulkSaving(false);
    }
  };

  const handleAdd = async () => {
    if (!newItemText.trim()) return;
    try {
      await addManualItem({ jobId, tenantId, text: newItemText, position: items.length });
      setNewItemText('');
      setItems(await loadChecklist(jobId));
    } catch (err) {
      setError(err?.message || 'Could not add that.');
    }
  };

  const handleRemove = async (item) => {
    try {
      await removeItem(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (err) {
      setError(err?.message || 'Could not remove that.');
    }
  };

  if (loading) return <p className="jm-hint">Loading checklist…</p>;

  if (error) {
    return (
      <div className="jm-notice danger">
        <Icon name="AlertCircle" size={15} />
        <span>{error}</span>
      </div>
    );
  }

  // The job points at a duty set that has since been deleted or renamed away.
  // Rendering nothing looks exactly like the checklist not existing, so say
  // what is actually wrong.
  if (missingTemplate) {
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

  const renderItem = (item) => {
    const noteOpen = openNote === item.id;
    const isDone = item.status === STATUS.DONE;
    const isReading = item.itemType === ITEM_TYPE.READING;
    const draft = drafts[item.id];
    const value = draft !== undefined ? draft : (item.valueNumeric ?? '');
    const out = isReading && isOutOfRange(value, item.minNormal, item.maxNormal);

    return (
      <div key={item.id} className={`dc-task${isDone ? ' done' : ''}`}>
        <label className="dc-check">
          <input
            type="checkbox"
            checked={isDone}
            disabled={!canInteract || savingId === item.id}
            onChange={(e) => toggle(item, e?.target?.checked)}
          />
          <span className="box"><Icon name="Check" size={11} /></span>
          <span className="t">{item.text}</span>
        </label>

        <div className="dc-task-side">
          {item.isMandatory && <span className="dc-age">required</span>}
          <button
            type="button"
            className={`dc-notebtn${item.note ? ' has' : ''}`}
            onClick={() => setOpenNote(noteOpen ? null : item.id)}
            title={item.note ? 'Edit note' : 'Add a note'}
          >
            <Icon name="MessageSquare" size={13} />
          </button>
          {item.originKind === ORIGIN.MANUAL && canInteract && (
            <button type="button" className="dc-notebtn" title="Remove this item"
              onClick={() => handleRemove(item)}>
              <Icon name="X" size={13} />
            </button>
          )}
        </div>

        {isReading && (
          <div className="dc-reading">
            <input
              className={`dc-num${out || item.outOfRange ? ' out' : ''}`}
              type="number"
              inputMode="decimal"
              placeholder="—"
              disabled={!canInteract}
              value={value}
              onChange={(e) => setDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
              onBlur={() => {
                const v = drafts[item.id];
                if (v === undefined) return;
                setDrafts((d) => { const n = { ...d }; delete n[item.id]; return n; });
                if (String(v) !== String(item.valueNumeric ?? '')) patch(item, { valueNumeric: v });
              }}
              aria-label={`Reading for ${item.text}`}
            />
            {item.unit && <span className="dc-unit">{item.unit}</span>}
            {(item.minNormal != null || item.maxNormal != null) && (
              <span className="dc-range">
                normal {item.minNormal ?? '−∞'} to {item.maxNormal ?? '∞'}
              </span>
            )}
            {(out || item.outOfRange) && (
              <span className="dc-out"><Icon name="AlertTriangle" size={11} /> Out of range</span>
            )}
          </div>
        )}

        {(noteOpen || item.note) && (
          <div className="dc-note">
            {noteOpen ? (
              <textarea
                autoFocus
                className="jm-textarea"
                rows={2}
                placeholder="Note for today — what you found, what you left"
                defaultValue={item.note}
                disabled={!canInteract}
                onBlur={(e) => {
                  const v = e?.target?.value;
                  setOpenNote(null);
                  if (v !== item.note) patch(item, { note: v });
                }}
              />
            ) : (
              <p className="dc-note-read" onClick={() => canInteract && setOpenNote(item.id)}>
                {item.note}
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  const headLabel = isDuty && template ? `${template.name} — today` : 'Checklist';

  return (
    <div className="dc">
      <div className="jm-secthead-row">
        <p className="jm-secthead">
          <Icon name="ListChecks" size={14} />
          {headLabel}
        </p>
        <div className="dc-headside">
          {canInteract && dailies.length > 0 && (
            <button type="button" className="dc-bulk" onClick={handleBulk} disabled={bulkSaving}>
              <Icon name={allDailiesDone ? 'Square' : 'CheckCheck'} size={13} />
              {bulkSaving ? 'Saving…' : (allDailiesDone ? 'Clear dailies' : 'Tick all dailies')}
            </button>
          )}
          <span className="cd-progress-count">{doneCount}/{total}</span>
        </div>
      </div>
      <div className="cd-progress"><div className="bar" style={{ width: `${pct}%` }} /></div>

      {sections.map(({ section, items: secItems }) => (
        <div key={section || 'ungrouped'}
          className={`dc-group${section?.startsWith('Monthly') ? ' due' : ''}`}>
          {section && (
            <p className="dc-grouphead">
              <span>{section}</span>
              <span className="n">{secItems.length}</span>
            </p>
          )}
          {section?.startsWith('Monthly') && (
            <p className="dc-groupnote">
              Not done in over {MONTHLY_DUE_AFTER_DAYS} days — pick these up when you have
              time in the round.
            </p>
          )}
          {secItems.map(renderItem)}
        </div>
      ))}

      {/* Monthlies recently done — collapsed out of the way. Informational, so
          never materialised onto the job: ticking one would claim it was redone
          today and push its clock out. */}
      {recentlyDone.length > 0 && (
        <details className="dc-recent">
          <summary>
            {recentlyDone.length} monthly {recentlyDone.length === 1 ? 'task' : 'tasks'} done recently
          </summary>
          <div className="dc-group">
            {recentlyDone.map((t) => (
              <div key={t?.id || t?.text} className="dc-task done">
                <label className="dc-check">
                  <input type="checkbox" checked readOnly disabled />
                  <span className="box"><Icon name="Check" size={11} /></span>
                  <span className="t">{t?.text}</span>
                </label>
                <div className="dc-task-side">
                  <span className="dc-age">
                    {t?.daysSinceDone === null ? 'never done' : `${t?.daysSinceDone}d ago`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* A card anyone can add to — the Trello checklist, on any job. */}
      {canInteract && !isDuty && (
        <div className="dc-add">
          <input
            className="jm-input"
            placeholder="Add a checklist item…"
            value={newItemText}
            onChange={(e) => setNewItemText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
          />
          <button type="button" className="dc-bulk" onClick={handleAdd} disabled={!newItemText.trim()}>
            <Icon name="Plus" size={13} /> Add
          </button>
        </div>
      )}

      {total === 0 && recentlyDone.length === 0 && (
        <p className="jm-hint">
          {isDuty ? 'Nothing scheduled for this duty set today.' : 'No checklist on this job yet.'}
        </p>
      )}
    </div>
  );
};

export default JobChecklist;
