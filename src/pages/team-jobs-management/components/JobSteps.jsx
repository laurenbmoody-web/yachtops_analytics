import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../../../components/AppIcon';
import {
  loadJobSteps,
  addJobStep,
  setJobStepDone,
  renameJobStep,
  removeJobStep,
} from '../utils/jobSteps';
import '../job-modals.css';

/**
 * Steps — the small pieces inside one job, the way To Do does them.
 *
 * Ticking one is instant and optimistic; the write follows. Adding keeps the
 * field focused so a job can be broken into five steps without reaching for
 * the mouse, which is the only reason anyone bothers to break one down at all.
 *
 * Distinct from the duty set checklist, which comes from a rotation template
 * and is the same every time that round comes round. These belong to this job.
 */
const JobSteps = ({ job, activeTenantId, currentUserId, canInteract = true }) => {
  const [steps, setSteps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const inputRef = useRef(null);

  const jobId = job?.supabase_id || job?.id || null;

  const refresh = useCallback(async () => {
    if (!jobId || !activeTenantId) { setLoading(false); return; }
    try {
      setSteps(await loadJobSteps({ job, tenantId: activeTenantId }));
      setError(null);
    } catch (err) {
      console.warn('[JobSteps] load failed:', err);
      setError('Could not load this job’s steps.');
    } finally {
      setLoading(false);
    }
    // the job object is rebuilt each render; its id decides what to load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, activeTenantId]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleAdd = async () => {
    const text = draft?.trim();
    if (!text || adding) return;
    setAdding(true);
    try {
      const step = await addJobStep({
        job, tenantId: activeTenantId, text, userId: currentUserId, after: steps,
      });
      if (step) setSteps(prev => [...prev, step]);
      setDraft('');
      setError(null);
      inputRef?.current?.focus();
    } catch (err) {
      console.warn('[JobSteps] add failed:', err);
      setError('That step did not save. Try again.');
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (step) => {
    const next = !step?.done;
    setSteps(prev => prev?.map(s => (s?.id === step?.id ? { ...s, done: next } : s)));
    try {
      await setJobStepDone({ stepId: step?.id, done: next, userId: currentUserId });
    } catch (err) {
      console.warn('[JobSteps] toggle failed:', err);
      setSteps(prev => prev?.map(s => (s?.id === step?.id ? { ...s, done: !next } : s)));
      setError('That tick did not save.');
    }
  };

  const handleRename = async (step, text) => {
    const clean = String(text || '')?.trim();
    if (!clean || clean === step?.text) return;
    setSteps(prev => prev?.map(s => (s?.id === step?.id ? { ...s, text: clean } : s)));
    try {
      await renameJobStep({ stepId: step?.id, text: clean });
    } catch (err) {
      console.warn('[JobSteps] rename failed:', err);
      setError('That change did not save.');
    }
  };

  const handleRemove = async (step) => {
    setSteps(prev => prev?.filter(s => s?.id !== step?.id));
    try {
      await removeJobStep({ stepId: step?.id });
    } catch (err) {
      console.warn('[JobSteps] remove failed:', err);
      setError('Could not remove that step.');
      refresh();
    }
  };

  if (loading) return null;

  const done = steps?.filter(s => s?.done)?.length || 0;

  return (
    <div className="cd-steps">
      {steps?.length > 0 && (
        <div className="cd-steplist">
          {steps?.map(step => (
            <div key={step?.id} className={`cd-step${step?.done ? ' done' : ''}`}>
              <button
                type="button"
                className={`cd-stepcheck${step?.done ? ' on' : ''}`}
                disabled={!canInteract}
                onClick={() => handleToggle(step)}
                title={step?.done ? 'Not done after all' : 'Mark this step done'}
                aria-pressed={step?.done}
              >
                {step?.done && <Icon name="Check" size={11} />}
              </button>

              {canInteract ? (
                <input
                  type="text"
                  className="cd-steptext"
                  defaultValue={step?.text}
                  onBlur={(e) => handleRename(step, e?.target?.value)}
                  onKeyDown={(e) => { if (e?.key === 'Enter') e?.currentTarget?.blur(); }}
                  aria-label="Step"
                />
              ) : (
                <span className="cd-steptext ro">{step?.text}</span>
              )}

              {canInteract && (
                <button
                  type="button"
                  className="cd-stepx"
                  onClick={() => handleRemove(step)}
                  title="Remove this step"
                >
                  <Icon name="X" size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canInteract && (
        <div className="cd-stepadd">
          <span className="cd-stepaddico">
            {adding ? <span className="jm-spin sm" /> : <Icon name="Plus" size={14} />}
          </span>
          <input
            ref={inputRef}
            type="text"
            className="cd-stepinput"
            placeholder="Add step"
            value={draft}
            onChange={(e) => setDraft(e?.target?.value)}
            onKeyDown={(e) => {
              if (e?.key === 'Enter') { e?.preventDefault(); handleAdd(); }
              if (e?.key === 'Escape') setDraft('');
            }}
          />
        </div>
      )}

      {steps?.length > 0 && (
        <p className="cd-stepcount">{done} of {steps?.length} done</p>
      )}

      {error && (
        <p className="jm-err">
          <Icon name="AlertCircle" size={11} />
          {error}
        </p>
      )}
    </div>
  );
};

export default JobSteps;
