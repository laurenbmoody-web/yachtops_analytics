import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';

import { crewMembers } from '../data/mockData';

const CreateDutySetModal = ({ boards, onClose, onCreate }) => {
  const [formData, setFormData] = useState({
    name: '',
    board: boards?.[0]?.id || '',
    assignees: [],
    dueDate: new Date()?.toISOString()?.split('T')?.[0],
    tasks: []
  });

  const [newTask, setNewTask] = useState({ text: '', frequency: 'daily' });

  const handleAddTask = () => {
    if (!newTask?.text?.trim()) return;
    const task = {
      id: `task-${Date.now()}`,
      text: newTask?.text,
      frequency: newTask?.frequency,
      completed: false
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
    if (!formData?.name?.trim() || formData?.tasks?.length === 0) return;
    onCreate({
      ...formData,
      dueDate: new Date(formData?.dueDate)?.toISOString()
    });
  };

  const boardOptions = boards?.map(b => ({ value: b?.id, label: b?.name }));
  const crewOptions = crewMembers?.map(c => ({ value: c?.id, label: c?.name }));
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
          <h2 className="text-2xl font-semibold text-foreground">Create Duty Set</h2>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-smooth">
            <Icon name="X" size={20} className="text-muted-foreground" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <Input
            label="Duty Set Name"
            required
            value={formData?.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e?.target?.value }))}
            placeholder="e.g., Crew Mess, Captain's Cabin"
          />

          <Select
            label="Board"
            required
            options={boardOptions}
            value={formData?.board}
            onChange={(value) => setFormData(prev => ({ ...prev, board: value }))}
          />

          <Select
            label="Assign to"
            options={crewOptions}
            value={formData?.assignees}
            onChange={(value) => setFormData(prev => ({ ...prev, assignees: value }))}
            multiple
            searchable
            placeholder="Select crew members"
          />

          <Input
            label="Due Date"
            type="date"
            required
            value={formData?.dueDate}
            onChange={(e) => setFormData(prev => ({ ...prev, dueDate: e?.target?.value }))}
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
              iconName="Plus" 
              fullWidth
              disabled={!formData?.name?.trim() || formData?.tasks?.length === 0}
            >
              Create Duty Set
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateDutySetModal;