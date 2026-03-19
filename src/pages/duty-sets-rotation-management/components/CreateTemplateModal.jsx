import React, { useState, useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';

const DAYS = [
  { key: 'Mon', label: 'Mon' },
  { key: 'Tue', label: 'Tue' },
  { key: 'Wed', label: 'Wed' },
  { key: 'Thu', label: 'Thu' },
  { key: 'Fri', label: 'Fri' },
  { key: 'Sat', label: 'Sat' },
  { key: 'Sun', label: 'Sun' },
];

const ORDINALS = [
  { value: '1', label: '1st' },
  { value: '2', label: '2nd' },
  { value: '3', label: '3rd' },
  { value: '4', label: '4th' },
  { value: '5', label: '5th (last)' },
];

const WEEKDAYS = [
  { value: 'Monday', label: 'Monday' },
  { value: 'Tuesday', label: 'Tuesday' },
  { value: 'Wednesday', label: 'Wednesday' },
  { value: 'Thursday', label: 'Thursday' },
  { value: 'Friday', label: 'Friday' },
  { value: 'Saturday', label: 'Saturday' },
  { value: 'Sunday', label: 'Sunday' },
];

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

  const repeatsOptions = [
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'fortnightly', label: 'Fortnightly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'custom', label: 'Custom' },
  ];

  const rec = formData?.recurrence;

  return (
    <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-card rounded-xl border border-border shadow-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e?.stopPropagation()}
      >
        <div className="sticky top-0 bg-card border-b border-border p-6 flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-foreground">Create Duty Set Template</h2>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-smooth">
            <Icon name="X" size={20} className="text-muted-foreground" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <Input
            label="Template Name"
            required
            value={formData?.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e?.target?.value }))}
            placeholder="e.g., Crew Mess, Captain's Cabin"
          />

          {/* Duty (formerly Category) */}
          <div className="space-y-2">
            <Select
              label="Duty"
              options={dutyOptions}
              value={formData?.category}
              onChange={(value) => setFormData(prev => ({ ...prev, category: value }))}
            />
            <div className="flex gap-2">
              <input
                type="text"
                value={newDutyInput}
                onChange={(e) => setNewDutyInput(e?.target?.value)}
                onKeyDown={(e) => { if (e?.key === 'Enter') { e?.preventDefault(); handleAddDuty(); } }}
                placeholder="Add new duty…"
                className="flex-1 text-sm px-3 py-1.5 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                type="button"
                onClick={handleAddDuty}
                disabled={!newDutyInput?.trim()}
                className="px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition-smooth"
              >
                Add
              </button>
            </div>
          </div>

          <Input
            label="Estimated Duration (minutes)"
            type="number"
            value={formData?.estimatedDuration}
            onChange={(e) => setFormData(prev => ({ ...prev, estimatedDuration: parseInt(e?.target?.value) }))}
            min={5}
          />

          {/* Recurrence */}
          <div className="space-y-3">
            <Select
              label="Repeats"
              options={repeatsOptions}
              value={rec?.type}
              onChange={(value) => updateRecurrence('type', value)}
            />

            {/* Weekly: day-of-week multi-selector */}
            {rec?.type === 'weekly' && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Select days</p>
                <div className="flex flex-wrap gap-2">
                  {DAYS?.map(d => (
                    <button
                      key={d?.key}
                      type="button"
                      onClick={() => toggleWeekDay(d?.key)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-smooth ${
                        rec?.weekDays?.includes(d?.key)
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background text-foreground border-border hover:bg-muted'
                      }`}
                    >
                      {d?.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Fortnightly: day-of-week + Week A/B */}
            {rec?.type === 'fortnightly' && (
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Select days</p>
                  <div className="flex flex-wrap gap-2">
                    {DAYS?.map(d => (
                      <button
                        key={d?.key}
                        type="button"
                        onClick={() => toggleWeekDay(d?.key)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-smooth ${
                          rec?.weekDays?.includes(d?.key)
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background text-foreground border-border hover:bg-muted'
                        }`}
                      >
                        {d?.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Week</p>
                  <div className="flex gap-2">
                    {['A', 'B']?.map(w => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => updateRecurrence('fortnightWeek', w)}
                        className={`px-5 py-1.5 rounded-lg text-sm font-medium border transition-smooth ${
                          rec?.fortnightWeek === w
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background text-foreground border-border hover:bg-muted'
                        }`}
                      >
                        Week {w}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Monthly */}
            {rec?.type === 'monthly' && (
              <div className="space-y-3">
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="monthlyMode"
                      value="day"
                      checked={rec?.monthlyMode === 'day'}
                      onChange={() => updateRecurrence('monthlyMode', 'day')}
                      className="accent-primary"
                    />
                    <span className="text-sm text-foreground">Day of month</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="monthlyMode"
                      value="nth"
                      checked={rec?.monthlyMode === 'nth'}
                      onChange={() => updateRecurrence('monthlyMode', 'nth')}
                      className="accent-primary"
                    />
                    <span className="text-sm text-foreground">Nth weekday</span>
                  </label>
                </div>

                {rec?.monthlyMode === 'day' && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">Day</span>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={rec?.monthDay}
                      onChange={(e) => updateRecurrence('monthDay', parseInt(e?.target?.value) || 1)}
                      className="w-20 text-sm px-3 py-1.5 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <span className="text-sm text-muted-foreground">of the month</span>
                  </div>
                )}

                {rec?.monthlyMode === 'nth' && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-muted-foreground">The</span>
                    <select
                      value={rec?.nthOrdinal}
                      onChange={(e) => updateRecurrence('nthOrdinal', e?.target?.value)}
                      className="text-sm px-3 py-1.5 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      {ORDINALS?.map(o => (
                        <option key={o?.value} value={o?.value}>{o?.label}</option>
                      ))}
                    </select>
                    <select
                      value={rec?.nthWeekday}
                      onChange={(e) => updateRecurrence('nthWeekday', e?.target?.value)}
                      className="text-sm px-3 py-1.5 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      {WEEKDAYS?.map(w => (
                        <option key={w?.value} value={w?.value}>{w?.label}</option>
                      ))}
                    </select>
                    <span className="text-sm text-muted-foreground">of the month</span>
                  </div>
                )}
              </div>
            )}

            {/* Custom: every X days */}
            {rec?.type === 'custom' && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">Every</span>
                <input
                  type="number"
                  min={1}
                  value={rec?.everyXDays}
                  onChange={(e) => updateRecurrence('everyXDays', parseInt(e?.target?.value) || 1)}
                  className="w-20 text-sm px-3 py-1.5 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <span className="text-sm text-muted-foreground">days</span>
              </div>
            )}
          </div>

          {/* Tasks */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Tasks</h3>
            <div className="space-y-3 mb-4">
              {formData?.tasks?.map(task => (
                <div key={task?.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                  <div className="flex-1">
                    <p className="text-sm text-foreground">{task?.text}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveTask(task?.id)}
                    className="p-1 hover:bg-muted rounded transition-smooth"
                  >
                    <Icon name="X" size={16} className="text-muted-foreground" />
                  </button>
                </div>
              ))}
              {formData?.tasks?.length === 0 && (
                <p className="text-sm text-muted-foreground">No tasks added yet</p>
              )}
            </div>

            {/* Add Task Form */}
            <div className="space-y-3 p-4 bg-muted/20 rounded-lg">
              <div className="flex gap-3">
                <Input
                  placeholder="Task description"
                  value={newTask?.text}
                  onChange={(e) => setNewTask(prev => ({ ...prev, text: e?.target?.value }))}
                />
                <Button type="button" iconName="Plus" onClick={handleAddTask}>
                  Add Task
                </Button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose} fullWidth>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="default"
              iconName="Plus"
              fullWidth
              disabled={!formData?.name?.trim() || formData?.tasks?.length === 0}
            >
              Create Template
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateTemplateModal;