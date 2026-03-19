import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

import { crewMembers } from '../data/mockData';

const BoardView = ({
  userId,
  isChiefStew,
  boards,
  activeBoard,
  setActiveBoard,
  tasks,
  dutySets,
  onCompleteTask,
  onCompleteDutySet,
  onCardClick
}) => {
  const [showCompleted, setShowCompleted] = useState(false);

  const today = new Date();
  const todayStr = today?.toISOString()?.split('T')?.[0];
  const tomorrow = new Date(today);
  tomorrow?.setDate(tomorrow?.getDate() + 1);
  const tomorrowStr = tomorrow?.toISOString()?.split('T')?.[0];

  // Get active board data
  const currentBoard = boards?.find(b => b?.id === activeBoard);

  // Filter items by board
  const boardTasks = tasks?.filter(t => t?.board === activeBoard);
  const boardDutySets = dutySets?.filter(ds => ds?.board === activeBoard);

  // Combine tasks and duty sets
  const allItems = [...boardTasks, ...boardDutySets];

  // Categorize by column
  const todayItems = allItems?.filter(item => {
    if (item?.status === 'completed' || item?.completed) return false;
    const dueDate = new Date(item?.dueDate)?.toISOString()?.split('T')?.[0];
    return dueDate === todayStr;
  });

  const upcomingItems = allItems?.filter(item => {
    if (item?.status === 'completed' || item?.completed) return false;
    const dueDate = new Date(item?.dueDate)?.toISOString()?.split('T')?.[0];
    return dueDate > todayStr;
  });

  const completedItems = allItems?.filter(item => 
    item?.status === 'completed' || item?.completed
  );

  const getCrewMember = (id) => crewMembers?.find(c => c?.id === id);

  const getPriorityDot = (priority) => {
    switch (priority) {
      case 'high': return 'bg-error';
      case 'medium': return 'bg-warning';
      case 'low': return 'bg-success';
      default: return 'bg-muted-foreground';
    }
  };

  const renderCard = (item) => {
    const isDutySet = item?.type === 'dutyset';
    const assignees = item?.assignees || [];

    return (
      <div
        key={item?.id}
        onClick={() => onCardClick(item)}
        className="bg-card rounded-xl border border-border shadow-sm p-4 hover:shadow-md transition-smooth cursor-pointer mb-3"
      >
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2 flex-1">
            {isDutySet ? (
              <Icon name="ListChecks" size={16} className="text-primary flex-shrink-0" />
            ) : (
              item?.priority && <div className={`w-2 h-2 rounded-full ${getPriorityDot(item?.priority)} flex-shrink-0`} />
            )}
            <h4 className="text-sm font-semibold text-foreground line-clamp-1">
              {isDutySet ? item?.name : item?.title}
            </h4>
          </div>
        </div>
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-1">
            {assignees?.slice(0, 3)?.map(assigneeId => {
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
            {assignees?.length > 3 && (
              <div className="w-6 h-6 rounded-full bg-muted border-2 border-card flex items-center justify-center text-xs text-muted-foreground">
                +{assignees?.length - 3}
              </div>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {new Date(item?.dueDate)?.toISOString()?.split('T')?.[0] === todayStr ? 'Today' :
             new Date(item?.dueDate)?.toISOString()?.split('T')?.[0] === tomorrowStr ? 'Tomorrow' :
             new Date(item?.dueDate)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* Board Tabs */}
      <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2">
        {boards?.map(board => (
          <button
            key={board?.id}
            onClick={() => setActiveBoard(board?.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-smooth whitespace-nowrap ${
              activeBoard === board?.id
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
            }`}
            style={activeBoard === board?.id ? { backgroundColor: board?.color } : {}}
          >
            {board?.name}
          </button>
        ))}
      </div>

      {/* Board Columns */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Today Column */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-foreground">Today</h3>
            <span className="text-sm text-muted-foreground">{todayItems?.length}</span>
          </div>
          <div className="space-y-3">
            {todayItems?.map(renderCard)}
            {todayItems?.length === 0 && (
              <div className="bg-muted/30 rounded-xl border border-dashed border-border p-6 text-center">
                <Icon name="Calendar" size={32} className="mx-auto mb-2 text-muted-foreground opacity-30" />
                <p className="text-sm text-muted-foreground">No tasks due today</p>
              </div>
            )}
          </div>
        </div>

        {/* Upcoming Column */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-foreground">Upcoming</h3>
            <span className="text-sm text-muted-foreground">{upcomingItems?.length}</span>
          </div>
          <div className="space-y-3">
            {upcomingItems?.map(renderCard)}
            {upcomingItems?.length === 0 && (
              <div className="bg-muted/30 rounded-xl border border-dashed border-border p-6 text-center">
                <Icon name="Clock" size={32} className="mx-auto mb-2 text-muted-foreground opacity-30" />
                <p className="text-sm text-muted-foreground">No upcoming tasks</p>
              </div>
            )}
          </div>
        </div>

        {/* Completed Column */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setShowCompleted(!showCompleted)}
              className="flex items-center gap-2 hover:text-foreground transition-smooth"
            >
              <h3 className="text-base font-semibold text-foreground">Completed</h3>
              <Icon 
                name={showCompleted ? 'ChevronDown' : 'ChevronRight'} 
                size={16} 
                className="text-muted-foreground" 
              />
            </button>
            <span className="text-sm text-muted-foreground">{completedItems?.length}</span>
          </div>
          {showCompleted && (
            <div className="space-y-3">
              {completedItems?.map(renderCard)}
              {completedItems?.length === 0 && (
                <div className="bg-muted/30 rounded-xl border border-dashed border-border p-6 text-center">
                  <Icon name="CheckCircle2" size={32} className="mx-auto mb-2 text-muted-foreground opacity-30" />
                  <p className="text-sm text-muted-foreground">No completed tasks</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BoardView;