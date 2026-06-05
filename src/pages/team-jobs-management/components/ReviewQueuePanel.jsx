import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

import { useAuth } from '../../../contexts/AuthContext';


import { normalizeTier, isCommand, isChief } from '../utils/tierPermissions';

const ReviewQueuePanel = ({ cards, onAccept, onReject, onEdit, onConvertToPlanned, onAcceptHandoff, onRejectHandoff, onReturnHandoff, onAcceptWithEdit, onClose, currentTenantMember, selectedDepartmentId }) => {
  const { currentUser } = useAuth();
  const [selectedCard, setSelectedCard] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(null);
  const [showInlineReject, setShowInlineReject] = useState(false);
  const [inlineRejectNotes, setInlineRejectNotes] = useState('');
  const [returnComment, setReturnComment] = useState('');
  const [showReturnModal, setShowReturnModal] = useState(null);
  const [activeTab, setActiveTab] = useState('pending-acceptance');

  const tier = normalizeTier(currentTenantMember?.permission_tier);
  const memberDeptId = currentTenantMember?.department_id;

  // Pending acceptance jobs: filter by department for CHIEF, all for COMMAND
  const pendingAcceptanceJobs = (cards || [])?.filter(card => {
    if (card?.status !== 'pending_acceptance' && card?.status !== 'pending_review') return false;
    if (isCommand(tier)) {
      // COMMAND: if viewing a specific dept, filter to that dept; otherwise show all
      if (selectedDepartmentId && selectedDepartmentId !== 'ALL') {
        return card?.department_id === selectedDepartmentId || card?.department === selectedDepartmentId;
      }
      return true;
    }
    if (isChief(tier)) {
      // CHIEF: only their own department's pending items
      return card?.department_id === memberDeptId || card?.pendingForDepartment === memberDeptId;
    }
    return false;
  });

  // Self-reported jobs (legacy tab)
  const pendingReviewJobs = pendingAcceptanceJobs?.filter(card =>
    card?.jobType === 'self-reported' || card?.status === 'pending_review'
  );

  // Handoff / cross-dept jobs
  const pendingHandoffJobs = pendingAcceptanceJobs?.filter(card =>
    card?.jobType === 'handoff' || card?.status === 'pending_acceptance'
  );

  const displayedJobs = activeTab === 'pending-acceptance' ? pendingAcceptanceJobs : pendingReviewJobs;

  const handleSelectCard = (card) => {
    setSelectedCard(card);
    setShowInlineReject(false);
    setInlineRejectNotes('');
  };

  const handleAcceptWithEdit = () => {
    if (!selectedCard) return;
    if (selectedCard?.jobType === 'handoff') {
      onAcceptHandoff(selectedCard?.id);
    } else {
      // Open job in edit/acceptance modal
      if (onAcceptWithEdit) {
        onAcceptWithEdit(selectedCard);
      } else if (onAccept) {
        onAccept(selectedCard?.id);
      }
    }
    setSelectedCard(null);
  };

  const handleInlineRejectConfirm = () => {
    if (!selectedCard || !inlineRejectNotes?.trim()) return;
    if (selectedCard?.jobType === 'handoff') {
      onRejectHandoff(selectedCard?.id, inlineRejectNotes);
    } else {
      onReject(selectedCard?.id, inlineRejectNotes);
    }
    setShowInlineReject(false);
    setInlineRejectNotes('');
    setSelectedCard(null);
  };

  const handleReject = () => {
    if (!showRejectModal) return;
    if (showRejectModal?.jobType === 'handoff') {
      onRejectHandoff(showRejectModal?.id, rejectReason);
    } else {
      onReject(showRejectModal?.id, rejectReason);
    }
    setShowRejectModal(null);
    setRejectReason('');
    if (selectedCard?.id === showRejectModal?.id) {
      setSelectedCard(null);
    }
  };

  const handleReturn = () => {
    if (!showReturnModal) return;
    onReturnHandoff(showReturnModal?.id, returnComment);
    setShowReturnModal(null);
    setReturnComment('');
    if (selectedCard?.id === showReturnModal?.id) {
      setSelectedCard(null);
    }
  };

  const getCrewMemberName = (userId) => {
    // In production, fetch from team members
    return 'Crew Member';
  };

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatTime = (dateStr) => {
    const date = new Date(dateStr);
    return date?.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full h-[90vh] flex flex-col">
        {/* Header */}
        <div className="border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Pending Acceptance</h2>
              <p className="text-sm text-gray-500 mt-1">
                {pendingAcceptanceJobs?.length} item{pendingAcceptanceJobs?.length !== 1 ? 's' : ''} awaiting review
                {isChief(tier) && memberDeptId ? ' for your department' : ''}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <Icon name="X" size={24} />
            </button>
          </div>
          
          {/* Tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => {
                setActiveTab('pending-acceptance');
                setSelectedCard(null);
              }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'pending-acceptance' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              All Pending ({pendingAcceptanceJobs?.length})
            </button>
            <button
              onClick={() => {
                setActiveTab('self-reported');
                setSelectedCard(null);
              }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'self-reported' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Self-Reported ({pendingReviewJobs?.length})
            </button>
            <button
              onClick={() => {
                setActiveTab('handoff');
                setSelectedCard(null);
              }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'handoff'
                  ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Cross-Dept ({pendingHandoffJobs?.length})
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Job List */}
          <div className="w-1/3 border-r border-gray-200 overflow-y-auto">
            {displayedJobs?.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-6">
                <Icon name="CheckCircle" size={48} className="text-gray-300 mb-3" />
                <p className="text-gray-500 font-medium">All caught up!</p>
                <p className="text-sm text-gray-400 mt-1">
                  No pending {activeTab === 'self-reported' ? 'reviews' : 'handoffs'} at the moment
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {displayedJobs?.map(card => (
                  <div
                    key={card?.id}
                    onClick={() => handleSelectCard(card)}
                    className={`p-4 cursor-pointer transition-colors ${
                      selectedCard?.id === card?.id
                        ? 'bg-blue-50 border-l-4 border-blue-500' :'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-gray-900 truncate">{card?.title}</h3>
                        <p className="text-sm text-gray-500 mt-1">
                          {card?.jobType === 'handoff' 
                            ? `From ${card?.handoffMetadata?.sourceDepartment} → ${card?.handoffMetadata?.targetDepartment}`
                            : `By ${getCrewMemberName(card?.createdBy)}`
                          }
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs text-gray-400">{formatDate(card?.createdAt)}</span>
                          <span className="text-xs text-gray-400">{formatTime(card?.createdAt)}</span>
                        </div>
                      </div>
                      <div className="flex-shrink-0">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          card?.jobType === 'handoff'
                            ? 'bg-purple-100 text-purple-800' :'bg-yellow-100 text-yellow-800'
                        }`}>
                          {card?.jobType === 'handoff' ? 'Handoff' : 'Pending'}
                        </span>
                      </div>
                    </div>
                    {card?.attachments?.length > 0 && (
                      <div className="flex items-center gap-1 mt-2 text-xs text-gray-500">
                        <Icon name="Paperclip" size={12} />
                        <span>{card?.attachments?.length} attachment{card?.attachments?.length > 1 ? 's' : ''}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Job Detail */}
          <div className="flex-1 overflow-y-auto">
            {!selectedCard ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-6">
                <Icon name="ArrowLeft" size={48} className="text-gray-300 mb-3" />
                <p className="text-gray-500 font-medium">Select a task to review</p>
                <p className="text-sm text-gray-400 mt-1">Choose from the list on the left</p>
              </div>
            ) : (
              <div className="p-6 space-y-6">
                {/* Title */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-2">
                    Task Title
                  </label>
                  <h2 className="text-2xl font-semibold text-gray-900">{selectedCard?.title}</h2>
                </div>

                {/* Handoff Metadata */}
                {selectedCard?.jobType === 'handoff' && selectedCard?.handoffMetadata && (
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 space-y-2">
                    <div className="flex items-center gap-2 text-purple-700">
                      <Icon name="ArrowRightLeft" size={16} />
                      <h4 className="font-medium text-sm">Cross-Department Handoff</h4>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <span className="text-gray-600">From:</span>
                        <span className="ml-2 font-medium text-gray-900">{selectedCard?.handoffMetadata?.sourceDepartment}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">To:</span>
                        <span className="ml-2 font-medium text-gray-900">{selectedCard?.handoffMetadata?.targetDepartment}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Requested by:</span>
                        <span className="ml-2 font-medium text-gray-900">{selectedCard?.handoffMetadata?.handoffByName}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Date:</span>
                        <span className="ml-2 font-medium text-gray-900">{formatDate(selectedCard?.handoffMetadata?.handoffAt)}</span>
                      </div>
                    </div>
                    {selectedCard?.handoffMetadata?.handoffNote && (
                      <div className="mt-2 pt-2 border-t border-purple-200">
                        <span className="text-xs text-gray-600 uppercase">Handoff Note:</span>
                        <p className="text-sm text-gray-900 mt-1">{selectedCard?.handoffMetadata?.handoffNote}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Metadata */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase mb-1">
                      {selectedCard?.jobType === 'handoff' ? 'Requested By' : 'Reported By'}
                    </label>
                    <p className="text-sm text-gray-900">{getCrewMemberName(selectedCard?.createdBy)}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase mb-1">
                      Department
                    </label>
                    <p className="text-sm text-gray-900">{selectedCard?.department}</p>
                  </div>
                  {selectedCard?.jobType !== 'handoff' && selectedCard?.completedAt && (
                    <div>
                      <label className="block text-xs font-medium text-gray-500 uppercase mb-1">
                        Completed At
                      </label>
                      <p className="text-sm text-gray-900">
                        {formatDate(selectedCard?.completedAt)} at {formatTime(selectedCard?.completedAt)}
                      </p>
                    </div>
                  )}
                </div>

                {/* Description */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-2">
                    Description
                  </label>
                  <p className="text-gray-700 whitespace-pre-wrap">
                    {selectedCard?.description || 'No description provided'}
                  </p>
                </div>

                {/* Time Spent */}
                {selectedCard?.notes?.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase mb-2">
                      Time Spent
                    </label>
                    {selectedCard?.notes?.map(note => (
                      <p key={note?.id} className="text-sm text-gray-700">{note?.text}</p>
                    ))}
                  </div>
                )}

                {/* Attachments */}
                {selectedCard?.attachments?.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase mb-2">
                      Attachments
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      {selectedCard?.attachments?.map(attachment => (
                        <div
                          key={attachment?.id}
                          className="border border-gray-200 rounded-lg p-3 hover:border-blue-500 transition-colors cursor-pointer"
                        >
                          {attachment?.type?.startsWith('image/') ? (
                            <img
                              src={attachment?.url}
                              alt={attachment?.name}
                              className="w-full h-32 object-cover rounded mb-2"
                            />
                          ) : (
                            <div className="w-full h-32 bg-gray-100 rounded mb-2 flex items-center justify-center">
                              <Icon name="file" size={32} className="text-gray-400" />
                            </div>
                          )}
                          <p className="text-xs text-gray-700 truncate">{attachment?.name}</p>
                          <p className="text-xs text-gray-400">
                            {(attachment?.size / 1024)?.toFixed(1)} KB
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Inline Reject Notes */}
                {showInlineReject && (
                  <div className="border border-red-200 bg-red-50 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2 text-red-700">
                      <Icon name="XCircle" size={16} />
                      <h4 className="font-medium text-sm">Rejection Notes</h4>
                    </div>
                    <p className="text-xs text-red-600">
                      These notes will be sent back to the job creator as a notification.
                    </p>
                    <textarea
                      value={inlineRejectNotes}
                      onChange={(e) => setInlineRejectNotes(e?.target?.value)}
                      placeholder="Explain why this job is being rejected..."
                      rows={3}
                      className="w-full px-3 py-2 border border-red-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-400 text-sm text-gray-900"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setShowInlineReject(false); setInlineRejectNotes(''); }}
                        className="flex-1 px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleInlineRejectConfirm}
                        disabled={!inlineRejectNotes?.trim()}
                        className="flex-1 px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
                      >
                        Confirm Rejection
                      </button>
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                {!showInlineReject && (
                  <div className="flex items-center gap-3 pt-4 border-t border-gray-200">
                    {selectedCard?.jobType === 'handoff' ? (
                      <>
                        <Button
                          variant="default"
                          iconName="Check"
                          onClick={handleAcceptWithEdit}
                          fullWidth
                        >
                          Accept Handoff
                        </Button>
                        <Button
                          variant="outline"
                          iconName="CornerUpLeft"
                          onClick={() => setShowReturnModal(selectedCard)}
                          fullWidth
                        >
                          Return
                        </Button>
                        <Button
                          variant="outline"
                          iconName="X"
                          onClick={() => setShowRejectModal(selectedCard)}
                          fullWidth
                        >
                          Reject
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="default"
                          iconName="CheckCircle"
                          onClick={handleAcceptWithEdit}
                          fullWidth
                        >
                          Accept
                        </Button>
                        <Button
                          variant="outline"
                          iconName="XCircle"
                          onClick={() => {
                            setShowInlineReject(true);
                            setInlineRejectNotes('');
                          }}
                          fullWidth
                        >
                          Reject
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Reject Modal (for handoff) */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {showRejectModal?.jobType === 'handoff' ? 'Reject Handoff' : 'Reject Task'}
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Please provide a reason for rejection:
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e?.target?.value)}
              placeholder="Enter rejection reason..."
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 mb-4"
            />
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setShowRejectModal(null);
                  setRejectReason('');
                }}
                fullWidth
              >
                Cancel
              </Button>
              <Button
                variant="default"
                onClick={handleReject}
                disabled={!rejectReason?.trim()}
                fullWidth
              >
                Confirm Rejection
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Return Modal */}
      {showReturnModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Return Handoff for More Info
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Provide feedback on what additional information is needed:
            </p>
            <textarea
              value={returnComment}
              onChange={(e) => setReturnComment(e?.target?.value)}
              placeholder="Enter feedback or questions..."
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
            />
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setShowReturnModal(null);
                  setReturnComment('');
                }}
                fullWidth
              >
                Cancel
              </Button>
              <Button
                variant="default"
                onClick={handleReturn}
                disabled={!returnComment?.trim()}
                fullWidth
              >
                Return to Sender
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReviewQueuePanel;
