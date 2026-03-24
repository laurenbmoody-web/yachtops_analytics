import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { getCurrentUser, hasCommandAccess, hasChiefAccess, hasHODAccess } from '../../utils/authStorage';
import { getAllDefects, DefectStatus, DefectPriority, DefectDepartment, getOpenDefectsCount, getOverdueDefectsCount, getCriticalDefectsCount, getPendingDefectsForChief, acceptDefect, declineDefect, getSentByYouDefects, deletePendingDefect, archiveDeclinedDefect, normalizeDept } from './utils/defectsStorage';
import { loadAllTypes } from './utils/defectTypeTaxonomy';
import ReportDefectModal from './components/ReportDefectModal';
import ViewDefectModal from './components/ViewDefectModal';

const DefectsDashboard = () => {
  const navigate = useNavigate();
  const { defectId } = useParams();
  const currentUser = getCurrentUser();
  
  // Use effectiveTier for role detection
  const userTierRaw = currentUser?.effectiveTier || currentUser?.roleTier || currentUser?.permissionTier || currentUser?.tier || '';
  const userTier = userTierRaw?.trim()?.toUpperCase();
  
  const [defects, setDefects] = useState([]);
  const [pendingDefects, setPendingDefects] = useState([]);
  const [sentByYouDefects, setSentByYouDefects] = useState([]);
  const [filteredDefects, setFilteredDefects] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [departmentFilter, setDepartmentFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');
  const [showReportModal, setShowReportModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedDefectId, setSelectedDefectId] = useState(null);
  const [activeTab, setActiveTab] = useState('main');
  const [showArchivedSent, setShowArchivedSent] = useState(false);
  const [acceptDeclineModal, setAcceptDeclineModal] = useState(null);
  const [declineReason, setDeclineReason] = useState('');
  const [showAcceptDeclineModal, setShowAcceptDeclineModal] = useState(false);
  const [selectedPendingDefect, setSelectedPendingDefect] = useState(null);
  const [declineNotes, setDeclineNotes] = useState('');
  const [availableTypes, setAvailableTypes] = useState([]);
  
  // Widget counts
  const [openCount, setOpenCount] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);
  const [criticalCount, setCriticalCount] = useState(0);
  
  // Load defects
  const loadDefects = () => {
    const allDefects = getAllDefects(currentUser);
    
    // Apply department scoping for non-Command users
    let scopedDefects = allDefects;
    if (!hasCommandAccess(currentUser)) {
      const userDept = normalizeDept(currentUser?.department);
      scopedDefects = allDefects?.filter(d => {
        const defectDept = normalizeDept(d?.departmentOwner);
        return defectDept === userDept;
      });
    }
    
    // Filter out pending_acceptance and deleted defects from main list
    const activeDefects = scopedDefects?.filter(d => 
      d?.status !== DefectStatus?.PENDING_ACCEPTANCE && 
      d?.status !== 'deleted'
    );
    setDefects(activeDefects);
    
    // Load pending defects for Chiefs (with proper role detection)
    if (userTier === 'CHIEF' || userTier === 'COMMAND') {
      const pending = getPendingDefectsForChief(currentUser);
      setPendingDefects(pending);
      
      // Load sent by you defects
      const sentByYou = getSentByYouDefects(currentUser);
      setSentByYouDefects(sentByYou);
    } else {
      setPendingDefects([]);
      setSentByYouDefects([]);
    }
    
    // Update counts with department scoping
    setOpenCount(getOpenDefectsCount(currentUser));
    setOverdueCount(getOverdueDefectsCount(currentUser));
    setCriticalCount(getCriticalDefectsCount(currentUser));
    
    // Load available types from taxonomy
    const types = loadAllTypes();
    setAvailableTypes(types);
  };
  
  useEffect(() => {
    loadDefects();
  }, []);
  
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
    
    // Search filter
    if (searchQuery?.trim()) {
      const query = searchQuery?.toLowerCase();
      filtered = filtered?.filter(d => 
        d?.title?.toLowerCase()?.includes(query) ||
        d?.description?.toLowerCase()?.includes(query) ||
        d?.locationPathLabel?.toLowerCase()?.includes(query)
      );
    }
    
    // Status filter
    if (statusFilter === 'All') {
      // Exclude closed defects from default All view
      filtered = filtered?.filter(d => d?.status !== DefectStatus?.CLOSED);
    } else if (statusFilter === 'Closed') {
      // Show only closed defects
      filtered = filtered?.filter(d => d?.status === DefectStatus?.CLOSED);
    } else if (statusFilter !== 'All') {
      filtered = filtered?.filter(d => d?.status === statusFilter);
    }
    
    // Department filter
    if (departmentFilter !== 'All') {
      filtered = filtered?.filter(d => d?.departmentOwner === departmentFilter);
    }
    
    // Type filter
    if (typeFilter !== 'All') {
      filtered = filtered?.filter(d => d?.defectType === typeFilter);
    }
    
    // Sort by priority (Critical first) then by createdAt (newest first)
    filtered?.sort((a, b) => {
      const priorityOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 };
      if (priorityOrder?.[a?.priority] !== priorityOrder?.[b?.priority]) {
        return priorityOrder?.[a?.priority] - priorityOrder?.[b?.priority];
      }
      return new Date(b?.createdAt) - new Date(a?.createdAt);
    });
    
    setFilteredDefects(filtered);
  }, [defects, searchQuery, statusFilter, departmentFilter, typeFilter]);
  
  const handleDefectClick = (defect) => {
    // Open modal instead of navigating
    setSelectedDefectId(defect?.id);
    setShowViewModal(true);
  };
  
  const handleCloseViewModal = () => {
    setShowViewModal(false);
    setSelectedDefectId(null);
    loadDefects();
  };
  
  const handleReportSuccess = () => {
    setShowReportModal(false);
    loadDefects();
  };
  
  const handleAcceptDefect = (defectId) => {
    acceptDefect(defectId, '');
    setAcceptDeclineModal(null);
    setDeclineReason('');
    loadDefects();
  };
  
  const handleDeclineDefect = (defectId) => {
    if (!declineReason?.trim()) {
      alert('Please provide a reason for declining');
      return;
    }
    declineDefect(defectId, declineReason);
    setAcceptDeclineModal(null);
    setDeclineReason('');
    loadDefects();
  };
  
  const handleDeletePendingDefect = (defectId) => {
    if (confirm('Delete this pending defect request?')) {
      deletePendingDefect(defectId);
      loadDefects();
    }
  };
  
  const handleArchiveDeclinedDefect = (defectId) => {
    archiveDeclinedDefect(defectId);
    loadDefects();
  };
  
  const handlePendingDefectClick = (defect) => {
    // Open ViewDefectModal for pending defects (same as main list)
    setSelectedDefectId(defect?.id);
    setShowViewModal(true);
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
  
  const isOverdue = (defect) => {
    if (!defect?.dueDate || defect?.status === DefectStatus?.CLOSED) return false;
    const today = new Date();
    today?.setHours(0, 0, 0, 0);
    const dueDate = new Date(defect?.dueDate);
    return dueDate < today;
  };
  
  // Determine available departments for filter
  const availableDepartments = hasCommandAccess(currentUser) 
    ? Object.values(DefectDepartment)
    : [currentUser?.department];
  
  const isCommand = hasCommandAccess(currentUser);
  const isChiefOrHOD = hasChiefAccess(currentUser) || hasHODAccess(currentUser);
  const isChief = (userTier === 'CHIEF' || userTier === 'COMMAND');
  
  // Filter sent by you defects based on archive toggle
  const filteredSentByYou = sentByYouDefects?.filter(defect => {
    if (!showArchivedSent && defect?.isArchivedBySender === true) {
      return false;
    }
    return true;
  });
  
  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[1800px] mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-3xl font-bold text-foreground">Defects</h1>
            <div className="flex items-center gap-3">
              {/* Pending Acceptance Button (Chiefs only) */}
              {(isChief || isCommand) && (
                <button
                  onClick={() => setActiveTab('pending')}
                  className={`relative flex items-center gap-2 px-4 py-2 rounded-lg transition-smooth ${
                    activeTab === 'pending' ?'bg-warning text-white' :'bg-card border border-border text-foreground hover:bg-muted'
                  }`}
                >
                  <Icon name="Clock" size={20} />
                  Pending Acceptance ({pendingDefects?.length || 0})
                  {pendingDefects?.length > 0 && (
                    <span className="absolute -top-1 -right-1 bg-error text-white text-xs font-semibold rounded-full w-5 h-5 flex items-center justify-center">
                      {pendingDefects?.length}
                    </span>
                  )}
                </button>
              )}
              <button
                onClick={() => setShowReportModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-smooth"
              >
                <Icon name="Plus" size={20} />
                Report defect
              </button>
            </div>
          </div>
          
          {/* Search Bar */}
          <div className="relative mb-4">
            <Icon name="Search" size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search defects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e?.target?.value)}
              className="w-full pl-10 pr-4 py-2 bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          
          {/* Status Filter Chips */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <button
              onClick={() => setStatusFilter('All')}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-smooth ${
                statusFilter === 'All' ?'bg-primary text-white' :'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              All
            </button>
            {/* Only show non-pending_acceptance statuses */}
            {[DefectStatus?.NEW, DefectStatus?.ASSIGNED, DefectStatus?.IN_PROGRESS, DefectStatus?.WAITING_PARTS, DefectStatus?.FIXED, DefectStatus?.REOPENED, DefectStatus?.DECLINED]?.map(status => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-smooth ${
                  statusFilter === status 
                    ? 'bg-primary text-white' :'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {status}
              </button>
            ))}
            {/* Closed filter as separate chip */}
            <button
              onClick={() => setStatusFilter('Closed')}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-smooth ${
                statusFilter === 'Closed' ?'bg-primary text-white' :'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              Closed
            </button>
          </div>
          
          {/* Type Filter Dropdown */}
          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center gap-2">
              <label className="text-sm text-muted-foreground">Type:</label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e?.target?.value)}
                className="px-3 py-1.5 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="All">All Types</option>
                {availableTypes?.map(type => (
                  <option key={type?.id} value={type?.name}>
                    {type?.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          
          {/* Department Filter */}
          {isCommand && (
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <span className="text-sm text-muted-foreground">Department:</span>
              <button
                onClick={() => setDepartmentFilter('All')}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-smooth ${
                  departmentFilter === 'All' ?'bg-primary text-white' :'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                All
              </button>
              {availableDepartments?.map(dept => (
                <button
                  key={dept}
                  onClick={() => setDepartmentFilter(dept)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-smooth ${
                    departmentFilter === dept 
                      ? 'bg-primary text-white' :'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {dept}
                </button>
              ))}
            </div>
          )}
        </div>
        
        {/* Main Tab Content */}
        {activeTab === 'main' && (
          <>
            {/* Top Widgets Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-3xl font-bold text-primary">{openCount}</div>
                    <div className="text-sm text-muted-foreground mt-1">Open</div>
                  </div>
                  <Icon name="AlertCircle" size={32} className="text-primary opacity-20" />
                </div>
              </div>
              
              <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-3xl font-bold text-error">{overdueCount}</div>
                    <div className="text-sm text-muted-foreground mt-1">Overdue</div>
                  </div>
                  <Icon name="Clock" size={32} className="text-error opacity-20" />
                </div>
              </div>
              
              <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-3xl font-bold text-warning">{criticalCount}</div>
                    <div className="text-sm text-muted-foreground mt-1">Critical</div>
                  </div>
                  <Icon name="AlertTriangle" size={32} className="text-warning opacity-20" />
                </div>
              </div>
            </div>
            
            {/* Defects List */}
            <div className="bg-card border border-border rounded-2xl shadow-sm">
              <div className="p-6">
                <h2 className="text-lg font-semibold text-foreground mb-4">
                  {filteredDefects?.length} {filteredDefects?.length === 1 ? 'Defect' : 'Defects'}
                </h2>
                
                {filteredDefects?.length === 0 ? (
                  <div className="text-center py-12">
                    <Icon name="CheckCircle" size={48} className="text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">No defects found</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredDefects?.map(defect => (
                      <div
                        key={defect?.id}
                        onClick={() => handleDefectClick(defect)}
                        className="border border-border rounded-xl p-4 hover:bg-muted/30 transition-smooth cursor-pointer"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="text-base font-semibold text-foreground truncate">
                                {defect?.title}
                              </h3>
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${getPriorityBadge(defect?.priority)}`}>
                                {defect?.priority}
                              </span>
                            </div>
                            
                            <div className="flex items-center gap-3 text-sm text-muted-foreground mb-2">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(defect?.status)}`}>
                                {defect?.status}
                              </span>
                              {defect?.defectType && (
                                <span className="flex items-center gap-1">
                                  <Icon name="Tag" size={14} />
                                  {defect?.defectType}{defect?.defectSubType ? ` • ${defect?.defectSubType}` : ''}
                                </span>
                              )}
                              <span className="flex items-center gap-1">
                                <Icon name="MapPin" size={14} />
                                {defect?.locationPathLabel || 'No location'}
                              </span>
                              <span className="flex items-center gap-1">
                                <Icon name="Building" size={14} />
                                {defect?.departmentOwner}
                              </span>
                            </div>
                            
                            {defect?.dueDate && (
                              <div className={`text-xs flex items-center gap-1 ${
                                isOverdue(defect) ? 'text-error font-medium' : 'text-muted-foreground'
                              }`}>
                                <Icon name="Calendar" size={12} />
                                Due: {formatDate(defect?.dueDate)}
                                {isOverdue(defect) && ' (Overdue)'}
                              </div>
                            )}
                          </div>
                          
                          <Icon name="ChevronRight" size={20} className="text-muted-foreground flex-shrink-0" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
        
        {/* Pending Acceptance Tab Content */}
        {activeTab === 'pending' && (isChief || isCommand) && (
          <div className="space-y-6">
            {/* Back Button */}
            <button
              onClick={() => setActiveTab('main')}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-smooth"
            >
              <Icon name="ArrowLeft" size={16} />
              Back to main list
            </button>
            
            {/* Pending Acceptance Section */}
            <div className="bg-card border border-border rounded-2xl shadow-sm">
              <div className="p-6">
                <div className="mb-6">
                  <h2 className="text-xl font-semibold text-foreground mb-2">Pending Acceptance</h2>
                  <p className="text-sm text-muted-foreground">
                    Defects requiring your department's approval
                  </p>
                </div>
                
                {pendingDefects?.length === 0 ? (
                  <div className="text-center py-12 bg-background rounded-lg border border-border">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                      <Icon name="CheckCircle" size={24} className="text-primary" />
                    </div>
                    <p className="text-sm text-muted-foreground">No pending defects to review.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pendingDefects?.map(defect => (
                      <div
                        key={defect?.id}
                        className="bg-background rounded-lg border border-border hover:border-primary/50 transition-all duration-200 p-4 group"
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between mb-2">
                              <h4 
                                className="text-sm font-semibold text-foreground flex-1 cursor-pointer hover:text-primary"
                                onClick={() => handlePendingDefectClick(defect)}
                              >
                                {defect?.title}
                              </h4>
                              <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ml-2 ${
                                defect?.priority === 'Critical' ? 'bg-error/10 text-error' :
                                defect?.priority === 'High' ? 'bg-warning/10 text-warning' : 'bg-primary/10 text-primary'
                              }`}>
                                {defect?.priority}
                              </span>
                            </div>
                            
                            {defect?.description && (
                              <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{defect?.description}</p>
                            )}
                            
                            <div className="flex items-center gap-2 mb-2">
                              <Icon name="User" size={14} className="text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">
                                Submitted by <span className="font-medium text-foreground">{defect?.submittedByName || defect?.createdByName || 'Unknown'}</span>
                              </span>
                            </div>
                            
                            <div className="flex items-center gap-2 mb-3">
                              <Icon name="MapPin" size={14} className="text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">
                                {defect?.locationPathLabel || 'No location'}
                              </span>
                            </div>
                            
                            <div className="flex items-center gap-2 mt-3">
                              <button
                                onClick={(e) => {
                                  e?.stopPropagation();
                                  handleAcceptDefect(defect?.id);
                                }}
                                className="h-7 px-3 text-xs bg-success text-white rounded-lg hover:bg-success/90 transition-smooth"
                              >
                                Accept
                              </button>
                              <button
                                onClick={(e) => {
                                  e?.stopPropagation();
                                  setAcceptDeclineModal({ type: 'decline', defectId: defect?.id });
                                  setDeclineReason('');
                                }}
                                className="h-7 px-3 text-xs border border-error text-error rounded-lg hover:bg-error/10 transition-smooth"
                              >
                                Decline
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            
            {/* Sent by You Section */}
            <div className="bg-card border border-border rounded-2xl shadow-sm">
              <div className="p-6">
                <div className="mb-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-semibold text-foreground mb-2">Sent by you</h2>
                      <p className="text-sm text-muted-foreground">
                        Track defects you submitted
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                        <input
                          type="checkbox"
                          checked={showArchivedSent}
                          onChange={(e) => setShowArchivedSent(e?.target?.checked)}
                          className="w-4 h-4"
                        />
                        Show archived
                      </label>
                    </div>
                  </div>
                </div>
                
                {filteredSentByYou?.length === 0 ? (
                  <div className="text-center py-12 bg-background rounded-lg border border-border">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                      <Icon name="Send" size={24} className="text-primary" />
                    </div>
                    <p className="text-sm text-muted-foreground">No defects sent yet.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredSentByYou?.map(defect => {
                      const statusBadge = {
                        'pending_acceptance': { label: 'Pending acceptance', color: 'bg-warning/10 text-warning border-warning/20' },
                        'declined': { label: 'Declined', color: 'bg-error/10 text-error border-error/20' }
                      };
                      
                      const currentStatus = statusBadge?.[defect?.status] || { label: defect?.status, color: 'bg-muted text-muted-foreground border-border' };
                      
                      const canDeletePending = defect?.status === DefectStatus?.PENDING_ACCEPTANCE && defect?.createdByUserId === currentUser?.id;
                      const canArchive = defect?.status === DefectStatus?.DECLINED && defect?.createdByUserId === currentUser?.id && defect?.isArchivedBySender !== true;
                      
                      return (
                        <div
                          key={defect?.id}
                          className="bg-background rounded-lg border border-border p-4"
                        >
                          <div className="flex items-start justify-between mb-2">
                            <h4 
                              className="text-sm font-semibold text-foreground flex-1 cursor-pointer hover:text-primary"
                              onClick={() => handleDefectClick(defect)}
                            >
                              {defect?.title}
                            </h4>
                            <span className={`text-xs px-2 py-1 rounded-full border ml-2 ${currentStatus?.color}`}>
                              {currentStatus?.label}
                            </span>
                          </div>
                          
                          {defect?.description && (
                            <p className="text-xs text-muted-foreground mb-2 line-clamp-1">{defect?.description}</p>
                          )}
                          
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
                            <span className="flex items-center gap-1">
                              <Icon name="Building" size={12} />
                              {defect?.departmentOwner}
                            </span>
                            <span className="flex items-center gap-1">
                              <Icon name="Calendar" size={12} />
                              {formatDate(defect?.createdAt)}
                            </span>
                          </div>
                          
                          {defect?.decisionNotes && (
                            <div className="bg-error/5 border border-error/20 rounded p-2 mb-2">
                              <p className="text-xs text-error">
                                <span className="font-medium">Reason:</span> {defect?.decisionNotes}
                              </p>
                            </div>
                          )}
                          
                          <div className="flex items-center gap-2 mt-2">
                            {canDeletePending && (
                              <button
                                onClick={(e) => {
                                  e?.stopPropagation();
                                  handleDeletePendingDefect(defect?.id);
                                }}
                                className="h-7 px-3 text-xs border border-error text-error rounded-lg hover:bg-error/10 transition-smooth"
                              >
                                Delete request
                              </button>
                            )}
                            {canArchive && (
                              <button
                                onClick={(e) => {
                                  e?.stopPropagation();
                                  handleArchiveDeclinedDefect(defect?.id);
                                }}
                                className="h-7 px-3 text-xs border border-border text-muted-foreground rounded-lg hover:bg-muted transition-smooth"
                              >
                                Archive
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
      
      {/* Report Defect Modal */}
      {showReportModal && (
        <ReportDefectModal
          onClose={() => setShowReportModal(false)}
          onSuccess={handleReportSuccess}
        />
      )}
      
      {/* View Defect Modal */}
      {showViewModal && selectedDefectId && (
        <ViewDefectModal
          defectId={selectedDefectId}
          onClose={handleCloseViewModal}
          onUpdate={loadDefects}
        />
      )}
      {/* Accept/Decline Modal */}
      {showAcceptDeclineModal && selectedPendingDefect && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-card border-b border-border p-6 flex items-center justify-between">
              <h2 className="text-xl font-bold text-foreground">Review Defect</h2>
              <button
                onClick={() => {
                  setShowAcceptDeclineModal(false);
                  setSelectedPendingDefect(null);
                  setDeclineNotes('');
                }}
                className="p-2 hover:bg-muted rounded-lg transition-smooth"
              >
                <Icon name="X" size={20} className="text-muted-foreground" />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-2">{selectedPendingDefect?.title}</h3>
                {selectedPendingDefect?.description && (
                  <p className="text-sm text-muted-foreground mb-4">{selectedPendingDefect?.description}</p>
                )}
              </div>
              
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Location:</span>
                  <p className="text-foreground font-medium">{selectedPendingDefect?.locationPathLabel}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Submitted by:</span>
                  <p className="text-foreground font-medium">{selectedPendingDefect?.submittedByName}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Department:</span>
                  <p className="text-foreground font-medium">{selectedPendingDefect?.departmentOwner}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Priority:</span>
                  <p className="text-foreground font-medium">{selectedPendingDefect?.priority}</p>
                </div>
              </div>
              
              {selectedPendingDefect?.photos?.length > 0 && (
                <div>
                  <span className="text-sm text-muted-foreground">Photo:</span>
                  <img
                    src={selectedPendingDefect?.photos?.[0]}
                    alt="Defect"
                    className="w-full h-48 object-cover rounded-lg border border-border mt-2"
                  />
                </div>
              )}
              
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Decline reason (optional if accepting)
                </label>
                <textarea
                  value={declineNotes}
                  onChange={(e) => setDeclineNotes(e?.target?.value)}
                  placeholder="Provide reason if declining..."
                  rows={3}
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>
              
              <div className="flex items-center gap-3 pt-4">
                <button
                  onClick={() => handleDeclineDefect(selectedPendingDefect)}
                  className="flex-1 px-4 py-2 bg-error text-white rounded-lg hover:bg-error/90 transition-smooth"
                >
                  Decline
                </button>
                <button
                  onClick={() => handleAcceptDefect(selectedPendingDefect)}
                  className="flex-1 px-4 py-2 bg-success text-white rounded-lg hover:bg-success/90 transition-smooth"
                >
                  Accept
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Decline Modal */}
      {acceptDeclineModal?.type === 'decline' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl shadow-xl max-w-md w-full">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-foreground mb-4">Decline Defect</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Please provide a reason for declining this defect:
              </p>
              <textarea
                value={declineReason}
                onChange={(e) => setDeclineReason(e?.target?.value)}
                placeholder="Enter decline reason..."
                rows={4}
                className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none mb-4"
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setAcceptDeclineModal(null);
                    setDeclineReason('');
                  }}
                  className="flex-1 px-4 py-2 border border-border text-foreground rounded-lg hover:bg-muted transition-smooth"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDeclineDefect(acceptDeclineModal?.defectId)}
                  className="flex-1 px-4 py-2 bg-error text-white rounded-lg hover:bg-error/90 transition-smooth"
                >
                  Decline
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DefectsDashboard;