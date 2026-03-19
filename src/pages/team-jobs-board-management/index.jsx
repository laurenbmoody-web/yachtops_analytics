import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { hasCommandAccess, hasChiefAccess } from '../../utils/authStorage';
import { loadBoards } from '../team-jobs-management/utils/boardStorage';
import { loadCards, saveCards, createCard, updateCard, deleteCard, completeCard } from '../team-jobs-management/utils/cardStorage';
import { loadTeamMembers } from '../team-jobs-management/utils/teamStorage';
import CardDetailModal from '../team-jobs-management/components/CardDetailModal';

const TeamJobsBoardManagement = () => {
  const { boardId } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();

  // Check if user has Command or Chief access
  const hasFullAccess = currentUser && (hasCommandAccess(currentUser) || hasChiefAccess(currentUser));
  
  const [boards] = useState(() => loadBoards());
  const [cards, setCards] = useState(() => loadCards());
  const [teamMembers] = useState(() => loadTeamMembers());
  const [selectedCard, setSelectedCard] = useState(null);
  const [showCreateCard, setShowCreateCard] = useState(null); // column status
  const [draggedCard, setDraggedCard] = useState(null);

  // New card form
  const [newCardTitle, setNewCardTitle] = useState('');
  const [newCardDescription, setNewCardDescription] = useState('');
  const [newCardAssignees, setNewCardAssignees] = useState([]);
  const [newCardDueDate, setNewCardDueDate] = useState(new Date()?.toISOString()?.split('T')?.[0]);
  const [newCardPriority, setNewCardPriority] = useState('medium');

  const board = boards?.find(b => b?.id === boardId);
  const boardCards = cards?.filter(card => card?.boardId === boardId) || [];

  // Group cards by status
  const todayCards = boardCards?.filter(c => c?.status === 'today');
  const upcomingCards = boardCards?.filter(c => c?.status === 'upcoming');
  const completedCards = boardCards?.filter(c => c?.status === 'completed');

  const columns = [
    { id: 'today', title: 'Today', cards: todayCards, color: 'bg-blue-500' },
    { id: 'upcoming', title: 'Upcoming', cards: upcomingCards, color: 'bg-yellow-500' },
    { id: 'completed', title: 'Completed', cards: completedCards, color: 'bg-green-500' }
  ];

  // Handle create card
  const handleCreateCard = (status) => {
    if (!newCardTitle?.trim()) return;
    
    const newCard = createCard({
      boardId,
      title: newCardTitle,
      description: newCardDescription,
      assignees: newCardAssignees,
      dueDate: newCardDueDate,
      priority: newCardPriority,
      status
    }, currentUser?.id);
    
    const updatedCards = [...cards, newCard];
    setCards(updatedCards);
    saveCards(updatedCards);
    
    // Reset form
    setShowCreateCard(null);
    setNewCardTitle('');
    setNewCardDescription('');
    setNewCardAssignees([]);
    setNewCardDueDate(new Date()?.toISOString()?.split('T')?.[0]);
    setNewCardPriority('medium');
  };

  // Handle update card
  const handleUpdateCard = (cardId, updates) => {
    const updatedCards = updateCard(cards, cardId, updates, currentUser?.id);
    setCards(updatedCards);
    saveCards(updatedCards);
  };

  // Handle complete card
  const handleCompleteCard = (cardId, completedBy) => {
    const updatedCards = completeCard(cards, cardId, completedBy || currentUser?.id);
    setCards(updatedCards);
    saveCards(updatedCards);
  };

  // Handle delete card
  const handleDeleteCard = (cardId) => {
    const updatedCards = deleteCard(cards, cardId);
    setCards(updatedCards);
    saveCards(updatedCards);
  };

  // Handle move card to different column
  const handleMoveCard = (cardId, newStatus) => {
    handleUpdateCard(cardId, { status: newStatus });
  };

  // Drag and drop handlers
  const handleDragStart = (card) => {
    setDraggedCard(card);
  };

  const handleDragOver = (e) => {
    e?.preventDefault();
  };

  const handleDrop = (status) => {
    if (draggedCard && draggedCard?.status !== status) {
      handleMoveCard(draggedCard?.id, status);
    }
    setDraggedCard(null);
  };

  const getTeamMember = (id) => teamMembers?.find(m => m?.id === id);

  if (!board) {
    return (
      <div className="min-h-screen bg-background transition-colors duration-300">
        <Header />
        <main className="p-6 max-w-[1800px] mx-auto pt-24">
          <div className="text-center py-12">
            <h1 className="text-2xl font-semibold text-foreground mb-4">Board Not Found</h1>
            <Button onClick={() => navigate('/jobs')}>Back to Jobs</Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[1800px] mx-auto pt-24">
        <div className="mb-6">
          <Button variant="outline" iconName="ArrowLeft" onClick={() => navigate('/jobs')}>
            Back to Jobs
          </Button>
        </div>
        
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-semibold text-foreground">{board?.name}</h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
              {board?.boardType}
            </span>
          </div>
          {board?.description && (
            <p className="text-sm text-muted-foreground">{board?.description}</p>
          )}
        </div>

        {/* Kanban Board Columns */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {columns?.map(column => (
            <div 
              key={column?.id}
              className="bg-card rounded-xl border border-border p-4 min-h-[600px]"
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(column?.id)}
            >
              {/* Column Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${column?.color}`} />
                  <h2 className="text-lg font-semibold text-foreground">{column?.title}</h2>
                  <span className="text-sm text-muted-foreground">({column?.cards?.length})</span>
                </div>
              </div>

              {/* Cards */}
              <div className="space-y-3">
                {column?.cards?.map(card => (
                  <div
                    key={card?.id}
                    draggable={hasFullAccess}
                    onDragStart={() => handleDragStart(card)}
                    onClick={() => setSelectedCard(card)}
                    className="bg-background rounded-lg border border-border hover:border-primary/50 transition-all duration-200 p-4 cursor-pointer group"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h4 className="text-sm font-semibold text-foreground flex-1">{card?.title}</h4>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        card?.priority === 'high' ? 'bg-red-500/10 text-red-500' :
                        card?.priority === 'medium'? 'bg-yellow-500/10 text-yellow-500' : 'bg-blue-500/10 text-blue-500'
                      }`}>
                        {card?.priority}
                      </span>
                    </div>
                    {card?.description && (
                      <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{card?.description}</p>
                    )}
                    
                    {/* Labels */}
                    {card?.labels?.length > 0 && (
                      <div className="flex items-center gap-1 mb-3 flex-wrap">
                        {card?.labels?.slice(0, 3)?.map(label => (
                          <span key={label} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                            {label}
                          </span>
                        ))}
                        {card?.labels?.length > 3 && (
                          <span className="text-xs text-muted-foreground">+{card?.labels?.length - 3}</span>
                        )}
                      </div>
                    )}

                    {/* Checklist Progress */}
                    {card?.checklist?.length > 0 && (
                      <div className="mb-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                          <Icon name="CheckSquare" size={12} />
                          <span>
                            {card?.checklist?.filter(item => item?.completed)?.length}/{card?.checklist?.length}
                          </span>
                        </div>
                        <div className="h-1.5 bg-border rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-primary transition-all duration-300"
                            style={{ 
                              width: `${(card?.checklist?.filter(item => item?.completed)?.length / card?.checklist?.length) * 100}%` 
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Footer */}
                    <div className="flex items-center justify-between">
                      <div className="flex -space-x-2">
                        {card?.assignees?.slice(0, 3)?.map(assigneeId => {
                          const member = getTeamMember(assigneeId);
                          return member ? (
                            <img
                              key={assigneeId}
                              src={member?.avatar}
                              alt={member?.name}
                              className="w-6 h-6 rounded-full border-2 border-card"
                              title={member?.name}
                            />
                          ) : null;
                        })}
                        {card?.assignees?.length > 3 && (
                          <div className="w-6 h-6 rounded-full bg-muted border-2 border-card flex items-center justify-center">
                            <span className="text-xs font-medium text-muted-foreground">+{card?.assignees?.length - 3}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Icon name="Calendar" size={12} />
                        <span>{new Date(card?.dueDate)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      </div>
                    </div>

                    {/* Move buttons (visible on hover for Chief Stew) */}
                    {hasFullAccess && column?.id !== 'completed' && (
                      <div className="mt-3 pt-3 border-t border-border opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="flex gap-2">
                          {column?.id === 'today' && (
                            <button
                              onClick={(e) => {
                                e?.stopPropagation();
                                handleMoveCard(card?.id, 'upcoming');
                              }}
                              className="flex-1 text-xs px-2 py-1 bg-muted hover:bg-muted/80 rounded transition-smooth"
                            >
                              → Upcoming
                            </button>
                          )}
                          {column?.id === 'upcoming' && (
                            <button
                              onClick={(e) => {
                                e?.stopPropagation();
                                handleMoveCard(card?.id, 'today');
                              }}
                              className="flex-1 text-xs px-2 py-1 bg-muted hover:bg-muted/80 rounded transition-smooth"
                            >
                              ← Today
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e?.stopPropagation();
                              handleCompleteCard(card?.id, currentUser?.id);
                            }}
                            className="flex-1 text-xs px-2 py-1 bg-green-500/10 text-green-500 hover:bg-green-500/20 rounded transition-smooth"
                          >
                            ✓ Complete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {column?.cards?.length === 0 && (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    No cards in {column?.title?.toLowerCase()}
                  </div>
                )}
              </div>

              {/* Add Card Button */}
              {hasFullAccess && column?.id !== 'completed' && (
                <button
                  onClick={() => setShowCreateCard(column?.id)}
                  className="w-full mt-4 flex items-center justify-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-smooth border-2 border-dashed border-border hover:border-primary"
                >
                  <Icon name="Plus" size={16} />
                  Add Card
                </button>
              )}
            </div>
          ))}
        </div>
      </main>

      {/* Modals */}
      {selectedCard && (
        <CardDetailModal
          card={selectedCard}
          currentUser={currentUser}
          isChiefStew={hasFullAccess}
          teamMembers={teamMembers}
          onClose={() => setSelectedCard(null)}
          onComplete={handleCompleteCard}
          onUpdate={handleUpdateCard}
          onDelete={handleDeleteCard}
          onArchive={() => {}}
          onUnarchive={() => {}}
        />
      )}

      {/* Create Card Modal */}
      {showCreateCard && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl border border-border shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-foreground">Add Card</h2>
              <button
                onClick={() => {
                  setShowCreateCard(null);
                  setNewCardTitle('');
                  setNewCardDescription('');
                  setNewCardAssignees([]);
                  setNewCardDueDate(new Date()?.toISOString()?.split('T')?.[0]);
                  setNewCardPriority('medium');
                }}
                className="text-muted-foreground hover:text-foreground transition-smooth"
              >
                <Icon name="X" size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Title *</label>
                <input
                  type="text"
                  value={newCardTitle}
                  onChange={(e) => setNewCardTitle(e?.target?.value)}
                  placeholder="Enter card title"
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Description</label>
                <textarea
                  value={newCardDescription}
                  onChange={(e) => setNewCardDescription(e?.target?.value)}
                  placeholder="Enter description"
                  rows={3}
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Assign To</label>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {teamMembers?.filter(m => m?.department === 'Interior')?.map(member => (
                    <label key={member?.id} className="flex items-center gap-3 p-2 hover:bg-muted rounded-lg cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newCardAssignees?.includes(member?.id)}
                        onChange={(e) => {
                          if (e?.target?.checked) {
                            setNewCardAssignees(prev => [...prev, member?.id]);
                          } else {
                            setNewCardAssignees(prev => prev?.filter(id => id !== member?.id));
                          }
                        }}
                        className="w-4 h-4"
                      />
                      <img src={member?.avatar} alt={member?.name} className="w-6 h-6 rounded-full" />
                      <span className="text-sm text-foreground">{member?.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Due Date</label>
                  <input
                    type="date"
                    value={newCardDueDate}
                    onChange={(e) => setNewCardDueDate(e?.target?.value)}
                    className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Priority</label>
                  <select
                    value={newCardPriority}
                    onChange={(e) => setNewCardPriority(e?.target?.value)}
                    className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowCreateCard(null);
                  setNewCardTitle('');
                  setNewCardDescription('');
                  setNewCardAssignees([]);
                  setNewCardDueDate(new Date()?.toISOString()?.split('T')?.[0]);
                  setNewCardPriority('medium');
                }}
                className="flex-1 px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-smooth"
              >
                Cancel
              </button>
              <button
                onClick={() => handleCreateCard(showCreateCard)}
                disabled={!newCardTitle?.trim()}
                className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-smooth disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add Card
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeamJobsBoardManagement;