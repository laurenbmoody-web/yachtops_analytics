import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import AddGuestModal from './components/AddGuestModal';
import GuestDetailPanel from './components/GuestDetailPanel';
import { loadGuests, createGuest, updateGuest, deleteGuest, reinstateGuest, GuestType, linkKid } from './utils/guestStorage';
import { showToast } from '../../utils/toast';

import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';


// DEV_MODE constant
const DEV_MODE = true;

// Helper function to format cabin display to show only Level 3 (final segment)
const formatCabinLevel3 = (cabinValue) => {
  if (!cabinValue) return 'Not assigned';
  const raw = String(cabinValue)?.trim();
  if (!raw) return 'Not assigned';
  const parts = raw?.split('>')?.map(p => p?.trim())?.filter(Boolean);
  if (parts?.length === 0) return 'Not assigned';
  return parts?.[parts?.length - 1];
};

const GuestManagementDashboard = () => {
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const { activeTenantId, currentTenantMember } = useTenant();
  const [guests, setGuests] = useState([]);
  const [expandedGuestId, setExpandedGuestId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingGuest, setEditingGuest] = useState(null);
  const [sortConfig, setSortConfig] = useState({ column: null, direction: null });
  const [showDeletedGuests, setShowDeletedGuests] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadTimeout, setLoadTimeout] = useState(false);
  const [error, setError] = useState(null);
  const timeoutRef = useRef(null);

  // Use session from Supabase auth instead of localStorage currentUser
  const isAuthenticated = !!session || DEV_MODE;

  // Derive permissions from currentTenantMember (real Supabase tier)
  const userTierRaw = currentTenantMember?.permission_tier || '';
  const userTier = String(userTierRaw)?.toUpperCase()?.trim();
  const isCommandOrChief = userTier === 'COMMAND' || userTier === 'CHIEF';
  const canEdit = DEV_MODE ? true : isCommandOrChief;
  const canDelete = DEV_MODE ? true : userTier === 'COMMAND';
  const canExpand = DEV_MODE ? true : isCommandOrChief;
  const canSeeAll = DEV_MODE ? true : isCommandOrChief;

  // Load guests
  useEffect(() => {
    console.log('[PAGE] Mounted /guest-management-dashboard');
    // Wait for auth to finish loading before fetching
    if (authLoading) return;

    if (activeTenantId || DEV_MODE) {
      fetchGuests();
    } else {
      setError('No tenant context (currentTenantId missing)');
      setLoading(false);
    }

    return () => {
      if (timeoutRef?.current) {
        clearTimeout(timeoutRef?.current);
      }
    };
  }, [activeTenantId, authLoading]);

  const fetchGuests = async () => {
    console.log('[GUEST] start fetch');
    setLoading(true);
    setLoadTimeout(false);
    setError(null);

    // Start 8-second timeout
    if (timeoutRef?.current) {
      clearTimeout(timeoutRef?.current);
    }
    timeoutRef.current = setTimeout(() => {
      console.log('[GUEST] 8s timeout reached');
      setLoadTimeout(true);
      setLoading(false);
    }, 8000);

    try {
      if (!activeTenantId) {
        if (DEV_MODE) {
          console.log('[GUEST] DEV_MODE: rendering without tenant');
          setGuests([]);
          return;
        }
        setError('No tenant context (currentTenantId missing)');
        setGuests([]);
        return;
      }

      const data = await loadGuests(activeTenantId);
      console.log('[GUEST] fetch success, rows:', data?.length || 0);
      setGuests(data || []);
    } catch (err) {
      console.error('[GUEST] fetch error:', err);
      if (err?.code === '401' || err?.code === 'PGRST301') {
        setError('Authentication error: ' + (err?.message || 'Unauthorized'));
      } else if (err?.code === '403' || err?.code === 'PGRST302') {
        setError('Permission denied: ' + (err?.message || 'Forbidden'));
      } else {
        setError(err?.message || 'Failed to load guest data');
      }
      setGuests([]);
    } finally {
      if (timeoutRef?.current) {
        clearTimeout(timeoutRef?.current);
      }
      setLoading(false);
      console.log('[GUEST] end fetch');
    }
  };

  const loadGuestsData = async () => {
    try {
      const data = await loadGuests(activeTenantId);
      setGuests(data || []);
    } catch (err) {
      console.error('[GUEST] loadGuestsData error:', err);
    }
  };

  // Enhanced search filter
  const getSearchFilteredGuests = () => {
    let filteredList = guests;

    // HOD and CREW can only see guests who are active on the current trip
    if (!canSeeAll) {
      filteredList = filteredList?.filter(g => g?.isActiveOnTrip === true);
    }

    if (!showDeletedGuests) {
      filteredList = filteredList?.filter(g => !g?.isDeleted);
    }

    if (!searchQuery?.trim()) {
      return filteredList;
    }

    const query = searchQuery?.toLowerCase()?.trim();
    return filteredList?.filter(guest => {
      const fullName = `${guest?.firstName} ${guest?.lastName}`?.toLowerCase();
      const cabin = (guest?.cabinLocationPath || guest?.cabinLocationLabel || guest?.cabinAllocated || '')?.toLowerCase();
      const email = guest?.contactEmail?.toLowerCase() || '';
      const phone = guest?.contactPhone?.toLowerCase() || '';
      const allergies = guest?.allergies?.toLowerCase() || '';
      const healthConditions = guest?.healthConditions?.toLowerCase() || '';
      const status = guest?.isActiveOnTrip ? 'active' : 'inactive';

      return fullName?.includes(query) ||
             cabin?.includes(query) ||
             email?.includes(query) ||
             phone?.includes(query) ||
             allergies?.includes(query) ||
             healthConditions?.includes(query) ||
             status?.includes(query);
    });
  };

  // Sort function
  const getSortedGuests = (guestsToSort) => {
    if (!sortConfig?.column || !sortConfig?.direction) {
      return guestsToSort;
    }

    const sorted = [...guestsToSort]?.sort((a, b) => {
      let aValue, bValue;

      switch (sortConfig?.column) {
        case 'name':
          aValue = `${a?.firstName} ${a?.lastName}`?.toLowerCase() || '';
          bValue = `${b?.firstName} ${b?.lastName}`?.toLowerCase() || '';
          break;
        case 'contact':
          aValue = a?.contactEmail?.toLowerCase() || a?.contactPhone?.toLowerCase() || '';
          bValue = b?.contactEmail?.toLowerCase() || b?.contactPhone?.toLowerCase() || '';
          break;
        case 'cabin':
          aValue = (a?.cabinLocationPath || a?.cabinLocationLabel || a?.cabinAllocated || '')?.toLowerCase();
          bValue = (b?.cabinLocationPath || b?.cabinLocationLabel || b?.cabinAllocated || '')?.toLowerCase();
          break;
        case 'status':
          aValue = a?.isActiveOnTrip ? 0 : 1;
          bValue = b?.isActiveOnTrip ? 0 : 1;
          break;
        default:
          return 0;
      }

      if (sortConfig?.column === 'status') {
        return sortConfig?.direction === 'asc' ? aValue - bValue : bValue - aValue;
      } else {
        if (aValue < bValue) return sortConfig?.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig?.direction === 'asc' ? 1 : -1;
        return 0;
      }
    });

    return sorted;
  };

  const handleSort = (column) => {
    setSortConfig(prev => {
      if (prev?.column === column) {
        if (prev?.direction === 'asc') return { column, direction: 'desc' };
        else if (prev?.direction === 'desc') return { column: null, direction: null };
      }
      return { column, direction: 'asc' };
    });
  };

  const renderSortIcon = (column) => {
    if (sortConfig?.column !== column) {
      return (
        <div className="inline-flex flex-col ml-1 opacity-30">
          <Icon name="ChevronUp" size={12} className="-mb-1" />
          <Icon name="ChevronDown" size={12} />
        </div>
      );
    }
    if (sortConfig?.direction === 'asc') {
      return <Icon name="ChevronUp" size={14} className="inline ml-1 text-primary" />;
    } else if (sortConfig?.direction === 'desc') {
      return <Icon name="ChevronDown" size={14} className="inline ml-1 text-primary" />;
    }
    return null;
  };

  const handleAddGuest = async (guestData) => {
    const { _linkedKidIds, ...cleanData } = guestData;
    const newGuest = await createGuest(cleanData, activeTenantId);
    if (newGuest) {
      // Link any kids selected in the modal
      if (Array.isArray(_linkedKidIds) && _linkedKidIds?.length > 0) {
        await Promise.all(_linkedKidIds?.map(kidId => linkKid(newGuest?.id, kidId, activeTenantId)));
      }
      showToast('Guest added successfully', 'success');
      await loadGuestsData();
    } else {
      showToast('Failed to add guest', 'error');
    }
  };

  const handleEditGuest = (guest) => {
    setEditingGuest(guest);
    setShowAddModal(true);
  };

  const handleUpdateGuest = async (guestId, updates) => {
    const updated = await updateGuest(guestId, updates, activeTenantId);
    if (updated) {
      showToast('Guest updated successfully', 'success');
      await loadGuestsData();
    } else {
      showToast('Failed to update guest', 'error');
    }
  };

  const handleDeleteGuest = async (guestId) => {
    if (window.confirm('Are you sure you want to delete this guest?')) {
      const success = await deleteGuest(guestId, activeTenantId);
      if (success) {
        showToast('Guest deleted successfully', 'success');
        setExpandedGuestId(null);
        await loadGuestsData();
      } else {
        showToast('Failed to delete guest', 'error');
      }
    }
  };

  const handleReinstateGuest = async (guestId) => {
    const success = await reinstateGuest(guestId, activeTenantId);
    if (success) {
      showToast('Guest reinstated successfully', 'success');
      setExpandedGuestId(null);
      await loadGuestsData();
    } else {
      showToast('Failed to reinstate guest', 'error');
    }
  };

  const toggleExpand = (guestId) => {
    setExpandedGuestId(prev => prev === guestId ? null : guestId);
  };

  const filteredAndSortedGuests = getSortedGuests(getSearchFilteredGuests());

  // Show loading state — only block on authLoading OR our own loading (not both forever)
  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </div>
    );
  }

  // Show timeout UI if loading takes too long
  if (loadTimeout) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="flex flex-col items-center justify-center py-20 gap-4 px-4">
          <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center">
            <Icon name="AlertTriangle" size={32} className="text-yellow-600" />
          </div>
          <div className="text-center max-w-md">
            <h2 className="text-xl font-semibold text-foreground mb-2">Still Loading</h2>
            <p className="text-muted-foreground mb-6">
              Guest data is taking longer than expected to load.
            </p>
            <button
              onClick={fetchGuests}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Block render if not authenticated (session check replaces localStorage currentUser check)
  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="p-6 max-w-[1800px] mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-foreground mb-1">Guest Management</h1>
            <p className="text-sm text-muted-foreground">
              {canSeeAll
                ? 'Manage guest profiles, cabin allocations, and preferences' :'Viewing active trip guests'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {canDelete && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={showDeletedGuests}
                  onChange={(e) => setShowDeletedGuests(e?.target?.checked)}
                  className="w-4 h-4 rounded border-border text-primary focus:ring-2 focus:ring-ring"
                />
                Show deleted
              </label>
            )}
            {canEdit && (
              <Button onClick={() => { setEditingGuest(null); setShowAddModal(true); }}>
                <Icon name="UserPlus" size={18} />
                Add Guest
              </Button>
            )}
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-center gap-3">
            <Icon name="AlertCircle" size={18} className="text-red-500 flex-shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Search Bar */}
        <div className="bg-card border border-border rounded-2xl p-4 mb-6">
          <div className="relative">
            <Icon
              name="Search"
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              placeholder="Search by name, contact, cabin, allergies, or status..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e?.target?.value)}
              className="w-full h-10 pl-10 pr-4 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        {/* Guest Table */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/30 border-b border-border">
                <tr>
                  <th
                    className="text-left p-4 text-sm font-medium text-foreground cursor-pointer hover:bg-muted/50 transition-colors select-none"
                    onClick={() => handleSort('name')}
                  >
                    <div className="flex items-center">
                      Name
                      {renderSortIcon('name')}
                    </div>
                  </th>
                  <th
                    className="text-left p-4 text-sm font-medium text-foreground cursor-pointer hover:bg-muted/50 transition-colors select-none"
                    onClick={() => handleSort('contact')}
                  >
                    <div className="flex items-center">
                      Contact
                      {renderSortIcon('contact')}
                    </div>
                  </th>
                  <th
                    className="text-left p-4 text-sm font-medium text-foreground cursor-pointer hover:bg-muted/50 transition-colors select-none"
                    onClick={() => handleSort('cabin')}
                  >
                    <div className="flex items-center">
                      Cabin
                      {renderSortIcon('cabin')}
                    </div>
                  </th>
                  <th
                    className="text-left p-4 text-sm font-medium text-foreground cursor-pointer hover:bg-muted/50 transition-colors select-none"
                    onClick={() => handleSort('status')}
                  >
                    <div className="flex items-center">
                      Status
                      {renderSortIcon('status')}
                    </div>
                  </th>
                  <th className="text-right p-4 text-sm font-medium text-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSortedGuests?.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="p-8 text-center text-muted-foreground">
                      No guests found
                    </td>
                  </tr>
                ) : (
                  filteredAndSortedGuests?.map(guest => (
                    <React.Fragment key={guest?.id}>
                      <tr className="border-b border-border hover:bg-muted/20 transition-smooth">
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            {/* Guest Photo */}
                            {guest?.photo?.dataUrl ? (
                              <img
                                src={guest?.photo?.dataUrl}
                                alt={`${guest?.firstName} ${guest?.lastName}`}
                                className="w-10 h-10 rounded-full object-cover border-2 border-border"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center border-2 border-border">
                                <span className="text-sm font-semibold text-primary">
                                  {guest?.firstName?.[0]}{guest?.lastName?.[0]}
                                </span>
                              </div>
                            )}

                            {/* Guest Info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h3 className="font-medium text-foreground truncate">
                                  {guest?.firstName} {guest?.lastName}
                                </h3>
                                {guest?.isDeleted && (
                                  <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800 rounded">
                                    Deleted
                                  </span>
                                )}
                                {guest?.guestType && (
                                  <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                                    guest?.guestType === GuestType?.OWNER
                                      ? 'bg-blue-100 text-blue-800'
                                      : guest?.guestType === GuestType?.CHARTER
                                      ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                                  }`}>
                                    {guest?.guestType}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="p-4 text-sm text-muted-foreground">
                          {guest?.contactEmail || guest?.contactPhone || '-'}
                        </td>
                        <td className="p-4 text-sm text-foreground">
                          {formatCabinLevel3(guest?.cabinLocationPath || guest?.cabinLocationLabel || guest?.cabinAllocated)}
                        </td>
                        <td className="p-4">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                            Guest
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {canExpand && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleExpand(guest?.id)}
                              >
                                <Icon name={expandedGuestId === guest?.id ? "ChevronUp" : "ChevronDown"} size={16} />
                                {expandedGuestId === guest?.id ? 'Collapse' : 'Expand'}
                              </Button>
                            )}
                            {canEdit && !guest?.isDeleted && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEditGuest(guest)}
                              >
                                <Icon name="Edit2" size={16} />
                                Edit
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {/* Expanded Detail Row */}
                      {canExpand && expandedGuestId === guest?.id && (
                        <tr>
                          <td colSpan="5" className="p-0">
                            <GuestDetailPanel
                              guest={guest}
                              onEdit={() => {
                                loadGuestsData();
                                setExpandedGuestId(null);
                              }}
                              onDelete={() => {
                                loadGuestsData();
                                setExpandedGuestId(null);
                              }}
                              onReinstate={() => {
                                loadGuestsData();
                                setExpandedGuestId(null);
                              }}
                              onClose={() => setExpandedGuestId(null)}
                              permissions={{ canEdit, canDelete }}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
      {/* Add/Edit Modal */}
      {showAddModal && (
        <AddGuestModal
          isOpen={showAddModal}
          onClose={() => { setShowAddModal(false); setEditingGuest(null); }}
          onSave={editingGuest ? (data) => handleUpdateGuest(editingGuest?.id, data) : handleAddGuest}
          editingGuest={editingGuest}
        />
      )}
    </div>
  );
};

export default GuestManagementDashboard;