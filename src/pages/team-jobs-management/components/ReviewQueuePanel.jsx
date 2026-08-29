import React, { useState } from 'react';
import {formatTime, dateLocale } from '../../../utils/dateFormat';
import Icon from '../../../components/AppIcon';
import '../job-modals.css';

import { useAuth } from '../../../contexts/AuthContext';


import { normalizeTier, isCommand, isChief } from '../utils/tierPermissions';

import ModalShell from '../../../components/ui/ModalShell';
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
    return date?.toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <>
      <ModalShell onClose={onClose} panelClassName="jm-panel rq-panel">
        {/* Header */}
        <div className="jm-head">
          <div>
            <p className="jm-eyebrow">Jobs</p>
            <h2 className="jm-title">Pending acceptance</h2>
            <p className="jm-sub">
              {pendingAcceptanceJobs?.length} item{pendingAcceptanceJobs?.length !== 1 ? 's' : ''} awaiting review
              {isChief(tier) && memberDeptId ? ' for your department' : ''}
            </p>
          </div>
          <button onClick={onClose} className="jm-x" title="Close">
            <Icon name="X" size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="rq-tabbar">
          <div className="jm-tabs">
            <button
              onClick={() => { setActiveTab('pending-acceptance'); setSelectedCard(null); }}
              className={`jm-tab${activeTab === 'pending-acceptance' ? ' on' : ''}`}
            >
              All pending ({pendingAcceptanceJobs?.length})
            </button>
            <button
              onClick={() => { setActiveTab('self-reported'); setSelectedCard(null); }}
              className={`jm-tab${activeTab === 'self-reported' ? ' on' : ''}`}
            >
              Self-reported ({pendingReviewJobs?.length})
            </button>
            <button
              onClick={() => { setActiveTab('handoff'); setSelectedCard(null); }}
              className={`jm-tab${activeTab === 'handoff' ? ' on' : ''}`}
            >
              Cross-dept ({pendingHandoffJobs?.length})
            </button>
          </div>
        </div>

        {/* Body: queue list + detail */}
        <div className="rq-body">
          <div className="rq-list">
            {displayedJobs?.length === 0 ? (
              <div className="jm-empty">
                <div className="jm-empty-ico"><Icon name="Check" size={20} /></div>
                <p className="jm-empty-t">All caught up</p>
                <p className="jm-empty-s">
                  Nothing {activeTab === 'self-reported' ? 'reported' : activeTab === 'handoff' ? 'handed over' : 'pending'} right now.
                </p>
              </div>
            ) : (
              displayedJobs?.map(card => (
                <button
                  key={card?.id}
                  onClick={() => handleSelectCard(card)}
                  className={`rq-item${selectedCard?.id === card?.id ? ' on' : ''}`}
                >
                  <span className="rq-item-top">
                    <span className="rq-item-title">{card?.title}</span>
                    <span className={`jm-tag ${card?.jobType === 'handoff' ? 'navy' : 'warn'}`}>
                      {card?.jobType === 'handoff' ? 'Handoff' : 'Pending'}
                    </span>
                  </span>
                  <span className="rq-item-sub">
                    {card?.jobType === 'handoff'
                      ? `${card?.handoffMetadata?.sourceDepartment} → ${card?.handoffMetadata?.targetDepartment}`
                      : `By ${getCrewMemberName(card?.createdBy)}`}
                  </span>
                  <span className="rq-item-meta">
                    <span>{formatDate(card?.createdAt)}</span>
                    <span>{formatTime(card?.createdAt)}</span>
                    {card?.attachments?.length > 0 && (
                      <span className="att">
                        <Icon name="Paperclip" size={10} />
                        {card?.attachments?.length}
                      </span>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="rq-detail">
            {!selectedCard ? (
              <div className="jm-empty">
                <div className="jm-empty-ico"><Icon name="MousePointerClick" size={20} /></div>
                <p className="jm-empty-t">Select a job to review</p>
                <p className="jm-empty-s">Choose one from the queue on the left.</p>
              </div>
            ) : (
              <div className="rq-detail-inner">
                <div className="jm-section">
                  <p className="jm-label">Job</p>
                  <h2 className="rq-detail-title">{selectedCard?.title}</h2>
                </div>

                {/* Handoff metadata */}
                {selectedCard?.jobType === 'handoff' && selectedCard?.handoffMetadata && (
                  <div className="jm-section">
                    <div className="jm-notice info">
                      <Icon name="ArrowRightLeft" size={15} />
                      <span>
                        <strong>Cross-department handoff</strong>
                        <span className="rq-handoff-grid">
                          <span><em>From</em>{selectedCard?.handoffMetadata?.sourceDepartment}</span>
                          <span><em>To</em>{selectedCard?.handoffMetadata?.targetDepartment}</span>
                          <span><em>Requested by</em>{selectedCard?.handoffMetadata?.handoffByName}</span>
                          <span><em>Date</em>{formatDate(selectedCard?.handoffMetadata?.handoffAt)}</span>
                        </span>
                        {selectedCard?.handoffMetadata?.handoffNote && (
                          <span className="rq-handoff-note">{selectedCard?.handoffMetadata?.handoffNote}</span>
                        )}
                      </span>
                    </div>
                  </div>
                )}

                <div className="jm-section jm-grid">
                  <div>
                    <p className="jm-label">
                      {selectedCard?.jobType === 'handoff' ? 'Requested by' : 'Reported by'}
                    </p>
                    <p className="rq-value">{getCrewMemberName(selectedCard?.createdBy)}</p>
                  </div>
                  <div>
                    <p className="jm-label">Department</p>
                    <p className="rq-value">{selectedCard?.department || '—'}</p>
                  </div>
                  {selectedCard?.jobType !== 'handoff' && selectedCard?.completedAt && (
                    <div>
                      <p className="jm-label">Completed</p>
                      <p className="rq-value">
                        {formatDate(selectedCard?.completedAt)} at {formatTime(selectedCard?.completedAt)}
                      </p>
                    </div>
                  )}
                </div>

                <div className="jm-section">
                  <p className="jm-label">Description</p>
                  <p className="rq-body-text">
                    {selectedCard?.description || 'No description provided.'}
                  </p>
                </div>

                {selectedCard?.notes?.length > 0 && (
                  <div className="jm-section">
                    <p className="jm-label">Time spent</p>
                    {selectedCard?.notes?.map(note => (
                      <p key={note?.id} className="rq-value">{note?.text}</p>
                    ))}
                  </div>
                )}

                {selectedCard?.attachments?.length > 0 && (
                  <div className="jm-section">
                    <p className="jm-label">Attachments</p>
                    <div className="rq-attachments">
                      {selectedCard?.attachments?.map(attachment => (
                        <div key={attachment?.id} className="rq-attachment">
                          {attachment?.type?.startsWith('image/') ? (
                            <img src={attachment?.url} alt={attachment?.name} />
                          ) : (
                            <span className="ph"><Icon name="File" size={22} /></span>
                          )}
                          <span className="n">{attachment?.name}</span>
                          <span className="s">{(attachment?.size / 1024)?.toFixed(1)} KB</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Inline reject notes */}
                {showInlineReject && (
                  <div className="jm-section">
                    <div className="rq-reject">
                      <p className="jm-label" style={{ color: '#C0453C' }}>Rejection notes</p>
                      <p className="jm-hint">
                        These notes are sent back to whoever raised the job.
                      </p>
                      <textarea
                        className="jm-textarea"
                        rows={3}
                        value={inlineRejectNotes}
                        onChange={(e) => setInlineRejectNotes(e?.target?.value)}
                        placeholder="Explain why this job is being rejected…"
                      />
                      <div className="rq-reject-actions">
                        <button
                          className="jm-btn ghost"
                          onClick={() => { setShowInlineReject(false); setInlineRejectNotes(''); }}
                        >
                          Cancel
                        </button>
                        <button
                          className="jm-btn danger-solid"
                          onClick={handleInlineRejectConfirm}
                          disabled={!inlineRejectNotes?.trim()}
                        >
                          Confirm rejection
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Actions */}
                {!showInlineReject && (
                  <div className="rq-actions">
                    {selectedCard?.jobType === 'handoff' ? (
                      <>
                        <button className="jm-btn primary" onClick={handleAcceptWithEdit}>
                          <Icon name="Check" size={15} />
                          Accept handoff
                        </button>
                        <button className="jm-btn ghost" onClick={() => setShowReturnModal(selectedCard)}>
                          <Icon name="CornerUpLeft" size={15} />
                          Return
                        </button>
                        <button className="jm-btn danger" onClick={() => setShowRejectModal(selectedCard)}>
                          <Icon name="X" size={15} />
                          Reject
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="jm-btn primary" onClick={handleAcceptWithEdit}>
                          <Icon name="Check" size={15} />
                          Accept
                        </button>
                        <button
                          className="jm-btn danger"
                          onClick={() => { setShowInlineReject(true); setInlineRejectNotes(''); }}
                        >
                          <Icon name="X" size={15} />
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </ModalShell>

      {/* Reject Modal (for handoff) */}
      {showRejectModal && (
        <ModalShell
          onClose={() => setShowRejectModal(null)}
          isDirty={!!rejectReason?.trim()}
          panelClassName="jm-panel sm"
        >
          <div className="jm-head">
            <div>
              <p className="jm-eyebrow">Jobs</p>
              <h3 className="jm-title">
                {showRejectModal?.jobType === 'handoff' ? 'Reject handoff' : 'Reject job'}
              </h3>
              <p className="jm-sub">This is sent back to whoever raised it.</p>
            </div>
            <button onClick={() => setShowRejectModal(null)} className="jm-x" title="Close">
              <Icon name="X" size={18} />
            </button>
          </div>
          <div className="jm-body">
            <label className="jm-label" htmlFor="rq-reject-reason">
              Reason<span className="req">required</span>
            </label>
            <textarea
              id="rq-reject-reason"
              autoFocus
              className="jm-textarea"
              rows={4}
              value={rejectReason}
              onChange={(e) => setRejectReason(e?.target?.value)}
              placeholder="Why is this being rejected?"
            />
          </div>
          <div className="jm-foot">
            <button
              className="jm-btn ghost"
              onClick={() => { setShowRejectModal(null); setRejectReason(''); }}
            >
              Cancel
            </button>
            <div className="spacer" />
            <button className="jm-btn danger-solid" onClick={handleReject} disabled={!rejectReason?.trim()}>
              Confirm rejection
            </button>
          </div>
        </ModalShell>
      )}

      {/* Return Modal */}
      {showReturnModal && (
        <ModalShell
          onClose={() => setShowReturnModal(null)}
          isDirty={!!returnComment?.trim()}
          panelClassName="jm-panel sm"
        >
          <div className="jm-head">
            <div>
              <p className="jm-eyebrow">Jobs</p>
              <h3 className="jm-title">Return for more info</h3>
              <p className="jm-sub">Tell the sender what else you need.</p>
            </div>
            <button onClick={() => setShowReturnModal(null)} className="jm-x" title="Close">
              <Icon name="X" size={18} />
            </button>
          </div>
          <div className="jm-body">
            <label className="jm-label" htmlFor="rq-return-note">
              Feedback<span className="req">required</span>
            </label>
            <textarea
              id="rq-return-note"
              autoFocus
              className="jm-textarea"
              rows={4}
              value={returnComment}
              onChange={(e) => setReturnComment(e?.target?.value)}
              placeholder="What questions or detail are outstanding?"
            />
          </div>
          <div className="jm-foot">
            <button
              className="jm-btn ghost"
              onClick={() => { setShowReturnModal(null); setReturnComment(''); }}
            >
              Cancel
            </button>
            <div className="spacer" />
            <button className="jm-btn primary" onClick={handleReturn} disabled={!returnComment?.trim()}>
              <Icon name="CornerUpLeft" size={15} />
              Return to sender
            </button>
          </div>
        </ModalShell>
      )}
    </>
  );
};

export default ReviewQueuePanel;
