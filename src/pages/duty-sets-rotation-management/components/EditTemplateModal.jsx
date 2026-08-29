import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import ModalShell from '../../../components/ui/ModalShell';
import '../../team-jobs-management/job-modals.css';
import '../duty-sets.css';

const EditTemplateModal = ({ template, existingTemplates = [], onClose, onSave }) => {
  // Derive duty options from existing templates
  const usedDuties = Array.from(
    new Set((existingTemplates || [])?.map(t => t?.category).filter(Boolean))
  );
  const dutyOptions = usedDuties?.length > 0
    ? usedDuties?.map(c => ({ value: c, label: c }))
    : [
        { value: 'Daily Service', label: 'Daily Service' },
        { value: 'Weekly Maintenance', label: 'Weekly Maintenance' },
        { value: 'Guest Turnover', label: 'Guest Turnover' },
        { value: 'Other', label: 'Other' },
      ];

  const [formData, setFormData] = useState({
    name: template?.name || '',
    category: template?.category || 'Daily Service',
    estimatedDuration: template?.estimatedDuration ?? template?.estimated_duration ?? 30,
    tasks: template?.tasks ? template?.tasks?.map(t => ({
      id: t?.id || `task-${Math.random()}`,
      text: t?.text || t?.title || t?.name || '',
      frequency: t?.frequency || 'daily'
    })) : []
  });

  const [newTask, setNewTask] = useState({ text: '', frequency: 'daily' });

  const handleAddTask = () => {
    if (!newTask?.text?.trim()) return;
    const task = {
      id: `task-${Date.now()}`,
      text: newTask?.text,
      frequency: newTask?.frequency
    };
    setFormData(prev => ({ ...prev, tasks: [...prev?.tasks, task] }));
    setNewTask({ text: '', frequency: 'daily' });
  };

  const handleRemoveTask = (taskId) => {
    setFormData(prev => ({
      ...prev,
      tasks: prev?.tasks?.filter(t => t?.id !== taskId)
    }));
  };

  const handleSubmit = (e) => {
    e?.preventDefault();
    if (!formData?.name?.trim()) return;
    onSave(template?.id, formData);
  };

  const frequencyOptions = [
    { value: 'daily', label: 'Daily' },
    { value: 'weekly-monday', label: 'Weekly - Monday' },
    { value: 'weekly-tuesday', label: 'Weekly - Tuesday' },
    { value: 'weekly-wednesday', label: 'Weekly - Wednesday' },
    { value: 'weekly-thursday', label: 'Weekly - Thursday' },
    { value: 'weekly-friday', label: 'Weekly - Friday' },
    { value: 'weekly-saturday', label: 'Weekly - Saturday' },
    { value: 'weekly-sunday', label: 'Weekly - Sunday' },
    { value: 'monthly-1', label: 'Monthly - 1st' },
    { value: 'monthly-15', label: 'Monthly - 15th' }
  ];

  return (
    <ModalShell onClose={onClose} panelClassName="jm-panel lg">
      <div className="jm-head">
        <div>
          <p className="jm-eyebrow">Rotation</p>
          <h2 className="jm-title">Edit duty set</h2>
          <p className="jm-sub">{template?.name}</p>
        </div>
        <button onClick={onClose} className="jm-x" title="Close">
          <Icon name="X" size={18} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="jm-body" id="dsr-edit-template-form">
        <div className="jm-section">
          <label className="jm-label" htmlFor="etpl-name">
            Template name<span className="req">required</span>
          </label>
          <input
            id="etpl-name"
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
            <label className="jm-label" htmlFor="etpl-duty">Duty</label>
            <select
              id="etpl-duty"
              className="jm-select"
              value={formData?.category || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, category: e?.target?.value }))}
            >
              {dutyOptions?.map(o => (
                <option key={o?.value} value={o?.value}>{o?.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="jm-label" htmlFor="etpl-dur">Estimated duration</label>
            <div className="dsr-suffixfield">
              <input
                id="etpl-dur"
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

        <hr className="jm-rule" />

        {/* Tasks */}
        <div className="jm-section">
          <p className="jm-label">Tasks</p>
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
                    {task?.frequency && (
                      <p className="jm-row-sub">{String(task?.frequency)?.replace('-', ' — ')}</p>
                    )}
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

          <div className="jm-section">
            <input
              type="text"
              className="jm-input"
              placeholder="Task description"
              value={newTask?.text}
              onChange={(e) => setNewTask(prev => ({ ...prev, text: e?.target?.value }))}
              onKeyDown={(e) => { if (e?.key === 'Enter') { e?.preventDefault(); handleAddTask(); } }}
            />
            <div className="dsr-inlineadd">
              <select
                className="jm-select"
                value={newTask?.frequency || ''}
                onChange={(e) => setNewTask(prev => ({ ...prev, frequency: e?.target?.value }))}
              >
                {frequencyOptions?.map(o => (
                  <option key={o?.value} value={o?.value}>{o?.label}</option>
                ))}
              </select>
              <button type="button" className="jm-btn accent sm" onClick={handleAddTask}>
                <Icon name="Plus" size={14} />
                Add task
              </button>
            </div>
          </div>
        </div>
      </form>

      <div className="jm-foot">
        <button type="button" className="jm-btn ghost" onClick={onClose}>Cancel</button>
        <div className="spacer" />
        <button
          type="submit"
          form="dsr-edit-template-form"
          className="jm-btn primary"
          disabled={!formData?.name?.trim()}
        >
          <Icon name="Save" size={15} />
          Save changes
        </button>
      </div>
    </ModalShell>
  );
};

export default EditTemplateModal;
