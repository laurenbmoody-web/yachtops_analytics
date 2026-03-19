import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';

const CreateDutySetModal = ({ onClose, onCreate, activeBoard, boards }) => {
  const [formData, setFormData] = useState({
    name: '',
    board: activeBoard,
    assignedTo: [],
    rotationRule: 'manual'
  });
  
  const [tasks, setTasks] = useState([]);
  const [newTask, setNewTask] = useState({ text: '', frequency: 'daily', day: '', date: '' });
  
  const crewMembers = ['Mark', 'Sarah', 'Lisa', 'Emma', 'Tom', 'Mike', 'John'];
  const frequencies = [
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' }
  ];
  const weekDays = [
    { value: 'Monday', label: 'Monday' },
    { value: 'Tuesday', label: 'Tuesday' },
    { value: 'Wednesday', label: 'Wednesday' },
    { value: 'Thursday', label: 'Thursday' },
    { value: 'Friday', label: 'Friday' },
    { value: 'Saturday', label: 'Saturday' },
    { value: 'Sunday', label: 'Sunday' }
  ];
  const rotationRules = [
    { value: 'manual', label: 'Manual Assignment' },
    { value: 'daily', label: 'Daily Rotation' },
    { value: 'weekly', label: 'Weekly Rotation' }
  ];
  
  const handleAddTask = () => {
    if (!newTask?.text?.trim()) return;
    
    setTasks(prev => [...prev, { ...newTask, id: `task-${Date.now()}`, completed: false }]);
    setNewTask({ text: '', frequency: 'daily', day: '', date: '' });
  };
  
  const handleRemoveTask = (taskId) => {
    setTasks(prev => prev?.filter(t => t?.id !== taskId));
  };
  
  const handleSubmit = (e) => {
    e?.preventDefault();
    
    const newDutySet = {
      ...formData,
      tasks,
      dueToday: true
    };
    
    onCreate(newDutySet);
  };
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-100 p-6">
      <div className="bg-card rounded-xl border border-border shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Icon name="ListChecks" size={24} className="text-primary" />
              <h2 className="text-xl font-semibold text-foreground">Create Duty Set Template</h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-muted rounded-lg transition-smooth"
            >
              <Icon name="X" size={20} className="text-muted-foreground" />
            </button>
          </div>
        </div>
        
        {/* Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            {/* Basic Info */}
            <div className="space-y-4">
              <Input
                label="Duty Set Name"
                required
                value={formData?.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e?.target?.value }))}
                placeholder="e.g., Crew Mess, Captain's Cabin"
              />
              
              <Select
                label="Board"
                options={boards?.map(b => ({ value: b?.id, label: b?.name }))}
                value={formData?.board}
                onChange={(value) => setFormData(prev => ({ ...prev, board: value }))}
              />
              
              <Select
                label="Assign To"
                options={crewMembers?.map(m => ({ value: m, label: m }))}
                value={formData?.assignedTo}
                onChange={(value) => setFormData(prev => ({ ...prev, assignedTo: value }))}
                multiple
                placeholder="Select crew members"
              />
              
              <Select
                label="Rotation Rule"
                options={rotationRules}
                value={formData?.rotationRule}
                onChange={(value) => setFormData(prev => ({ ...prev, rotationRule: value }))}
                description="How this duty set should be rotated among crew members"
              />
            </div>
            
            {/* Tasks */}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3">Tasks</h3>
              
              {/* Add Task Form */}
              <div className="p-4 bg-muted/30 rounded-lg mb-3">
                <div className="space-y-3">
                  <Input
                    placeholder="Task description"
                    value={newTask?.text}
                    onChange={(e) => setNewTask(prev => ({ ...prev, text: e?.target?.value }))}
                  />
                  
                  <div className="grid grid-cols-3 gap-3">
                    <Select
                      options={frequencies}
                      value={newTask?.frequency}
                      onChange={(value) => setNewTask(prev => ({ ...prev, frequency: value, day: '', date: '' }))}
                      placeholder="Frequency"
                    />
                    
                    {newTask?.frequency === 'weekly' && (
                      <Select
                        options={weekDays}
                        value={newTask?.day}
                        onChange={(value) => setNewTask(prev => ({ ...prev, day: value }))}
                        placeholder="Select day"
                      />
                    )}
                    
                    {newTask?.frequency === 'monthly' && (
                      <Input
                        type="number"
                        min="1"
                        max="31"
                        placeholder="Day of month"
                        value={newTask?.date}
                        onChange={(e) => setNewTask(prev => ({ ...prev, date: e?.target?.value }))}
                      />
                    )}
                  </div>
                  
                  <Button
                    variant="outline"
                    size="sm"
                    iconName="Plus"
                    onClick={handleAddTask}
                    type="button"
                  >
                    Add Task
                  </Button>
                </div>
              </div>
              
              {/* Tasks List */}
              <div className="space-y-2">
                {tasks?.map(task => (
                  <div key={task?.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                    <div className="flex-1">
                      <p className="text-sm text-foreground font-medium mb-1">{task?.text}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground capitalize">{task?.frequency}</span>
                        {task?.frequency === 'weekly' && task?.day && (
                          <span className="px-2 py-0.5 rounded text-xs bg-primary/10 text-primary">{task?.day}</span>
                        )}
                        {task?.frequency === 'monthly' && task?.date && (
                          <span className="px-2 py-0.5 rounded text-xs bg-accent/10 text-accent">Day {task?.date}</span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveTask(task?.id)}
                      className="p-2 hover:bg-error/10 rounded-lg transition-smooth"
                    >
                      <Icon name="Trash2" size={16} className="text-error" />
                    </button>
                  </div>
                ))}
                
                {tasks?.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    No tasks added yet. Add tasks above to build your duty set.
                  </div>
                )}
              </div>
            </div>
          </div>
        </form>
        
        {/* Footer */}
        <div className="p-6 border-t border-border">
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={onClose} fullWidth>
              Cancel
            </Button>
            <Button 
              variant="default" 
              iconName="Plus" 
              onClick={handleSubmit} 
              fullWidth
              disabled={!formData?.name || tasks?.length === 0}
            >
              Create Duty Set
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreateDutySetModal;