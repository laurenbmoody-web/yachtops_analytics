import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../components/AppIcon';
import {
  WEEKDAYS, TRIGGER_TYPES, STEP_TYPES, STEP_TYPE_LABELS, STEP_TYPE_HINTS,
} from '../utils/recurrence';
import './schedule-editor.css';

// The schedule editor. This is the screen that answers the complaint against a
// PMS that crams a whole procedure into one textarea: every step is its own row
// with its own type, and a typed step carries the fields that type needs — a
// unit and a normal range for a reading, a part and a quantity for anything that
// consumes stock.
//
// step_type is what varies by department, not the module. Interior ticks; Deck
// photographs; Galley and Engineering take readings. Interior simply leaves the
// engineering fields alone.

const RULE_KINDS = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Certain days' },
  { value: 'monthly', label: 'Day of the month' },
  { value: 'interval', label: 'Every N months' },
];

const emptyStep = () => ({
  key: `new-${Math.random().toString(36).slice(2)}`,
  text: '',
  stepType: STEP_TYPES.CHECK,
  frequency: null,
  unit: '',
  minNormal: '',
  maxNormal: '',
  inventoryItemId: null,
  quantityUsed: '',
  isMandatory: false,
});

const ScheduleEditorModal = ({
  schedule,          // null = create
  categories = [],
  equipment = [],
  onClose,
  onSave,            // async (draft) => void
}) => {
  const isEdit = !!schedule?.id;

  const [name, setName] = useState(schedule?.name || '');
  const [category, setCategory] = useState(schedule?.category || '');
  const [description, setDescription] = useState(schedule?.description || '');
  const [equipmentId, setEquipmentId] = useState(schedule?.equipmentId || '');
  const [estimatedMinutes, setEstimatedMinutes] = useState(schedule?.estimatedMinutes ?? '');
  const [triggerType, setTriggerType] = useState(schedule?.triggerType || TRIGGER_TYPES.CALENDAR);
  const [ruleKind, setRuleKind] = useState(schedule?.calendarRule?.kind || 'daily');
  const [ruleDays, setRuleDays] = useState(schedule?.calendarRule?.days || ['monday']);
  const [ruleDay, setRuleDay] = useState(schedule?.calendarRule?.day || 1);
  const [ruleMonths, setRuleMonths] = useState(schedule?.calendarRule?.months || 6);
  const [counterId, setCounterId] = useState(schedule?.counterId || '');
  const [counterInterval, setCounterInterval] = useState(schedule?.counterInterval ?? '');
  const [isClassItem, setIsClassItem] = useState(!!schedule?.isClassItem);
  const [steps, setSteps] = useState(
    (schedule?.steps || []).map((s) => ({
      key: s.id,
      text: s.text || '',
      stepType: s.stepType || STEP_TYPES.CHECK,
      frequency: s.frequency || null,
      unit: s.unit || '',
      minNormal: s.minNormal ?? '',
      maxNormal: s.maxNormal ?? '',
      inventoryItemId: s.inventoryItemId || null,
      quantityUsed: s.quantityUsed ?? '',
      isMandatory: !!s.isMandatory,
    })),
  );
  const [expanded, setExpanded] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  // Counters belong to the chosen equipment — a counter trigger is meaningless
  // without one, so the picker is driven off the selection.
  const counters = useMemo(() => {
    const eq = equipment.find((e) => e.id === equipmentId);
    return eq?.counters || [];
  }, [equipment, equipmentId]);

  const needsCounter = triggerType !== TRIGGER_TYPES.CALENDAR;
  const needsCalendar = triggerType !== TRIGGER_TYPES.COUNTER;

  const buildRule = () => {
    if (!needsCalendar) return null;
    switch (ruleKind) {
      case 'weekly':   return { kind: 'weekly', days: ruleDays.length ? ruleDays : ['monday'] };
      case 'monthly':  return { kind: 'monthly', day: Number(ruleDay) || 1 };
      case 'interval': return { kind: 'interval', months: Number(ruleMonths) || 1 };
      default:         return { kind: 'daily' };
    }
  };

  const updateStep = (key, patch) =>
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const moveStep = (idx, dir) => {
    setSteps((prev) => {
      const next = [...prev];
      const to = idx + dir;
      if (to < 0 || to >= next.length) return prev;
      [next[idx], next[to]] = [next[to], next[idx]];
      return next;
    });
  };

  const handleSave = async () => {
    setError('');
    if (!name.trim()) { setError('Give the schedule a name.'); return; }
    if (!steps.some((s) => s.text.trim())) { setError('Add at least one step.'); return; }
    if (needsCounter && (!counterId || !counterInterval)) {
      setError('A counter trigger needs a counter and an interval. Pick the equipment first if the list is empty.');
      return;
    }
    const badReading = steps.find(
      (s) => s.text.trim() && s.stepType === STEP_TYPES.READING && !s.unit.trim(),
    );
    if (badReading) { setError(`"${badReading.text.trim()}" is a reading — give it a unit (°C, bar, h).`); return; }

    setSaving(true);
    try {
      await onSave({
        id: schedule?.id,
        name, category, description,
        equipmentId: equipmentId || null,
        estimatedMinutes: estimatedMinutes === '' ? null : Number(estimatedMinutes),
        triggerType,
        calendarRule: buildRule(),
        counterId: needsCounter ? counterId : null,
        counterInterval: needsCounter && counterInterval !== '' ? Number(counterInterval) : null,
        isClassItem,
        active: schedule?.active !== false,
        departmentId: schedule?.departmentId ?? null,
        steps: steps
          .filter((s) => s.text.trim())
          .map((s) => ({
            ...s,
            minNormal: s.minNormal === '' ? null : Number(s.minNormal),
            maxNormal: s.maxNormal === '' ? null : Number(s.maxNormal),
            quantityUsed: s.quantityUsed === '' ? null : Number(s.quantityUsed),
          })),
      });
    } catch (e) {
      setError(e?.message || 'Could not save the schedule.');
      setSaving(false);
    }
  };

  return createPortal(
    <div className="use-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="use-panel" role="dialog" aria-modal="true" aria-label={isEdit ? 'Edit schedule' : 'New schedule'}>
        <div className="use-head">
          <div>
            <p className="use-eyebrow">Upkeep</p>
            <h2 className="use-title">{isEdit ? name || 'Edit schedule' : 'New schedule'}</h2>
          </div>
          <button type="button" className="use-x" onClick={onClose} aria-label="Close" disabled={saving}>
            <Icon name="X" size={19} />
          </button>
        </div>

        <div className="use-body">
          {error && <div className="use-error">{error}</div>}

          <div className="use-field">
            <label className="use-label" htmlFor="use-name">Name <span className="req">required</span></label>
            <input id="use-name" className="use-input" value={name} maxLength={120}
              onChange={(e) => setName(e.target.value)} placeholder="Chilled water compressors — weekly" />
          </div>

          <div className="use-grid">
            <div className="use-field">
              <label className="use-label" htmlFor="use-cat">Category <span className="opt">optional</span></label>
              <input id="use-cat" className="use-input" value={category} list="use-cats" maxLength={60}
                onChange={(e) => setCategory(e.target.value)} placeholder="Service, Deep Clean, Inspection…" />
              <datalist id="use-cats">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div className="use-field">
              <label className="use-label" htmlFor="use-mins">Takes about <span className="opt">optional</span></label>
              <input id="use-mins" className="use-input" type="number" min="0" value={estimatedMinutes}
                onChange={(e) => setEstimatedMinutes(e.target.value)} placeholder="Minutes" />
            </div>
          </div>

          <div className="use-field">
            <label className="use-label" htmlFor="use-eq">Equipment <span className="opt">optional</span></label>
            <select id="use-eq" className="use-select" value={equipmentId}
              onChange={(e) => { setEquipmentId(e.target.value); setCounterId(''); }}>
              <option value="">No specific equipment</option>
              {equipment.map((e) => (
                <option key={e.id} value={e.id}>{e.code ? `${e.code} — ${e.name}` : e.name}</option>
              ))}
            </select>
          </div>

          <div className="use-field">
            <label className="use-label" htmlFor="use-desc">Description <span className="opt">optional</span></label>
            <textarea id="use-desc" className="use-textarea" value={description} rows={2}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this covers. The actual procedure belongs in the steps below." />
          </div>

          {/* ── when it comes up ── */}
          <div className="use-section">
            <div className="use-sectionhead">
              <h3 className="use-sectiontitle">When it comes up</h3>
              <div className="use-seg">
                <button type="button" className={triggerType === TRIGGER_TYPES.CALENDAR ? 'is-on' : ''}
                  onClick={() => setTriggerType(TRIGGER_TYPES.CALENDAR)}>By date</button>
                <button type="button" className={triggerType === TRIGGER_TYPES.COUNTER ? 'is-on' : ''}
                  onClick={() => setTriggerType(TRIGGER_TYPES.COUNTER)}>By hours</button>
                <button type="button" className={triggerType === TRIGGER_TYPES.EITHER ? 'is-on' : ''}
                  onClick={() => setTriggerType(TRIGGER_TYPES.EITHER)}>Whichever first</button>
              </div>
            </div>

            {triggerType === TRIGGER_TYPES.EITHER && (
              <p className="use-hint">
                Comes up on whichever lands first — the date or the hours. The usual rule
                for machinery, e.g. &ldquo;250&nbsp;hours or 6&nbsp;months&rdquo;.
              </p>
            )}

            {needsCalendar && (
              <>
                <div className="use-field">
                  <label className="use-label" htmlFor="use-rule">Repeats</label>
                  <select id="use-rule" className="use-select" value={ruleKind} onChange={(e) => setRuleKind(e.target.value)}>
                    {RULE_KINDS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>

                {ruleKind === 'weekly' && (
                  <div className="use-field">
                    <label className="use-label">On these days</label>
                    <div className="use-days">
                      {WEEKDAYS.slice(1).concat(WEEKDAYS[0]).map((d) => (
                        <button key={d} type="button"
                          className={`use-day ${ruleDays.includes(d) ? 'is-on' : ''}`}
                          onClick={() => setRuleDays((prev) =>
                            prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d])}>
                          {d.charAt(0).toUpperCase() + d.slice(1, 3)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {ruleKind === 'monthly' && (
                  <div className="use-field">
                    <label className="use-label" htmlFor="use-dom">Day of the month</label>
                    <input id="use-dom" className="use-input" type="number" min="1" max="31"
                      value={ruleDay} onChange={(e) => setRuleDay(e.target.value)} />
                  </div>
                )}

                {ruleKind === 'interval' && (
                  <div className="use-field">
                    <label className="use-label" htmlFor="use-mos">Every how many months</label>
                    <input id="use-mos" className="use-input" type="number" min="1" max="120"
                      value={ruleMonths} onChange={(e) => setRuleMonths(e.target.value)} />
                  </div>
                )}
              </>
            )}

            {needsCounter && (
              <div className="use-grid">
                <div className="use-field">
                  <label className="use-label" htmlFor="use-counter">Counter <span className="req">required</span></label>
                  <select id="use-counter" className="use-select" value={counterId}
                    onChange={(e) => setCounterId(e.target.value)}>
                    <option value="">{equipmentId ? 'Pick a counter' : 'Pick equipment first'}</option>
                    {counters.map((c) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.unit})</option>
                    ))}
                  </select>
                </div>
                <div className="use-field">
                  <label className="use-label" htmlFor="use-cint">Every <span className="req">required</span></label>
                  <input id="use-cint" className="use-input" type="number" min="1" value={counterInterval}
                    onChange={(e) => setCounterInterval(e.target.value)} placeholder="250" />
                </div>
              </div>
            )}

            <label className="use-check" style={{ marginTop: 4 }}>
              <input type="checkbox" checked={isClassItem} onChange={(e) => setIsClassItem(e.target.checked)} />
              Class or flag surveyed
            </label>
          </div>

          {/* ── steps ── */}
          <div className="use-section">
            <div className="use-sectionhead">
              <h3 className="use-sectiontitle">Steps</h3>
              <span className="use-typehint">{steps.filter((s) => s.text.trim()).length} step(s)</span>
            </div>
            <p className="use-hint">
              One line per thing to do. Each gets its own tick, comment and — where it
              matters — a number. A step left on <strong>every occurrence</strong> appears
              each time; give it a day to spread the work across the week.
            </p>

            <div className="use-steps">
              {steps.map((s, i) => (
                <div className="use-step" key={s.key}>
                  <div className="use-step-ord">{i + 1}</div>
                  <div className="use-step-main">
                    <input className="use-input" value={s.text} maxLength={300}
                      placeholder="Check manometer readouts upstream and downstream of filter"
                      onChange={(e) => updateStep(s.key, { text: e.target.value })} />

                    <div className="use-step-typerow">
                      <select className="use-select" style={{ width: 'auto', minWidth: 120 }}
                        value={s.stepType}
                        onChange={(e) => updateStep(s.key, { stepType: e.target.value })}>
                        {Object.values(STEP_TYPES).map((t) => (
                          <option key={t} value={t}>{STEP_TYPE_LABELS[t]}</option>
                        ))}
                      </select>
                      <select className="use-select" style={{ width: 'auto', minWidth: 150 }}
                        value={s.frequency || ''}
                        onChange={(e) => updateStep(s.key, { frequency: e.target.value || null })}>
                        <option value="">Every occurrence</option>
                        {WEEKDAYS.slice(1).concat(WEEKDAYS[0]).map((d) => (
                          <option key={d} value={`weekly-${d}`}>
                            {d.charAt(0).toUpperCase() + d.slice(1)}s only
                          </option>
                        ))}
                      </select>
                      <span className="use-typehint">{STEP_TYPE_HINTS[s.stepType]}</span>
                    </div>

                    {(s.stepType === STEP_TYPES.READING || expanded === s.key) && (
                      <div className="use-step-extra">
                        {s.stepType === STEP_TYPES.READING && (
                          <div className="use-grid-3">
                            <div>
                              <label className="use-label">Unit <span className="req">required</span></label>
                              <input className="use-input" value={s.unit} maxLength={12} placeholder="bar, °C, h"
                                onChange={(e) => updateStep(s.key, { unit: e.target.value })} />
                            </div>
                            <div>
                              <label className="use-label">Normal from <span className="opt">optional</span></label>
                              <input className="use-input" type="number" value={s.minNormal} placeholder="-2"
                                onChange={(e) => updateStep(s.key, { minNormal: e.target.value })} />
                            </div>
                            <div>
                              <label className="use-label">Normal to <span className="opt">optional</span></label>
                              <input className="use-input" type="number" value={s.maxNormal} placeholder="5"
                                onChange={(e) => updateStep(s.key, { maxNormal: e.target.value })} />
                            </div>
                          </div>
                        )}
                        <label className="use-check" style={{ marginTop: 10 }}>
                          <input type="checkbox" checked={s.isMandatory}
                            onChange={(e) => updateStep(s.key, { isMandatory: e.target.checked })} />
                          Must be done before the job can be signed off
                        </label>
                      </div>
                    )}
                  </div>

                  <div className="use-step-tools">
                    <button type="button" className="use-icon" title="Move up" disabled={i === 0}
                      onClick={() => moveStep(i, -1)}><Icon name="ChevronUp" size={15} /></button>
                    <button type="button" className="use-icon" title="Move down" disabled={i === steps.length - 1}
                      onClick={() => moveStep(i, 1)}><Icon name="ChevronDown" size={15} /></button>
                    <button type="button" className="use-icon" title="More options"
                      onClick={() => setExpanded(expanded === s.key ? null : s.key)}>
                      <Icon name="Settings2" size={15} />
                    </button>
                    <button type="button" className="use-icon is-danger" title="Remove step"
                      onClick={() => setSteps((prev) => prev.filter((x) => x.key !== s.key))}>
                      <Icon name="Trash2" size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button type="button" className="use-addstep" onClick={() => setSteps((prev) => [...prev, emptyStep()])}>
              <Icon name="Plus" size={15} /> Add a step
            </button>
          </div>
        </div>

        <div className="use-foot">
          <span className="use-foot-note">
            {isEdit ? 'Past sign-offs keep the wording they were signed off with.' : ''}
          </span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="uk-btn" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="button" className="uk-btn uk-btn--primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create schedule'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ScheduleEditorModal;
