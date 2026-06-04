import React, { useMemo, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { useAuth } from '../../../contexts/AuthContext';
import { normalizeTier, isCommand, isChief } from '../utils/tierPermissions';
import '../../pantry/pantry.css';
import './ReviewQueuePanel.css';

// Canonical Cargo date/time formatting. Day-first "15 Mar 2026", 24h "14:30".
// Inline rather than a shared util because the rest of the app inlines the
// same toLocaleDateString call in place (provisioning, supplier pages, etc.) —
// no central helper to lift to.
function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}
function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

const ReviewQueuePanel = ({
  cards, teamMembers, onAccept, onReject, onEdit, onConvertToPlanned,
  onAcceptHandoff, onRejectHandoff, onReturnHandoff, onAcceptWithEdit,
  onClose, currentTenantMember, selectedDepartmentId,
}) => {
  // currentUser is destructured for parity with the previous signature but
  // unused — tier and dept come off currentTenantMember.
  useAuth();
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

  // Resolve userId → display name from the teamMembers map. Falls back to
  // "Crew member" rather than "Crew Member" so the unresolved case reads as
  // copy not a placeholder. teamMembers is expected as either an array of
  // { user_id, display_name } or a Map.
  const nameById = useMemo(() => {
    const m = new Map();
    if (Array.isArray(teamMembers)) {
      for (const tm of teamMembers) {
        const uid = tm?.user_id || tm?.userId || tm?.id;
        const name = tm?.display_name || tm?.name || tm?.full_name;
        if (uid && name) m.set(uid, name);
      }
    } else if (teamMembers && typeof teamMembers.get === 'function') {
      // Already a Map keyed by user_id → name.
      teamMembers.forEach((v, k) => m.set(k, v?.display_name || v?.name || v));
    }
    return m;
  }, [teamMembers]);
  const getCrewMemberName = (userId) => {
    if (!userId) return 'Crew member';
    return nameById.get(userId) || 'Crew member';
  };

  const pendingAcceptanceJobs = (cards || [])?.filter((card) => {
    if (card?.status !== 'pending_acceptance' && card?.status !== 'pending_review') return false;
    if (isCommand(tier)) {
      if (selectedDepartmentId && selectedDepartmentId !== 'ALL') {
        return card?.department_id === selectedDepartmentId || card?.department === selectedDepartmentId;
      }
      return true;
    }
    if (isChief(tier)) {
      return card?.department_id === memberDeptId || card?.pendingForDepartment === memberDeptId;
    }
    return false;
  });
  const pendingReviewJobs = pendingAcceptanceJobs?.filter((card) =>
    card?.jobType === 'self-reported' || card?.status === 'pending_review',
  );
  const pendingHandoffJobs = pendingAcceptanceJobs?.filter((card) =>
    card?.jobType === 'handoff' || card?.status === 'pending_acceptance',
  );

  // NOTE — pre-existing logic bug, NOT touched here: when activeTab ===
  // 'handoff' this falls through to pendingReviewJobs, so the Cross-Dept
  // tab actually shows the Self-Reported list. Flagged for follow-up.
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
    } else if (onAcceptWithEdit) {
      onAcceptWithEdit(selectedCard);
    } else if (onAccept) {
      onAccept(selectedCard?.id);
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
    if (selectedCard?.id === showRejectModal?.id) setSelectedCard(null);
  };
  const handleReturn = () => {
    if (!showReturnModal) return;
    onReturnHandoff(showReturnModal?.id, returnComment);
    setShowReturnModal(null);
    setReturnComment('');
    if (selectedCard?.id === showReturnModal?.id) setSelectedCard(null);
  };

  const subtitle = `${pendingAcceptanceJobs?.length} item${pendingAcceptanceJobs?.length !== 1 ? 's' : ''} awaiting review`
    + (isChief(tier) && memberDeptId ? ' for your department' : '');

  return (
    <div className="editorial-page">
      <div className="rq-backdrop" onClick={onClose} />
      <div className="rq-panel" role="dialog" aria-modal="true" aria-label="Pending acceptance review queue">
        <div className="rq-header">
          <div className="rq-header-row">
            <div>
              <div className="rq-eyebrow">Review queue</div>
              <h2 className="rq-title">Pending <em>acceptance</em>.</h2>
              <div className="rq-subtitle">{subtitle}</div>
            </div>
            <button type="button" className="rq-close" onClick={onClose} aria-label="Close">
              <Icon name="X" size={16} />
            </button>
          </div>

          <div className="rq-tabs" role="tablist">
            <button
              type="button" role="tab" aria-selected={activeTab === 'pending-acceptance'}
              className={`rq-tab${activeTab === 'pending-acceptance' ? ' active' : ''}`}
              onClick={() => { setActiveTab('pending-acceptance'); setSelectedCard(null); }}
            >All pending ({pendingAcceptanceJobs?.length})</button>
            <button
              type="button" role="tab" aria-selected={activeTab === 'self-reported'}
              className={`rq-tab${activeTab === 'self-reported' ? ' active' : ''}`}
              onClick={() => { setActiveTab('self-reported'); setSelectedCard(null); }}
            >Self-reported ({pendingReviewJobs?.length})</button>
            <button
              type="button" role="tab" aria-selected={activeTab === 'handoff'}
              className={`rq-tab${activeTab === 'handoff' ? ' active' : ''}`}
              onClick={() => { setActiveTab('handoff'); setSelectedCard(null); }}
            >Cross-dept ({pendingHandoffJobs?.length})</button>
          </div>
        </div>

        <div className="rq-body">
          {/* Left: job list */}
          <div className="rq-list">
            {displayedJobs?.length === 0 ? (
              <div className="rq-empty">
                <Icon name="CheckCircle" size={40} />
                <div className="rq-empty-msg">All caught up</div>
                <div className="rq-empty-sub">
                  No pending {activeTab === 'self-reported' ? 'reviews' : activeTab === 'handoff' ? 'handoffs' : 'items'} at the moment
                </div>
              </div>
            ) : (
              displayedJobs?.map((card) => (
                <button
                  key={card?.id}
                  type="button"
                  onClick={() => handleSelectCard(card)}
                  className={`rq-list-item${selectedCard?.id === card?.id ? ' is-selected' : ''}`}
                >
                  <div className="rq-list-item-head">
                    <div className="rq-list-item-title">{card?.title}</div>
                    <span className={`rq-tag${card?.jobType === 'handoff' ? ' handoff' : ''}`}>
                      {card?.jobType === 'handoff' ? 'Handoff' : 'Pending'}
                    </span>
                  </div>
                  <div className="rq-list-item-by">
                    {card?.jobType === 'handoff'
                      ? `${card?.handoffMetadata?.sourceDepartment} → ${card?.handoffMetadata?.targetDepartment}`
                      : `By ${getCrewMemberName(card?.createdBy)}`}
                  </div>
                  <div className="rq-list-item-date">
                    <span>{formatDate(card?.createdAt)}</span>
                    <span>{formatTime(card?.createdAt)}</span>
                  </div>
                  {card?.attachments?.length > 0 && (
                    <div className="rq-list-item-attach">
                      <Icon name="Paperclip" size={11} />
                      <span>{card?.attachments?.length} attachment{card?.attachments?.length > 1 ? 's' : ''}</span>
                    </div>
                  )}
                </button>
              ))
            )}
          </div>

          {/* Right: detail */}
          <div className="rq-detail">
            {!selectedCard ? (
              <div className="rq-empty">
                <Icon name="ArrowLeft" size={40} />
                <div className="rq-empty-msg">Select an item to review</div>
                <div className="rq-empty-sub">Choose one from the list on the left</div>
              </div>
            ) : (
              <div className="rq-detail-body">
                <div>
                  <div className="rq-field-label">Task title</div>
                  <h3 className="rq-detail-title">{selectedCard?.title}</h3>
                </div>

                {selectedCard?.jobType === 'handoff' && selectedCard?.handoffMetadata && (
                  <div className="rq-handoff">
                    <div className="rq-handoff-head">
                      <Icon name="ArrowRightLeft" size={14} />
                      <span>Cross-department handoff</span>
                    </div>
                    <div className="rq-handoff-grid">
                      <div>From<b>{selectedCard?.handoffMetadata?.sourceDepartment}</b></div>
                      <div>To<b>{selectedCard?.handoffMetadata?.targetDepartment}</b></div>
                      <div>Requested by<b>{selectedCard?.handoffMetadata?.handoffByName}</b></div>
                      <div>Date<b>{formatDate(selectedCard?.handoffMetadata?.handoffAt)}</b></div>
                    </div>
                    {selectedCard?.handoffMetadata?.handoffNote && (
                      <div className="rq-handoff-note">
                        <div className="rq-handoff-note-label">Handoff note</div>
                        <div className="rq-handoff-note-text">{selectedCard?.handoffMetadata?.handoffNote}</div>
                      </div>
                    )}
                  </div>
                )}

                <div className="rq-meta-grid">
                  <div>
                    <div className="rq-field-label">
                      {selectedCard?.jobType === 'handoff' ? 'Requested by' : 'Reported by'}
                    </div>
                    <div className="rq-field-value">{getCrewMemberName(selectedCard?.createdBy)}</div>
                  </div>
                  <div>
                    <div className="rq-field-label">Department</div>
                    <div className="rq-field-value">{selectedCard?.department || '—'}</div>
                  </div>
                  {selectedCard?.jobType !== 'handoff' && selectedCard?.completedAt && (
                    <div>
                      <div className="rq-field-label">Completed</div>
                      <div className="rq-field-value">
                        {formatDate(selectedCard?.completedAt)} at {formatTime(selectedCard?.completedAt)}
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <div className="rq-field-label">Description</div>
                  <div className={`rq-description${selectedCard?.description ? '' : ' empty'}`}>
                    {selectedCard?.description || 'No description provided'}
                  </div>
                </div>

                {selectedCard?.notes?.length > 0 && (
                  <div>
                    <div className="rq-field-label">Time spent</div>
                    <div className="rq-notes-list">
                      {selectedCard?.notes?.map((note) => (
                        <div key={note?.id} className="rq-note">{note?.text}</div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedCard?.attachments?.length > 0 && (
                  <div>
                    <div className="rq-field-label">Attachments</div>
                    <div className="rq-attachments">
                      {selectedCard?.attachments?.map((attachment) => (
                        <div key={attachment?.id} className="rq-attachment">
                          {attachment?.type?.startsWith('image/') ? (
                            <img src={attachment?.url} alt={attachment?.name} className="rq-attachment-thumb" />
                          ) : (
                            <div className="rq-attachment-thumb file">
                              <Icon name="file" size={28} />
                            </div>
                          )}
                          <div className="rq-attachment-name">{attachment?.name}</div>
                          <div className="rq-attachment-size">
                            {(attachment?.size / 1024)?.toFixed(1)} KB
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {showInlineReject && (
                  <div className="rq-reject">
                    <div className="rq-reject-head">
                      <Icon name="XCircle" size={14} />
                      <span>Rejection notes</span>
                    </div>
                    <div className="rq-reject-hint">
                      These notes will be sent back to the job creator as a notification.
                    </div>
                    <textarea
                      className="rq-textarea"
                      value={inlineRejectNotes}
                      onChange={(e) => setInlineRejectNotes(e?.target?.value)}
                      placeholder="Explain why this job is being rejected…"
                      rows={3}
                    />
                    <div className="rq-reject-actions">
                      <button
                        type="button" className="rq-btn ghost"
                        onClick={() => { setShowInlineReject(false); setInlineRejectNotes(''); }}
                      >Cancel</button>
                      <button
                        type="button" className="rq-btn danger"
                        onClick={handleInlineRejectConfirm}
                        disabled={!inlineRejectNotes?.trim()}
                      >Confirm rejection</button>
                    </div>
                  </div>
                )}

                {!showInlineReject && (
                  <div className="rq-actions">
                    {selectedCard?.jobType === 'handoff' ? (
                      <>
                        <button type="button" className="rq-btn primary" onClick={handleAcceptWithEdit}>
                          <Icon name="Check" size={14} />
                          Accept handoff
                        </button>
                        <button type="button" className="rq-btn ghost" onClick={() => setShowReturnModal(selectedCard)}>
                          <Icon name="CornerUpLeft" size={14} />
                          Return
                        </button>
                        <button type="button" className="rq-btn ghost" onClick={() => setShowRejectModal(selectedCard)}>
                          <Icon name="X" size={14} />
                          Reject
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="rq-btn primary" onClick={handleAcceptWithEdit}>
                          <Icon name="CheckCircle" size={14} />
                          Accept
                        </button>
                        <button
                          type="button" className="rq-btn ghost"
                          onClick={() => { setShowInlineReject(true); setInlineRejectNotes(''); }}
                        >
                          <Icon name="XCircle" size={14} />
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
      </div>

      {showRejectModal && (
        <div className="rq-inner-backdrop" onClick={() => { setShowRejectModal(null); setRejectReason(''); }}>
          <div className="rq-inner-panel" onClick={(e) => e.stopPropagation()}>
            <h3 className="rq-inner-title">
              {showRejectModal?.jobType === 'handoff' ? 'Reject handoff' : 'Reject task'}
            </h3>
            <div className="rq-inner-body">Please provide a reason for rejection.</div>
            <textarea
              className="rq-textarea"
              value={rejectReason}
              onChange={(e) => setRejectReason(e?.target?.value)}
              placeholder="Enter rejection reason…"
              rows={4}
            />
            <div className="rq-inner-actions">
              <button
                type="button" className="rq-btn ghost"
                onClick={() => { setShowRejectModal(null); setRejectReason(''); }}
              >Cancel</button>
              <button
                type="button" className="rq-btn danger"
                onClick={handleReject}
                disabled={!rejectReason?.trim()}
              >Confirm rejection</button>
            </div>
          </div>
        </div>
      )}

      {showReturnModal && (
        <div className="rq-inner-backdrop" onClick={() => { setShowReturnModal(null); setReturnComment(''); }}>
          <div className="rq-inner-panel" onClick={(e) => e.stopPropagation()}>
            <h3 className="rq-inner-title">Return handoff for more info</h3>
            <div className="rq-inner-body">
              Provide feedback on what additional information is needed.
            </div>
            <textarea
              className="rq-textarea"
              value={returnComment}
              onChange={(e) => setReturnComment(e?.target?.value)}
              placeholder="Enter feedback or questions…"
              rows={4}
            />
            <div className="rq-inner-actions">
              <button
                type="button" className="rq-btn ghost"
                onClick={() => { setShowReturnModal(null); setReturnComment(''); }}
              >Cancel</button>
              <button
                type="button" className="rq-btn primary"
                onClick={handleReturn}
                disabled={!returnComment?.trim()}
              >Return to sender</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReviewQueuePanel;
