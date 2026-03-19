import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';

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
    <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-card rounded-xl border border-border shadow-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e?.stopPropagation()}
      >
        <div className="sticky top-0 bg-card border-b border-border p-6 flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-foreground">Edit Duty Set Template</h2>
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

          <Select
            label="Duty"
            options={dutyOptions}
            value={formData?.category}
            onChange={(value) => setFormData(prev => ({ ...prev, category: value }))}
          />

          <Input
            label="Estimated Duration (minutes)"
            type="number"
            value={formData?.estimatedDuration}
            onChange={(e) => setFormData(prev => ({ ...prev, estimatedDuration: parseInt(e?.target?.value) }))}
            min={5}
          />

          {/* Tasks */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Tasks</h3>
            <div className="space-y-3 mb-4">
              {formData?.tasks?.map(task => (
                <div key={task?.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                  <div className="flex-1">
                    <p className="text-sm text-foreground">{task?.text}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {task?.frequency?.replace('-', ' — ')}
                    </p>
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
              <Input
                placeholder="Task description"
                value={newTask?.text}
                onChange={(e) => setNewTask(prev => ({ ...prev, text: e?.target?.value }))}
              />
              <div className="flex gap-3">
                <Select
                  options={frequencyOptions}
                  value={newTask?.frequency}
                  onChange={(value) => setNewTask(prev => ({ ...prev, frequency: value }))}
                  className="flex-1"
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
              iconName="Save"
              fullWidth
              disabled={!formData?.name?.trim()}
            >
              Save Changes
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditTemplateModal;
