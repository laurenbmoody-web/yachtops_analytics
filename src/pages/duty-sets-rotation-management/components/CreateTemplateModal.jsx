import React, { useState, useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import ModalShell from '../../../components/ui/ModalShell';
import '../../team-jobs-management/job-modals.css';
import '../duty-sets.css';
import { DAYS, ORDINALS, WEEKDAYS, REPEATS_OPTIONS } from './recurrenceOptions';

const DEFAULT_DUTIES = [
  'Daily Service',
  'Weekly Maintenance',
  'Guest Turnover',
  'Other',
];

const CreateTemplateModal = ({ onClose, onCreate, existingTemplates = [] }) => {
  // Derive duties (categories) that actually have templates
  const usedDuties = useMemo(() => {
    const cats = new Set(existingTemplates?.map(t => t?.category).filter(Boolean));
    return Array.from(cats);
  }, [existingTemplates]);

  const [formData, setFormData] = useState({
    name: '',
    category: usedDuties?.[0] || 'Daily Service',
    estimatedDuration: 30,
    tasks: [],
    recurrence: {
      type: 'daily',
      weekDays: [],
      fortnightWeek: 'A',
      monthlyMode: 'day',
      monthDay: 1,
      nthOrdinal: '1',
      nthWeekday: 'Monday',
      everyXDays: 1,
    },
  });

  const [newTask, setNewTask] = useState({ text: '' });

  // Inline duty state — seed only from used duties
  const [duties, setDuties] = useState(
    usedDuties?.length > 0 ? usedDuties : DEFAULT_DUTIES
  );
  const [newDutyInput, setNewDutyInput] = useState('');

  const handleAddDuty = () => {
    const trimmed = newDutyInput?.trim();
    if (!trimmed || duties?.includes(trimmed)) return;
    setDuties(prev => [...prev, trimmed]);
    setFormData(prev => ({ ...prev, category: trimmed }));
    setNewDutyInput('');
  };

  const handleAddTask = () => {
    if (!newTask?.text?.trim()) return;
    const task = {
      id: `task-${Date.now()}`,
      text: newTask?.text,
    };
    setFormData(prev => ({ ...prev, tasks: [...prev?.tasks, task] }));
    setNewTask({ text: '' });
  };

  const handleRemoveTask = (taskId) => {
    setFormData(prev => ({
      ...prev,
      tasks: prev?.tasks?.filter(t => t?.id !== taskId),
    }));
  };

  const toggleWeekDay = (day) => {
    setFormData(prev => {
      const days = prev?.recurrence?.weekDays?.includes(day)
        ? prev?.recurrence?.weekDays?.filter(d => d !== day)
        : [...prev?.recurrence?.weekDays, day];
      return { ...prev, recurrence: { ...prev?.recurrence, weekDays: days } };
    });
  };

  const updateRecurrence = (field, value) => {
    setFormData(prev => ({
      ...prev,
      recurrence: { ...prev?.recurrence, [field]: value },
    }));
  };

  const handleSubmit = (e) => {
    e?.preventDefault();
    if (!formData?.name?.trim() || formData?.tasks?.length === 0) return;
    onCreate({ ...formData });
  };

  const dutyOptions = duties?.map(c => ({ value: c, label: c }));

  const rec = formData?.recurrence;

  return (
    <ModalShell
      onClose={onClose}
      isDirty={!!formData?.name?.trim() || formData?.tasks?.length > 0}
      panelClassName="jm-panel xl"
    >
      <div className="jm-head">
        <div>
          <p className="jm-eyebrow">Rotation</p>
          <h2 className="jm-title">New duty set</h2>
          <p className="jm-sub">A reusable template the rotation calendar schedules for you.</p>
        </div>
        <button onClick={onClose} className="jm-x" title="Close">
          <Icon name="X" size={18} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="jm-body" id="dsr-create-template-form">
        <div className="jm-section">
          <label className="jm-label" htmlFor="ctpl-name">
            Template name<span className="req">required</span>
          </label>
          <input
            id="ctpl-name"
            autoFocus
            type="text"
            className="jm-titlefield"
            placeholder="e.g. Crew mess, Captain's cabin"
            value={formData?.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e?.target?.value }))}
          />
        </div>

        <div className="jm-section jm-grid">
          <div>
            <label className="jm-label" htmlFor="ctpl-duty">Duty</label>
            <select
              id="ctpl-duty"
              className="jm-select"
              value={formData?.category || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, category: e?.target?.value }))}
            >
              {dutyOptions?.map(o => (
                <option key={o?.value} value={o?.value}>{o?.label}</option>
              ))}
            </select>
            <div className="dsr-inlineadd">
              <input
                type="text"
                className="jm-input"
                value={newDutyInput}
                onChange={(e) => setNewDutyInput(e?.target?.value)}
                onKeyDown={(e) => { if (e?.key === 'Enter') { e?.preventDefault(); handleAddDuty(); } }}
                placeholder="Add a new duty…"
              />
              <button
                type="button"
                className="jm-btn ghost sm"
                onClick={handleAddDuty}
                disabled={!newDutyInput?.trim()}
              >
                Add
              </button>
            </div>
          </div>
          <div>
            <label className="jm-label" htmlFor="ctpl-dur">Estimated duration</label>
            <div className="dsr-suffixfield">
              <input
                id="ctpl-dur"
                type="number"
                min={5}
                className="jm-input"
                value={formData?.estimatedDuration}
                onChange={(e) => setFormData(prev => ({ ...prev, estimatedDuration: parseInt(e?.target?.value) }))}
              />
              <span className="suffix">minutes</span>
            </div>
          </div>
        </div>

        {/* Recurrence */}
        <div className="jm-section">
          <label className="jm-label" htmlFor="ctpl-repeats">Repeats</label>
          <select
            id="ctpl-repeats"
            className="jm-select"
            value={rec?.type || ''}
            onChange={(e) => updateRecurrence('type', e?.target?.value)}
          >
            {REPEATS_OPTIONS?.map(o => (
              <option key={o?.value} value={o?.value}>{o?.label}</option>
            ))}
          </select>

          {/* Weekly / fortnightly: day-of-week picker */}
          {(rec?.type === 'weekly' || rec?.type === 'fortnightly') && (
            <div style={{ marginTop: 16 }}>
              <p className="jm-label">Days</p>
              <div className="jm-pills">
                {DAYS?.map(d => (
                  <button
                    key={d?.key}
                    type="button"
                    onClick={() => toggleWeekDay(d?.key)}
                    className={`jm-pill${rec?.weekDays?.includes(d?.key) ? ' on' : ''}`}
                  >
                    {d?.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {rec?.type === 'fortnightly' && (
            <div style={{ marginTop: 16 }}>
              <p className="jm-label">Which week</p>
              <div className="jm-pills">
                {['A', 'B']?.map(w => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => updateRecurrence('fortnightWeek', w)}
                    className={`jm-pill${rec?.fortnightWeek === w ? ' on' : ''}`}
                  >
                    Week {w}
                  </button>
                ))}
              </div>
            </div>
          )}

          {rec?.type === 'monthly' && (
            <div style={{ marginTop: 16 }}>
              <p className="jm-label">Monthly pattern</p>
              <div className="jm-pills">
                <button
                  type="button"
                  onClick={() => updateRecurrence('monthlyMode', 'day')}
                  className={`jm-pill${rec?.monthlyMode === 'day' ? ' on' : ''}`}
                >
                  Day of month
                </button>
                <button
                  type="button"
                  onClick={() => updateRecurrence('monthlyMode', 'nth')}
                  className={`jm-pill${rec?.monthlyMode === 'nth' ? ' on' : ''}`}
                >
                  Nth weekday
                </button>
              </div>

              {rec?.monthlyMode === 'day' && (
                <div className="dsr-inlinerow">
                  <span>Day</span>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    className="jm-input narrow"
                    value={rec?.monthDay}
                    onChange={(e) => updateRecurrence('monthDay', parseInt(e?.target?.value) || 1)}
                  />
                  <span>of the month</span>
                </div>
              )}

              {rec?.monthlyMode === 'nth' && (
                <div className="dsr-inlinerow">
                  <span>The</span>
                  <select
                    className="jm-select auto"
                    value={rec?.nthOrdinal}
                    onChange={(e) => updateRecurrence('nthOrdinal', e?.target?.value)}
                  >
                    {ORDINALS?.map(o => (
                      <option key={o?.value} value={o?.value}>{o?.label}</option>
                    ))}
                  </select>
                  <select
                    className="jm-select auto"
                    value={rec?.nthWeekday}
                    onChange={(e) => updateRecurrence('nthWeekday', e?.target?.value)}
                  >
                    {WEEKDAYS?.map(w => (
                      <option key={w?.value} value={w?.value}>{w?.label}</option>
                    ))}
                  </select>
                  <span>of the month</span>
                </div>
              )}
            </div>
          )}

          {rec?.type === 'custom' && (
            <div className="dsr-inlinerow">
              <span>Every</span>
              <input
                type="number"
                min={1}
                className="jm-input narrow"
                value={rec?.everyXDays}
                onChange={(e) => updateRecurrence('everyXDays', parseInt(e?.target?.value) || 1)}
              />
              <span>days</span>
            </div>
          )}
        </div>

        <hr className="jm-rule" />

        {/* Tasks */}
        <div className="jm-section">
          <p className="jm-label">
            Tasks<span className="req">at least one</span>
          </p>
          {formData?.tasks?.length === 0 ? (
            <p className="jm-hint" style={{ marginBottom: 12 }}>
              No tasks yet — add the steps this duty set runs through.
            </p>
          ) : (
            <div className="jm-list" style={{ marginBottom: 12 }}>
              {formData?.tasks?.map(task => (
                <div key={task?.id} className="jm-row">
                  <span className="dsr-task-pip" />
                  <div className="jm-row-main">
                    <p className="jm-row-title">{task?.text}</p>
                  </div>
                  <div className="jm-row-actions">
                    <button
                      type="button"
                      onClick={() => handleRemoveTask(task?.id)}
                      className="jm-file-x"
                      title="Remove task"
                    >
                      <Icon name="X" size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="dsr-inlineadd">
            <input
              type="text"
              className="jm-input"
              placeholder="Task description"
              value={newTask?.text}
              onChange={(e) => setNewTask(prev => ({ ...prev, text: e?.target?.value }))}
              onKeyDown={(e) => { if (e?.key === 'Enter') { e?.preventDefault(); handleAddTask(); } }}
            />
            <button type="button" className="jm-btn accent sm" onClick={handleAddTask}>
              <Icon name="Plus" size={14} />
              Add task
            </button>
          </div>
        </div>
      </form>

      <div className="jm-foot">
        <button type="button" className="jm-btn ghost" onClick={onClose}>Cancel</button>
        <div className="spacer" />
        <button
          type="submit"
          form="dsr-create-template-form"
          className="jm-btn primary"
          disabled={!formData?.name?.trim() || formData?.tasks?.length === 0}
        >
          <Icon name="Plus" size={15} />
          Create template
        </button>
      </div>
    </ModalShell>
  );
};

export default CreateTemplateModal;
