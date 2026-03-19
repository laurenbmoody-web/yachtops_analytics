import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import { getCurrentUser } from '../../../utils/authStorage';
import { getDefectById, DefectStatus, DefectPriority } from '../utils/defectsStorage';
import { canEditDefect, canCloseDefect } from '../utils/defectPermissions';
import { format } from 'date-fns';
import DefectDetailModal from './DefectDetailModal';
import CloseDefectModal from './CloseDefectModal';
import ReopenDefectModal from './ReopenDefectModal';
import { closeDefectWithNotes, reopenDefect } from '../utils/defectsStorage';
import { showToast } from '../../../utils/toast';

const ViewDefectModal = ({ defectId, onClose, onUpdate }) => {
  const currentUser = getCurrentUser();
  const defect = getDefectById(defectId);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showReopenModal, setShowReopenModal] = useState(false);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  
  if (!defect) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-card border border-border rounded-2xl shadow-xl max-w-2xl w-full p-6">
          <p className="text-foreground">Defect not found</p>
          <button
            onClick={onClose}
            className="mt-4 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-smooth"
          >
            Close
          </button>
        </div>
      </div>
    );
  }
  
  const canEdit = canEditDefect(currentUser, defect);
  const canClose = canCloseDefect(currentUser, defect) && defect?.status !== 'Closed';
  const isClosed = defect?.status === 'Closed';
  const canReopen = isClosed && canCloseDefect(currentUser, defect);
  
  const getStatusColor = (status) => {
    switch (status) {
      case DefectStatus?.NEW:
      case 'New':
        return 'bg-primary/10 text-primary';
      case DefectStatus?.PENDING_ACCEPTANCE:
      case 'pending_acceptance':
        return 'bg-warning/10 text-warning';
      case DefectStatus?.ASSIGNED:
      case 'Assigned':
        return 'bg-blue-500/10 text-blue-600';
      case DefectStatus?.IN_PROGRESS:
      case 'InProgress':
        return 'bg-warning/10 text-warning';
      case DefectStatus?.WAITING_PARTS:
      case 'WaitingParts':
        return 'bg-orange-500/10 text-orange-600';
      case DefectStatus?.FIXED:
      case 'Fixed':
        return 'bg-success/10 text-success';
      case DefectStatus?.CLOSED:
      case 'Closed':
        return 'bg-muted text-muted-foreground';
      case DefectStatus?.DECLINED:
      case 'declined':
        return 'bg-error/10 text-error';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };
  
  const getPriorityColor = (priority) => {
    switch (priority) {
      case DefectPriority?.CRITICAL:
      case 'Critical':
        return 'text-error';
      case DefectPriority?.HIGH:
      case 'High':
        return 'text-warning';
      case DefectPriority?.MEDIUM:
      case 'Medium':
        return 'text-primary';
      case DefectPriority?.LOW:
      case 'Low':
        return 'text-muted-foreground';
      default:
        return 'text-muted-foreground';
    }
  };
  
  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    try {
      return format(new Date(dateStr), 'MMM dd, yyyy HH:mm');
    } catch {
      return 'Invalid date';
    }
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
  
  const handleEditClick = () => {
    setShowEditModal(true);
  };
  
  const handleEditClose = () => {
    setShowEditModal(false);
    onUpdate?.();
  };
  
  const handleCloseClick = () => {
    setShowCloseModal(true);
  };
  
  const handleCloseModalClose = () => {
    setShowCloseModal(false);
  };
  
  const handleCloseConfirm = async (closeData) => {
    try {
      const result = closeDefectWithNotes(
        defectId,
        closeData?.closeNotes,
        closeData?.closePhoto
      );
      
      if (result) {
        showToast('Defect closed', 'success');
        setShowCloseModal(false);
        onUpdate?.();
        onClose?.();
      } else {
        showToast('Failed to close defect', 'error');
      }
    } catch (error) {
      showToast('Failed to close defect', 'error');
    }
  };
  
  const handleReopenClick = () => {
    setShowReopenModal(true);
  };
  
  const handleReopenModalClose = () => {
    setShowReopenModal(false);
  };
  
  const handleReopenConfirm = async (reopenData) => {
    try {
      const result = reopenDefect(
        defectId,
        reopenData?.reopenNotes
      );
      
      if (result) {
        showToast('Defect re-opened', 'success');
        setShowReopenModal(false);
        onUpdate?.();
        onClose?.();
      } else {
        showToast('Failed to re-open defect', 'error');
      }
    } catch (error) {
      showToast('Failed to re-open defect', 'error');
    }
  };
  
  if (showEditModal) {
    return (
      <DefectDetailModal
        defect={defect}
        currentUser={currentUser}
        teamMembers={[]}
        onClose={handleEditClose}
        onDefectUpdated={onUpdate}
      />
    );
  }
  
  if (showCloseModal) {
    return (
      <CloseDefectModal
        defect={defect}
        onClose={handleCloseModalClose}
        onConfirm={handleCloseConfirm}
      />
    );
  }
  
  if (showReopenModal) {
    return (
      <ReopenDefectModal
        defect={defect}
        onClose={handleReopenModalClose}
        onConfirm={handleReopenConfirm}
      />
    );
  }
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-xl font-semibold text-foreground truncate">{defect?.title}</h2>
              <span className={`px-3 py-1 rounded-lg text-xs font-medium ${getStatusColor(defect?.status)}`}>
                {defect?.status === 'pending_acceptance' ? 'Pending Acceptance' : defect?.status}
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
        
        {/* Edit and Close Buttons */}
        {(canEdit || canClose || canReopen) && (
          <div className="px-6 py-4 border-b border-border flex items-center gap-3">
            {!isClosed && canEdit && (
              <button
                onClick={handleEditClick}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-smooth"
              >
                <Icon name="Edit" size={16} />
                Edit
              </button>
            )}
            {!isClosed && canClose && (
              <button
                onClick={handleCloseClick}
                className="flex items-center gap-2 px-4 py-2 bg-success text-white rounded-lg hover:bg-success/90 transition-smooth"
              >
                <Icon name="CheckCircle" size={16} />
                Close
              </button>
            )}
            {canReopen && (
              <button
                onClick={handleReopenClick}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-smooth"
              >
                <Icon name="RotateCcw" size={16} />
                Re-open
              </button>
            )}
          </div>
        )}
        
        {/* Body */}
        <div className="p-6 space-y-6">
          {/* Photo Carousel */}
          {defect?.photos?.length > 0 && (
            <div className="relative">
              <img
                src={defect?.photos?.[currentPhotoIndex]}
                alt={`Defect photo ${currentPhotoIndex + 1}`}
                className="w-full h-64 object-cover rounded-xl cursor-pointer"
                onClick={() => window.open(defect?.photos?.[currentPhotoIndex], '_blank')}
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
              <p className="text-sm text-muted-foreground mb-1">Status</p>
              <p className="text-foreground font-medium">
                {defect?.status === 'pending_acceptance' ? 'Pending Acceptance' : defect?.status}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Priority</p>
              <p className={`font-medium ${getPriorityColor(defect?.priority)}`}>
                {defect?.priority}
              </p>
            </div>
            {defect?.defectType && (
              <div>
                <p className="text-sm text-muted-foreground mb-1">Type</p>
                <p className="text-foreground font-medium">{defect?.defectType}</p>
              </div>
            )}
            {defect?.defectSubType && (
              <div>
                <p className="text-sm text-muted-foreground mb-1">Sub-Type</p>
                <p className="text-foreground font-medium">{defect?.defectSubType}</p>
              </div>
            )}
            <div>
              <p className="text-sm text-muted-foreground mb-1">Created By</p>
              <p className="text-foreground font-medium">
                {defect?.reportedByName || defect?.submittedByName || 'Unknown'}
              </p>
              <p className="text-xs text-muted-foreground">
                {defect?.departmentOwner}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Created Date</p>
              <p className="text-foreground font-medium">{formatDate(defect?.createdAt)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Target Department</p>
              <p className="text-foreground font-medium">{defect?.departmentOwner}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Location</p>
              <p className="text-foreground font-medium">{defect?.locationPathLabel || 'No location'}</p>
              {defect?.locationFreeText && (
                <p className="text-xs text-muted-foreground mt-1">{defect?.locationFreeText}</p>
              )}
            </div>
          </div>
          
          {/* Description */}
          {defect?.description && (
            <div>
              <p className="text-sm text-muted-foreground mb-2">Description</p>
              <p className="text-foreground">{defect?.description}</p>
            </div>
          )}
          
          {/* Close-out Notes and Photo */}
          {defect?.status === 'Closed' && defect?.closedNotes && (
            <div className="bg-success/10 border border-success/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Icon name="CheckCircle" size={16} className="text-success" />
                <p className="text-sm font-medium text-success">Closed</p>
              </div>
              <p className="text-sm text-muted-foreground mb-1">Close-out notes</p>
              <p className="text-foreground mb-2">{defect?.closedNotes}</p>
              {defect?.closedByName && (
                <p className="text-xs text-muted-foreground">Closed by {defect?.closedByName}</p>
              )}
              {defect?.closedAt && (
                <p className="text-xs text-muted-foreground">{formatDate(defect?.closedAt)}</p>
              )}
              {defect?.closedPhoto && (
                <img
                  src={defect?.closedPhoto}
                  alt="Close-out photo"
                  className="w-full h-48 object-cover rounded-lg mt-3 cursor-pointer"
                  onClick={() => window.open(defect?.closedPhoto, '_blank')}
                />
              )}
            </div>
          )}
          
          {/* Re-open Info */}
          {defect?.reopenedAt && defect?.reopenedNotes && (
            <div className="bg-primary/10 border border-primary/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Icon name="RotateCcw" size={16} className="text-primary" />
                <p className="text-sm font-medium text-primary">Re-opened</p>
              </div>
              <p className="text-sm text-muted-foreground mb-1">Re-open notes</p>
              <p className="text-foreground mb-2">{defect?.reopenedNotes}</p>
              {defect?.reopenedByName && (
                <p className="text-xs text-muted-foreground">Re-opened by {defect?.reopenedByName}</p>
              )}
              {defect?.reopenedAt && (
                <p className="text-xs text-muted-foreground">{formatDate(defect?.reopenedAt)}</p>
              )}
            </div>
          )}
          
          {/* History Timeline */}
          {defect?.history?.length > 0 && (
            <div>
              <p className="text-sm font-medium text-foreground mb-3">History</p>
              <div className="space-y-3">
                {[...defect?.history]?.reverse()?.map((entry) => (
                  <div key={entry?.id} className="flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full bg-primary mt-2 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <p className="text-sm font-medium text-foreground">{entry?.message}</p>
                        <p className="text-xs text-muted-foreground">by {entry?.userName || 'Unknown User'}</p>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{formatDate(entry?.at)}</p>
                      {entry?.meta?.notes && (
                        <p className="text-xs text-muted-foreground mt-1 italic">"{entry?.meta?.notes}"</p>
                      )}
                      {entry?.meta?.reason && (
                        <p className="text-xs text-muted-foreground mt-1 italic">"{entry?.meta?.reason}"</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Activity Log */}
          {defect?.activityLog?.length > 0 && (
            <div>
              <p className="text-sm font-medium text-foreground mb-3">Activity History</p>
              <div className="space-y-2">
                {defect?.activityLog?.map((activity, index) => (
                  <div key={index} className="flex items-start gap-3 text-sm">
                    <div className="w-2 h-2 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-foreground">{activity?.summary}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(activity?.timestamp)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Decision Info (for accepted/declined defects) */}
          {(defect?.status === DefectStatus?.DECLINED || defect?.decidedAt) && defect?.decisionNotes && (
            <div className="bg-muted/30 border border-border rounded-lg p-4">
              <p className="text-sm font-medium text-foreground mb-2">
                {defect?.status === DefectStatus?.DECLINED ? 'Decline Reason' : 'Decision Notes'}
              </p>
              <p className="text-sm text-foreground">{defect?.decisionNotes}</p>
              {defect?.decidedAt && (
                <p className="text-xs text-muted-foreground mt-2">{formatDate(defect?.decidedAt)}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ViewDefectModal;