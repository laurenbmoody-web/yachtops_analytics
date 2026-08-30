import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { fetchStepResults, saveStepResult } from '../utils/upkeepStorage';
import { STEP_TYPES, isOutOfRange } from '../utils/recurrence';
import './step-runner.css';

// The step list for one Upkeep occurrence, rendered inside the Team Jobs job
// view. This is the half of the fix the crew actually touches: every step has
// its own tick, its own comment box and — for a reading — its own number, checked
// against the normal range as it is typed.
//
// The wording shown is upkeep_step_results.step_text, the frozen copy taken when
// the occurrence was generated. Editing the schedule afterwards does not change
// what a past job says it asked for.

const StepRunner = ({ jobId, actor, readOnly = false }) => {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState({});   // local edits, flushed on blur
  const [busy, setBusy] = useState({});
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!jobId) { setResults([]); setLoading(false); return; }
    try {
      setLoading(true);
      setResults(await fetchStepResults(jobId));
      setError('');
    } catch (e) {
      setError(e?.message || 'Could not load the steps.');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => { load(); }, [load]);

  const doneCount = useMemo(
    () => results.filter((r) => r.status === 'done' || r.status === 'skipped').length,
    [results],
  );

  const patch = async (result, changes) => {
    if (readOnly) return;
    setBusy((b) => ({ ...b, [result.id]: true }));
    try {
      const saved = await saveStepResult(result.id, {
        ...changes,
        minNormal: result.minNormal,
        maxNormal: result.maxNormal,
        // a reading wired to a counter also lands in the counter log, which is
        // what moves the next counter-based due date
        counterId: result.counterId,
      }, actor);
      setResults((prev) => prev.map((r) => (r.id === saved.id ? { ...r, ...saved } : r)));
      setError('');
    } catch (e) {
      setError(e?.message || 'Could not save that step.');
    } finally {
      setBusy((b) => ({ ...b, [result.id]: false }));
    }
  };

  const toggleDone = (r) =>
    patch(r, { status: r.status === 'done' ? 'pending' : 'done' });

  const setStatus = (r, status) =>
    patch(r, { status: r.status === status ? 'pending' : status });

  const draftFor = (r, field) => (drafts[r.id]?.[field] ?? (field === 'comment' ? (r.comment ?? '') : (r.valueNumeric ?? '')));

  const setDraft = (r, field, value) =>
    setDrafts((d) => ({ ...d, [r.id]: { ...d[r.id], [field]: value } }));

  const flush = (r, field) => {
    const value = drafts[r.id]?.[field];
    if (value === undefined) return;
    setDrafts((d) => {
      const next = { ...d, [r.id]: { ...d[r.id] } };
      delete next[r.id][field];
      return next;
    });
    if (field === 'comment') {
      if ((value || '') !== (r.comment || '')) patch(r, { comment: value });
    } else {
      const before = r.valueNumeric ?? '';
      if (String(value) !== String(before)) patch(r, { valueNumeric: value });
    }
  };

  if (loading) return <div className="usr-empty">Loading steps…</div>;
  if (!results.length) return null;

  const pct = results.length ? Math.round((doneCount / results.length) * 100) : 0;

  return (
    <div className="usr-wrap">
      {error && <div className="usr-err">{error}</div>}

      <div className="usr-head">
        <span className="usr-label">Steps</span>
        <span className="usr-progress"><span className="done">{doneCount}</span> of {results.length} done</span>
      </div>
      <div className="usr-bar"><span style={{ width: `${pct}%` }} /></div>

      <div className="usr-list">
        {results.map((r) => {
          const isDone = r.status === 'done';
          const isFailed = r.status === 'failed';
          const isSkipped = r.status === 'skipped';
          const val = draftFor(r, 'value');
          const out = r.stepType === STEP_TYPES.READING && isOutOfRange(val, r.minNormal, r.maxNormal);

          return (
            <div key={r.id} className={`usr-step ${isDone ? 'is-done' : ''} ${isFailed ? 'is-failed' : ''}`}>
              <button
                type="button"
                className={`usr-tick ${isDone ? 'is-on' : ''} ${isFailed ? 'is-failed' : ''}`}
                onClick={() => toggleDone(r)}
                disabled={readOnly || busy[r.id]}
                aria-label={isDone ? 'Mark not done' : 'Mark done'}
              >
                {(isDone || isFailed) && <Icon name={isFailed ? 'X' : 'Check'} size={13} />}
              </button>

              <div>
                <p className="usr-text">{r.stepText}</p>

                <div className="usr-meta">
                  {r.isMandatory && <><span className="usr-req">Required</span><span className="sep">·</span></>}
                  {isSkipped && <><span>Skipped</span><span className="sep">·</span></>}
                  {r.stepType !== STEP_TYPES.CHECK && <span>{r.stepType}</span>}
                </div>

                {r.stepType === STEP_TYPES.READING && (
                  <div className="usr-reading">
                    <input
                      className={`usr-num ${out || r.outOfRange ? 'is-out' : ''}`}
                      type="number"
                      inputMode="decimal"
                      value={val}
                      disabled={readOnly}
                      placeholder="—"
                      onChange={(e) => setDraft(r, 'value', e.target.value)}
                      onBlur={() => flush(r, 'value')}
                      aria-label={`Reading for ${r.stepText}`}
                    />
                    {r.unit && <span className="usr-unit">{r.unit}</span>}
                    {(r.minNormal != null || r.maxNormal != null) && (
                      <span className="usr-range">
                        normal {r.minNormal ?? '−∞'} to {r.maxNormal ?? '∞'}
                      </span>
                    )}
                    {(out || r.outOfRange) && (
                      <span className="usr-outflag"><Icon name="AlertTriangle" size={11} /> Out of range</span>
                    )}
                  </div>
                )}

                <textarea
                  className="usr-comment"
                  rows={1}
                  placeholder="Add a note about this step…"
                  value={draftFor(r, 'comment')}
                  disabled={readOnly}
                  onChange={(e) => setDraft(r, 'comment', e.target.value)}
                  onBlur={() => flush(r, 'comment')}
                />

                {!readOnly && (
                  <div className="usr-tools">
                    <button type="button" className={`usr-mini is-fail ${isFailed ? 'is-on' : ''}`}
                      onClick={() => setStatus(r, 'failed')} disabled={busy[r.id]}>
                      Problem found
                    </button>
                    <button type="button" className={`usr-mini ${isSkipped ? 'is-on' : ''}`}
                      onClick={() => setStatus(r, 'skipped')} disabled={busy[r.id] || r.isMandatory}>
                      {r.isMandatory ? 'Cannot skip' : 'Not applicable'}
                    </button>
                  </div>
                )}

                {r.completedAt && r.completedByName && (
                  <p className="usr-signer">
                    {isFailed ? 'Problem logged' : isSkipped ? 'Skipped' : 'Done'} by {r.completedByName}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {results.some((r) => r.status === 'failed') && (
        <div className="usr-note">
          A step is marked as a problem. Raise it as a defect so it gets tracked to a fix —
          signing the job off does not close the fault.
        </div>
      )}
    </div>
  );
};

export default StepRunner;
