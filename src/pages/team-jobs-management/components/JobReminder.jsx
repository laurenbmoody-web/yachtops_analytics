import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../../../components/AppIcon';
import DateInput from '../../../components/ui/DateInput';
import {
  loadJobReminders,
  setJobReminder,
  snoozeJobReminder,
  cancelJobReminder,
  loadVesselTimezone,
  reminderPresets,
  snoozePresets,
  formatReminder,
  toWallClock,
  fromWallClock,
} from '../utils/jobReminders';
import '../job-modals.css';

/**
 * Remind me.
 *
 * Reads as one row like the others, and opens in place: presets first because
 * nobody wants a date picker to be told about a job in an hour, the picker
 * underneath for the times the presets do not cover.
 *
 * Two things To Do cannot do sit in here:
 *   • the recipient selector — a chief nudges the assignee rather than
 *     having to remember to chase them
 *   • snooze, once it has fired — "not now" moves the same row rather than
 *     throwing it away, and the row counts how many times you have done it
 */
const JobReminder = ({
  job,
  activeTenantId,
  currentUserId,
  teamMembers = [],
  canInteract = true,
}) => {
  const [reminders, setReminders] = useState([]);
  const [timezone, setTimezone] = useState(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [forUserId, setForUserId] = useState(currentUserId || '');
  const [customDate, setCustomDate] = useState('');
  const [customTime, setCustomTime] = useState('09:00');

  const jobId = job?.supabase_id || job?.id || null;

  const refresh = useCallback(async () => {
    if (!jobId || !activeTenantId) return;
    try {
      setReminders(await loadJobReminders({ job, tenantId: activeTenantId }));
      setError(null);
    } catch (err) {
      console.warn('[JobReminder] load failed:', err);
      setError('Could not load reminders for this job.');
    }
    // the job object is rebuilt each render; its id decides what to load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, activeTenantId]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { setForUserId(currentUserId || ''); }, [currentUserId]);

  useEffect(() => {
    let alive = true;
    loadVesselTimezone(activeTenantId)?.then(tz => { if (alive) setTimezone(tz); });
    return () => { alive = false; };
  }, [activeTenantId]);

  // Mine first: the row reads back my own reminder before anyone else's.
  const mine = useMemo(
    () => reminders?.find(r => r?.userId === currentUserId) || null,
    [reminders, currentUserId],
  );
  const others = useMemo(
    () => reminders?.filter(r => r?.userId !== currentUserId) || [],
    [reminders, currentUserId],
  );
  const shown = mine || others?.[0] || null;

  const nameFor = (userId) => {
    if (userId === currentUserId) return 'you';
    return teamMembers?.find(m => m?.id === userId)?.name || 'someone';
  };

  const presets = useMemo(
    () => reminderPresets({ timezone, dueDate: job?.dueDate }),
    [timezone, job?.dueDate],
  );
  const snoozes = useMemo(() => snoozePresets({ timezone }), [timezone]);

  const save = async (wall) => {
    if (!wall || saving) return;
    setSaving(true);
    setError(null);
    try {
      await setJobReminder({
        job,
        tenantId: activeTenantId,
        userId: currentUserId,
        forUserId: forUserId || currentUserId,
        remindLocal: wall,
      });
      await refresh();
      setOpen(false);
      setCustomDate('');
    } catch (err) {
      console.warn('[JobReminder] save failed:', err);
      setError(err?.message || 'That reminder did not save.');
    } finally {
      setSaving(false);
    }
  };

  const snooze = async (wall) => {
    if (!shown || saving) return;
    setSaving(true);
    try {
      await snoozeJobReminder({ reminder: shown, remindLocal: wall });
      await refresh();
      setOpen(false);
    } catch (err) {
      console.warn('[JobReminder] snooze failed:', err);
      setError('Could not snooze that.');
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (!shown) return;
    setReminders(prev => prev?.filter(r => r?.id !== shown?.id));
    try {
      await cancelJobReminder({ reminderId: shown?.id });
    } catch (err) {
      console.warn('[JobReminder] cancel failed:', err);
      setError('Could not clear that reminder.');
      refresh();
    }
  };

  const label = (() => {
    if (!shown) return 'Remind me';
    const when = formatReminder(shown?.remindLocal);
    const who = shown?.userId === currentUserId ? '' : ` · ${nameFor(shown?.userId)}`;
    if (shown?.state === 'sent') return `Reminded ${when}${who}`;
    return `${when}${who}`;
  })();

  const fired = shown?.state === 'sent';

  return (
    <>
      <button
        type="button"
        className={`cd-row${open ? ' open' : ''}${shown ? ' set' : ''}`}
        onClick={() => canInteract && setOpen(!open)}
        disabled={!canInteract}
      >
        <span className="cd-rowico">
          {saving ? <span className="jm-spin sm" /> : <Icon name={fired ? 'BellRing' : 'Bell'} size={15} />}
        </span>
        <span className="cd-rowlabel">{label}</span>
        {shown?.snoozeCount > 0 && (
          <span className="cd-rowmeta">snoozed {shown?.snoozeCount}×</span>
        )}
        {shown && canInteract && (
          <span
            role="button"
            tabIndex={0}
            className="cd-rowclear"
            title="Clear this reminder"
            onClick={(e) => { e?.stopPropagation(); clear(); }}
            onKeyDown={(e) => { if (e?.key === 'Enter') { e?.stopPropagation(); clear(); } }}
          >
            <Icon name="X" size={14} />
          </span>
        )}
      </button>

      {open && canInteract && (
        <div className="cd-rowpanel">
          {/* Once it has gone off, the useful action is "not now", not
              "set another one" — so that is what the panel leads with. */}
          <div className="jm-pills" style={{ marginBottom: 10 }}>
            {(fired ? snoozes : presets)?.map(p => (
              <button
                key={p?.key}
                type="button"
                className="jm-pill"
                onClick={() => (fired ? snooze(p?.wall) : save(p?.wall))}
              >
                {p?.label}
              </button>
            ))}
          </div>

          {/* A date and a time, not input[type=datetime-local] — that drew
              the browser's calendar, which is the one thing on this panel
              that did not look like Cargo. */}
          <div className="cd-remindrow">
            <DateInput
              className="jm-input"
              value={customDate}
              onChange={(e) => setCustomDate(e?.target?.value)}
            />
            <input
              type="time"
              className="jm-input cd-remindtime"
              value={customTime}
              onChange={(e) => setCustomTime(e?.target?.value)}
              aria-label="Time"
            />
            <button
              type="button"
              className="jm-btn primary sm"
              disabled={!customDate || saving}
              onClick={() => {
                const d = fromWallClock(`${customDate}T${customTime || '09:00'}`);
                if (d) (fired ? snooze(toWallClock(d)) : save(toWallClock(d)));
              }}
            >
              Set
            </button>
          </div>

          {/* The nudge. Only offered where there is someone to nudge. */}
          {!fired && teamMembers?.length > 0 && (
            <label className="cd-remindwho">
              <span className="cd-remindwholbl">Remind</span>
              <select
                className="jm-select"
                value={forUserId || ''}
                onChange={(e) => setForUserId(e?.target?.value)}
              >
                <option value={currentUserId || ''}>me</option>
                {teamMembers
                  ?.filter(m => m?.id && m?.id !== currentUserId)
                  ?.map(m => (
                    <option key={m?.id} value={m?.id}>{m?.name}</option>
                  ))}
              </select>
            </label>
          )}

          <p className="jm-hint">
            {timezone
              ? `Fires on ${timezone.replace('_', ' ')} time, from the server — it lands even with the app shut.`
              : 'Fires from the server, so it lands even with the app shut.'}
            {' '}Held if the job is done first, or if you are inside your quiet hours.
          </p>

          {others?.length > 0 && mine && (
            <p className="jm-hint">
              Also set for {others?.map(o => nameFor(o?.userId))?.join(', ')}.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="jm-err">
          <Icon name="AlertCircle" size={11} />
          {error}
        </p>
      )}
    </>
  );
};

export default JobReminder;
