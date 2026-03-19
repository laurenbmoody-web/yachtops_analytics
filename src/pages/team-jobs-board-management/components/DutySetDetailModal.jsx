import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

const DutySetDetailModal = ({ dutySet, onClose, onUpdate, currentUser }) => {
  const [tasks, setTasks] = useState(dutySet?.tasks);
  
  const handleToggleTask = (taskId) => {
    setTasks(prev => prev?.map(task => 
      task?.id === taskId ? { ...task, completed: !task?.completed } : task
    ));
  };
  
  const completedCount = tasks?.filter(t => t?.completed)?.length;
  const totalCount = tasks?.length;
  const progress = (completedCount / totalCount) * 100;
  
  const getFrequencyBadge = (task) => {
    if (task?.frequency === 'daily') return null;
    
    if (task?.frequency === 'weekly') {
      return (
        <span className="px-2 py-0.5 rounded text-xs bg-primary/10 text-primary">
          {task?.day}
        </span>
      );
    }
    
    if (task?.frequency === 'monthly') {
      return (
        <span className="px-2 py-0.5 rounded text-xs bg-accent/10 text-accent">
          Monthly — due today
        </span>
      );
    }
    
    return null;
  };
  
  const handleSave = () => {
    onUpdate({ ...dutySet, tasks });
  };
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-100 p-6">
      <div className="bg-card rounded-xl border border-border shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-border">
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <Icon name="ListChecks" size={24} className="text-primary" />
                <h2 className="text-xl font-semibold text-foreground">{dutySet?.name}</h2>
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Icon name="User" size={14} />
                  <span>Assigned to: {dutySet?.assignedTo?.join(', ')}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Icon name="Calendar" size={14} />
                  <span>Due today</span>
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-muted rounded-lg transition-smooth"
            >
              <Icon name="X" size={20} className="text-muted-foreground" />
            </button>
          </div>
          
          {/* Progress Bar */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-foreground">Progress</span>
              <span className="text-sm text-muted-foreground">{completedCount} of {totalCount} completed</span>
            </div>
            <div className="w-full bg-muted rounded-full h-3">
              <div 
                className="bg-success h-3 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-2">
            {tasks?.map(task => (
              <div 
                key={task?.id} 
                className="flex items-start gap-3 p-4 bg-muted/30 rounded-lg hover:bg-muted/50 transition-smooth"
              >
                <input
                  type="checkbox"
                  checked={task?.completed}
                  onChange={() => handleToggleTask(task?.id)}
                  className="w-5 h-5 rounded border-border cursor-pointer mt-0.5"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-sm ${
                      task?.completed ? 'text-muted-foreground line-through' : 'text-foreground font-medium'
                    }`}>
                      {task?.text}
                    </span>
                    {getFrequencyBadge(task)}
                  </div>
                </div>
              </div>
            ))}
          </div>
          
          {/* Info Box */}
          <div className="mt-6 p-4 bg-primary/5 border border-primary/10 rounded-lg">
            <div className="flex items-start gap-2">
              <Icon name="Info" size={16} className="text-primary mt-0.5" />
              <div className="text-xs text-muted-foreground">
                <p className="mb-1">This duty set shows only tasks due today.</p>
                <p>Daily tasks appear every day. Weekly and monthly tasks appear only when scheduled.</p>
              </div>
            </div>
          </div>
        </div>
        
        {/* Footer */}
        <div className="p-6 border-t border-border">
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={onClose} fullWidth>
              Close
            </Button>
            <Button 
              variant="success" 
              iconName="Check" 
              onClick={handleSave}
              fullWidth
              disabled={completedCount !== totalCount}
            >
              {completedCount === totalCount ? 'Complete Duty Set' : `${totalCount - completedCount} tasks remaining`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DutySetDetailModal;