import React, { useState } from 'react';
import { dateLocale } from '../../../utils/dateFormat';
import Icon from '../../../components/AppIcon';
import ModalShell from '../../../components/ui/ModalShell';
import '../job-modals.css';
import '../../duty-sets-rotation-management/duty-sets.css';

import { exportAuditTrailCSV } from '../utils/cardStorage';
import { useRole } from '../../../contexts/RoleContext';
import { hasCommandAccess, hasChiefAccess, loadUsers } from '../../../utils/authStorage';
import { format } from 'date-fns';
import { canPerformAction, getDisabledTooltip } from '../utils/tierPermissions';

// Priority / status → the shared jm-tag tones used across the Jobs modals
const priorityTagTone = (priority) => {
  switch (priority) {
    case 'high': return 'danger';
    case 'medium': return 'warn';
    case 'low': return 'success';
    default: return '';
  }
};
const statusTagTone = (status) => {
  switch (status) {
    case 'active': return 'success';
    case 'pending_acceptance': return 'warn';
    case 'declined': return 'danger';
    case 'completed': return 'navy';
    default: return '';
  }
};

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

  const displayPriority = editMode ? editedPriority : card?.priority;

  return (
    <ModalShell onClose={onClose} panelClassName="jm-panel lg">
      {/* Header */}
      <div className="jm-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="jm-eyebrow">Job</p>
          {editMode ? (
            <input
              type="text"
              className="jm-titlefield"
              value={editedTitle}
              onChange={(e) => setEditedTitle(e?.target?.value)}
            />
          ) : (
            <h2 className="jm-title">{card?.title}</h2>
          )}
          <div className="cd-tags">
            {displayPriority && (
              <span className={`jm-tag ${priorityTagTone(displayPriority)}`}>{displayPriority} priority</span>
            )}
            {card?.status === 'completed' && <span className="jm-tag success">Completed</span>}
            {modalMode === 'VIEW_ONLY' && <span className="jm-tag">View only</span>}
          </div>
        </div>
        <div className="cd-headactions">
          {modalMode === 'FULL' && canFullEdit && !editMode && card?.status !== 'completed' && card?.source !== 'rotation' && (
            <button onClick={() => setEditMode(true)} className="jm-x" title="Edit job">
              <Icon name="Pencil" size={16} />
            </button>
          )}
          {modalMode === 'FULL' && canDelete && (
            <button onClick={handleDelete} className="jm-x danger" title="Delete job">
              <Icon name="Trash2" size={16} />
            </button>
          )}
          {modalMode === 'FULL' && canArchive && !card?.isArchived && (
            <button onClick={handleArchive} className="jm-x" title="Archive job">
              <Icon name="Archive" size={16} />
            </button>
          )}
          {modalMode === 'FULL' && canUnarchive && card?.isArchived && (
            <button onClick={handleUnarchive} className="jm-x" title="Unarchive job">
              <Icon name="ArchiveRestore" size={16} />
            </button>
          )}
          <button onClick={onClose} className="jm-x" title="Close">
            <Icon name="X" size={18} />
          </button>
        </div>
      </div>

      <div className="jm-body">
        {/* ── Metadata (collapsible) ── */}
        <div className="cd-meta">
          <button onClick={() => setMetadataExpanded(!metadataExpanded)} className="cd-meta-head">
            <span className="jm-secthead" style={{ margin: 0 }}>
              <Icon name="Info" size={14} />
              Job metadata
            </span>
            {!metadataExpanded && (
              <span className="cd-meta-summary">
                {creatorInfo?.name} · {getDepartmentName(card?.department) || getDepartmentName(card?.department_id) || '—'} · {card?.status?.replace(/_/g, ' ') || '—'}
              </span>
            )}
            <Icon name={metadataExpanded ? 'ChevronUp' : 'ChevronDown'} size={15} />
          </button>

          {metadataExpanded && (
            <div className="cd-meta-body">
              <div className="cd-fact">
                <span className="k">Created by</span>
                <span className="v">
                  {creatorInfo?.name}
                  {creatorInfo?.tier && (
                    <span className="sub">
                      {creatorInfo?.tier}
                      {creatorInfo?.department && ` · ${creatorInfo?.department}`}
                    </span>
                  )}
                </span>
              </div>
              <div className="cd-fact">
                <span className="k">Created at</span>
                <span className="v">{card?.createdAt ? formatDate(card?.createdAt) : '—'}</span>
              </div>
              <div className="cd-fact">
                <span className="k">Department</span>
                <span className="v">
                  {getDepartmentName(card?.department) || getDepartmentName(card?.department_id) || '—'}
                </span>
              </div>
              <div className="cd-fact">
                <span className="k">Status</span>
                <span className="v">
                  {card?.status ? (
                    <span className={`jm-tag ${statusTagTone(card?.status)}`}>
                      {card?.status?.replace(/_/g, ' ')}
                    </span>
                  ) : '—'}
                </span>
              </div>
              {card?.status === 'pending_acceptance' && card?.pendingForDepartment && (
                <div className="cd-fact">
                  <span className="k">Pending for</span>
                  <span className="v">{card?.pendingForDepartment}</span>
                </div>
              )}
              {(card?.status === 'active' || card?.status === 'declined') && card?.decidedByUserId && (
                <div className="cd-fact">
                  <span className="k">Decision</span>
                  <span className="v">
                    {card?.status === 'active' ? 'Accepted' : 'Declined'} by{' '}
                    <strong>{getUserNameById(card?.decidedByUserId) || '—'}</strong>
                    {card?.decidedAt && <span className="sub">{formatDate(card?.decidedAt)}</span>}
                    {card?.decisionNotes && <span className="cd-decision-note">{card?.decisionNotes}</span>}
                  </span>
                </div>
              )}
              {card?.withdrawnByUserId && (
                <div className="cd-fact">
                  <span className="k">Decision</span>
                  <span className="v">
                    Withdrawn by <strong>{getUserNameById(card?.withdrawnByUserId) || '—'}</strong>
                    {card?.withdrawnAt && <span className="sub">{formatDate(card?.withdrawnAt)}</span>}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        <hr className="jm-rule" />

        {/* ── Description ── */}
        <p className="jm-secthead">
          <Icon name="AlignLeft" size={14} />
          Description
        </p>
        <div className="jm-section">
          {editMode && canEditCoreFields ? (
            <textarea
              className="jm-textarea"
              rows={3}
              placeholder="Add a description…"
              value={editedDescription}
              onChange={(e) => setEditedDescription(e?.target?.value)}
            />
          ) : (
            <p className="cd-text">{card?.description || 'No description.'}</p>
          )}
          {editMode && !canEditCoreFields && (
            <p className="jm-hint">{getDisabledTooltip(currentUser, 'editCoreFields')}</p>
          )}
        </div>

        {/* ── Department ── */}
        <p className="jm-secthead">
          <Icon name="Building2" size={14} />
          Department
        </p>
        <div className="jm-section">
          {editMode && canEditCoreFields ? (
            <select
              className="jm-select"
              value={editedDepartment}
              onChange={(e) => setEditedDepartment(e?.target?.value)}
            >
              <option value="INTERIOR">Interior</option>
              <option value="DECK">Deck</option>
              <option value="ENGINEERING">Engineering</option>
              <option value="GALLEY">Galley</option>
            </select>
          ) : (
            <p className="cd-text">
              {getDepartmentName(card?.department) || getDepartmentName(card?.department_id) || 'No department'}
            </p>
          )}
          {editMode && !canEditCoreFields && (
            <p className="jm-hint">{getDisabledTooltip(currentUser, 'editCoreFields')}</p>
          )}
        </div>

        {/* ── Assignees ── */}
        <p className="jm-secthead">
          <Icon name="Users" size={14} />
          Assigned to
        </p>
        <div className="jm-section">
          {editMode && canEditCoreFields ? (
            <div className="cd-picklist">
              {teamMembers?.filter(m => m?.department === card?.department)?.map(member => (
                <label key={member?.id} className="jm-check cd-pickrow">
                  <input
                    type="checkbox"
                    checked={editedAssignees?.includes(member?.id)}
                    onChange={(e) => {
                      if (e?.target?.checked) setEditedAssignees(prev => [...prev, member?.id]);
                      else setEditedAssignees(prev => prev?.filter(id => id !== member?.id));
                    }}
                  />
                  <span className="box"><Icon name="Check" size={11} /></span>
                  {member?.avatar
                    ? <img src={member?.avatar} alt={member?.name} className="cd-avatar-img" />
                    : <span className="jm-avatar">{member?.name?.split(' ')?.map(n => n?.[0])?.slice(0, 2)?.join('')}</span>}
                  {member?.name}
                </label>
              ))}
            </div>
          ) : (
            <div className="jm-pills">
              {(() => {
                const resolvedName = getAssignedUserName();
                if (resolvedName) {
                  return (
                    <span className="jm-tag navy">
                      <Icon name="User" size={10} />
                      {resolvedName}
                    </span>
                  );
                }
                const assigneeIds = card?.assignees?.length > 0
                  ? card?.assignees
                  : (card?.assigned_to ? [card?.assigned_to] : []);
                const resolvedMembers = assigneeIds?.map(id => getTeamMember(id))?.filter(Boolean);
                if (resolvedMembers?.length > 0) {
                  return resolvedMembers?.map(member => (
                    <span key={member?.id} className="jm-tag navy">
                      <Icon name="User" size={10} />
                      {member?.name}
                    </span>
                  ));
                }
                return <span className="cd-text">No assignees</span>;
              })()}
            </div>
          )}
          {editMode && !canEditCoreFields && (
            <p className="jm-hint">{getDisabledTooltip(currentUser, 'editCoreFields')}</p>
          )}
        </div>

        {/* ── Due date & priority ── */}
        <div className="jm-section jm-grid">
          <div>
            <p className="jm-label">Due date</p>
            {editMode && canFullEdit ? (
              <input
                type="date"
                className="jm-input"
                value={editedDueDate}
                onChange={(e) => setEditedDueDate(e?.target?.value)}
              />
            ) : (
              <p className="cd-text">
                {card?.dueDate ? new Date(card?.dueDate)?.toLocaleDateString(dateLocale()) : '—'}
              </p>
            )}
          </div>
          <div>
            <p className="jm-label">Priority</p>
            {editMode && canFullEdit ? (
              <div className="jm-pills">
                {['low', 'medium', 'high']?.map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setEditedPriority(p)}
                    className={`jm-pill${editedPriority === p ? ' on' : ''}`}
                  >
                    {p?.charAt(0)?.toUpperCase() + p?.slice(1)}
                  </button>
                ))}
              </div>
            ) : (
              <p className="cd-text" style={{ textTransform: 'capitalize' }}>{card?.priority || '—'}</p>
            )}
          </div>
        </div>

        {/* ── Recurrence (edit only) ── */}
        {editMode && canFullEdit && (
          <div className="jm-section">
            <p className="jm-label">Recurrence</p>
            <select
              className="jm-select"
              value={recurrence || 'none'}
              onChange={(e) => setRecurrence(e?.target?.value)}
            >
              <option value="none">None</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
        )}

        <hr className="jm-rule" />

        {/* ── Labels ── */}
        <p className="jm-secthead">
          <Icon name="Tag" size={14} />
          Labels
        </p>
        <div className="jm-section">
          {editedLabels?.length > 0 ? (
            <div className="jm-pills" style={{ marginBottom: editMode && canFullEdit ? 10 : 0 }}>
              {editedLabels?.map(label => (
                <span key={label} className="jm-tag accent">
                  {label}
                  {editMode && canFullEdit && (
                    <span
                      role="button"
                      tabIndex={-1}
                      title="Remove label"
                      onClick={() => handleRemoveLabel(label)}
                      style={{ display: 'flex', cursor: 'pointer' }}
                    >
                      <Icon name="X" size={10} />
                    </span>
                  )}
                </span>
              ))}
            </div>
          ) : (
            !editMode && <p className="cd-text">No labels.</p>
          )}
          {editMode && canFullEdit && (
            <div className="dsr-inlineadd" style={{ marginTop: 0 }}>
              <input
                type="text"
                className="jm-input"
                placeholder="Add a label"
                value={newLabel}
                onChange={(e) => setNewLabel(e?.target?.value)}
                onKeyDown={(e) => { if (e?.key === 'Enter') { e?.preventDefault(); handleAddLabel(); } }}
              />
              <button className="jm-btn accent sm" onClick={handleAddLabel}>
                <Icon name="Plus" size={14} />
                Add
              </button>
            </div>
          )}
        </div>

        {/* ── Checklist ── */}
        {(checklist?.length > 0 || (editMode && canInteract)) && (
          <>
            <hr className="jm-rule" />
            <div className="jm-secthead-row">
              <p className="jm-secthead">
                <Icon name="CheckSquare" size={14} />
                Checklist
              </p>
              {totalCount > 0 && (
                <span className="cd-progress-count">{completedCount}/{totalCount}</span>
              )}
            </div>
            {totalCount > 0 && (
              <div className="cd-progress">
                <div className="bar" style={{ width: `${progress}%` }} />
              </div>
            )}
            <div className="jm-section">
              {checklist?.map(item => (
                <label key={item?.id} className="jm-check cd-checkrow">
                  <input
                    type="checkbox"
                    checked={item?.completed}
                    onChange={() => handleChecklistToggle(item?.id)}
                    disabled={!canInteract}
                  />
                  <span className="box"><Icon name="Check" size={11} /></span>
                  <span className={`t${item?.completed ? ' done' : ''}`}>{item?.text}</span>
                  {canInteract && (
                    <span
                      role="button"
                      tabIndex={-1}
                      className="rm"
                      title="Remove item"
                      onClick={(e) => { e?.preventDefault(); handleRemoveChecklistItem(item?.id); }}
                    >
                      <Icon name="X" size={13} />
                    </span>
                  )}
                </label>
              ))}
              {canInteract && (
                <div className="dsr-inlineadd">
                  <input
                    type="text"
                    className="jm-input"
                    placeholder="Add checklist item"
                    value={newChecklistItem}
                    onChange={(e) => setNewChecklistItem(e?.target?.value)}
                    onKeyDown={(e) => { if (e?.key === 'Enter') { e?.preventDefault(); handleAddChecklistItem(); } }}
                  />
                  <button className="jm-btn accent sm" onClick={handleAddChecklistItem}>
                    <Icon name="Plus" size={14} />
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        <hr className="jm-rule" />

        {/* ── Notes ── */}
        <p className="jm-secthead">
          <Icon name="MessageSquare" size={14} />
          Notes
        </p>
        <div className="jm-section">
          {notes?.map(note => (
            <div key={note?.id} className="cd-note">
              <div className="cd-note-top">
                <span className="who">{note?.author}</span>
                <span className="when">{formatDate(note?.timestamp)}</span>
              </div>
              <p className="body">{note?.text}</p>
            </div>
          ))}
          {modalMode === 'FULL' && canAddNotes && (
            <div className="dsr-inlineadd">
              <input
                type="text"
                className="jm-input"
                placeholder="Add a note…"
                value={newNote}
                onChange={(e) => setNewNote(e?.target?.value)}
                onKeyDown={(e) => { if (e?.key === 'Enter') { e?.preventDefault(); handleAddNote(); } }}
              />
              <button className="jm-btn accent sm" onClick={handleAddNote} disabled={!newNote?.trim()}>
                Add
              </button>
            </div>
          )}
          {modalMode === 'VIEW_ONLY' && notes?.length === 0 && (
            <p className="cd-text">No notes yet.</p>
          )}
        </div>

        {/* ── Activity log ── */}
        {filteredAuditTrail?.length > 0 && (
          <>
            <hr className="jm-rule" />
            <div className="jm-secthead-row">
              <p className="jm-secthead">
                <Icon name="Activity" size={14} />
                Activity log
              </p>
              {isAdmin && (
                <button onClick={handleExportAudit} className="jm-btn ghost sm" title="Export audit trail">
                  <Icon name="Download" size={13} />
                  Export
                </button>
              )}
            </div>

            <div className="cd-audit">
              {filteredAuditTrail?.map((entry) => {
                const actorUser = getTeamMember(entry?.actorId);
                const actorName = entry?.actorName || actorUser?.name || 'Unknown user';
                const isExpanded = expandedAuditEntry === entry?.id;
                const humanAction = getHumanReadableAction(entry);
                const formattedDate = new Date(entry?.timestamp)?.toLocaleString('en-GB', {
                  day: '2-digit', month: '2-digit', year: 'numeric',
                  hour: '2-digit', minute: '2-digit', hour12: false,
                })?.replace(',', ' ·');

                return (
                  <div key={entry?.id} className="cd-auditrow">
                    <button
                      onClick={() => canViewFullAudit && toggleExpandEntry(entry?.id)}
                      className={`cd-auditrow-head${isExpanded ? ' on' : ''}`}
                      style={canViewFullAudit ? undefined : { cursor: 'default' }}
                    >
                      {actorUser?.avatar
                        ? <img src={actorUser?.avatar} alt={actorName} className="cd-avatar-img" />
                        : <span className="jm-avatar">{actorName?.split(' ')?.map(n => n?.[0])?.slice(0, 2)?.join('')}</span>}
                      <span className="what">
                        <strong>{actorName}</strong> {humanAction}
                      </span>
                      <span className="when">{formattedDate}</span>
                      {canViewFullAudit && (
                        <Icon name={isExpanded ? 'ChevronUp' : 'ChevronDown'} size={14} />
                      )}
                    </button>

                    {isExpanded && canViewFullAudit && (
                      <div className="cd-auditrow-body">
                        <div className="cd-fact">
                          <span className="k">Event type</span>
                          <span className="v">{entry?.eventType?.replace(/_/g, ' ')}</span>
                        </div>
                        <div className="cd-fact">
                          <span className="k">Actor id</span>
                          <span className="v mono">{entry?.actorId}</span>
                        </div>

                        {entry?.changes?.length > 0 && (
                          <div style={{ marginTop: 12 }}>
                            <p className="jm-label">Detailed changes</p>
                            {entry?.changes?.map((change, idx) => (
                              <div key={idx} className="cd-change">
                                <p className="f">{change?.field?.replace(/_/g, ' ')}</p>
                                <div className="cd-change-grid">
                                  <div>
                                    <span className="k">Before</span>
                                    <code className="before">
                                      {change?.oldValue === null || change?.oldValue === undefined
                                        ? '(empty)'
                                        : typeof change?.oldValue === 'object'
                                          ? JSON.stringify(change?.oldValue, null, 2)
                                          : String(change?.oldValue)}
                                    </code>
                                  </div>
                                  <div>
                                    <span className="k">After</span>
                                    <code className="after">
                                      {change?.newValue === null || change?.newValue === undefined
                                        ? '(empty)'
                                        : typeof change?.newValue === 'object'
                                          ? JSON.stringify(change?.newValue, null, 2)
                                          : String(change?.newValue)}
                                    </code>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="cd-hash">
                          <span>Hash <code>{entry?.hash}</code></span>
                          {entry?.prevHash && <span>Previous <code>{entry?.prevHash}</code></span>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="jm-foot">
        {modalMode === 'FULL' && canCompleteAction && card?.status !== 'completed' && (
          <button onClick={handleComplete} className="jm-btn success">
            <Icon name="Check" size={15} />
            Mark complete
          </button>
        )}
        {modalMode === 'FULL' && canReopen && card?.status === 'completed' && (
          <button
            onClick={() => {
              onUpdate(card?.id, { status: 'today', completedBy: null, completedAt: null });
              onClose();
            }}
            className="jm-btn ghost"
          >
            <Icon name="RotateCcw" size={15} />
            Reopen job
          </button>
        )}
        {modalMode === 'FULL' && editMode && (
          <>
            <button onClick={handleSaveEdit} className="jm-btn primary">
              <Icon name="Save" size={15} />
              Save changes
            </button>
            <button onClick={() => setEditMode(false)} className="jm-btn ghost">Cancel</button>
          </>
        )}
        <div className="spacer" />
        <button onClick={onClose} className="jm-btn ghost">Close</button>
      </div>
    </ModalShell>
  );
};

export default CardDetailModal;