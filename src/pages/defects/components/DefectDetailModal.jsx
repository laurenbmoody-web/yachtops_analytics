import React, { useState } from 'react';
import Button from '../../../components/ui/Button';
import Icon from '../../../components/AppIcon';
import { updateDefect, addComment, DefectStatus, DefectPriority } from '../utils/defectsStorage';
import {
  canEditDefect,
  canAssignDefect,
  canChangeDefectStatus,
  canCloseDefect,
  canAddComment,
  canAddPhoto
} from '../utils/defectPermissions';
import { format } from 'date-fns';
import Select from '../../../components/ui/Select';

const DefectDetailModal = ({ defect, currentUser, teamMembers, onClose, onDefectUpdated }) => {
  const [activeTab, setActiveTab] = useState('details');
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  
  const canEdit = canEditDefect(currentUser, defect);
  const canAssign = canAssignDefect(currentUser, defect);
  const canChangeStatus = canChangeDefectStatus(currentUser, defect);
  const canClose = canCloseDefect(currentUser, defect);
  const canComment = canAddComment(currentUser, defect);
  const canUploadPhoto = canAddPhoto(currentUser, defect);
  
  const handleAddComment = async () => {
    if (!newComment?.trim() || !canComment) return;
    
    setIsSubmitting(true);
    const updated = addComment(defect?.id, newComment);
    if (updated) {
      setNewComment('');
      onDefectUpdated();
    }
    setIsSubmitting(false);
  };
  
  const handleStatusChange = (newStatus) => {
    if (!canChangeStatus) return;
    
    const updated = updateDefect(defect?.id, { status: newStatus });
    if (updated) {
      onDefectUpdated();
    }
  };
  
  const handleAssign = (userId) => {
    if (!canAssign) return;
    
    const user = teamMembers?.find(u => u?.id === userId);
    const updated = updateDefect(defect?.id, {
      assignedToUserId: userId,
      assignedToName: user?.name || user?.fullName || 'Unknown'
    });
    if (updated) {
      setShowAssignModal(false);
      onDefectUpdated();
    }
  };
  
  const handleClose = () => {
    if (!canClose) return;
    
    const updated = updateDefect(defect?.id, { status: DefectStatus?.CLOSED });
    if (updated) {
      onDefectUpdated();
    }
  };
  
  const getStatusColor = (status) => {
    switch (status) {
      case DefectStatus?.NEW:
        return 'bg-primary/10 text-primary';
      case DefectStatus?.ASSIGNED:
        return 'bg-blue-500/10 text-blue-600';
      case DefectStatus?.IN_PROGRESS:
        return 'bg-warning/10 text-warning';
      case DefectStatus?.WAITING_PARTS:
        return 'bg-purple-500/10 text-purple-600';
      case DefectStatus?.FIXED:
        return 'bg-success/10 text-success';
      case DefectStatus?.CLOSED:
        return 'bg-muted/50 text-muted-foreground';
      default:
        return 'bg-muted/50 text-muted-foreground';
    }
  };
  
  const getPriorityColor = (priority) => {
    switch (priority) {
      case DefectPriority?.CRITICAL:
        return 'text-error';
      case DefectPriority?.HIGH:
        return 'text-warning';
      case DefectPriority?.MEDIUM:
        return 'text-primary';
      case DefectPriority?.LOW:
        return 'text-muted-foreground';
      default:
        return 'text-muted-foreground';
    }
  };
  
  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    try {
      return format(new Date(dateStr), 'MMM dd, yyyy');
    } catch {
      return 'Invalid date';
    }
  };
  
  const formatTimestamp = (dateStr) => {
    if (!dateStr) return 'N/A';
    try {
      return format(new Date(dateStr), 'MMM dd, yyyy HH:mm');
    } catch {
      return 'Invalid date';
    }
  };
  
  const getAssignedToName = () => {
    if (!defect?.assignedToUserId) return 'Unassigned';
    const user = teamMembers?.find(u => u?.id === defect?.assignedToUserId);
    return user?.name || user?.fullName || 'Unknown';
  };
  
  const nextPhoto = () => {
    if (defect?.photos?.length > 0) {
      setCurrentPhotoIndex((prev) => (prev + 1) % defect?.photos?.length);
    }
  };
  
  const prevPhoto = () => {
    if (defect?.photos?.length > 0) {
      setCurrentPhotoIndex((prev) => (prev - 1 + defect?.photos?.length) % defect?.photos?.length);
    }
  };
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-xl font-semibold text-foreground truncate">{defect?.title}</h2>
              <span className={`px-3 py-1 rounded-lg text-xs font-medium ${getStatusColor(defect?.status)}`}>
                {defect?.status}
              </span>
              <span className={`text-sm font-medium ${getPriorityColor(defect?.priority)}`}>
                {defect?.priority}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{defect?.locationPathLabel}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted/50 rounded-lg transition-smooth flex-shrink-0 ml-4"
          >
            <Icon name="X" size={20} className="text-muted-foreground" />
          </button>
        </div>
        
        {/* Action Buttons */}
        {(canEdit || canAssign || canChangeStatus || canClose) && (
          <div className="px-6 py-4 border-b border-border flex items-center gap-3 flex-wrap">
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => setShowEditModal(true)}>
                <Icon name="Edit" size={16} className="mr-2" />
                Edit
              </Button>
            )}
            {canAssign && (
              <Button variant="outline" size="sm" onClick={() => setShowAssignModal(true)}>
                <Icon name="UserPlus" size={16} className="mr-2" />
                Assign
              </Button>
            )}
            {canChangeStatus && (
              <Button variant="outline" size="sm" onClick={() => setShowStatusModal(true)}>
                <Icon name="RefreshCw" size={16} className="mr-2" />
                Change Status
              </Button>
            )}
            {canClose && defect?.status !== DefectStatus?.CLOSED && (
              <Button variant="outline" size="sm" onClick={handleClose}>
                <Icon name="CheckCircle" size={16} className="mr-2" />
                Close
              </Button>
            )}
          </div>
        )}
        
        {/* Tabs */}
        <div className="px-6 py-3 border-b border-border flex items-center gap-6">
          <button
            onClick={() => setActiveTab('details')}
            className={`text-sm font-medium pb-2 border-b-2 transition-smooth ${
              activeTab === 'details' ?'border-primary text-primary' :'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Details
          </button>
          <button
            onClick={() => setActiveTab('comments')}
            className={`text-sm font-medium pb-2 border-b-2 transition-smooth ${
              activeTab === 'comments' ?'border-primary text-primary' :'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Comments ({defect?.comments?.length || 0})
          </button>
          <button
            onClick={() => setActiveTab('activity')}
            className={`text-sm font-medium pb-2 border-b-2 transition-smooth ${
              activeTab === 'activity' ?'border-primary text-primary' :'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Activity
          </button>
        </div>
        
        {/* Body */}
        <div className="p-6">
          {activeTab === 'details' && (
            <div className="space-y-6">
              {/* Photo Carousel */}
              {defect?.photos?.length > 0 && (
                <div className="relative">
                  <img
                    src={defect?.photos?.[currentPhotoIndex]}
                    alt={`Defect photo ${currentPhotoIndex + 1}`}
                    className="w-full h-64 object-cover rounded-xl"
                  />
                  {defect?.photos?.length > 1 && (
                    <>
                      <button
                        onClick={prevPhoto}
                        className="absolute left-2 top-1/2 -translate-y-1/2 p-2 bg-black/50 text-white rounded-lg hover:bg-black/70 transition-smooth"
                      >
                        <Icon name="ChevronLeft" size={20} />
                      </button>
                      <button
                        onClick={nextPhoto}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-black/50 text-white rounded-lg hover:bg-black/70 transition-smooth"
                      >
                        <Icon name="ChevronRight" size={20} />
                      </button>
                      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/50 text-white text-xs rounded-full">
                        {currentPhotoIndex + 1} / {defect?.photos?.length}
                      </div>
                    </>
                  )}
                </div>
              )}
              
              {/* Details Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Department Owner</p>
                  <p className="text-sm text-foreground font-medium">{defect?.departmentOwner}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Assigned To</p>
                  <p className="text-sm text-foreground font-medium">{getAssignedToName()}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Reported By</p>
                  <p className="text-sm text-foreground font-medium">{defect?.reportedByName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Due Date</p>
                  <p className="text-sm text-foreground font-medium">{formatDate(defect?.dueDate)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Created</p>
                  <p className="text-sm text-foreground font-medium">{formatTimestamp(defect?.createdAt)}</p>
                </div>
                {defect?.closedAt && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Closed</p>
                    <p className="text-sm text-foreground font-medium">{formatTimestamp(defect?.closedAt)}</p>
                  </div>
                )}
              </div>
              
              {/* Description */}
              {defect?.description && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Description</p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{defect?.description}</p>
                </div>
              )}
              
              {/* Flags */}
              {(defect?.affectsGuestAreas || defect?.safetyRelated) && (
                <div className="flex items-center gap-3">
                  {defect?.affectsGuestAreas && (
                    <span className="px-3 py-1 bg-warning/10 text-warning text-xs font-medium rounded-lg">
                      Affects Guest Areas
                    </span>
                  )}
                  {defect?.safetyRelated && (
                    <span className="px-3 py-1 bg-error/10 text-error text-xs font-medium rounded-lg">
                      Safety Related
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
          
          {activeTab === 'comments' && (
            <div className="space-y-4">
              {/* Comments List */}
              {defect?.comments?.length === 0 ? (
                <div className="text-center py-8">
                  <Icon name="MessageSquare" size={32} className="text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No comments yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {defect?.comments?.map(comment => (
                    <div key={comment?.id} className="border border-border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-medium text-foreground">{comment?.userName}</p>
                        <p className="text-xs text-muted-foreground">{formatTimestamp(comment?.createdAt)}</p>
                      </div>
                      <p className="text-sm text-foreground whitespace-pre-wrap">{comment?.text}</p>
                    </div>
                  ))}
                </div>
              )}
              
              {/* Add Comment */}
              {canComment && (
                <div className="border-t border-border pt-4 mt-4">
                  <textarea
                    value={newComment}
                    onChange={(e) => setNewComment(e?.target?.value)}
                    placeholder="Add a comment..."
                    rows={3}
                    className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none mb-3"
                  />
                  <Button
                    onClick={handleAddComment}
                    disabled={!newComment?.trim() || isSubmitting}
                    size="sm"
                  >
                    {isSubmitting ? 'Posting...' : 'Post Comment'}
                  </Button>
                </div>
              )}
            </div>
          )}
          
          {activeTab === 'activity' && (
            <div className="space-y-3">
              {defect?.activityLog?.length === 0 ? (
                <div className="text-center py-8">
                  <Icon name="Activity" size={32} className="text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No activity yet</p>
                </div>
              ) : (
                defect?.activityLog?.map(activity => (
                  <div key={activity?.id} className="flex items-start gap-3">
                    <div className="p-2 bg-primary/10 rounded-lg flex-shrink-0">
                      <Icon name="Activity" size={16} className="text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground">{activity?.message}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-xs text-muted-foreground">{activity?.userName}</p>
                        <span className="text-xs text-muted-foreground">•</span>
                        <p className="text-xs text-muted-foreground">{formatTimestamp(activity?.timestamp)}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        
        {/* Status Change Modal */}
        {showStatusModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-card border border-border rounded-2xl p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-semibold text-foreground mb-4">Change Status</h3>
              <div className="space-y-2">
                {Object.values(DefectStatus)?.map(status => (
                  <button
                    key={status}
                    onClick={() => {
                      handleStatusChange(status);
                      setShowStatusModal(false);
                    }}
                    className={`w-full px-4 py-3 rounded-lg text-left transition-smooth ${
                      defect?.status === status
                        ? 'bg-primary/10 text-primary border-2 border-primary' :'bg-muted/50 text-foreground hover:bg-muted border-2 border-transparent'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-end gap-3 mt-6">
                <Button variant="outline" onClick={() => setShowStatusModal(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}
        
        {/* Assign Modal */}
        {showAssignModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-card border border-border rounded-2xl p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-semibold text-foreground mb-4">Assign Defect</h3>
              <Select
                value={defect?.assignedToUserId || ''}
                onChange={(e) => handleAssign(e?.target?.value)}
              >
                <option value="">Unassigned</option>
                {teamMembers
                  ?.filter(u => u?.department === defect?.departmentOwner)
                  ?.map(user => (
                    <option key={user?.id} value={user?.id}>
                      {user?.name || user?.fullName}
                    </option>
                  ))}
              </Select>
              <div className="flex items-center justify-end gap-3 mt-6">
                <Button variant="outline" onClick={() => setShowAssignModal(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DefectDetailModal;