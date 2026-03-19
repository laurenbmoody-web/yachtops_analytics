import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { loadAllLaundryItems, LaundryStatus } from '../../laundry-management-dashboard/utils/laundryStorage';
import { loadGuests } from '../../guest-management-dashboard/utils/guestStorage';

const TripLaundryDrawer = ({ isOpen, onClose, trip }) => {
  const navigate = useNavigate();
  const [laundryItems, setLaundryItems] = useState([]);
  const [filteredItems, setFilteredItems] = useState([]);
  const [guests, setGuests] = useState([]);
  const [activeOnlyToggle, setActiveOnlyToggle] = useState(true);
  const [selectedGuestFilter, setSelectedGuestFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Load data
  useEffect(() => {
    if (isOpen && trip) {
      loadData();
    }
  }, [isOpen, trip]);

  // Apply filters
  useEffect(() => {
    if (trip) {
      applyFilters();
    }
  }, [laundryItems, activeOnlyToggle, selectedGuestFilter, searchQuery, trip]);

  const loadData = async () => {
    const allLaundry = await loadAllLaundryItems();
    const allGuests = await loadGuests();
    setLaundryItems(allLaundry || []);
    setGuests(allGuests || []);
  };

  const applyFilters = () => {
    let filtered = [...laundryItems];

    // Filter by trip (tripId first, date fallback)
    const activeGuestIds = trip?.guests?.filter(g => g?.isActive)?.map(g => g?.guestId) || [];
    filtered = filtered?.filter(item => {
      // Preferred: Filter by tripId
      if (item?.tripId) {
        return item?.tripId === trip?.id;
      }
      // Fallback: Filter by date range for guest items
      if (item?.ownerType?.toLowerCase() === 'guest' && item?.ownerGuestId) {
        const isActiveGuest = activeGuestIds?.includes(item?.ownerGuestId);
        if (!isActiveGuest) return false;
        
        // Check if item created during trip dates
        const itemDate = new Date(item?.createdAt);
        const tripStart = new Date(trip?.startDate);
        const tripEnd = new Date(trip?.endDate);
        return itemDate >= tripStart && itemDate <= tripEnd;
      }
      return false;
    });

    // Filter by Active-only toggle
    if (activeOnlyToggle) {
      filtered = filtered?.filter(item => 
        item?.status === LaundryStatus?.IN_PROGRESS || 
        item?.status === LaundryStatus?.READY_TO_DELIVER
      );
    }

    // Filter by selected guest
    if (selectedGuestFilter !== 'all') {
      if (selectedGuestFilter === 'unknown') {
        filtered = filtered?.filter(item => !item?.ownerGuestId || item?.ownerName === 'Unknown');
      } else {
        filtered = filtered?.filter(item => item?.ownerGuestId === selectedGuestFilter);
      }
    }

    // Filter by search query
    if (searchQuery?.trim()) {
      const query = searchQuery?.toLowerCase();
      filtered = filtered?.filter(item =>
        item?.description?.toLowerCase()?.includes(query) ||
        item?.ownerName?.toLowerCase()?.includes(query) ||
        item?.tags?.some(tag => tag?.toLowerCase()?.includes(query))
      );
    }

    setFilteredItems(filtered);
  };

  const getCounts = () => {
    const tripLaundry = laundryItems?.filter(item => {
      // Same trip filtering logic
      if (item?.tripId) {
        return item?.tripId === trip?.id;
      }
      const activeGuestIds = trip?.guests?.filter(g => g?.isActive)?.map(g => g?.guestId) || [];
      if (item?.ownerType?.toLowerCase() === 'guest' && item?.ownerGuestId) {
        const isActiveGuest = activeGuestIds?.includes(item?.ownerGuestId);
        if (!isActiveGuest) return false;
        const itemDate = new Date(item?.createdAt);
        const tripStart = new Date(trip?.startDate);
        const tripEnd = new Date(trip?.endDate);
        return itemDate >= tripStart && itemDate <= tripEnd;
      }
      return false;
    });

    return {
      inProgress: tripLaundry?.filter(item => item?.status === LaundryStatus?.IN_PROGRESS)?.length || 0,
      ready: tripLaundry?.filter(item => item?.status === LaundryStatus?.READY_TO_DELIVER)?.length || 0,
      delivered: tripLaundry?.filter(item => item?.status === LaundryStatus?.DELIVERED)?.length || 0
    };
  };

  const formatTripDates = () => {
    if (!trip?.startDate || !trip?.endDate) return '';
    const start = new Date(trip?.startDate);
    const end = new Date(trip?.endDate);
    const options = { month: 'short', day: 'numeric', year: 'numeric' };
    return `${start?.toLocaleDateString('en-US', options)} – ${end?.toLocaleDateString('en-US', options)}`;
  };

  const getTripGuests = () => {
    const activeGuestIds = trip?.guests?.filter(g => g?.isActive)?.map(g => g?.guestId) || [];
    return guests?.filter(g => activeGuestIds?.includes(g?.id));
  };

  const getTimeAgo = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case LaundryStatus?.IN_PROGRESS:
        return { label: 'In Progress', color: 'bg-warning/10 text-warning' };
      case LaundryStatus?.READY_TO_DELIVER:
        return { label: 'Ready', color: 'bg-primary/10 text-primary' };
      case LaundryStatus?.DELIVERED:
        return { label: 'Delivered', color: 'bg-success/10 text-success' };
      default:
        return { label: status, color: 'bg-muted text-muted-foreground' };
    }
  };

  const handleOpenFullLaundry = () => {
    navigate(`/laundry?tripId=${trip?.id}`);
    onClose();
  };

  if (!isOpen || !trip) return null;

  const counts = getCounts();
  const tripGuests = getTripGuests();
  const isCompletedTrip = trip?.status === 'completed';

  // Default Active-only toggle to OFF for completed trips
  useEffect(() => {
    if (isCompletedTrip && isOpen) {
      setActiveOnlyToggle(false);
    }
  }, [isCompletedTrip, isOpen]);

  return (
    <>
      {/* Overlay */}
      <div 
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={onClose}
      />
      
      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-full max-w-2xl bg-card shadow-2xl z-50 flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-border p-6">
          <div className="flex items-start justify-between mb-2">
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-foreground">Trip Laundry</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {trip?.name} • {formatTripDates()}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-muted rounded-lg transition-smooth"
            >
              <Icon name="X" size={20} />
            </button>
          </div>
        </div>

        {/* Controls */}
        <div className="flex-shrink-0 border-b border-border p-6 space-y-4">
          {/* Active-only Toggle */}
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-foreground">Active only</label>
            <button
              onClick={() => setActiveOnlyToggle(!activeOnlyToggle)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                activeOnlyToggle ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  activeOnlyToggle ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Guest Filter Dropdown */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Guest filter</label>
            <select
              value={selectedGuestFilter}
              onChange={(e) => setSelectedGuestFilter(e?.target?.value)}
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
            >
              <option value="all">All trip guests</option>
              {tripGuests?.map(guest => (
                <option key={guest?.id} value={guest?.id}>
                  {guest?.firstName} {guest?.lastName}
                </option>
              ))}
              <option value="unknown">Unknown</option>
            </select>
          </div>

          {/* Search Input */}
          <div className="relative">
            <Icon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search items… (description, owner, tags)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e?.target?.value)}
              className="w-full pl-10 pr-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
            />
          </div>

          {/* Summary Counts */}
          <div className="flex items-center gap-4 pt-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">In Progress:</span>
              <span className="text-sm font-semibold text-warning">{counts?.inProgress}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Ready:</span>
              <span className="text-sm font-semibold text-primary">{counts?.ready}</span>
            </div>
            {!activeOnlyToggle && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Delivered:</span>
                <span className="text-sm font-semibold text-success">{counts?.delivered}</span>
              </div>
            )}
          </div>
        </div>

        {/* Laundry Items List */}
        <div className="flex-1 overflow-y-auto p-6">
          {filteredItems?.length === 0 ? (
            <div className="text-center py-12">
              <Icon name="Shirt" size={48} className="text-muted-foreground mx-auto mb-4" />
              <p className="text-sm text-muted-foreground">
                {searchQuery || selectedGuestFilter !== 'all' ?'No laundry items match your filters' :'No laundry items for this trip'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredItems?.map(item => {
                const statusBadge = getStatusBadge(item?.status);
                return (
                  <div
                    key={item?.id}
                    className="bg-background border border-border rounded-lg p-4 hover:shadow-md transition-smooth cursor-pointer"
                  >
                    <div className="flex gap-3">
                      {/* Thumbnail */}
                      <div className="flex-shrink-0">
                        {item?.photo ? (
                          <img
                            src={item?.photo}
                            alt={item?.description || 'Laundry item'}
                            className="w-16 h-16 object-cover rounded-lg"
                          />
                        ) : (
                          <div className="w-16 h-16 bg-muted rounded-lg flex items-center justify-center">
                            <Icon name="Image" size={24} className="text-muted-foreground" />
                          </div>
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <h4 className="text-sm font-semibold text-foreground truncate">
                            {item?.description || 'No description'}
                          </h4>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${statusBadge?.color}`}>
                            {statusBadge?.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                          <span className="px-1.5 py-0.5 bg-blue-500/10 text-blue-600 rounded font-medium">
                            {item?.ownerType === 'guest' ? 'Guest' : item?.ownerType === 'crew' ? 'Crew' : 'Unknown'}
                          </span>
                          {item?.ownerName && (
                            <>
                              <span>•</span>
                              <span className="font-medium">{item?.ownerName}</span>
                            </>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Updated {getTimeAgo(item?.updatedAt)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer with CTA */}
        <div className="flex-shrink-0 border-t border-border p-6">
          <Button
            onClick={handleOpenFullLaundry}
            className="w-full"
            iconName="ExternalLink"
          >
            Open full Laundry
          </Button>
        </div>
      </div>
    </>
  );
};

export default TripLaundryDrawer;