import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { Checkbox } from '../../../components/ui/Checkbox';

const DutySetDetailPanel = ({ dutySet, userId, hasFullAccess, getCrewMember, onClose, onToggleTask }) => {
  const [activeTab, setActiveTab] = useState('all');

  const today = new Date();

  // Filter tasks based on active tab
  const getFilteredTasks = () => {
    return dutySet?.tasks?.filter(t => {
      // Filter by tab
      if (activeTab === 'daily' && t?.frequency !== 'daily') return false;
      if (activeTab === 'weekly' && !t?.frequency?.startsWith('weekly-')) return false;
      if (activeTab === 'monthly' && !t?.frequency?.startsWith('monthly-')) return false;
      
      // For 'all' tab, show only tasks due today
      if (activeTab === 'all') {
        if (t?.frequency === 'daily') return true;
        if (t?.frequency?.startsWith('weekly-')) {
          const day = t?.frequency?.split('-')?.[1];
          const dayMap = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0 };
          return today?.getDay() === dayMap?.[day];
        }
        if (t?.frequency?.startsWith('monthly-')) {
          const date = parseInt(t?.frequency?.split('-')?.[1]);
          return today?.getDate() === date;
        }
        return false;
      }
      
      return true;
    });
  };

  const filteredTasks = getFilteredTasks();
  const completedCount = filteredTasks?.filter(t => t?.completed)?.length || 0;
  const totalCount = filteredTasks?.length || 0;
  const allComplete = totalCount > 0 && completedCount === totalCount;

  // Helper to format frequency chip
  const getFrequencyChip = (frequency) => {
    if (!frequency || frequency === 'daily') return null;
    
    if (frequency?.startsWith('weekly-')) {
      const day = frequency?.split('-')?.[1];
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 text-xs font-medium capitalize">
          {day}
        </span>
      );
    }
    
    if (frequency?.startsWith('monthly-')) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-600 text-xs font-medium">
          Monthly — due today
        </span>
      );
    }
    
    return null;
  };

  const tabs = [
    { id: 'all', label: 'All', count: getFilteredTasks()?.length },
    { id: 'daily', label: 'Daily', count: dutySet?.tasks?.filter(t => t?.frequency === 'daily')?.length },
    { id: 'weekly', label: 'Weekly', count: dutySet?.tasks?.filter(t => t?.frequency?.startsWith('weekly-'))?.length },
    { id: 'monthly', label: 'Monthly', count: dutySet?.tasks?.filter(t => t?.frequency?.startsWith('monthly-'))?.length }
  ];

  return (
    <>
      {/* Overlay */}
      <div 
        className="fixed inset-0 bg-black/50 z-40 transition-opacity duration-300"
        onClick={onClose}
      />
      
      {/* Side Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-2xl bg-background shadow-2xl z-50 overflow-y-auto">
        <div className="sticky top-0 bg-background border-b border-border z-10">
          {/* Header */}
          <div className="flex items-center justify-between p-6 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <Icon name="ListChecks" size={24} className="text-primary" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-foreground">{dutySet?.name}</h2>
                <span className="text-sm text-muted-foreground">Due: Today</span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="rounded-full w-10 h-10 p-0"
            >
              <Icon name="X" size={20} />
            </Button>
          </div>

          {/* Assigned Crew */}
          <div className="px-6 pb-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Assigned to:</span>
              <div className="flex -space-x-2">
                {dutySet?.assignees?.map(assigneeId => {
                  const crew = getCrewMember(assigneeId);
                  return crew ? (
                    <img
                      key={assigneeId}
                      src={crew?.avatar}
                      alt={crew?.name}
                      className="w-8 h-8 rounded-full border-2 border-background"
                      title={crew?.name}
                    />
                  ) : null;
                })}
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 px-6 pb-4">
            {tabs?.map(tab => (
              <button
                key={tab?.id}
                onClick={() => setActiveTab(tab?.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  activeTab === tab?.id
                    ? 'bg-primary text-white' :'text-muted-foreground hover:bg-muted'
                }`}
              >
                {tab?.label}
                {tab?.count > 0 && (
                  <span className={`ml-2 text-xs ${
                    activeTab === tab?.id ? 'text-white/80' : 'text-muted-foreground'
                  }`}>
                    ({tab?.count})
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Task List */}
        <div className="p-6">
          {filteredTasks?.length > 0 ? (
            <div className="space-y-3">
              {filteredTasks?.map(task => (
                <div
                  key={task?.id}
                  className="flex items-start gap-3 p-4 rounded-lg border border-border hover:border-primary/30 transition-all duration-200 bg-card"
                >
                  <Checkbox
                    checked={task?.completed}
                    onCheckedChange={() => onToggleTask(dutySet?.id, task?.id)}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm font-medium ${
                        task?.completed ? 'text-muted-foreground line-through' : 'text-foreground'
                      }`}>
                        {task?.name}
                      </p>
                      {getFrequencyChip(task?.frequency)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <Icon name="CheckCircle" size={48} className="text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No tasks in this category</p>
            </div>
          )}

          {/* Completion Footer */}
          {allComplete && activeTab === 'all' && (
            <div className="mt-6 p-4 rounded-lg bg-green-50 border border-green-200">
              <div className="flex items-center gap-2">
                <Icon name="CheckCircle" size={20} className="text-green-600" />
                <p className="text-sm font-medium text-green-900">
                  Done for today. Will repeat tomorrow.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default DutySetDetailPanel;