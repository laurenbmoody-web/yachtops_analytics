import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { hasCommandAccess, hasChiefAccess } from '../../utils/authStorage';
import DutySetDetailPanel from './components/DutySetDetailPanel';
import ComprehensiveJobModal from '../team-jobs-management/components/ComprehensiveJobModal';
import { loadBoards } from '../team-jobs-management/utils/boardStorage';
import { loadCards, saveCards } from '../team-jobs-management/utils/cardStorage';

import { mockDutySets, mockTasks, crewMembers, mockCustomBoards } from './data/mockData';

const DailyJobsList = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const userRole = currentUser?.role;
  const userId = currentUser?.id;
  const userName = currentUser?.name;
  
  const [selectedDutySet, setSelectedDutySet] = useState(null);
  const [dutySets, setDutySets] = useState(mockDutySets);
  const [tasks, setTasks] = useState(mockTasks);
  const [customBoards, setCustomBoards] = useState(mockCustomBoards);
  const [showCreateBoardModal, setShowCreateBoardModal] = useState(false);
  const [showAddCardModal, setShowAddCardModal] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const [newBoardType, setNewBoardType] = useState('interior');
  const [newBoardDescription, setNewBoardDescription] = useState('');
  const [newCardTitle, setNewCardTitle] = useState('');
  const [newCardAssignees, setNewCardAssignees] = useState([]);
  const [boards] = useState(() => loadBoards());
  const [cards, setCards] = useState(() => loadCards());

  const today = new Date();
  const todayStr = today?.toISOString()?.split('T')?.[0];

  // Check if user has Command or Chief access
  const hasFullAccess = currentUser && (hasCommandAccess(currentUser) || hasChiefAccess(currentUser));

  // Filter duty sets for today
  const todayDutySets = dutySets?.filter(ds => {
    const dueDate = new Date(ds?.dueDate)?.toISOString()?.split('T')?.[0];
    if (dueDate !== todayStr) return false;

    if (!hasFullAccess && !ds?.assignees?.includes(userId)) return false;

    return true;
  });

  // Filter individual tasks for today
  const todayTasks = tasks?.filter(task => {
    const dueDate = new Date(task?.dueDate)?.toISOString()?.split('T')?.[0];
    if (dueDate !== todayStr) return false;

    if (!hasFullAccess && !task?.assignees?.includes(userId)) return false;

    return true;
  });

  const getCrewMember = (id) => crewMembers?.find(c => c?.id === id);

  const handleDutySetClick = (dutySet) => {
    setSelectedDutySet(dutySet);
  };

  const handleCloseDutySetPanel = () => {
    setSelectedDutySet(null);
  };

  const handleCompleteDutySetTask = (dutySetId, taskId) => {
    setDutySets(prev => prev?.map(ds => {
      if (ds?.id === dutySetId) {
        return {
          ...ds,
          tasks: ds?.tasks?.map(t => 
            t?.id === taskId ? { ...t, completed: !t?.completed } : t
          )
        };
      }
      return ds;
    }));
  };

  const handleCompleteTask = (taskId, completedBy) => {
    setTasks(prev => prev?.map(task => 
      task?.id === taskId 
        ? { ...task, status: 'completed', completedBy, completedAt: new Date()?.toISOString() }
        : task
    ));
  };

  const handleCreateBoard = () => {
    if (!newBoardName?.trim()) return;
    
    const newBoard = {
      id: `board-${Date.now()}`,
      name: newBoardName,
      description: newBoardDescription,
      type: newBoardType,
      cards: []
    };
    
    setCustomBoards(prev => [...prev, newBoard]);
    setNewBoardName('');
    setNewBoardDescription('');
    setNewBoardType('interior');
    setShowCreateBoardModal(false);
  };

  const handleAddCard = () => {
    if (!newCardTitle?.trim()) return;
    
    const newCard = {
      id: `card-${Date.now()}`,
      title: newCardTitle,
      assignees: newCardAssignees,
      createdAt: new Date()?.toISOString()
    };
    
    // Add to Additional Jobs board (first custom board)
    setCustomBoards(prev => prev?.map((board, index) => {
      if (index === 0) {
        return {
          ...board,
          cards: [...(board?.cards || []), newCard]
        };
      }
      return board;
    }));
    
    setNewCardTitle('');
    setNewCardAssignees([]);
    setShowAddCardModal(false);
  };

  const handleComprehensiveJobSuccess = (newCard) => {
    // Save to cards storage
    const updatedCards = [...cards, newCard];
    setCards(updatedCards);
    saveCards(updatedCards);
    
    // Also add to customBoards for display (first board = Additional Jobs)
    setCustomBoards(prev => prev?.map((board, index) => {
      if (index === 0) {
        return {
          ...board,
          cards: [...(board?.cards || []), {
            id: newCard?.id,
            title: newCard?.title,
            assignees: newCard?.assignees,
            createdAt: newCard?.createdAt
          }]
        };
      }
      return board;
    }));
    
    setShowAddCardModal(false);
  };

  const getTasksForToday = (dutySet) => {
    return dutySet?.tasks?.filter(t => {
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
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="max-w-[1800px] mx-auto px-6 py-8">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Jobs</h1>
              <p className="text-muted-foreground mt-1">Your tasks and duties for today</p>
            </div>
          </div>
        </div>

        {/* Board Strip (Horizontal Scrollable) */}
        <div className="flex gap-6 overflow-x-auto pb-6 snap-x snap-mandatory scrollbar-hide">
          
          {/* WIDGET A: Daily Jobs Board */}
          <div className="flex-shrink-0 w-[420px] snap-start">
            <div className="bg-card rounded-2xl border-2 border-border p-6 h-full min-h-[700px]">
              {/* Board Header */}
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-foreground mb-1">Daily Jobs</h2>
                <p className="text-sm text-muted-foreground">Your duties and tasks for today</p>
              </div>

              {/* Duty Sets Section */}
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1 h-5 bg-primary rounded-full" />
                  <h3 className="text-sm font-bold text-foreground uppercase tracking-wide">Your Duties</h3>
                </div>
                <div className="space-y-3">
                  {todayDutySets?.map(dutySet => {
                    const tasksToday = getTasksForToday(dutySet);
                    const completedCount = tasksToday?.filter(t => t?.completed)?.length || 0;
                    const totalCount = tasksToday?.length || 0;
                    const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

                    return (
                      <div
                        key={dutySet?.id}
                        onClick={() => handleDutySetClick(dutySet)}
                        className="bg-background rounded-xl border border-border hover:border-primary/50 transition-all duration-200 p-4 cursor-pointer group"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                              <Icon name="ListChecks" size={18} className="text-primary" />
                            </div>
                            <div>
                              <h4 className="text-sm font-bold text-foreground">{dutySet?.name}</h4>
                              <span className="text-xs text-muted-foreground">Due: Today</span>
                            </div>
                          </div>
                        </div>

                        {/* Progress */}
                        <div className="flex items-center gap-3 mb-3">
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-medium text-foreground">{completedCount} / {totalCount} tasks</span>
                              <span className="text-xs text-muted-foreground">{Math.round(progress)}%</span>
                            </div>
                            <div className="h-2 bg-border rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-primary transition-all duration-300"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Assigned Crew */}
                        <div className="flex items-center gap-2">
                          <div className="flex -space-x-2">
                            {dutySet?.assignees?.slice(0, 3)?.map(assigneeId => {
                              const crew = getCrewMember(assigneeId);
                              return crew ? (
                                <img
                                  key={assigneeId}
                                  src={crew?.avatar}
                                  alt={crew?.alt || crew?.name}
                                  className="w-6 h-6 rounded-full border-2 border-card"
                                  title={crew?.name}
                                />
                              ) : null;
                            })}
                            {dutySet?.assignees?.length > 3 && (
                              <div className="w-6 h-6 rounded-full bg-muted border-2 border-card flex items-center justify-center">
                                <span className="text-xs font-medium text-muted-foreground">+{dutySet?.assignees?.length - 3}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {todayDutySets?.length === 0 && (
                    <div className="text-center py-6 bg-background rounded-xl border border-border">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-2">
                        <Icon name="CheckCircle" size={20} className="text-primary" />
                      </div>
                      <p className="text-xs text-muted-foreground">No duties for today</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Your Tasks Section */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1 h-5 bg-primary rounded-full" />
                  <h3 className="text-sm font-bold text-foreground uppercase tracking-wide">Your Tasks</h3>
                </div>
                <div className="space-y-3">
                  {todayTasks?.map(task => (
                    <div
                      key={task?.id}
                      className="bg-background rounded-xl border border-border hover:border-primary/30 transition-all duration-200 p-4"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            {task?.priority === 'high' && (
                              <div className="w-2 h-2 rounded-full bg-red-500" />
                            )}
                            <h4 className="text-sm font-semibold text-foreground">{task?.title}</h4>
                          </div>
                          {task?.description && (
                            <p className="text-xs text-muted-foreground">{task?.description}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="flex -space-x-2">
                            {task?.assignees?.map(assigneeId => {
                              const crew = getCrewMember(assigneeId);
                              return crew ? (
                                <img
                                  key={assigneeId}
                                  src={crew?.avatar}
                                  alt={crew?.alt || crew?.name}
                                  className="w-6 h-6 rounded-full border-2 border-card"
                                  title={crew?.name}
                                />
                              ) : null;
                            })}
                          </div>
                          <span className="text-xs text-muted-foreground">Due today</span>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleCompleteTask(task?.id, userId)}
                        >
                          <Icon name="Check" size={14} />
                        </Button>
                      </div>
                    </div>
                  ))}

                  {todayTasks?.length === 0 && (
                    <div className="text-center py-6 bg-background rounded-xl border border-border">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-2">
                        <Icon name="CheckCircle" size={20} className="text-primary" />
                      </div>
                      <p className="text-xs text-muted-foreground">No tasks for today</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* WIDGET B: Additional Jobs Board */}
          <div className="flex-shrink-0 w-[420px] snap-start">
            <div className="bg-card rounded-2xl border-2 border-border p-6 h-full min-h-[700px]">
              {/* Board Header */}
              <div className="mb-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold text-foreground mb-1">Additional Jobs</h2>
                    <p className="text-sm text-muted-foreground">Custom tasks for your team</p>
                  </div>
                  <button
                    onClick={() => setShowAddCardModal(true)}
                    className="w-8 h-8 rounded-lg bg-primary/10 hover:bg-primary/20 flex items-center justify-center transition-colors"
                  >
                    <Icon name="Plus" size={18} className="text-primary" />
                  </button>
                </div>
              </div>

              {/* Cards */}
              <div className="space-y-3">
                {customBoards?.[0]?.cards?.length > 0 ? (
                  customBoards?.[0]?.cards?.map(card => (
                    <div
                      key={card?.id}
                      className="bg-background rounded-xl border border-border hover:border-primary/30 transition-all duration-200 p-4"
                    >
                      <h4 className="text-sm font-semibold text-foreground mb-3">{card?.title}</h4>
                      {card?.assignees?.length > 0 && (
                        <div className="flex -space-x-2">
                          {card?.assignees?.map(assigneeId => {
                            const crew = getCrewMember(assigneeId);
                            return crew ? (
                              <img
                                key={assigneeId}
                                src={crew?.avatar}
                                alt={crew?.alt || crew?.name}
                                className="w-6 h-6 rounded-full border-2 border-card"
                                title={crew?.name}
                              />
                            ) : null;
                          })}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="text-center py-16">
                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                      <Icon name="Inbox" size={24} className="text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground mb-1">No tasks yet</p>
                    <p className="text-xs text-muted-foreground">Add a card to get started</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* User-Created Custom Boards */}
          {customBoards?.slice(1)?.map(board => (
            <div key={board?.id} className="flex-shrink-0 w-[420px] snap-start">
              <div className="bg-card rounded-2xl border-2 border-border p-6 h-full min-h-[700px]">
                {/* Board Header */}
                <div className="mb-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-2xl font-bold text-foreground mb-1">{board?.name}</h2>
                      {board?.description && (
                        <p className="text-sm text-muted-foreground">{board?.description}</p>
                      )}
                      <span className="inline-block mt-2 px-2 py-1 bg-primary/10 text-primary text-xs rounded-md font-medium">
                        {board?.type === 'interior' ? 'Interior Board' : 'HOD Board'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Cards */}
                <div className="space-y-3">
                  {board?.cards?.length > 0 ? (
                    board?.cards?.map(card => (
                      <div
                        key={card?.id}
                        className="bg-background rounded-xl border border-border hover:border-primary/30 transition-all duration-200 p-4"
                      >
                        <h4 className="text-sm font-semibold text-foreground mb-3">{card?.title}</h4>
                        {card?.assignees?.length > 0 && (
                          <div className="flex -space-x-2">
                            {card?.assignees?.map(assigneeId => {
                              const crew = getCrewMember(assigneeId);
                              return crew ? (
                                <img
                                  key={assigneeId}
                                  src={crew?.avatar}
                                  alt={crew?.alt || crew?.name}
                                  className="w-6 h-6 rounded-full border-2 border-card"
                                  title={crew?.name}
                                />
                              ) : null;
                            })}
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-16">
                      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                        <Icon name="Inbox" size={24} className="text-muted-foreground" />
                      </div>
                      <p className="text-sm text-muted-foreground">No tasks yet</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* WIDGET C: New Board Widget (Always Last) */}
          <div className="flex-shrink-0 w-[420px] snap-start">
            <div 
              onClick={() => setShowCreateBoardModal(true)}
              className="bg-card rounded-2xl border-2 border-dashed border-border hover:border-primary/50 p-6 h-full min-h-[700px] flex flex-col items-center justify-center cursor-pointer transition-all duration-200 group"
            >
              <div className="w-16 h-16 rounded-full bg-primary/10 group-hover:bg-primary/20 flex items-center justify-center mb-4 transition-colors">
                <Icon name="Plus" size={32} className="text-primary" />
              </div>
              <h3 className="text-xl font-bold text-foreground mb-1">New Board</h3>
              <p className="text-sm text-muted-foreground text-center">Create a custom board for your team</p>
            </div>
          </div>
        </div>
      </div>
      {/* Duty Set Detail Panel */}
      {selectedDutySet && (
        <DutySetDetailPanel
          dutySet={selectedDutySet}
          userId={userId}
          isChiefStew={hasFullAccess}
          getCrewMember={getCrewMember}
          onClose={handleCloseDutySetPanel}
          onToggleTask={handleCompleteDutySetTask}
        />
      )}
      {/* Create Board Modal */}
      {showCreateBoardModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border-2 border-border p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-foreground">Create Board</h2>
              <button
                onClick={() => setShowCreateBoardModal(false)}
                className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center transition-colors"
              >
                <Icon name="X" size={20} className="text-muted-foreground" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Board Name *</label>
                <input
                  type="text"
                  value={newBoardName}
                  onChange={(e) => setNewBoardName(e?.target?.value)}
                  placeholder="e.g. Deep Clean Week"
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Board Type</label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setNewBoardType('interior')}
                    className={`flex-1 px-4 py-2 rounded-lg border transition-all ${
                      newBoardType === 'interior' ? 'bg-primary text-white border-primary' : 'bg-background text-foreground border-border hover:border-primary/50'
                    }`}
                  >
                    Interior Board
                  </button>
                  <button
                    onClick={() => setNewBoardType('hod')}
                    className={`flex-1 px-4 py-2 rounded-lg border transition-all ${
                      newBoardType === 'hod' ? 'bg-primary text-white border-primary' : 'bg-background text-foreground border-border hover:border-primary/50'
                    }`}
                  >
                    HOD Board
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Description (Optional)</label>
                <textarea
                  value={newBoardDescription}
                  onChange={(e) => setNewBoardDescription(e?.target?.value)}
                  placeholder="Brief description of this board's purpose"
                  rows={3}
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <Button
                variant="outline"
                onClick={() => setShowCreateBoardModal(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateBoard}
                disabled={!newBoardName?.trim()}
                className="flex-1"
              >
                Create Board
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* Add Card Modal */}
      {showAddCardModal && (
        <ComprehensiveJobModal
          boards={boards}
          selectedDate={null}
          defaultBoardId={boards?.[0]?.id}
          activeTenantId={currentUser?.tenantId}
          currentUser={currentUser}
          onClose={() => setShowAddCardModal(false)}
          onSuccess={handleComprehensiveJobSuccess}
        />
      )}
    </div>
  );
};

export default DailyJobsList;