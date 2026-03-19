import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import { getCurrentUser, getAllUsers } from '../../../utils/authStorage';
import { getDefectById, updateDefect, addDefectComment, addDefectPhoto, canEditDefect, canAssignDefect, canChangeDefectStatus, canCloseDefect, DefectStatus, DefectPriority } from '../utils/defectsStorage';
import { getActivityForEntity } from '../../../utils/activityStorage';
import { showToast } from '../../../utils/toast';
import { formatDistanceToNow } from 'date-fns';

const DefectDetailView = ({ defect: initialDefect, onClose, onUpdate }) => {
  const currentUser = getCurrentUser();
  const [defect, setDefect] = useState(initialDefect);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [newComment, setNewComment] = useState('');
  const [activityLog, setActivityLog] = useState([]);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  
  const canEdit = canEditDefect(currentUser, defect);
  const canAssign = canAssignDefect(currentUser, defect);
  const canChangeStatus = canChangeDefectStatus(currentUser, defect);
  const canClose = canCloseDefect(currentUser, defect);
  
  useEffect(() => {
    const users = getAllUsers();
    setAllUsers(users);
  }, []);
  
  useEffect(() => {
    // Load activity log
    const activity = getActivityForEntity('defect', defect?.id);
    setActivityLog(activity);
  }, [defect?.id]);
  
  const refreshDefect = () => {
    const updated = getDefectById(defect?.id);
    if (updated) {
      setDefect(updated);
    }
  };
  
  const handleStartEdit = () => {
    setEditForm({
      title: defect?.title,
      description: defect?.description,
      priority: defect?.priority,
      dueDate: defect?.dueDate || ''
    });
    setIsEditing(true);
  };
  
  const handleSaveEdit = () => {
    if (!editForm?.title?.trim()) {
      showToast('Title is required', 'error');
      return;
    }
    
    const updated = updateDefect(defect?.id, editForm);
    if (updated) {
      setDefect(updated);
      setIsEditing(false);
      showToast('Defect updated', 'success');
      onUpdate?.();
    }
  };
  
  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditForm({});
  };
  
  const handleStatusChange = (newStatus) => {
    const updated = updateDefect(defect?.id, { status: newStatus });
    if (updated) {
      setDefect(updated);
      showToast('Status updated', 'success');
      onUpdate?.();
    }
  };
  
  const handleAssign = (userId) => {
    const updated = updateDefect(defect?.id, { assignedToUserId: userId });
    if (updated) {
      setDefect(updated);
      showToast('Defect assigned', 'success');
      onUpdate?.();
    }
  };
  
  const handleAddComment = () => {
    if (!newComment?.trim()) return;
    
    const updated = addDefectComment(defect?.id, newComment);
    if (updated) {
      setDefect(updated);
      setNewComment('');
      showToast('Comment added', 'success');
      refreshDefect();
    }
  };
  
  const handlePhotoUpload = (e) => {
    const file = e?.target?.files?.[0];
    if (!file) return;
    
    if (!file?.type?.startsWith('image/')) {
      showToast('Please select an image file', 'error');
      return;
    }
    
    if (file?.size > 5 * 1024 * 1024) {
      showToast('Image size must be less than 5MB', 'error');
      return;
    }
    
    const reader = new FileReader();
    reader.onloadend = () => {
      const updated = addDefectPhoto(defect?.id, reader?.result);
      if (updated) {
        setDefect(updated);
        showToast('Photo added', 'success');
        refreshDefect();
      }
    };
    reader?.readAsDataURL(file);
  };
  
  const getStatusColor = (status) => {
    switch (status) {
      case DefectStatus?.NEW: return 'bg-primary/10 text-primary';
      case DefectStatus?.ASSIGNED: return 'bg-blue-500/10 text-blue-600';
      case DefectStatus?.IN_PROGRESS: return 'bg-warning/10 text-warning';
      case DefectStatus?.WAITING_PARTS: return 'bg-orange-500/10 text-orange-600';
      case DefectStatus?.FIXED: return 'bg-success/10 text-success';
      case DefectStatus?.CLOSED: return 'bg-muted text-muted-foreground';
      default: return 'bg-muted text-muted-foreground';
    }
  };
  
  const getPriorityBadge = (priority) => {
    switch (priority) {
      case DefectPriority?.CRITICAL: return 'bg-error text-white';
      case DefectPriority?.HIGH: return 'bg-warning text-white';
      case DefectPriority?.MEDIUM: return 'bg-primary/20 text-primary';
      case DefectPriority?.LOW: return 'bg-muted text-muted-foreground';
      default: return 'bg-muted text-muted-foreground';
    }
  };
  
  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date?.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };
  
  const getAssignedUserName = (userId) => {
    if (!userId) return 'Unassigned';
    const user = allUsers?.find(u => u?.id === userId);
    return user?.fullName || user?.name || 'Unknown';
  };
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="p-2 hover:bg-muted rounded-lg transition-smooth"
            >
              <Icon name="ArrowLeft" size={20} className="text-muted-foreground" />
            </button>
            <h2 className="text-xl font-bold text-foreground">Defect Details</h2>
          </div>
          
          <div className="flex items-center gap-2">
            {canEdit && !isEditing && (
              <button
                onClick={handleStartEdit}
                className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-foreground hover:bg-muted transition-smooth"
              >
                <Icon name="Edit" size={16} />
                Edit
              </button>
            )}
            {canClose && defect?.status !== DefectStatus?.CLOSED && (
              <button
                onClick={() => handleStatusChange(DefectStatus?.CLOSED)}
                className="flex items-center gap-2 px-3 py-2 bg-success text-white rounded-lg hover:bg-success/90 transition-smooth"
              >
                <Icon name="CheckCircle" size={16} />
                Close
              </button>
            )}
          </div>
        </div>
        
        <div className="p-6 space-y-6">
          {/* Title and Status */}
          {isEditing ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Title</label>
                <input
                  type="text"
                  value={editForm?.title}
                  onChange={(e) => setEditForm(prev => ({ ...prev, title: e?.target?.value }))}
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Priority</label>
                <select
                  value={editForm?.priority}
                  onChange={(e) => setEditForm(prev => ({ ...prev, priority: e?.target?.value }))}
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {Object.values(DefectPriority)?.map(priority => (
                    <option key={priority} value={priority}>{priority}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Due Date</label>
                <input
                  type="date"
                  value={editForm?.dueDate}
                  onChange={(e) => setEditForm(prev => ({ ...prev, dueDate: e?.target?.value }))}
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Description</label>
                <textarea
                  value={editForm?.description}
                  onChange={(e) => setEditForm(prev => ({ ...prev, description: e?.target?.value }))}
                  rows={4}
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSaveEdit}
                  className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-smooth"
                >
                  Save
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="px-4 py-2 border border-border rounded-lg text-foreground hover:bg-muted transition-smooth"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="text-2xl font-bold text-foreground mb-2">{defect?.title}</h3>
                  <div className="flex items-center gap-2">
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(defect?.status)}`}>
                      {defect?.status}
                    </span>
                    <span className={`px-3 py-1 rounded text-sm font-medium ${getPriorityBadge(defect?.priority)}`}>
                      {defect?.priority}
                    </span>
                  </div>
                </div>
              </div>
              
              {/* Info Grid */}
              <div className="grid grid-cols-2 gap-4 p-4 bg-muted/30 rounded-lg">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Location</div>
                  <div className="text-sm text-foreground font-medium flex items-center gap-1">
                    <Icon name="MapPin" size={14} />
                    {defect?.locationPathLabel || 'No location'}
                    {defect?.locationFreeText && (
                      <span className="text-muted-foreground">({defect?.locationFreeText})</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Department</div>
                  <div className="text-sm text-foreground font-medium flex items-center gap-1">
                    <Icon name="Building" size={14} />
                    {defect?.departmentOwner}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Reported By</div>
                  <div className="text-sm text-foreground font-medium">
                    {defect?.reportedByName || 'Unknown'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Assigned To</div>
                  <div className="text-sm text-foreground font-medium">
                    {getAssignedUserName(defect?.assignedToUserId)}
                  </div>
                </div>
                {defect?.dueDate && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Due Date</div>
                    <div className="text-sm text-foreground font-medium flex items-center gap-1">
                      <Icon name="Calendar" size={14} />
                      {formatDate(defect?.dueDate)}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Created</div>
                  <div className="text-sm text-foreground font-medium">
                    {formatDate(defect?.createdAt)}
                  </div>
                </div>
              </div>
              
              {/* Description */}
              {defect?.description && (
                <div className="mt-4">
                  <h4 className="text-sm font-semibold text-foreground mb-2">Description</h4>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{defect?.description}</p>
                </div>
              )}
            </div>
          )}
          
          {/* Status Change Actions */}
          {canChangeStatus && !isEditing && (
            <div className="border-t border-border pt-6">
              <h4 className="text-sm font-semibold text-foreground mb-3">Change Status</h4>
              <div className="flex flex-wrap gap-2">
                {Object.values(DefectStatus)?.map(status => (
                  <button
                    key={status}
                    onClick={() => handleStatusChange(status)}
                    disabled={defect?.status === status}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-smooth ${
                      defect?.status === status
                        ? 'bg-muted text-muted-foreground cursor-not-allowed'
                        : 'border border-border hover:bg-muted'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>
          )}
          
          {/* Assignment */}
          {canAssign && !isEditing && (
            <div className="border-t border-border pt-6">
              <h4 className="text-sm font-semibold text-foreground mb-3">Assign To</h4>
              <select
                value={defect?.assignedToUserId || ''}
                onChange={(e) => handleAssign(e?.target?.value)}
                className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Unassigned</option>
                {allUsers
                  ?.filter(u => u?.department?.toUpperCase() === defect?.departmentOwner?.toUpperCase())
                  ?.map(user => (
                    <option key={user?.id} value={user?.id}>
                      {user?.fullName || user?.name} ({user?.roleTitle})
                    </option>
                  ))}
              </select>
            </div>
          )}
          
          {/* Photos */}
          <div className="border-t border-border pt-6">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-foreground">Photos</h4>
              <label className="flex items-center gap-2 px-3 py-1.5 border border-border rounded-lg text-sm text-foreground hover:bg-muted transition-smooth cursor-pointer">
                <Icon name="Camera" size={16} />
                Add Photo
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
              </label>
            </div>
            
            {defect?.photos?.length === 0 ? (
              <p className="text-sm text-muted-foreground">No photos</p>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {defect?.photos?.map((photo, index) => (
                  <img
                    key={photo?.id}
                    src={photo?.dataUrl}
                    alt={`Defect photo ${index + 1}`}
                    onClick={() => setSelectedPhotoIndex(index)}
                    className="w-full h-32 object-cover rounded-lg border border-border cursor-pointer hover:opacity-80 transition-smooth"
                  />
                ))}
              </div>
            )}
          </div>
          
          {/* Comments */}
          <div className="border-t border-border pt-6">
            <h4 className="text-sm font-semibold text-foreground mb-3">Comments</h4>
            
            <div className="space-y-3 mb-4">
              {defect?.comments?.length === 0 ? (
                <p className="text-sm text-muted-foreground">No comments yet</p>
              ) : (
                defect?.comments?.map(comment => (
                  <div key={comment?.id} className="bg-muted/30 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-foreground">{comment?.userName}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(comment?.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-sm text-foreground">{comment?.text}</p>
                  </div>
                ))
              )}
            </div>
            
            <div className="flex gap-2">
              <input
                type="text"
                value={newComment}
                onChange={(e) => setNewComment(e?.target?.value)}
                onKeyPress={(e) => e?.key === 'Enter' && handleAddComment()}
                placeholder="Add a comment..."
                className="flex-1 px-4 py-2 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button
                onClick={handleAddComment}
                disabled={!newComment?.trim()}
                className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-smooth disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Icon name="Send" size={16} />
              </button>
            </div>
          </div>
          
          {/* Activity Timeline */}
          <div className="border-t border-border pt-6">
            <h4 className="text-sm font-semibold text-foreground mb-3">Activity Timeline</h4>
            
            {activityLog?.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet</p>
            ) : (
              <div className="space-y-3">
                {activityLog?.map(activity => (
                  <div key={activity?.id} className="flex gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <Icon name="Activity" size={14} className="text-primary" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm text-foreground">{activity?.summary}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {activity?.actorName} · {formatDistanceToNow(new Date(activity?.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Photo Lightbox */}
      {selectedPhotoIndex !== null && (
        <div 
          className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60]"
          onClick={() => setSelectedPhotoIndex(null)}
        >
          <button
            onClick={() => setSelectedPhotoIndex(null)}
            className="absolute top-4 right-4 p-2 bg-white/10 rounded-lg hover:bg-white/20 transition-smooth"
          >
            <Icon name="X" size={24} className="text-white" />
          </button>
          <img
            src={defect?.photos?.[selectedPhotoIndex]?.dataUrl}
            alt="Full size"
            className="max-w-[90vw] max-h-[90vh] object-contain"
          />
        </div>
      )}
    </div>
  );
};

export default DefectDetailView;