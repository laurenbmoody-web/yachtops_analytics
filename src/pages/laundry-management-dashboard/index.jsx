import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import Header from '../../components/navigation/Header';
import AddLaundryModal from './components/AddLaundryModal';
import LaundryItemRow from './components/LaundryItemRow';
import { LaundryStatus, getTodayViewItems, migrateLaundryItems, isNewDay, setLastLaundryDayKey, getTodayKey, manualResetDay } from './utils/laundryStorage';
import { loadGuests } from '../guest-management-dashboard/utils/guestStorage';
import { getCurrentUser } from '../../utils/authStorage';

import { loadTrips } from '../trips-management-dashboard/utils/tripStorage';



const LaundryManagementDashboard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [currentUser, setCurrentUser] = useState(null);
  const [laundryItems, setLaundryItems] = useState([]);
  const [filteredItems, setFilteredItems] = useState([]);
  const [guests, setGuests] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterOwnerType, setFilterOwnerType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [tripId, setTripId] = useState(null);
  const [ownerFilter, setOwnerFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [trip, setTrip] = useState(null);
  const [showResetModal, setShowResetModal] = useState(false);
  
  useEffect(() => {
    const user = getCurrentUser();
    if (!user) {
      // DO NOT redirect here - ProtectedRoute handles this
      return;
    }
    setCurrentUser(user);
    
    // Check for tripId query parameter
    const searchParams = new URLSearchParams(location?.search);
    const tripIdParam = searchParams?.get('tripId');
    if (tripIdParam) {
      setTripId(tripIdParam);
    }
    
    // Run migration on first load
    migrateLaundryItems();
    
    // Auto daily reset detection
    if (isNewDay()) {
      console.log('New day detected - refreshing Today view');
      setLastLaundryDayKey(getTodayKey());
    }
  }, [navigate, location]);
  
  useEffect(() => {
    const guests = loadGuests();
    setGuests(guests || []);
  }, []);
  
  useEffect(() => {
    // Load items using Today view filtering
    const { openItems, deliveredToday } = getTodayViewItems();
    const allTodayItems = [...openItems, ...deliveredToday];
    setLaundryItems(allTodayItems);
  }, []);
  
  useEffect(() => {
    // Apply filters
    let filtered = [...laundryItems];

    // Filter by status
    if (statusFilter !== 'All') {
      const statusMap = {
        'In Progress': LaundryStatus?.IN_PROGRESS,
        'Ready': LaundryStatus?.READY_TO_DELIVER,
        'Delivered': LaundryStatus?.DELIVERED
      };
      filtered = filtered?.filter(item => item?.status === statusMap?.[statusFilter]);
    }

    // Filter by owner type
    if (ownerFilter !== 'All') {
      filtered = filtered?.filter(item => item?.ownerType?.toLowerCase() === ownerFilter?.toLowerCase());
    }

    // Filter by search query
    if (searchQuery?.trim()) {
      const query = searchQuery?.toLowerCase();
      filtered = filtered?.filter(item => 
        item?.ownerName?.toLowerCase()?.includes(query) ||
        item?.description?.toLowerCase()?.includes(query) ||
        item?.id?.toLowerCase()?.includes(query)
      );
    }
    
    // Filter by tripId if present
    if (tripId) {
      const trips = loadTrips();
      const tripData = trips?.find(t => t?.id === tripId);
      setTrip(tripData);
      
      if (tripData) {
        const activeGuestIds = tripData?.guests?.filter(g => g?.isActive)?.map(g => g?.guestId) || [];
        filtered = filtered?.filter(item => {
          // First check if item has tripId field
          if (item?.tripId) {
            return item?.tripId === tripId;
          }
          // Fallback to guest matching
          if (item?.ownerType?.toLowerCase() === 'guest' && item?.ownerGuestId) {
            return activeGuestIds?.includes(item?.ownerGuestId);
          }
          return false;
        });
      }
    }

    setFilteredItems(filtered);
  }, [laundryItems, statusFilter, ownerFilter, searchQuery, tripId]);
  
  const loadLaundryItems = () => {
    const { openItems, deliveredToday } = getTodayViewItems();
    // Show open items + delivered items from today (until Reset Day pressed)
    const allTodayItems = [...openItems, ...deliveredToday];
    setLaundryItems(allTodayItems);
  };
  
  const handleAddSuccess = () => {
    setShowAddModal(false);
    loadLaundryItems();
  };
  
  const handleResetDay = () => {
    setShowResetModal(true);
  };
  
  const confirmResetDay = () => {
    if (manualResetDay()) {
      loadLaundryItems();
    }
    setShowResetModal(false);
  };
  
  const getStatusCounts = () => {
    // Count from filtered items for Today view
    let itemsToCount = laundryItems;
    
    if (tripId && trip) {
      const activeGuestIds = trip?.guests?.filter(g => g?.isActive)?.map(g => g?.guestId) || [];
      itemsToCount = laundryItems?.filter(item => {
        if (item?.tripId) {
          return item?.tripId === tripId;
        }
        if (item?.ownerType?.toLowerCase() === 'guest' && item?.ownerGuestId) {
          return activeGuestIds?.includes(item?.ownerGuestId);
        }
        return false;
      });
    }
    
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    
    return {
      inProgress: itemsToCount?.filter(item => item?.status === LaundryStatus?.IN_PROGRESS)?.length,
      ready: itemsToCount?.filter(item => item?.status === LaundryStatus?.READY_TO_DELIVER)?.length,
      delivered: itemsToCount?.filter(item => {
        if (item?.status !== LaundryStatus?.DELIVERED || !item?.deliveredAt) {
          return false;
        }
        const deliveredDate = new Date(item.deliveredAt);
        return deliveredDate >= todayStart && deliveredDate <= todayEnd;
      })?.length
    };
  };
  
  const handleClearTripFilter = () => {
    navigate('/laundry-management-dashboard');
  };
  
  const counts = getStatusCounts();
  
  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="container mx-auto px-4 pb-6 max-w-7xl">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Laundry Management</h1>
              {tripId && (
                <p className="text-sm text-muted-foreground mt-1">Filtered by trip</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              {currentUser?.effectiveTier === 'COMMAND' || currentUser?.tier === 'COMMAND' || currentUser?.effectiveTier === 'CHIEF' || currentUser?.tier === 'CHIEF' ? (
                <button
                  onClick={handleResetDay}
                  className="flex items-center gap-2 px-4 py-2 bg-card border border-border text-foreground rounded-lg hover:bg-muted transition-smooth"
                >
                  <Icon name="RotateCcw" size={20} />
                  Reset Day
                </button>
              ) : null}
              <button
                onClick={() => navigate('/laundry-calendar-history-view')}
                className="flex items-center gap-2 px-4 py-2 bg-card border border-border text-foreground rounded-lg hover:bg-muted transition-smooth"
              >
                <Icon name="Calendar" size={20} />
                History
              </button>
              <Button
                onClick={() => setShowAddModal(true)}
                iconName="Plus"
              >
                Add Laundry
              </Button>
            </div>
          </div>
          
          {/* Stats Cards */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">In Progress</p>
                  <p className="text-2xl font-bold text-foreground mt-1">{counts?.inProgress}</p>
                </div>
                <div className="w-12 h-12 bg-warning/10 rounded-lg flex items-center justify-center">
                  <Icon name="Clock" size={24} className="text-warning" />
                </div>
              </div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Ready to Deliver</p>
                  <p className="text-2xl font-bold text-foreground mt-1">{counts?.ready}</p>
                </div>
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                  <Icon name="CheckCircle" size={24} className="text-primary" />
                </div>
              </div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Delivered Today</p>
                  <p className="text-2xl font-bold text-foreground mt-1">{counts?.delivered}</p>
                </div>
                <div className="w-12 h-12 bg-success/10 rounded-lg flex items-center justify-center">
                  <Icon name="Package" size={24} className="text-success" />
                </div>
              </div>
            </div>
          </div>
          
          {/* Search Bar */}
          <div className="relative mb-4">
            <Icon name="Search" size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by description, owner, area, or tags..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e?.target?.value)}
              className="w-full pl-10 pr-4 py-2 bg-card border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          
          {/* Filters - Single Row with Status Left, Owner Right */}
          <div className="flex items-center justify-between mb-4">
            {/* Status Filters - Left */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground mr-2">Status:</span>
              {['All', 'In Progress', 'Ready', 'Delivered']?.map(status => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-smooth ${
                    statusFilter === status
                      ? 'bg-primary text-white' :'bg-card border border-border text-foreground hover:bg-muted'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
            
            {/* Owner Filters - Right */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground mr-2">Owner:</span>
              {['All', 'Guest', 'Crew', 'Unknown']?.map(owner => (
                <button
                  key={owner}
                  onClick={() => setOwnerFilter(owner)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-smooth ${
                    ownerFilter === owner
                      ? 'bg-primary text-white' :'bg-card border border-border text-foreground hover:bg-muted'
                  }`}
                >
                  {owner}
                </button>
              ))}
            </div>
          </div>
        </div>
        
        {/* Items List - Flat List */}
        <div className="space-y-3">
          {filteredItems?.length === 0 ? (
            <div className="bg-card border border-border rounded-xl p-12 text-center">
              <Icon name="Package" size={48} className="text-muted-foreground mx-auto mb-4" />
              <p className="text-lg font-semibold text-foreground">No laundry items match your filters.</p>
              <p className="text-sm text-muted-foreground mt-1">
                {searchQuery || statusFilter !== 'All' || ownerFilter !== 'All' ?'Try adjusting your filters' :'Add your first laundry item to get started'}
              </p>
            </div>
          ) : (
            filteredItems?.map(item => (
              <LaundryItemRow
                key={item?.id}
                item={item}
                onUpdate={loadLaundryItems}
              />
            ))
          )}
        </div>
      </main>
      {/* Add Laundry Modal */}
      {showAddModal && (
        <AddLaundryModal
          onClose={() => setShowAddModal(false)}
          onSuccess={handleAddSuccess}
        />
      )}
      
      {/* Reset Day Confirmation Modal */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-semibold text-foreground mb-2">Reset day?</h3>
            <p className="text-sm text-muted-foreground mb-6">
              This will clear 'Delivered Today' from the operational view. Open items remain.
            </p>
            <div className="flex items-center gap-3 justify-end">
              <Button
                variant="outline"
                onClick={() => setShowResetModal(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={confirmResetDay}
              >
                Reset
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LaundryManagementDashboard;