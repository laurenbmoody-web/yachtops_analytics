import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

import { exportAuditTrailCSV } from '../utils/cardStorage';
import { useRole } from '../../../contexts/RoleContext';
import { hasCommandAccess, hasChiefAccess, loadUsers } from '../../../utils/authStorage';
import { format } from 'date-fns';
import { canPerformAction, getDisabledTooltip } from '../utils/tierPermissions';

const CardDetailModal = ({ 
  card, 
  currentUser, 
  isChiefStew, 
  teamMembers, 
  onClose, 
  onComplete, 
  onUpdate, 
  onDelete,
  onArchive,
  onUnarchive,
  canFullEdit = false,
  canInteract = false,
  canComplete = false,
  canDelete = false,
  canReopen = false,
  canArchive = false,
  canUnarchive = false,
  modalMode = 'FULL', // 'FULL' | 'VIEW_ONLY'
}) => {
  const [editMode, setEditMode] = useState(false);
  const [editedTitle, setEditedTitle] = useState(card?.title || '');
  const [editedDescription, setEditedDescription] = useState(card?.description || '');
  const [editedAssignees, setEditedAssignees] = useState(card?.assignees || []);
  const [editedDueDate, setEditedDueDate] = useState(card?.dueDate?.split('T')?.[0] || '');
  const [editedPriority, setEditedPriority] = useState(card?.priority || 'medium');
  const [editedLabels, setEditedLabels] = useState(card?.labels || []);
  const [newLabel, setNewLabel] = useState('');
  const [checklist, setChecklist] = useState(card?.checklist || []);
  const [newChecklistItem, setNewChecklistItem] = useState('');
  const [notes, setNotes] = useState(card?.notes || []);
  const [newNote, setNewNote] = useState('');
  const [showAssistedCompletion, setShowAssistedCompletion] = useState(false);
  const [selectedCompletedBy, setSelectedCompletedBy] = useState(currentUser?.id);
  const [recurrence, setRecurrence] = useState(card?.recurrence || 'none');
  const [expandedAuditEntry, setExpandedAuditEntry] = useState(null);
  const [metadataExpanded, setMetadataExpanded] = useState(false);
  const [editedDepartment, setEditedDepartment] = useState(card?.department || '');
  
  const { userRole } = useRole();

  // Normalize role to uppercase for consistent comparison
  const role = userRole?.toUpperCase();
  
  // Role-based permissions
  const isCrew = role === 'CREW';
  const isHOD = role === 'HOD';
  const isAdmin = role === 'ADMIN';
  const currentUserRole = currentUser?.role?.toUpperCase();
  const canViewFullAudit = isHOD || isAdmin || currentUserRole === 'CHIEF_STEW' || hasCommandAccess(currentUser) || hasChiefAccess(currentUser);

  // Get user capabilities - MOVE BEFORE ANY USAGE
  const canEditCoreFields = modalMode === 'FULL' && canPerformAction(currentUser, card, 'editCoreFields');
  const canAddNotes = modalMode === 'FULL' && canPerformAction(currentUser, card, 'addNotes');
  const canCompleteAction = modalMode === 'FULL' && canPerformAction(currentUser, card, 'complete');

  // Helper function to resolve creator information from users store
  const getCreatorInfo = () => {
    if (!card?.createdByUserId) {
      return {
        name: 'Unknown User',
        tier: '—',
        department: '—'
      };
    }

    // Normalize IDs as strings for comparison
    const creatorId = String(card?.createdByUserId);
    const users = loadUsers();
    const creator = users?.find(u => String(u?.id) === creatorId);

    if (creator) {
      // User found - return actual user information
      return {
        name: creator?.fullName || creator?.name || 'Unknown User',
        tier: creator?.effectiveTier || creator?.tier || '—',
        department: creator?.department || '—'
      };
    } else {
      // User not found (deleted/missing) but ID exists
      return {
        name: 'Former user',
        tier: card?.createdByRoleTier || '—',
        department: card?.createdByDepartment || '—'
      };
    }
  };

  // Get resolved creator info
  const creatorInfo = getCreatorInfo();

  // Helper function to get user name from ID
  const getUserNameById = (userId) => {
    if (!userId) return null;
    const users = loadUsers();
    const user = users?.find(u => u?.id === userId);
    return user?.name || null;
  };

  // Helper function to format date
  const formatDate = (dateString) => {
    if (!dateString) return null;
    try {
      return format(new Date(dateString), 'MMM dd, yyyy HH:mm');
    } catch (e) {
      return null;
    }
  };

  // Add this block - Helper function to get department name
  const getDepartmentName = (dept) => {
    if (!dept) return null;
    const deptMap = {
      'INTERIOR': 'Interior',
      'DECK': 'Deck',
      'ENGINEERING': 'Engineering',
      'GALLEY': 'Galley'
    };
    return deptMap?.[dept?.toUpperCase()] || dept;
  };

  // Add this block - Helper function to get assigned user name
  const getAssignedUserName = () => {
    const userId = card?.assigned_to || card?.assignees?.[0];
    if (!userId) return null;
    const users = loadUsers();
    const user = users?.find(u => u?.id === userId);
    return user?.name || user?.fullName || null;
  };

  const getTeamMember = (id) => teamMembers?.find(m => m?.id === id);

  // Filter audit trail based on role
  const getFilteredAuditTrail = () => {
    if (!card?.auditTrail) return [];
    
    if (isCrew) {
      // Crew: only comments and completion events
      return card?.auditTrail?.filter(entry => 
        entry?.eventType === 'note_added' || 
        entry?.eventType === 'completed' ||
        entry?.eventType === 'reopened'
      );
    }
    
    // HOD and Admin: full audit trail
    return card?.auditTrail;
  };

  // Convert audit entry to human-readable format
  const getHumanReadableAction = (entry) => {
    const actorName = entry?.actorName || 'Unknown User';
    
    switch (entry?.eventType) {
      case 'created':
        return `created this job`;
      case 'completed':
        return `marked job completed`;
      case 'reopened':
        return `reopened this job`;
      case 'note_added':
        return `added a comment`;
      case 'updated':
        if (entry?.changes?.length > 0) {
          const fields = entry?.changes?.map(c => c?.field)?.join(', ');
          return `updated ${fields}`;
        }
        return `made changes`;
      case 'checklist_item_checked':
        return `checked a checklist item`;
      case 'checklist_item_unchecked':
        return `unchecked a checklist item`;
      case 'assignee_changed':
        return `changed assignment`;
      case 'due_date_changed':
        return `changed due date`;
      case 'priority_changed':
        return `changed priority`;
      default:
        return entry?.eventType?.replace(/_/g, ' ');
    }
  };

  const toggleExpandEntry = (entryId) => {
    setExpandedAuditEntry(expandedAuditEntry === entryId ? null : entryId);
  };

  const handleSaveEdit = () => {
    if (!canEditCoreFields) {
      alert('You do not have permission to edit core fields of this job');
      return;
    }
    onUpdate(card?.id, {
      title: editedTitle,
      description: editedDescription,
      assignees: editedAssignees,
      dueDate: editedDueDate,
      priority: editedPriority,
      labels: editedLabels,
      department: editedDepartment,
      recurrence
    });
    setEditMode(false);
  };

  const handleChecklistToggle = (itemId) => {
    if (!canInteract) {
      alert('You do not have permission to interact with this job');
      return;
    }
    const updatedChecklist = checklist?.map(item => 
      item?.id === itemId ? { ...item, completed: !item?.completed } : item
    );
    setChecklist(updatedChecklist);
    onUpdate(card?.id, { checklist: updatedChecklist });
  };

  const handleAddChecklistItem = () => {
    if (!newChecklistItem?.trim()) return;
    if (!canInteract) {
      alert('You do not have permission to interact with this job');
      return;
    }
    const newItem = {
      id: crypto.randomUUID(),
      text: newChecklistItem,
      completed: false
    };
    const updatedChecklist = [...checklist, newItem];
    setChecklist(updatedChecklist);
    onUpdate(card?.id, { checklist: updatedChecklist });
    setNewChecklistItem('');
  };

  const handleRemoveChecklistItem = (itemId) => {
    if (!canInteract) {
      alert('You do not have permission to interact with this job');
      return;
    }
    const updatedChecklist = checklist?.filter(item => item?.id !== itemId);
    setChecklist(updatedChecklist);
    onUpdate(card?.id, { checklist: updatedChecklist });
  };

  const handleAddNote = () => {
    if (!newNote?.trim()) return;
    if (!canInteract) {
      alert('You do not have permission to add notes to this job');
      return;
    }
    const note = {
      id: crypto.randomUUID(),
      text: newNote,
      author: currentUser?.name,
      authorId: currentUser?.id,
      timestamp: new Date()?.toISOString()
    };
    const updatedNotes = [...notes, note];
    setNotes(updatedNotes);
    onUpdate(card?.id, { notes: updatedNotes });
    setNewNote('');
  };

  const handleExportAudit = () => {
    const csv = exportAuditTrailCSV(card);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL?.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-trail-${card?.title?.replace(/\s+/g, '-')}-${new Date()?.toISOString()?.split('T')?.[0]}.csv`;
    document.body?.appendChild(a);
    a?.click();
    document.body?.removeChild(a);
    window.URL?.revokeObjectURL(url);
  };

  const handleAddLabel = () => {
    if (!newLabel?.trim() || editedLabels?.includes(newLabel?.trim())) return;
    setEditedLabels(prev => [...prev, newLabel?.trim()]);
    setNewLabel('');
  };

  const handleRemoveLabel = (label) => {
    setEditedLabels(prev => prev?.filter(l => l !== label));
  };

  const handleComplete = () => {
    if (showAssistedCompletion) {
      onComplete(card?.id, selectedCompletedBy);
    } else {
      onComplete(card?.id, currentUser?.id);
    }
    
    // Trigger dashboard activity refresh
    window.dispatchEvent(new CustomEvent('activityUpdated'));
    
    onClose();
  };

  const handleDelete = () => {
    if (confirm('Delete this card?')) {
      onDelete(card?.id);
      onClose();
    }
  };

  const handleArchive = () => {
    if (confirm('Archive this job? It will be hidden from the main view.')) {
      onArchive(card?.id);
      onClose();
    }
  };

  const handleUnarchive = () => {
    onUnarchive(card?.id);
    onClose();
  };

  const completedCount = checklist?.filter(item => item?.completed)?.length || 0;
  const totalCount = checklist?.length || 0;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  const filteredAuditTrail = getFilteredAuditTrail();

  return (
    <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4" onClick={onClose}>
      <div 
        className="bg-card rounded-xl border border-border shadow-lg max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e?.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-card border-b border-border p-5 flex items-start justify-between">
          <div className="flex-1">
            {editMode ? (
              <input
                type="text"
                value={editedTitle}
                onChange={(e) => setEditedTitle(e?.target?.value)}
                className="w-full text-xl font-semibold text-foreground bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
              />
            ) : (
              <h2 className="text-xl font-semibold text-foreground mb-2">{card?.title}</h2>
            )}
            <div className="flex items-center gap-3 mt-2">
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                editMode ? editedPriority === 'high' : card?.priority === 'high' ? 'bg-red-500/10 text-red-500' :
                editMode ? editedPriority === 'medium' : card?.priority === 'medium' ? 'bg-yellow-500/10 text-yellow-500' : 'bg-blue-500/10 text-blue-500'
              }`}>
                {editMode ? editedPriority : card?.priority}
              </span>
              {card?.status === 'completed' && (
                <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-green-500/10 text-green-500">
                  Completed
                </span>
              )}
              {/* VIEW_ONLY badge */}
              {modalMode === 'VIEW_ONLY' && (
                <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-muted text-muted-foreground">
                  View Only
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Edit button — only in FULL mode, not for rotation jobs */}
            {modalMode === 'FULL' && canFullEdit && !editMode && card?.status !== 'completed' && card?.source !== 'rotation' && (
              <button
                onClick={() => setEditMode(true)}
                className="p-2 hover:bg-muted rounded-lg transition-smooth"
                title="Edit"
              >
                <Icon name="Edit2" size={18} className="text-muted-foreground" />
              </button>
            )}
            {/* Delete button — only in FULL mode */}
            {modalMode === 'FULL' && canDelete && (
              <button
                onClick={handleDelete}
                className="p-2 hover:bg-red-500/10 rounded-lg transition-smooth"
                title="Delete"
              >
                <Icon name="Trash2" size={18} className="text-red-500" />
              </button>
            )}
            {/* Archive button — only in FULL mode */}
            {modalMode === 'FULL' && canArchive && !card?.isArchived && (
              <button
                onClick={handleArchive}
                className="p-2 hover:bg-muted/10 rounded-lg transition-smooth"
                title="Archive"
              >
                <Icon name="Archive" size={18} className="text-muted-foreground" />
              </button>
            )}
            {modalMode === 'FULL' && canUnarchive && card?.isArchived && (
              <button
                onClick={handleUnarchive}
                className="p-2 hover:bg-primary/10 rounded-lg transition-smooth"
                title="Unarchive"
              >
                <Icon name="ArchiveRestore" size={18} className="text-muted-foreground" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 hover:bg-muted rounded-lg transition-smooth"
            >
              <Icon name="X" size={18} className="text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Collapsible Job Metadata Section */}
          <div className="border border-border rounded-lg overflow-hidden">
            {/* Metadata Header - Always Visible */}
            <button
              onClick={() => setMetadataExpanded(!metadataExpanded)}
              className="w-full flex items-center justify-between p-4 bg-muted/30 hover:bg-muted/50 transition-smooth"
            >
              <div className="flex items-center gap-2">
                <Icon name="Info" size={16} className="text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">Job metadata</h3>
              </div>
              <div className="flex items-center gap-3">
                {/* Compact Summary Line (when collapsed) */}
                {!metadataExpanded && (
                  <span className="text-xs text-muted-foreground truncate max-w-md">
                    Created by {creatorInfo?.name} ({creatorInfo?.tier}) • Dept: {getDepartmentName(card?.department) || getDepartmentName(card?.department_id) || '—'} • Status: {card?.status?.replace(/_/g, ' ') || '—'}
                  </span>
                )}
                <Icon 
                  name={metadataExpanded ? "ChevronUp" : "ChevronDown"} 
                  size={16} 
                  className="text-muted-foreground flex-shrink-0"
                />
              </div>
            </button>

            {/* Expanded Metadata Content */}
            {metadataExpanded && (
              <div className="p-5 bg-muted/10 border-t border-border">
                <div className="space-y-3 text-sm">
                  {/* Creator Info */}
                  <div className="flex items-start gap-2">
                    <span className="text-muted-foreground min-w-[140px]">Created by:</span>
                    <span className="text-foreground font-medium">
                      {creatorInfo?.name}
                      {creatorInfo?.tier && (
                        <span className="text-muted-foreground font-normal">
                          {' '}(Role: {creatorInfo?.tier}
                          {creatorInfo?.department && `, Dept: ${creatorInfo?.department}`})
                        </span>
                      )}
                    </span>
                  </div>

                  {/* Created At */}
                  <div className="flex items-start gap-2">
                    <span className="text-muted-foreground min-w-[140px]">Created at:</span>
                    <span className="text-foreground">
                      {card?.createdAt ? formatDate(card?.createdAt) : '—'}
                    </span>
                  </div>

                  {/* Assigned Department */}
                  <div className="flex items-start gap-2">
<span className="text-muted-foreground min-w-[140px]">Assigned department:</span>
                    <span className="text-foreground font-medium">
                      {getDepartmentName(card?.department) || getDepartmentName(card?.department_id) || '—'}
                    </span>
                  </div>

                  {/* Status */}
                  <div className="flex items-start gap-2">
                    <span className="text-muted-foreground min-w-[140px]">Status:</span>
                    <span className="text-foreground">
                      {card?.status ? (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                          card?.status === 'active' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                          card?.status === 'pending_acceptance' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
                          card?.status === 'declined' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                          card?.status === 'completed'? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
                        }`}>
                          {card?.status?.replace(/_/g, ' ')}
                        </span>
                      ) : '—'}
                    </span>
                  </div>

                  {/* Pending For Department (only if status is pending_acceptance) */}
                  {card?.status === 'pending_acceptance' && card?.pendingForDepartment && (
                    <div className="flex items-start gap-2">
                      <span className="text-muted-foreground min-w-[140px]">Pending for:</span>
                      <span className="text-foreground font-medium">
                        {card?.pendingForDepartment}
                      </span>
                    </div>
                  )}

                  {/* Decision Info */}
                  {(card?.status === 'active' || card?.status === 'declined') && card?.decidedByUserId && (
                    <div className="flex items-start gap-2">
                      <span className="text-muted-foreground min-w-[140px]">Decision:</span>
                      <div className="text-foreground">
                        {card?.status === 'active' && (
                          <span>
                            Accepted by <span className="font-medium">{getUserNameById(card?.decidedByUserId) || '—'}</span>
                            {card?.decidedAt && (
                              <span className="text-muted-foreground"> at {formatDate(card?.decidedAt)}</span>
                            )}
                          </span>
                        )}
                        {card?.status === 'declined' && (
                          <span>
                            Declined by <span className="font-medium">{getUserNameById(card?.decidedByUserId) || '—'}</span>
                            {card?.decidedAt && (
                              <span className="text-muted-foreground"> at {formatDate(card?.decidedAt)}</span>
                            )}
                          </span>
                        )}
                        {card?.decisionNotes && (
                          <div className="mt-2 p-3 bg-background border border-border rounded-lg">
                            <span className="text-xs text-muted-foreground block mb-1">Notes:</span>
                            <span className="text-sm">{card?.decisionNotes}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Withdrawn Info (if status indicates withdrawn - future-proofing) */}
                  {card?.withdrawnByUserId && (
                    <div className="flex items-start gap-2">
                      <span className="text-muted-foreground min-w-[140px]">Decision:</span>
                      <div className="text-foreground">
                        <span>
                          Withdrawn by <span className="font-medium">{getUserNameById(card?.withdrawnByUserId) || '—'}</span>
                          {card?.withdrawnAt && (
                            <span className="text-muted-foreground"> at {formatDate(card?.withdrawnAt)}</span>
                          )}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
              <Icon name="AlignLeft" size={16} />
              Description
            </h3>
            {editMode && canEditCoreFields ? (
              <textarea
                value={editedDescription}
                onChange={(e) => setEditedDescription(e?.target?.value)}
                placeholder="Add a description..."
                rows={3}
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
            ) : (
              <p className="text-sm text-muted-foreground">{card?.description || 'No description'}</p>
            )}
            {editMode && !canEditCoreFields && (
              <p className="text-xs text-muted-foreground mt-1">
                {getDisabledTooltip(currentUser, 'editCoreFields')}
              </p>
            )}
          </div>

          {/* Department */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
              <Icon name="Building" size={16} />
              Department
            </h3>
            {editMode && canEditCoreFields ? (
              <select
                value={editedDepartment}
                onChange={(e) => setEditedDepartment(e?.target?.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground"
              >
                <option value="INTERIOR">Interior</option>
                <option value="DECK">Deck</option>
                <option value="ENGINEERING">Engineering</option>
                <option value="GALLEY">Galley</option>
              </select>
            ) : (
              <p className="text-sm text-muted-foreground">{getDepartmentName(card?.department) || getDepartmentName(card?.department_id) || 'No department'}</p>
            )}
            {editMode && !canEditCoreFields && (
              <p className="text-xs text-muted-foreground mt-1">
                {getDisabledTooltip(currentUser, 'editCoreFields')}
              </p>
            )}
          </div>

          {/* Assignees */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Icon name="Users" size={16} />
              Assigned To
            </h3>
            {editMode && canEditCoreFields ? (
              <div className="space-y-2 max-h-40 overflow-y-auto bg-background rounded-lg border border-border p-3">
                {teamMembers?.filter(m => m?.department === card?.department)?.map(member => (
                  <label key={member?.id} className="flex items-center gap-3 p-2 hover:bg-muted rounded-lg cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editedAssignees?.includes(member?.id)}
                      onChange={(e) => {
                        if (e?.target?.checked) {
                          setEditedAssignees(prev => [...prev, member?.id]);
                        } else {
                          setEditedAssignees(prev => prev?.filter(id => id !== member?.id));
                        }
                      }}
                      className="w-4 h-4"
                    />
                    <img src={member?.avatar} alt={member?.name} className="w-6 h-6 rounded-full" />
                    <span className="text-sm text-foreground">{member?.name}</span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                {/* Try to show resolved name from assigned_to or assignees */}
                {(() => {
                  const resolvedName = getAssignedUserName();
                  if (resolvedName) {
                    return (
                      <div className="flex items-center gap-2 bg-muted px-3 py-1.5 rounded-lg">
                        <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center">
                          <Icon name="User" size={12} className="text-primary" />
                        </div>
                        <span className="text-sm text-foreground">{resolvedName}</span>
                      </div>
                    );
                  }
                  // Fallback: try teamMembers lookup for each assignee
                  const assigneeIds = card?.assignees?.length > 0 ? card?.assignees : (card?.assigned_to ? [card?.assigned_to] : []);
                  const resolvedMembers = assigneeIds?.map(id => getTeamMember(id))?.filter(Boolean);
                  if (resolvedMembers?.length > 0) {
                    return resolvedMembers?.map(member => (
                      <div key={member?.id} className="flex items-center gap-2 bg-muted px-3 py-1.5 rounded-lg">
                        {member?.avatar ? (
                          <img src={member?.avatar} alt={member?.name} className="w-5 h-5 rounded-full" />
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center">
                            <Icon name="User" size={12} className="text-primary" />
                          </div>
                        )}
                        <span className="text-sm text-foreground">{member?.name}</span>
                      </div>
                    ));
                  }
                  return <span className="text-sm text-muted-foreground">No assignees</span>;
                })()}
              </div>
            )}
            {editMode && !canEditCoreFields && (
              <p className="text-xs text-muted-foreground mt-1">
                {getDisabledTooltip(currentUser, 'editCoreFields')}
              </p>
            )}
          </div>

          {/* Due Date & Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                <Icon name="Calendar" size={16} />
                Due Date
              </h3>
              {editMode && canFullEdit ? (
                <input
                  type="date"
                  value={editedDueDate}
                  onChange={(e) => setEditedDueDate(e?.target?.value)}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {new Date(card?.dueDate)?.toLocaleDateString()}
                </p>
              )}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                <Icon name="Flag" size={16} />
                Priority
              </h3>
              {editMode && canFullEdit ? (
                <select
                  value={editedPriority}
                  onChange={(e) => setEditedPriority(e?.target?.value)}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              ) : (
                <p className="text-sm text-muted-foreground capitalize">{card?.priority}</p>
              )}
            </div>
          </div>

          {/* Recurrence */}
          {editMode && canFullEdit && (
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                <Icon name="Repeat" size={16} />
                Recurrence
              </h3>
              <select
                value={recurrence}
                onChange={(e) => setRecurrence(e?.target?.value)}
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="none">None</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          )}

          {/* Labels */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
              <Icon name="Tag" size={16} />
              Labels
            </h3>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              {editedLabels?.map(label => (
                <span key={label} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
                  {label}
                  {editMode && canFullEdit && (
                    <button onClick={() => handleRemoveLabel(label)} className="hover:text-primary/70">
                      <Icon name="X" size={12} />
                    </button>
                  )}
                </span>
              ))}
              {editedLabels?.length === 0 && !editMode && (
                <span className="text-sm text-muted-foreground">No labels</span>
              )}
            </div>
            {editMode && canFullEdit && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e?.target?.value)}
                  onKeyPress={(e) => e?.key === 'Enter' && handleAddLabel()}
                  placeholder="Add label..."
                  className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <Button size="sm" onClick={handleAddLabel} iconName="Plus">
                  Add
                </Button>
              </div>
            )}
          </div>

          {/* Checklist */}
          {(checklist?.length > 0 || (editMode && canInteract)) && (
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <Icon name="CheckSquare" size={16} />
                Checklist
                {totalCount > 0 && (
                  <span className="text-xs text-muted-foreground ml-auto">
                    {completedCount}/{totalCount}
                  </span>
                )}
              </h3>
              
              {/* Progress Bar */}
              {totalCount > 0 && (
                <div className="w-full bg-muted rounded-full h-2 mb-3">
                  <div 
                    className="bg-primary h-2 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
              
              {/* Checklist Items */}
              <div className="space-y-2 mb-3">
                {checklist?.map(item => (
                  <label key={item?.id} className="flex items-center gap-3 p-2 hover:bg-muted rounded-lg cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={item?.completed}
                      onChange={() => handleChecklistToggle(item?.id)}
                      disabled={!canInteract}
                      className="w-4 h-4"
                    />
                    <span className={`text-sm flex-1 ${
                      item?.completed ? 'line-through text-muted-foreground' : 'text-foreground'
                    }`}>
                      {item?.text}
                    </span>
                    {canInteract && (
                      <button
                        onClick={(e) => {
                          e?.preventDefault();
                          handleRemoveChecklistItem(item?.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Icon name="X" size={14} className="text-muted-foreground hover:text-foreground" />
                      </button>
                    )}
                  </label>
                ))}
              </div>
              
              {/* Add Checklist Item */}
              {canInteract && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newChecklistItem}
                    onChange={(e) => setNewChecklistItem(e?.target?.value)}
                    onKeyPress={(e) => e?.key === 'Enter' && handleAddChecklistItem()}
                    placeholder="Add checklist item..."
                    className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <button
                    onClick={handleAddChecklistItem}
                    className="px-3 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-smooth"
                  >
                    <Icon name="Plus" size={16} />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Notes section */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Icon name="MessageSquare" size={16} />
              Notes
            </h3>
            <div className="space-y-3">
              {notes?.map(note => (
                <div key={note?.id} className="bg-muted/30 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-foreground">{note?.author}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(note?.timestamp)}</span>
                  </div>
                  <p className="text-sm text-foreground">{note?.text}</p>
                </div>
              ))}
              {/* Add note input — only in FULL mode and when canAddNotes */}
              {modalMode === 'FULL' && canAddNotes && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newNote}
                    onChange={(e) => setNewNote(e?.target?.value)}
                    placeholder="Add a note..."
                    className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    onKeyDown={(e) => { if (e?.key === 'Enter') { e?.preventDefault(); handleAddNote(); } }}
                  />
                  <button
                    onClick={handleAddNote}
                    disabled={!newNote?.trim()}
                    className="px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    Add
                  </button>
                </div>
              )}
              {modalMode === 'VIEW_ONLY' && notes?.length === 0 && (
                <p className="text-sm text-muted-foreground italic">No notes yet.</p>
              )}
            </div>
          </div>

          {/* Refactored Audit Trail - Collapsed Human-Readable Activity Log */}
          {filteredAuditTrail?.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Icon name="Activity" size={16} />
                  Activity Log
                </h3>
                {isAdmin && (
                  <button
                    onClick={handleExportAudit}
                    className="text-xs px-2.5 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-smooth flex items-center gap-1"
                    title="Export Audit Trail"
                  >
                    <Icon name="Download" size={12} />
                    Export
                  </button>
                )}
              </div>

              <div className="space-y-2">
                {filteredAuditTrail?.map((entry) => {
                  const actorUser = getTeamMember(entry?.actorId);
                  const actorName = entry?.actorName || actorUser?.name || 'Unknown User';
                  const actorAvatar = actorUser?.avatar || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(actorName);
                  const isExpanded = expandedAuditEntry === entry?.id;
                  const humanAction = getHumanReadableAction(entry);
                  
                  const formattedDate = new Date(entry?.timestamp)?.toLocaleString('en-GB', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                  })?.replace(',', ' –');

                  return (
                    <div key={entry?.id} className="border border-border rounded-lg overflow-hidden">
                      {/* Collapsed View - Single Line Entry */}
                      <button
                        onClick={() => canViewFullAudit && toggleExpandEntry(entry?.id)}
                        className={`w-full flex items-center gap-3 p-3 text-left transition-smooth ${
                          canViewFullAudit ? 'hover:bg-muted/30 cursor-pointer' : 'cursor-default'
                        } ${isExpanded ? 'bg-muted/20' : 'bg-transparent'}`}
                      >
                        {/* Actor Avatar */}
                        <img 
                          src={actorAvatar} 
                          alt={actorName}
                          className="w-8 h-8 rounded-full flex-shrink-0"
                        />
                        
                        {/* Activity Description */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground">
                            <span className="font-medium">{actorName}</span>
                            {' '}
                            <span className="text-muted-foreground">{humanAction}</span>
                          </p>
                        </div>
                        
                        {/* Timestamp */}
                        <span className="text-xs text-muted-foreground flex-shrink-0">
                          {formattedDate}
                        </span>
                        
                        {/* Expand Indicator */}
                        {canViewFullAudit && (
                          <Icon 
                            name={isExpanded ? "ChevronUp" : "ChevronDown"} 
                            size={16} 
                            className="text-muted-foreground flex-shrink-0"
                          />
                        )}
                      </button>

                      {/* Expanded View - Detailed Change History */}
                      {isExpanded && canViewFullAudit && (
                        <div className="border-t border-border bg-muted/10 p-4 space-y-3">
                          {/* Metadata */}
                          <div className="grid grid-cols-2 gap-3 text-xs">
                            <div>
                              <span className="text-muted-foreground">Event Type:</span>
                              <span className="ml-2 text-foreground font-medium uppercase">
                                {entry?.eventType?.replace(/_/g, ' ')}
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Actor ID:</span>
                              <span className="ml-2 text-foreground font-mono text-[10px]">
                                {entry?.actorId}
                              </span>
                            </div>
                          </div>

                          {/* Field-Level Changes */}
                          {entry?.changes && entry?.changes?.length > 0 && (
                            <div className="space-y-2">
                              <h4 className="text-xs font-semibold text-foreground">Detailed Changes:</h4>
                              {entry?.changes?.map((change, idx) => (
                                <div key={idx} className="bg-background rounded-lg p-3 border border-border">
                                  <div className="text-xs font-medium text-foreground mb-2 capitalize">
                                    {change?.field?.replace(/_/g, ' ')}
                                  </div>
                                  <div className="grid grid-cols-2 gap-3 text-xs">
                                    <div>
                                      <div className="text-muted-foreground mb-1">Before:</div>
                                      <div className="text-red-600 dark:text-red-400 font-mono text-[11px] break-words bg-red-50 dark:bg-red-950/20 p-2 rounded">
                                        {change?.oldValue === null || change?.oldValue === undefined ? '(empty)' : 
                                         typeof change?.oldValue === 'object' ? JSON.stringify(change?.oldValue, null, 2) : 
                                         String(change?.oldValue)}
                                      </div>
                                    </div>
                                    <div>
                                      <div className="text-muted-foreground mb-1">After:</div>
                                      <div className="text-green-600 dark:text-green-400 font-mono text-[11px] break-words bg-green-50 dark:bg-green-950/20 p-2 rounded">
                                        {change?.newValue === null || change?.newValue === undefined ? '(empty)' : 
                                         typeof change?.newValue === 'object' ? JSON.stringify(change?.newValue, null, 2) : 
                                         String(change?.newValue)}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Integrity Hash Chain */}
                          <div className="pt-2 border-t border-border">
                            <div className="flex items-center gap-4 text-[10px]">
                              <div className="flex items-center gap-1">
                                <span className="text-muted-foreground">Hash:</span>
                                <code className="text-primary font-mono">{entry?.hash}</code>
                              </div>
                              {entry?.prevHash && (
                                <div className="flex items-center gap-1">
                                  <span className="text-muted-foreground">Previous:</span>
                                  <code className="text-muted-foreground font-mono">{entry?.prevHash}</code>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="border-t border-border p-5 flex items-center justify-between gap-3">
          {/* Complete button — only in FULL mode */}
          {modalMode === 'FULL' && canCompleteAction && card?.status !== 'completed' && (
            <button
              onClick={handleComplete}
              className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Icon name="Check" size={16} />
              Mark Complete
            </button>
          )}
          {modalMode === 'FULL' && canReopen && card?.status === 'completed' && (
            <button
              onClick={() => {
                onUpdate(card?.id, { status: 'today', completedBy: null, completedAt: null });
                onClose();
              }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Icon name="RotateCcw" size={16} />
              Reopen Job
            </button>
          )}
          {/* Save edit button */}
          {modalMode === 'FULL' && editMode && (
            <button
              onClick={handleSaveEdit}
              className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-medium transition-colors"
            >
              <Icon name="Save" size={16} />
              Save Changes
            </button>
          )}
          {modalMode === 'FULL' && editMode && (
            <button
              onClick={() => setEditMode(false)}
              className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          )}
          <div className="ml-auto">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-border rounded-lg text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CardDetailModal;