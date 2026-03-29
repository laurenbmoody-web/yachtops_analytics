import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Header from '../../../components/navigation/Header';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Select from '../../../components/ui/Select';
import AddItemDrawer from './AddItemDrawer';
import PartialBottleModal from './PartialBottleModal';
import { getItemById, saveItem, duplicateItem, calculateTotalQuantity } from '../utils/inventoryStorage';
import { getCategoryById, getSubcategoryL2ById, autoDetectAlcohol } from '../utils/taxonomyStorage';

const ALCOHOL_KEYWORDS = [
  'alcohol', 'wine', 'champagne', 'spirits', 'vodka', 'gin', 'whisky', 'whiskey',
  'beer', 'lager', 'ale', 'liqueur', 'rum', 'tequila', 'brandy', 'cognac',
  'prosecco', 'cava', 'drinks store', 'bar'
];

const ItemDetail = () => {
  const navigate = useNavigate();
  const { categoryId, itemId } = useParams();
  const [showNotes, setShowNotes] = useState(true);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDuplicateOpen, setIsDuplicateOpen] = useState(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const [item, setItem] = useState(null);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [showPartialBottleModal, setShowPartialBottleModal] = useState(false);

  useEffect(() => {
    loadItem();
  }, [itemId]);
  
  useEffect(() => {
    // Set default selected location when item loads
    if (item?.additionalLocations?.length > 0 && !selectedLocation) {
      setSelectedLocation(item?.additionalLocations?.[0]?.location);
    }
  }, [item]);

  const loadItem = () => {
    const loadedItem = getItemById(itemId);
    if (loadedItem) {
      setItem(loadedItem);
    } else {
      // Fallback to mock data if item not found
      setItem({
        id: itemId,
        name: 'Belvedere Vodka',
        category: 'Alcohol & Bar',
        primaryLocation: 'Bar Storage',
        quantity: 4.5,
        unit: 'bottles',
        status: 'healthy',
        lastChecked: '2024-01-07',
        checkedBy: 'Sarah Mitchell',
        minThreshold: 3,
        notes: 'Premium vodka for VIP guests. Reorder when below 3 bottles.',
        additionalLocations: [
          { location: 'Bar Storage', quantity: 3.5 },
          { location: 'Wine Cellar', quantity: 1 }
        ],
        activityHistory: [
          {
            id: 'act-1',
            type: 'stock_check',
            description: 'Stock count recorded',
            user: 'Sarah Mitchell',
            timestamp: '2024-01-07 14:30',
            quantity: 4.5
          },
          {
            id: 'act-2',
            type: 'usage',
            description: 'Used for guest service',
            user: 'James Cooper',
            timestamp: '2024-01-06 19:15',
            quantity: -0.5
          },
          {
            id: 'act-3',
            type: 'restock',
            description: 'Restocked from supplier',
            user: 'Sarah Mitchell',
            timestamp: '2024-01-05 10:00',
            quantity: 2
          }
        ]
      });
    }
  };

  const handleItemSaved = () => {
    loadItem();
    setIsEditOpen(false);
    setIsDuplicateOpen(false);
  };

  // Detect if this item's category is alcohol-related
  const isAlcoholItem = () => {
    if (!item) return false;
    // Check category isAlcohol flag first
    const cat = getCategoryById(item?.categoryId);
    if (cat?.isAlcohol !== undefined) return !!cat.isAlcohol;
    const l2 = getSubcategoryL2ById(item?.subcategoryL2Id);
    if (l2?.isAlcohol !== undefined) return !!l2.isAlcohol;
    // Fall back to keyword detection on category name or item category string
    const nameToCheck = (cat?.name || item?.category || '').toLowerCase();
    const l2Name = (l2?.name || '').toLowerCase();
    return ALCOHOL_KEYWORDS.some(kw => nameToCheck.includes(kw) || l2Name.includes(kw));
  };

  const handlePartialBottleSave = (fraction) => {
    if (!item) return;
    const updated = { ...item, partialBottle: fraction };
    saveItem(updated);
    setItem(updated);
    setShowPartialBottleModal(false);
  };

  const handlePartialBottleClear = () => {
    if (!item) return;
    const updated = { ...item, partialBottle: null };
    saveItem(updated);
    setItem(updated);
    setShowPartialBottleModal(false);
  };

  const handleDuplicate = () => {
    const duplicated = duplicateItem(itemId);
    if (duplicated) {
      setIsDuplicateOpen(true);
      setShowOverflowMenu(false);
    }
  };
  
  const getSelectedLocationQuantity = () => {
    if (!selectedLocation || !item?.additionalLocations) return 0;
    const location = item?.additionalLocations?.find(loc => loc?.location === selectedLocation);
    return location?.quantity || 0;
  };
  
  const getTotalQuantity = () => {
    if (!item) return 0;
    return calculateTotalQuantity(item);
  };
  
  const getLocationOptions = () => {
    if (!item?.additionalLocations || item?.additionalLocations?.length === 0) {
      return [];
    }
    return item?.additionalLocations?.map(loc => ({
      value: loc?.location,
      label: loc?.location
    }));
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'healthy':
        return 'text-success';
      case 'low':
        return 'text-warning';
      case 'out':
        return 'text-error';
      default:
        return 'text-muted-foreground';
    }
  };

  const getStatusBg = (status) => {
    switch (status) {
      case 'healthy':
        return 'bg-success/10';
      case 'low':
        return 'bg-warning/10';
      case 'out':
        return 'bg-error/10';
      default:
        return 'bg-muted/10';
    }
  };

  const getActivityIcon = (type) => {
    switch (type) {
      case 'stock_check':
        return 'ClipboardCheck';
      case 'usage':
        return 'TrendingDown';
      case 'restock':
        return 'TrendingUp';
      case 'move':
        return 'Move';
      default:
        return 'Activity';
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[1000px] mx-auto">
        {/* Header with Back Button */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(`/inventory/${categoryId}`)}
              className="p-2 hover:bg-muted rounded-lg transition-smooth"
            >
              <Icon name="ArrowLeft" size={24} className="text-foreground" />
            </button>
            <div>
              <h1 className="text-3xl font-semibold text-foreground font-heading">{item?.name}</h1>
              <p className="text-sm text-muted-foreground">{item?.category}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" iconName="Edit" size="sm" onClick={() => setIsEditOpen(true)}>
              Edit
            </Button>
            <Button variant="default" iconName="ClipboardCheck" size="sm">
              Record Count
            </Button>
            <div className="relative">
              <button
                onClick={() => setShowOverflowMenu(!showOverflowMenu)}
                className="p-2 hover:bg-muted rounded-lg transition-smooth"
              >
                <Icon name="MoreVertical" size={20} className="text-foreground" />
              </button>
              {showOverflowMenu && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-card border border-border rounded-lg shadow-lg z-10">
                  <button
                    onClick={handleDuplicate}
                    className="w-full px-4 py-2.5 text-left text-sm text-foreground hover:bg-muted transition-smooth flex items-center gap-2"
                  >
                    <Icon name="Copy" size={16} />
                    Duplicate Item
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="space-y-6">
          {/* Quantity & Status Block */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Current Quantity</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold text-foreground">{item?.quantity}</span>
                  <span className="text-lg text-muted-foreground">{item?.unit}</span>
                  {isAlcoholItem() && item?.partialBottle != null && (
                    <span className="text-sm text-muted-foreground">
                      + {Math.round(item.partialBottle * 100)}% partial
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isAlcoholItem() && (
                  <button
                    onClick={() => setShowPartialBottleModal(true)}
                    title={item?.partialBottle != null ? 'Edit partial bottle' : 'Add partial bottle'}
                    style={{
                      width: 36, height: 36,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      borderRadius: 8, cursor: 'pointer', transition: 'background 0.15s',
                      border: item?.partialBottle != null ? '2px solid #C4842A' : '2px dashed #CBD5E1',
                      background: item?.partialBottle != null ? 'rgba(196,132,42,0.1)' : 'transparent',
                      color: item?.partialBottle != null ? '#C4842A' : '#94A3B8'
                    }}
                  >
                    <Icon name="Wine" size={18} />
                  </button>
                )}
                <div className={`px-4 py-2 rounded-xl text-sm font-medium ${
                  getStatusBg(item?.status)
                } ${getStatusColor(item?.status)}`}>
                  <span className="capitalize">{item?.status}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icon name="MapPin" size={16} />
              <span>Primary location: {item?.primaryLocation}</span>
            </div>
          </div>

          {/* Locations List */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-foreground mb-4 font-heading">Locations</h3>
            
            {item?.additionalLocations && item?.additionalLocations?.length > 0 ? (
              <div className="space-y-4">
                {/* Location Dropdown */}
                <div>
                  <label className="text-sm text-muted-foreground mb-2 block">Select Location</label>
                  <Select
                    value={selectedLocation || ''}
                    onChange={(value) => setSelectedLocation(value)}
                    options={getLocationOptions()}
                    placeholder="Select a location"
                  />
                </div>
                
                {/* Quantity for Selected Location */}
                {selectedLocation && (
                  <div className="bg-muted/30 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Icon name="MapPin" size={20} className="text-primary" />
                        <span className="text-sm text-muted-foreground">Quantity at {selectedLocation}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-2xl font-bold text-foreground">{getSelectedLocationQuantity()}</span>
                        <span className="text-sm text-muted-foreground ml-1">{item?.unit}</span>
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Total Quantity */}
                <div className="bg-primary/10 rounded-xl p-4 border border-primary/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon name="Package" size={20} className="text-primary" />
                      <span className="text-sm font-medium text-foreground">Total Quantity (All Locations)</span>
                    </div>
                    <div className="text-right">
                      <span className="text-2xl font-bold text-primary">{getTotalQuantity()}</span>
                      <span className="text-sm text-muted-foreground ml-1">{item?.unit}</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <Icon name="MapPin" size={40} className="text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No location data available</p>
              </div>
            )}
          </div>

          {/* Stock Info */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-foreground mb-4 font-heading">Stock Information</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Last Checked</span>
                <span className="text-base text-foreground font-medium">{formatDate(item?.lastChecked)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Checked By</span>
                <span className="text-base text-foreground font-medium">{item?.checkedBy}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Minimum Threshold</span>
                <span className="text-base text-foreground font-medium">{item?.minThreshold} {item?.unit}</span>
              </div>
            </div>
          </div>

          {/* Notes Section */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground font-heading">Notes</h3>
              <button
                onClick={() => setShowNotes(!showNotes)}
                className="text-sm text-primary hover:underline"
              >
                {showNotes ? 'Hide' : 'Show'}
              </button>
            </div>
            {showNotes && (
              <p className="text-base text-foreground leading-relaxed">{item?.notes}</p>
            )}
          </div>

          {/* Activity History */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-foreground mb-4 font-heading">Activity History</h3>
            <div className="space-y-4">
              {item?.activityHistory?.map((activity) => (
                <div key={activity?.id} className="flex gap-4">
                  <div className="flex-shrink-0">
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                      <Icon name={getActivityIcon(activity?.type)} size={18} className="text-foreground" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-base text-foreground font-medium mb-1">{activity?.description}</p>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span>{activity?.user}</span>
                      <span>•</span>
                      <span>{activity?.timestamp}</span>
                      {activity?.quantity && (
                        <>
                          <span>•</span>
                          <span className={activity?.quantity > 0 ? 'text-success' : 'text-error'}>
                            {activity?.quantity > 0 ? '+' : ''}{activity?.quantity} {item?.unit}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* Edit Item Drawer */}
      <AddItemDrawer
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        mode="edit"
        initialData={item}
        categoryId={categoryId}
        onSave={handleItemSaved}
      />

      {/* Duplicate Item Drawer */}
      <AddItemDrawer
        isOpen={isDuplicateOpen}
        onClose={() => setIsDuplicateOpen(false)}
        mode="duplicate"
        initialData={item}
        categoryId={categoryId}
        onSave={handleItemSaved}
      />

      {/* Partial Bottle Modal */}
      {showPartialBottleModal && (
        <PartialBottleModal
          initialValue={item?.partialBottle ?? null}
          itemName={item?.name}
          onSave={handlePartialBottleSave}
          onClear={handlePartialBottleClear}
          onClose={() => setShowPartialBottleModal(false)}
        />
      )}
    </div>
  );
};

export default ItemDetail;