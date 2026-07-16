import React, { useState, useEffect } from 'react';
import { dateLocale } from '../../utils/dateFormat';
import { useNavigate, useParams } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { hasCommandAccess, hasChiefAccess, hasHODAccess } from '../../utils/authStorage';
import { getAllDefects, DefectStatus, DefectPriority, DefectDepartment, getOpenDefectsCount, getOverdueDefectsCount, getCriticalDefectsCount, getPendingDefectsForChief, acceptDefect, declineDefect, getSentByYouDefects, deletePendingDefect, archiveDeclinedDefect, normalizeDept, importLegacyDefects } from './utils/defectsStorage';
import { useDefectActor } from './utils/useDefectActor';
import { loadAllTypes } from './utils/defectTypeTaxonomy';
import ReportDefectModal from './components/ReportDefectModal';
import ViewDefectModal from './components/ViewDefectModal';
import SnagReportModal from './components/SnagReportModal';
import CharterReadinessBanner from './components/CharterReadinessBanner';
import ModalShell from '../../components/ui/ModalShell';
import './defects.css';

// Friendly status labels + editorial pill classes (semantic, not the accent).
const STATUS_META = {
  pending_acceptance: { cls: 'df-s-pending', label: 'Pending acceptance' },
  New: { cls: 'df-s-open', label: 'New' },
  Reopened: { cls: 'df-s-open', label: 'Reopened' },
  Assigned: { cls: 'df-s-open', label: 'Assigned' },
  InProgress: { cls: 'df-s-progress', label: 'In progress' },
  WaitingParts: { cls: 'df-s-progress', label: 'Waiting parts' },
  Fixed: { cls: 'df-s-fixed', label: 'Fixed' },
  Closed: { cls: 'df-s-closed', label: 'Closed' },
  declined: { cls: 'df-s-declined', label: 'Declined' },
};
const statusMeta = (s) => STATUS_META[s] || { cls: 'df-s-open', label: s };
const STATUS_FILTERS = [DefectStatus.NEW, DefectStatus.ASSIGNED, DefectStatus.IN_PROGRESS, DefectStatus.WAITING_PARTS, DefectStatus.FIXED, DefectStatus.REOPENED, DefectStatus.DECLINED];

const DefectsDashboard = () => {
  const navigate = useNavigate();
  const { defectId } = useParams();
  const currentUser = useDefectActor();

  // Real login/tenant tier for role detection.
  const userTier = (currentUser?.tier || '')?.toString()?.trim()?.toUpperCase();

  const [defects, setDefects] = useState([]);
  const [pendingDefects, setPendingDefects] = useState([]);
  const [sentByYouDefects, setSentByYouDefects] = useState([]);
  const [filteredDefects, setFilteredDefects] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [departmentFilter, setDepartmentFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');
  const [showReportModal, setShowReportModal] = useState(false);
  const [showSnag, setShowSnag] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedDefectId, setSelectedDefectId] = useState(null);
  const [activeTab, setActiveTab] = useState('main');
  const [showArchivedSent, setShowArchivedSent] = useState(false);
  const [acceptDeclineModal, setAcceptDeclineModal] = useState(null);
  const [declineReason, setDeclineReason] = useState('');
  const [availableTypes, setAvailableTypes] = useState([]);

  const [openCount, setOpenCount] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);
  const [criticalCount, setCriticalCount] = useState(0);

  // Load defects
  const loadDefects = async () => {
    if (!currentUser?.tenantId) return;

    // One-time migration of any legacy per-browser defects into the shared DB.
    await importLegacyDefects(currentUser);

    const allDefects = await getAllDefects(currentUser);

    // Apply department scoping for non-Command users
    let scopedDefects = allDefects;
    if (!hasCommandAccess(currentUser)) {
      const userDept = normalizeDept(currentUser?.department);
      scopedDefects = allDefects?.filter(d => normalizeDept(d?.departmentOwner) === userDept);
    }

    // Filter out pending_acceptance and deleted defects from main list
    const activeDefects = scopedDefects?.filter(d =>
      d?.status !== DefectStatus?.PENDING_ACCEPTANCE && d?.status !== 'deleted');
    setDefects(activeDefects);

    if (userTier === 'CHIEF' || userTier === 'COMMAND') {
      setPendingDefects(await getPendingDefectsForChief(currentUser));
      setSentByYouDefects(await getSentByYouDefects(currentUser));
    } else {
      setPendingDefects([]);
      setSentByYouDefects([]);
    }

    setOpenCount(getOpenDefectsCount(allDefects, currentUser));
    setOverdueCount(getOverdueDefectsCount(allDefects, currentUser));
    setCriticalCount(getCriticalDefectsCount(allDefects, currentUser));

    setAvailableTypes(loadAllTypes());
  };

  useEffect(() => {
    loadDefects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.tenantId, userTier]);

  // Handle defectId from URL
  useEffect(() => {
    if (defectId) {
      const defect = defects?.find(d => d?.id === defectId);
      if (defect) {
        setSelectedDefectId(defectId);
        setShowViewModal(true);
      }
    }
  }, [defectId, defects]);

  // Filter defects
  useEffect(() => {
    let filtered = [...defects];

    if (searchQuery?.trim()) {
      const query = searchQuery?.toLowerCase();
      filtered = filtered?.filter(d =>
        d?.title?.toLowerCase()?.includes(query) ||
        d?.description?.toLowerCase()?.includes(query) ||
        d?.locationPathLabel?.toLowerCase()?.includes(query));
    }

    if (statusFilter === 'All') {
      filtered = filtered?.filter(d => d?.status !== DefectStatus?.CLOSED);
    } else if (statusFilter === 'Closed') {
      filtered = filtered?.filter(d => d?.status === DefectStatus?.CLOSED);
    } else {
      filtered = filtered?.filter(d => d?.status === statusFilter);
    }

    if (departmentFilter !== 'All') filtered = filtered?.filter(d => d?.departmentOwner === departmentFilter);
    if (typeFilter !== 'All') filtered = filtered?.filter(d => d?.defectType === typeFilter);

    filtered?.sort((a, b) => {
      const order = { Critical: 0, High: 1, Medium: 2, Low: 3 };
      if (order?.[a?.priority] !== order?.[b?.priority]) return order?.[a?.priority] - order?.[b?.priority];
      return new Date(b?.createdAt) - new Date(a?.createdAt);
    });

    setFilteredDefects(filtered);
  }, [defects, searchQuery, statusFilter, departmentFilter, typeFilter]);

  const openDefect = (id) => { setSelectedDefectId(id); setShowViewModal(true); };
  const handleCloseViewModal = () => { setShowViewModal(false); setSelectedDefectId(null); loadDefects(); };
  const handleReportSuccess = () => { setShowReportModal(false); loadDefects(); };

  const handleAcceptDefect = async (id) => {
    await acceptDefect(id, '', currentUser);
    setAcceptDeclineModal(null); setDeclineReason(''); loadDefects();
  };
  const handleDeclineDefect = async (id) => {
    if (!declineReason?.trim()) { alert('Please provide a reason for declining'); return; }
    await declineDefect(id, declineReason, currentUser);
    setAcceptDeclineModal(null); setDeclineReason(''); loadDefects();
  };
  const handleDeletePendingDefect = async (id) => {
    if (confirm('Delete this pending defect request?')) { await deletePendingDefect(id, currentUser); loadDefects(); }
  };
  const handleArchiveDeclinedDefect = async (id) => { await archiveDeclinedDefect(id, currentUser); loadDefects(); };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    return new Date(dateString)?.toLocaleDateString(dateLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' });
  };
  const isOverdue = (defect) => {
    if (!defect?.dueDate || defect?.status === DefectStatus?.CLOSED) return false;
    const today = new Date(); today?.setHours(0, 0, 0, 0);
    return new Date(defect?.dueDate) < today;
  };

  const availableDepartments = hasCommandAccess(currentUser) ? Object.values(DefectDepartment) : [currentUser?.department];
  const isCommand = hasCommandAccess(currentUser);
  const isChief = (userTier === 'CHIEF' || userTier === 'COMMAND');

  const filteredSentByYou = sentByYouDefects?.filter(d => showArchivedSent || d?.isArchivedBySender !== true);

  return (
    <div className="df-page-outer" style={{ minHeight: '100vh', background: '#FAFAF8' }}>
      <Header />
      <div className="df-page">
        <div className="df-wrap">
          {/* Head */}
          <div className="df-head">
            <div>
              <p className="df-eyebrow">Maintenance</p>
              <h1 className="df-title">Defects</h1>
            </div>
            <div className="df-actions">
              {isChief && (
                <button
                  className={`df-btn ghost${activeTab === 'pending' ? ' pending-on' : ''}`}
                  onClick={() => setActiveTab(activeTab === 'pending' ? 'main' : 'pending')}
                >
                  <Icon name="Clock" size={16} />
                  Pending acceptance
                  {pendingDefects?.length > 0 && <span className="badge">{pendingDefects.length}</span>}
                </button>
              )}
              <button className="df-btn ghost" onClick={() => setShowSnag(true)}>
                <Icon name="FileText" size={16} /> Snag report
              </button>
              <button className="df-btn primary" onClick={() => setShowReportModal(true)}>
                <Icon name="Plus" size={16} /> Report defect
              </button>
            </div>
          </div>

          {activeTab === 'main' && (
            <>
              <CharterReadinessBanner defects={defects} onOpenDefect={openDefect} />

              {/* Search */}
              <div className="df-search">
                <Icon name="Search" size={17} className="ic" />
                <input value={searchQuery} onChange={(e) => setSearchQuery(e?.target?.value)} placeholder="Search defects, location…" />
              </div>

              {/* Status filters */}
              <div className="df-filters">
                <button className={`df-fpill${statusFilter === 'All' ? ' on' : ''}`} onClick={() => setStatusFilter('All')}>All open</button>
                {STATUS_FILTERS.map(s => (
                  <button key={s} className={`df-fpill${statusFilter === s ? ' on' : ''}`} onClick={() => setStatusFilter(s)}>{statusMeta(s).label}</button>
                ))}
                <button className={`df-fpill${statusFilter === 'Closed' ? ' on' : ''}`} onClick={() => setStatusFilter('Closed')}>Closed</button>
              </div>

              {/* Type + department filters */}
              <div className="df-filters">
                <span className="df-flabel">Type</span>
                <select className="df-fselect" value={typeFilter} onChange={(e) => setTypeFilter(e?.target?.value)}>
                  <option value="All">All types</option>
                  {availableTypes?.map(t => <option key={t?.id} value={t?.name}>{t?.name}</option>)}
                </select>
                {isCommand && (
                  <>
                    <span className="df-flabel" style={{ marginLeft: 8 }}>Dept</span>
                    <button className={`df-fpill${departmentFilter === 'All' ? ' on' : ''}`} onClick={() => setDepartmentFilter('All')}>All</button>
                    {availableDepartments?.map(dept => (
                      <button key={dept} className={`df-fpill${departmentFilter === dept ? ' on' : ''}`} onClick={() => setDepartmentFilter(dept)}>{dept}</button>
                    ))}
                  </>
                )}
              </div>

              {/* Stats */}
              <div className="df-stats">
                <div className="df-stat open"><span className="n">{openCount}</span><span className="l">Open</span></div>
                <div className="df-stat overdue"><span className="n">{overdueCount}</span><span className="l">Overdue</span></div>
                <div className="df-stat critical"><span className="n">{criticalCount}</span><span className="l">Critical</span></div>
              </div>

              {/* List */}
              <div className="df-section-h">
                <h2>{filteredDefects?.length} {filteredDefects?.length === 1 ? 'defect' : 'defects'}</h2>
              </div>
              {filteredDefects?.length === 0 ? (
                <div className="df-empty"><div className="ei">✧</div><p>No defects here — all clear.</p></div>
              ) : (
                <div className="df-list">
                  {filteredDefects?.map(defect => {
                    const sm = statusMeta(defect?.status);
                    return (
                      <div key={defect?.id} className="df-row" onClick={() => openDefect(defect?.id)}>
                        <div className="df-row-main">
                          <div className="df-row-top">
                            <span className="df-row-title">{defect?.title}</span>
                            <span className={`df-pill df-p-${defect?.priority}`}><span className="cd" />{defect?.priority}</span>
                            <span className={`df-pill ${sm.cls}`}><span className="cd" />{sm.label}</span>
                          </div>
                          <div className="df-row-meta">
                            {defect?.defectType && <span className="mi"><Icon name="Tag" size={13} />{defect?.defectType}{defect?.defectSubType ? ` · ${defect?.defectSubType}` : ''}</span>}
                            <span className="mi"><Icon name="MapPin" size={13} />{defect?.locationPathLabel || defect?.locationFreeText || 'No location'}</span>
                            {defect?.departmentOwner && <span className="mi"><Icon name="Building" size={13} />{defect?.departmentOwner}</span>}
                            {defect?.dueDate && (
                              <span className={`mi df-row-due${isOverdue(defect) ? ' over' : ''}`}>
                                <Icon name="Calendar" size={13} />Due {formatDate(defect?.dueDate)}{isOverdue(defect) ? ' · overdue' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                        <Icon name="ChevronRight" size={18} className="df-chev" />
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* Pending tab */}
          {activeTab === 'pending' && isChief && (
            <>
              <button className="df-back" onClick={() => setActiveTab('main')}><Icon name="ArrowLeft" size={15} /> Back to defects</button>

              <div className="df-section-h"><h2>Pending acceptance</h2><span className="df-count">Defects sent to your department</span></div>
              {pendingDefects?.length === 0 ? (
                <div className="df-empty"><div className="ei">✧</div><p>Nothing waiting on you.</p></div>
              ) : (
                pendingDefects?.map(defect => (
                  <div key={defect?.id} className="df-pcard">
                    <div className="df-pcard-top">
                      <span className="df-pcard-title" onClick={() => openDefect(defect?.id)}>{defect?.title}</span>
                      <span className={`df-pill df-p-${defect?.priority}`}><span className="cd" />{defect?.priority}</span>
                    </div>
                    {defect?.description && <p className="df-pcard-desc">{defect?.description}</p>}
                    <div className="df-pcard-meta">
                      <span className="mi"><Icon name="User" size={13} /> {defect?.submittedByName || defect?.createdByName || 'Unknown'}</span>
                      <span className="mi"><Icon name="MapPin" size={13} /> {defect?.locationPathLabel || defect?.locationFreeText || 'No location'}</span>
                    </div>
                    <div className="df-pcard-actions">
                      <button className="df-mini accept" onClick={(e) => { e.stopPropagation(); handleAcceptDefect(defect?.id); }}>Accept</button>
                      <button className="df-mini decline" onClick={(e) => { e.stopPropagation(); setAcceptDeclineModal({ type: 'decline', defectId: defect?.id }); setDeclineReason(''); }}>Decline</button>
                    </div>
                  </div>
                ))
              )}

              <div className="df-section-h">
                <h2>Sent by you</h2>
                <label className="df-toggle">
                  <input type="checkbox" checked={showArchivedSent} onChange={(e) => setShowArchivedSent(e?.target?.checked)} /> Show archived
                </label>
              </div>
              {filteredSentByYou?.length === 0 ? (
                <div className="df-empty"><div className="ei">✧</div><p>You haven't sent any defects.</p></div>
              ) : (
                filteredSentByYou?.map(defect => {
                  const sm = statusMeta(defect?.status);
                  const canDeletePending = defect?.status === DefectStatus?.PENDING_ACCEPTANCE && defect?.createdByUserId === currentUser?.id;
                  const canArchive = defect?.status === DefectStatus?.DECLINED && defect?.createdByUserId === currentUser?.id && defect?.isArchivedBySender !== true;
                  return (
                    <div key={defect?.id} className="df-pcard">
                      <div className="df-pcard-top">
                        <span className="df-pcard-title" onClick={() => openDefect(defect?.id)}>{defect?.title}</span>
                        <span className={`df-pill ${sm.cls}`}><span className="cd" />{sm.label}</span>
                      </div>
                      <div className="df-pcard-meta">
                        <span className="mi"><Icon name="Building" size={13} /> {defect?.departmentOwner}</span>
                        <span className="mi"><Icon name="Calendar" size={13} /> {formatDate(defect?.createdAt)}</span>
                      </div>
                      {defect?.decisionNotes && <div className="df-reason"><strong>Reason:</strong> {defect?.decisionNotes}</div>}
                      {(canDeletePending || canArchive) && (
                        <div className="df-pcard-actions">
                          {canDeletePending && <button className="df-mini decline" onClick={(e) => { e.stopPropagation(); handleDeletePendingDefect(defect?.id); }}>Delete request</button>}
                          {canArchive && <button className="df-mini ghost" onClick={(e) => { e.stopPropagation(); handleArchiveDeclinedDefect(defect?.id); }}>Archive</button>}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>
      </div>

      {/* Modals */}
      {showReportModal && <ReportDefectModal onClose={() => setShowReportModal(false)} onSuccess={handleReportSuccess} />}
      {showViewModal && selectedDefectId && (
        <ViewDefectModal defectId={selectedDefectId} onClose={handleCloseViewModal} onUpdate={loadDefects} />
      )}
      {showSnag && <SnagReportModal onClose={() => setShowSnag(false)} />}

      {acceptDeclineModal?.type === 'decline' && (
        <ModalShell onClose={() => { setAcceptDeclineModal(null); setDeclineReason(''); }} panelClassName="df-modal">
          <h3>Decline defect</h3>
          <p>Let the sender know why — they'll be notified.</p>
          <textarea value={declineReason} onChange={(e) => setDeclineReason(e?.target?.value)} placeholder="Reason for declining…" autoFocus />
          <div className="df-modal-actions">
            <button className="df-btn ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => { setAcceptDeclineModal(null); setDeclineReason(''); }}>Cancel</button>
            <button className="df-btn primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => handleDeclineDefect(acceptDeclineModal?.defectId)}>Decline</button>
          </div>
        </ModalShell>
      )}
    </div>
  );
};

export default DefectsDashboard;
