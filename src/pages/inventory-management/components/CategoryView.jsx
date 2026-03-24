import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Header from '../../../components/navigation/Header';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import AddItemDrawer from './AddItemDrawer';
import { getItemsByCategory, getStockStatus } from '../utils/inventoryStorage';


const CategoryView = () => {
  const navigate = useNavigate();
  const { categoryId } = useParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterLocation, setFilterLocation] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [items, setItems] = useState([]);

  // Decode category name from URL parameter
  const categoryName = decodeURIComponent(categoryId);
  
  // Get current asset scope (same as dashboard)
  const getCurrentAssetId = () => {
    return localStorage.getItem('current_asset_id') || 'default-asset';
  };

  // Load items from storage
  useEffect(() => {
    loadItems();
  }, [categoryId]);

  const loadItems = () => {
    const assetId = getCurrentAssetId();
    // Query by category NAME (string), not categoryId
    const categoryItems = getItemsByCategory(categoryName, assetId);
    setItems(categoryItems);
    
    // DEBUG: Log to console for verification
    console.log('[CategoryView DEBUG]', {
      categoryName,
      assetId,
      itemsReturned: categoryItems?.length,
      items: categoryItems
    });
  };

  const handleItemSaved = () => {
    loadItems();
    setIsAddItemOpen(false);
  };

  const locationOptions = [
    { value: 'all', label: 'All Locations' },
    { value: 'bar-storage', label: 'Bar Storage' },
    { value: 'wine-cellar', label: 'Wine Cellar' },
    { value: 'pantry', label: 'Pantry' },
    { value: 'cold-room', label: 'Cold Room' }
  ];

  const statusOptions = [
    { value: 'all', label: 'All Status' },
    { value: 'healthy', label: 'Healthy' },
    { value: 'low', label: 'Low Stock' },
    { value: 'out', label: 'Out of Stock' }
  ];

  const sortOptions = [
    { value: 'name', label: 'Name' },
    { value: 'last-checked', label: 'Last Checked' },
    { value: 'quantity', label: 'Quantity' }
  ];

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

  const getStatusIcon = (status) => {
    switch (status) {
      case 'healthy':
        return 'CheckCircle2';
      case 'low':
        return 'AlertCircle';
      case 'out':
        return 'XCircle';
      default:
        return 'Circle';
    }
  };

  const filteredItems = items?.filter(item => {
    const matchesSearch = item?.name?.toLowerCase()?.includes(searchQuery?.toLowerCase());
    const matchesLocation = filterLocation === 'all' || item?.primaryLocation?.toLowerCase()?.includes(filterLocation?.toLowerCase());
    const itemStatus = getStockStatus(item);
    const matchesStatus = filterStatus === 'all' || itemStatus === filterStatus;
    return matchesSearch && matchesLocation && matchesStatus;
  });

  const handleItemClick = (itemId) => {
    navigate(`/inventory/${encodeURIComponent(categoryName)}/${itemId}`);
  };

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[1400px] mx-auto">
        {/* Header with Back Button */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => navigate('/inventory')}
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
          >
            <Icon name="ArrowLeft" size={24} className="text-foreground" />
          </button>
          <div className="flex-1">
            <h1 className="text-3xl font-semibold text-foreground font-heading">{categoryName}</h1>
            <p className="text-sm text-muted-foreground">{filteredItems?.length} items</p>
          </div>
          <Button
            variant="default"
            iconName="Plus"
            onClick={() => setIsAddItemOpen(true)}
          >
            Add Item
          </Button>
          <Button
            variant="outline"
            iconName="FileUp"
            onClick={() => navigate('/template-based-inventory-import')}
          >
            Import CSV
          </Button>
        </div>

        {/* Search and Filters */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Search */}
            <div className="md:col-span-2">
              <div className="relative">
                <Icon
                  name="Search"
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  type="text"
                  placeholder="Search items..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e?.target?.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-muted border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            {/* Location Filter */}
            <div>
              <select
                value={filterLocation}
                onChange={(e) => setFilterLocation(e?.target?.value)}
                className="w-full px-3 py-2.5 bg-muted border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {locationOptions?.map(opt => (
                  <option key={opt?.value} value={opt?.value}>{opt?.label}</option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e?.target?.value)}
                className="w-full px-3 py-2.5 bg-muted border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {statusOptions?.map(opt => (
                  <option key={opt?.value} value={opt?.value}>{opt?.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Sort Controls */}
          <div className="flex items-center gap-3 mt-4 pt-4 border-t border-border">
            <span className="text-sm text-muted-foreground">Sort by:</span>
            <div className="flex gap-2">
              {sortOptions?.map(opt => (
                <button
                  key={opt?.value}
                  onClick={() => setSortBy(opt?.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-smooth ${
                    sortBy === opt?.value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground hover:bg-muted/80'
                  }`}
                >
                  {opt?.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Item Cards */}
        <div className="space-y-4">
          {filteredItems?.length === 0 ? (
            <div className="text-center py-12">
              <Icon name="Package" size={48} className="text-muted-foreground mx-auto mb-4" />
              <p className="text-lg text-muted-foreground">No items found</p>
              <Button
                variant="default"
                iconName="Plus"
                onClick={() => setIsAddItemOpen(true)}
                className="mt-4"
              >
                Add First Item
              </Button>
            </div>
          ) : (
            filteredItems?.map((item) => {
              const status = getStockStatus(item);
              return (
                <div
                  key={item?.id}
                  onClick={() => handleItemClick(item?.id)}
                  className="bg-card border border-border rounded-2xl p-5 shadow-sm hover:shadow-md transition-smooth cursor-pointer"
                >
                  <div className="flex items-center gap-4">
                    {/* Thumbnail */}
                    <div className="w-16 h-16 rounded-lg bg-muted flex-shrink-0 overflow-hidden">
                      {item?.imageUrl ? (
                        <img src={item?.imageUrl} alt={item?.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Icon name="Package" size={24} className="text-muted-foreground" />
                        </div>
                      )}
                    </div>

                    {/* Item Info */}
                    <div className="flex-1 min-w-0">
                      <h4 className="text-lg font-semibold text-foreground mb-1">{item?.name}</h4>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Icon name="MapPin" size={14} />
                          <span>{item?.primaryLocation}</span>
                        </div>
                        <span>•</span>
                        <span>{item?.quantity} {item?.unit}</span>
                      </div>
                    </div>

                    {/* Status Indicator */}
                    <div className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                      status === 'healthy' ? 'bg-success/10 text-success' :
                      status === 'low' ? 'bg-warning/10 text-warning' :
                      status === 'out'? 'bg-error/10 text-error' : 'bg-muted text-muted-foreground'
                    }`}>
                      {status === 'healthy' && <Icon name="CheckCircle2" size={16} className="inline mr-1" />}
                      {status === 'low' && <Icon name="AlertCircle" size={16} className="inline mr-1" />}
                      {status === 'out' && <Icon name="XCircle" size={16} className="inline mr-1" />}
                      <span className="capitalize">{status}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>

      {/* Add Item Drawer */}
      <AddItemDrawer
        isOpen={isAddItemOpen}
        onClose={() => setIsAddItemOpen(false)}
        mode="add"
        prefillCategory={categoryName}
        categoryId={categoryName}
        onSave={handleItemSaved}
      />
    </div>
  );
};

export default CategoryView;