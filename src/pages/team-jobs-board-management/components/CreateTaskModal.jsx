import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';

const CreateTaskModal = ({ onClose, onCreate, activeBoard, boards }) => {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    board: activeBoard,
    assignedTo: [],
    priority: 'medium',
    dueDate: new Date()?.toISOString()?.split('T')?.[0],
    dueTime: '12:00',
    column: 'today'
  });
  
  const crewMembers = ['Mark', 'Sarah', 'Lisa', 'Emma', 'Tom', 'Mike', 'John'];
  const priorities = [
    { value: 'low', label: 'Low Priority' },
    { value: 'medium', label: 'Medium Priority' },
    { value: 'high', label: 'High Priority' }
  ];
  
  const handleSubmit = (e) => {
    e?.preventDefault();
    
    const newTask = {
      ...formData,
      dueDate: new Date(formData.dueDate),
      status: 'open',
      completedBy: null,
      completedAt: null,
      notes: [],
      attachments: [],
      checklist: [],
      activityLog: [
        { id: 'a1', user: 'Chief Stew', action: 'created task', timestamp: new Date() }
      ],
      assignedBy: 'Chief Stew'
    };
    
    onCreate(newTask);
  };
  
  const handleAssignmentChange = (value) => {
    setFormData(prev => ({ ...prev, assignedTo: value }));
  };
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-100 p-6">
      <div className="bg-card rounded-xl border border-border shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-foreground">Create New Task</h2>
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
          <div className="space-y-4">
            <Input
              label="Task Title"
              required
              value={formData?.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e?.target?.value }))}
              placeholder="Enter task title"
            />
            
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">Description</label>
              <textarea
                value={formData?.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e?.target?.value }))}
                placeholder="Enter task description"
                rows={3}
                className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            
            <Select
              label="Board"
              options={boards?.map(b => ({ value: b?.id, label: b?.name }))}
              value={formData?.board}
              onChange={(value) => setFormData(prev => ({ ...prev, board: value }))}
            />
            
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">Assign To</label>
              <Select
                options={[
                  { value: 'all-interior', label: 'All Interior' },
                  ...crewMembers?.map(m => ({ value: m, label: m }))
                ]}
                value={formData?.assignedTo}
                onChange={handleAssignmentChange}
                multiple
                placeholder="Select crew members"
              />
            </div>
            
            <Select
              label="Priority"
              options={priorities}
              value={formData?.priority}
              onChange={(value) => setFormData(prev => ({ ...prev, priority: value }))}
            />
            
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Due Date"
                type="date"
                required
                value={formData?.dueDate}
                onChange={(e) => setFormData(prev => ({ ...prev, dueDate: e?.target?.value }))}
              />
              
              <Input
                label="Due Time"
                type="time"
                required
                value={formData?.dueTime}
                onChange={(e) => setFormData(prev => ({ ...prev, dueTime: e?.target?.value }))}
              />
            </div>
          </div>
        </form>
        
        {/* Footer */}
        <div className="p-6 border-t border-border">
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={onClose} fullWidth>
              Cancel
            </Button>
            <Button variant="default" iconName="Plus" onClick={handleSubmit} fullWidth>
              Create Task
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreateTaskModal;