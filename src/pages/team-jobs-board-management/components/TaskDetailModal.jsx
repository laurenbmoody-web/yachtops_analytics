import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';

const TaskDetailModal = ({ task, onClose, onComplete, onUpdate, currentUser, userRole }) => {
  const [activeTab, setActiveTab] = useState('details');
  const [newNote, setNewNote] = useState('');
  const [newComment, setNewComment] = useState('');
  const [checklist, setChecklist] = useState(task?.checklist || []);
  const [completedBy, setCompletedBy] = useState(currentUser);
  
  const crewMembers = ['Mark', 'Sarah', 'Lisa', 'Emma', 'Tom', 'Mike', 'John'];
  
  const handleChecklistToggle = (itemId) => {
    setChecklist(prev => prev?.map(item => 
      item?.id === itemId ? { ...item, completed: !item?.completed } : item
    ));
  };
  
  const handleAddNote = () => {
    if (!newNote?.trim()) return;
    
    const updatedTask = {
      ...task,
      notes: [
        ...task?.notes,
        { id: `n${Date.now()}`, user: currentUser, text: newNote, timestamp: new Date() }
      ],
      activityLog: [
        ...task?.activityLog,
        { id: `a${Date.now()}`, user: currentUser, action: 'added note', timestamp: new Date() }
      ]
    };
    
    onUpdate(updatedTask);
    setNewNote('');
  };
  
  const handleAddComment = () => {
    if (!newComment?.trim()) return;
    
    const updatedTask = {
      ...task,
      notes: [
        ...task?.notes,
        { id: `c${Date.now()}`, user: currentUser, text: newComment, timestamp: new Date(), isComment: true }
      ],
      activityLog: [
        ...task?.activityLog,
        { id: `a${Date.now()}`, user: currentUser, action: 'added comment', timestamp: new Date() }
      ]
    };
    
    onUpdate(updatedTask);
    setNewComment('');
  };
  
  const handleComplete = () => {
    onComplete(task?.id, completedBy);
    onClose();
  };
  
  const formatTimestamp = (date) => {
    return new Date(date)?.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };
  
  const isAssistedCompletion = task?.assignedTo?.[0] !== completedBy;
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-100 p-6">
      <div className="bg-card rounded-xl border border-border shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-border">
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <h2 className="text-xl font-semibold text-foreground mb-2">{task?.title}</h2>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Icon name="User" size={14} />
                  <span>Assigned to: {task?.assignedTo?.join(', ')}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Icon name="Calendar" size={14} />
                  <span>Due: {new Date(task.dueDate)?.toLocaleDateString()} {task?.dueTime}</span>
                </div>
                <div className={`px-2 py-1 rounded text-xs font-medium ${
                  task?.priority === 'high' ? 'bg-error/10 text-error' :
                  task?.priority === 'medium'? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'
                }`}>
                  {task?.priority} priority
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
          
          {/* Tabs */}
          <div className="flex items-center gap-2 border-b border-border -mb-6">
            {['details', 'notes', 'attachments', 'activity']?.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium transition-smooth capitalize ${
                  activeTab === tab
                    ? 'text-primary border-b-2 border-primary' :'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'details' && (
            <div className="space-y-6">
              {/* Description */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">Description</h3>
                <p className="text-sm text-muted-foreground">{task?.description}</p>
              </div>
              
              {/* Checklist */}
              {checklist?.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-3">Checklist</h3>
                  <div className="space-y-2">
                    {checklist?.map(item => (
                      <div key={item?.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                        <input
                          type="checkbox"
                          checked={item?.completed}
                          onChange={() => handleChecklistToggle(item?.id)}
                          className="w-4 h-4 rounded border-border cursor-pointer"
                        />
                        <span className={`text-sm ${
                          item?.completed ? 'text-muted-foreground line-through' : 'text-foreground'
                        }`}>
                          {item?.text}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 text-xs text-muted-foreground">
                    {checklist?.filter(i => i?.completed)?.length} of {checklist?.length} completed
                  </div>
                </div>
              )}
              
              {/* Assignment Info */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">Assignment</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Assigned by:</span>
                    <span className="text-foreground font-medium">{task?.assignedBy}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Board:</span>
                    <span className="text-foreground font-medium capitalize">{task?.board}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {activeTab === 'notes' && (
            <div className="space-y-4">
              {/* Add Note */}
              <div>
                <Input
                  placeholder="Add a note..."
                  value={newNote}
                  onChange={(e) => setNewNote(e?.target?.value)}
                  onKeyPress={(e) => e?.key === 'Enter' && handleAddNote()}
                />
                <Button
                  variant="default"
                  size="sm"
                  iconName="Plus"
                  onClick={handleAddNote}
                  className="mt-2"
                >
                  Add Note
                </Button>
              </div>
              
              {/* Notes List */}
              <div className="space-y-3">
                {task?.notes?.filter(n => !n?.isComment)?.map(note => (
                  <div key={note?.id} className="p-4 bg-muted/30 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-foreground">{note?.user}</span>
                      <span className="text-xs text-muted-foreground">{formatTimestamp(note?.timestamp)}</span>
                    </div>
                    <p className="text-sm text-foreground">{note?.text}</p>
                  </div>
                ))}
                {task?.notes?.filter(n => !n?.isComment)?.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    No notes yet
                  </div>
                )}
              </div>
            </div>
          )}
          
          {activeTab === 'attachments' && (
            <div className="space-y-4">
              <Button variant="outline" iconName="Upload">
                Upload Attachment
              </Button>
              
              {task?.attachments?.length === 0 && (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  <Icon name="Paperclip" size={48} className="mx-auto mb-3 opacity-30" />
                  <p>No attachments yet</p>
                </div>
              )}
            </div>
          )}
          
          {activeTab === 'activity' && (
            <div className="space-y-3">
              {task?.activityLog?.map(log => (
                <div key={log?.id} className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg">
                  <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-medium flex-shrink-0">
                    {log?.user?.[0]}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-foreground">
                      <span className="font-medium">{log?.user}</span> {log?.action}
                    </p>
                    <span className="text-xs text-muted-foreground">{formatTimestamp(log?.timestamp)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="p-6 border-t border-border">
          {task?.status !== 'completed' && (
            <div className="space-y-3">
              {/* Assisted Completion */}
              {userRole?.toUpperCase() === 'CREW' && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">Complete on behalf of:</span>
                  <Select
                    options={crewMembers?.map(m => ({ value: m, label: m }))}
                    value={completedBy}
                    onChange={setCompletedBy}
                    className="flex-1"
                  />
                </div>
              )}
              
              {isAssistedCompletion && (
                <div className="p-3 bg-warning/10 border border-warning/20 rounded-lg">
                  <div className="flex items-start gap-2">
                    <Icon name="AlertTriangle" size={16} className="text-warning mt-0.5" />
                    <div className="text-xs text-warning">
                      You are completing this task on behalf of {task?.assignedTo?.[0]}. This will be recorded in the activity log.
                    </div>
                  </div>
                </div>
              )}
              
              <div className="flex items-center gap-3">
                <Button variant="outline" onClick={onClose} fullWidth>
                  Cancel
                </Button>
                <Button variant="success" iconName="Check" onClick={handleComplete} fullWidth>
                  Mark Complete
                </Button>
              </div>
            </div>
          )}
          
          {task?.status === 'completed' && (
            <div className="p-4 bg-success/10 border border-success/20 rounded-lg">
              <div className="flex items-center gap-2 text-success">
                <Icon name="CheckCircle2" size={20} />
                <div>
                  <p className="text-sm font-medium">Task completed</p>
                  <p className="text-xs">
                    by {task?.completedBy} on {formatTimestamp(task?.completedAt)}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TaskDetailModal;