import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

const TaskCard = ({ task, userId, isChiefStew, getCrewMember, onComplete }) => {
  const [showAssistedCompletion, setShowAssistedCompletion] = useState(false);

  const isAssignedToUser = task?.assignees?.includes(userId);
  const canComplete = isChiefStew || isAssignedToUser;

  const handleComplete = (completedBy = userId) => {
    onComplete(task?.id, completedBy);
    setShowAssistedCompletion(false);
  };

  const getDueIndicator = () => {
    const dueDate = new Date(task?.dueDate);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow?.setDate(tomorrow?.getDate() + 1);

    const dueDateStr = dueDate?.toISOString()?.split('T')?.[0];
    const todayStr = today?.toISOString()?.split('T')?.[0];
    const tomorrowStr = tomorrow?.toISOString()?.split('T')?.[0];

    if (dueDateStr === todayStr) return { text: 'Today', color: 'text-red-600' };
    if (dueDateStr === tomorrowStr) return { text: 'Tomorrow', color: 'text-amber-600' };
    return { text: dueDate?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), color: 'text-muted-foreground' };
  };

  const dueIndicator = getDueIndicator();

  return (
    <div className="bg-card rounded-lg border border-border p-4 hover:border-primary/30 transition-all duration-200">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <h3 className="text-base font-semibold text-foreground mb-1">{task?.title}</h3>
          {task?.description && (
            <p className="text-sm text-muted-foreground">{task?.description}</p>
          )}
        </div>
        <span className={`text-xs font-medium ${dueIndicator?.color}`}>
          {dueIndicator?.text}
        </span>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {task?.assignees?.length > 0 && (
            <div className="flex -space-x-2">
              {task?.assignees?.slice(0, 3)?.map(assigneeId => {
                const crew = getCrewMember(assigneeId);
                return crew ? (
                  <img
                    key={assigneeId}
                    src={crew?.avatar}
                    alt={crew?.name}
                    className="w-6 h-6 rounded-full border-2 border-card"
                    title={crew?.name}
                  />
                ) : null;
              })}
              {task?.assignees?.length > 3 && (
                <div className="w-6 h-6 rounded-full bg-muted border-2 border-card flex items-center justify-center">
                  <span className="text-xs font-medium text-muted-foreground">+{task?.assignees?.length - 3}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {canComplete && (
          <div className="flex items-center gap-2">
            {showAssistedCompletion ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Complete as:</span>
                {task?.assignees?.map(assigneeId => {
                  const crew = getCrewMember(assigneeId);
                  return crew ? (
                    <button
                      key={assigneeId}
                      onClick={() => handleComplete(assigneeId)}
                      className="w-8 h-8 rounded-full border-2 border-primary hover:scale-110 transition-transform"
                      title={`Complete as ${crew?.name}`}
                    >
                      <img src={crew?.avatar} alt={crew?.name} className="w-full h-full rounded-full" />
                    </button>
                  ) : null;
                })}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowAssistedCompletion(false)}
                >
                  <Icon name="X" size={16} />
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (task?.assignees?.length > 1) {
                    setShowAssistedCompletion(true);
                  } else {
                    handleComplete();
                  }
                }}
              >
                <Icon name="Check" size={16} className="mr-1" />
                Complete
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TaskCard;