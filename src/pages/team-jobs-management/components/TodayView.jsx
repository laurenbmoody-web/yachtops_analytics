import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { crewMembers } from '../data/mockData';
import CardDetailModal from './CardDetailModal';

const TodayView = ({
  userId,
  userName,
  isChiefStew,
  tasks,
  dutySets,
  boards,
  activeBoard,
  onCompleteTask,
  onCompleteDutySet,
  onTakeTask,
  onCardClick
}) => {
  const [selectedCard, setSelectedCard] = useState(null);
  
  const today = new Date();
  const todayStr = today?.toISOString()?.split('T')?.[0];

  // Filter duty sets for today
  const todayDutySets = dutySets?.filter(ds => {
    const dueDate = new Date(ds?.dueDate)?.toISOString()?.split('T')?.[0];
    if (dueDate !== todayStr) return false;

    // For crew: only assigned to them
    if (!isChiefStew && !ds?.assignees?.includes(userId)) return false;

    return true;
  });

  // Filter tasks for today
  const todayTasks = tasks?.filter(task => {
    const dueDate = new Date(task?.dueDate)?.toISOString()?.split('T')?.[0];
    if (dueDate !== todayStr) return false;

    // For crew: only assigned to them
    if (!isChiefStew && !task?.assignees?.includes(userId)) return false;

    return true;
  });

  // Check if all assigned tasks are complete
  const allAssignedComplete = todayDutySets?.length === 0 && todayTasks?.length === 0;

  // Available tasks (only show if all assigned complete)
  const availableTasks = allAssignedComplete ? tasks?.filter(task => {
    if (task?.status === 'completed') return false;
    const dueDate = new Date(task?.dueDate)?.toISOString()?.split('T')?.[0];
    if (dueDate !== todayStr) return false;
    
    // Unassigned or assigned to all interior
    return task?.assignees?.length === 0 || task?.assignees?.includes('all-interior');
  }) : [];

  const getCrewMember = (id) => crewMembers?.find(c => c?.id === id);

  const handleCardClick = (card) => {
    setSelectedCard(card);
  };

  const handleCloseModal = () => {
    setSelectedCard(null);
  };

  const handleComplete = (cardId, completedBy) => {
    const card = [...dutySets, ...tasks]?.find(c => c?.id === cardId);
    if (card?.type === 'dutyset') {
      onCompleteDutySet(cardId, completedBy);
    } else {
      onCompleteTask(cardId, completedBy);
    }
    setSelectedCard(null);
  };

  const handleTakeTask = (e, taskId) => {
    e?.stopPropagation();
    onTakeTask(taskId);
  };

  return (
    <div className="space-y-6">
      {/* Header with user info */}
      <div className="flex items-center gap-3 mb-4">
        <img 
          src={getCrewMember(userId)?.avatar || 'https://i.pravatar.cc/150?img=1'} 
          alt={userName} 
          className="w-10 h-10 rounded-full border-2 border-border"
        />
        <div>
          <h1 className="text-xl font-bold text-foreground">{userName}</h1>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Interior</span>
            {todayDutySets?.length === 0 && todayTasks?.length === 0 && (
              <span className="text-sm text-success font-medium">All Interior tasks are complete.</span>
            )}
          </div>
        </div>
      </div>

      {/* YOUR DUTIES (TODAY) - PRIMARY SECTION */}
      {todayDutySets?.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-foreground mb-3">
            Your Duties
          </h2>
          <div className="space-y-3">
            {todayDutySets?.map(dutySet => {
              const tasksToday = dutySet?.tasks?.filter(t => {
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
              });

              const completedCount = tasksToday?.filter(t => t?.completed)?.length;
              const totalCount = tasksToday?.length;

              return (
                <div
                  key={dutySet?.id}
                  onClick={() => handleCardClick(dutySet)}
                  className="bg-card rounded-lg border border-border hover:border-primary/50 transition-all duration-200 p-4 cursor-pointer group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Icon name="ListChecks" size={18} className="text-primary" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-base font-semibold text-foreground mb-0.5">{dutySet?.name}</h3>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5">
                            {dutySet?.assignees?.slice(0, 2)?.map(assigneeId => {
                              const crew = getCrewMember(assigneeId);
                              return crew ? (
                                <img
                                  key={assigneeId}
                                  src={crew?.avatar}
                                  alt={crew?.name}
                                  className="w-5 h-5 rounded-full border border-card"
                                  title={crew?.name}
                                />
                              ) : null;
                            })}
                            <span className="text-xs text-muted-foreground">{dutySet?.assignees?.length > 1 ? getCrewMember(dutySet?.assignees?.[0])?.name?.split(' ')?.[0] : getCrewMember(dutySet?.assignees?.[0])?.name?.split(' ')?.[0]}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">• Today</span>
                        </div>
                      </div>
                    </div>
                    <Icon name="ChevronRight" size={18} className="text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* YOUR TASKS - SECONDARY SECTION */}
      {todayTasks?.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-foreground mb-3">
            Your Tasks
          </h2>
          <div className="space-y-2">
            {todayTasks?.map(task => (
              <div
                key={task?.id}
                onClick={() => handleCardClick(task)}
                className="bg-card rounded-lg border border-border hover:border-primary/30 transition-all duration-200 p-3.5 cursor-pointer"
              >
                <div className="flex items-start gap-3">
                  <Icon name="FileText" size={16} className="text-primary mt-0.5" />
                  <div className="flex-1">
                    <h3 className="text-sm font-medium text-foreground mb-1">{task?.title}</h3>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        {task?.assignees?.slice(0, 1)?.map(assigneeId => {
                          const crew = getCrewMember(assigneeId);
                          return crew ? (
                            <img
                              key={assigneeId}
                              src={crew?.avatar}
                              alt={crew?.name}
                              className="w-4 h-4 rounded-full border border-card"
                              title={crew?.name}
                            />
                          ) : null;
                        })}
                        <span className="text-xs text-muted-foreground">{getCrewMember(task?.assignees?.[0])?.name?.split(' ')?.[0]}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AVAILABLE TASKS (OPTIONAL) - CONDITIONAL SECTION */}
      {allAssignedComplete && availableTasks?.length > 0 && (
        <div className="pt-4 border-t border-dashed border-border">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-base font-semibold text-foreground">Available Tasks</h2>
            <span className="text-xs text-muted-foreground">Optional</span>
          </div>
          <div className="space-y-2">
            {availableTasks?.map(task => (
              <div
                key={task?.id}
                className="bg-muted/30 rounded-lg border border-dashed border-border hover:border-solid hover:bg-card transition-all duration-200 p-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1">
                    <Icon name="FileText" size={16} className="text-muted-foreground mt-0.5" />
                    <div className="flex-1">
                      <h3 className="text-sm font-medium text-foreground mb-1">{task?.title}</h3>
                      <span className="text-xs text-muted-foreground">{task?.assignees?.length === 0 ? 'Mark assigned' : 'June assigned'}</span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => handleTakeTask(e, task?.id)}
                    className="text-xs px-3 py-1.5 h-auto"
                  >
                    Take task
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Card Detail Modal */}
      {selectedCard && (
        <CardDetailModal
          card={selectedCard}
          isChiefStew={isChiefStew}
          userId={userId}
          userName={userName}
          currentUser={{ id: userId, name: userName }}
          teamMembers={crewMembers}
          onClose={handleCloseModal}
          onComplete={handleComplete}
          onUpdate={() => {}}
          onDelete={() => {}}
          onArchive={() => {}}
          onUnarchive={() => {}}
        />
      )}
    </div>
  );
};

export default TodayView;