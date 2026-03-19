import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import Header from '../../components/navigation/Header';
import { saveItem, getAllItems } from '../inventory-management/utils/inventoryStorage';

const ImportStatusReview = () => {
  const navigate = useNavigate();
  const [importData, setImportData] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState(null);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [importError, setImportError] = useState(null);
  const [liveVerification, setLiveVerification] = useState(null);

  // Get current asset scope (default to 'default-asset' for now)
  // In future: this would come from app context/state
  const getCurrentAssetId = () => {
    return localStorage.getItem('current_asset_id') || 'default-asset';
  };

  useEffect(() => {
    // Load import data from sessionStorage
    const data = sessionStorage.getItem('cargo_template_import_data');
    if (!data) {
      navigate('/template-based-inventory-import');
      return;
    }

    try {
      const parsed = JSON.parse(data);
      setImportData(parsed);
      processImport(parsed);
    } catch (error) {
      console.error('Failed to load import data:', error);
      navigate('/template-based-inventory-import');
    }
  }, [navigate]);

  const normalizeText = (text) => {
    return String(text || '')?.toLowerCase()?.trim();
  };

  const parseNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const trimmed = String(value)?.trim();
    const parsed = parseFloat(trimmed);
    return isNaN(parsed) ? null : parsed;
  };

  // Category normalization with case-insensitive matching
  const normalizeCategoryName = (categoryName) => {
    if (!categoryName) return 'Imported';
    const normalized = String(categoryName)?.trim();
    return normalized || 'Imported';
  };

  const findExistingCategory = (categoryName, existingCategories) => {
    const normalizedInput = normalizeText(categoryName);
    return existingCategories?.find(cat => normalizeText(cat) === normalizedInput);
  };

  const processImport = (data) => {
    setProcessing(true);
    setImportError(null);

    try {
      const { headers, rows, columnMapping, itemNameIndex } = data;
      
      // Get current asset scope
      const assetId = getCurrentAssetId();
      
      // Normalize headers for mapping
      const normalizedHeaders = headers?.map(h => normalizeText(h));
      
      // Find column indices
      const findColumnIndex = (patterns) => {
        return normalizedHeaders?.findIndex(h => patterns?.includes(h));
      };

      const categoryIndex = findColumnIndex(['category']);
      const subcategoryIndex = findColumnIndex(['subcategory', 'sub category']);
      const brandIndex = findColumnIndex(['brand']);
      const locationIndex = findColumnIndex(['location']);
      const quantityIndex = findColumnIndex(['quantity', 'qty', 'amount']);
      const unitIndex = findColumnIndex(['unit', 'uom', 'unit of measure']);
      const conditionIndex = findColumnIndex(['condition']);
      const parLevelIndex = findColumnIndex(['par level', 'par']);
      const reorderPointIndex = findColumnIndex(['reorder point', 'reorder']);
      const notesIndex = findColumnIndex(['notes', 'note', 'comments']);
      const photoIndex = findColumnIndex(['photo', 'image url', 'image']);

      const processedRows = [];
      const skippedRows = [];
      const warnings = [];
      let itemsCreated = 0;
      let itemsUpdated = 0;
      const locationsCreated = new Set();
      const categoriesTracked = new Set();
      let stockLocationsCreated = 0;

      // Get existing items for deduplication
      const existingItems = getAllItems();
      
      // Build list of existing categories (case-preserved)
      const existingCategories = [...new Set(existingItems?.map(item => item?.category)?.filter(Boolean))];

      rows?.forEach((row, index) => {
        const rowNumber = index + 2; // +2 because: 1 for header, 1 for 0-index
        
        // VALIDATION: Only Item Name is required
        const itemName = String(row?.[itemNameIndex] || '')?.trim();
        
        if (!itemName) {
          skippedRows?.push({
            rowNumber,
            itemName: '',
            quantity: row?.[quantityIndex] || '',
            reason: 'Missing Item Name'
          });
          return;
        }

        // Extract category with normalization
        const rawCategory = String(row?.[categoryIndex] || '')?.trim();
        const normalizedCategory = normalizeCategoryName(rawCategory);
        
        // Find existing category with same normalized name (case-insensitive)
        const existingCategory = findExistingCategory(normalizedCategory, existingCategories);
        const finalCategory = existingCategory || normalizedCategory;
        
        // Track categories (for statistics)
        categoriesTracked?.add(finalCategory);
        
        // If new category, add to existing list
        if (!existingCategory) {
          existingCategories?.push(finalCategory);
        }

        // Extract all other fields (with defaults for blanks)
        const subcategory = String(row?.[subcategoryIndex] || '')?.trim() || null;
        const brand = String(row?.[brandIndex] || '')?.trim() || null;
        const location = String(row?.[locationIndex] || '')?.trim() || 'Unassigned';
        const quantity = parseNumber(row?.[quantityIndex]);
        const unit = String(row?.[unitIndex] || '')?.trim() || 'each';
        const condition = String(row?.[conditionIndex] || '')?.trim() || null;
        const parLevel = parseNumber(row?.[parLevelIndex]);
        const reorderPoint = parseNumber(row?.[reorderPointIndex]);
        const notes = String(row?.[notesIndex] || '')?.trim() || null;
        const photo = String(row?.[photoIndex] || '')?.trim() || null;

        // Check for existing item (deduplication)
        const normalizedItemName = normalizeText(itemName);
        const normalizedFinalCategory = normalizeText(finalCategory);
        const normalizedSubcategory = normalizeText(subcategory);
        
        const existingItem = existingItems?.find(item => {
          const matchName = normalizeText(item?.name) === normalizedItemName;
          const matchCategory = normalizeText(item?.category) === normalizedFinalCategory;
          const matchSubcategory = normalizeText(item?.subcategory) === normalizedSubcategory;
          const matchAsset = item?.assetId === assetId; // Asset scope matching
          return matchName && matchCategory && (subcategory ? matchSubcategory : true) && matchAsset;
        });

        // Create item object with ASSET SCOPING
        const itemData = {
          id: existingItem?.id || `item-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
          name: itemName,
          category: finalCategory,
          subcategory,
          brand,
          unit,
          condition,
          parLevel,
          reorderPoint,
          notes,
          photo,
          quantity: 0, // Default to 0, will be set if location/quantity provided
          primaryLocation: location,
          additionalLocations: [],
          hasVariants: false,
          variants: [],
          assetId: assetId // REQUIRED SCOPE FIELD
        };

        // Handle stock location (OPTIONAL)
        let stockStatus = 'item-only';
        let stockWarning = null;

        if (location && quantity !== null && quantity !== undefined) {
          // Both location and quantity present - create stock entry
          itemData.quantity = quantity;
          itemData.primaryLocation = location;
          stockStatus = 'item-with-stock';
          stockLocationsCreated++;
          locationsCreated?.add(location);
        } else if (!location && quantity !== null && quantity !== undefined) {
          // Quantity without location - use default location
          itemData.quantity = quantity;
          itemData.primaryLocation = 'Unassigned';
          stockStatus = 'item-with-stock';
          stockWarning = 'Location was blank, assigned to "Unassigned"';
          stockLocationsCreated++;
          locationsCreated?.add('Unassigned');
        } else if (location && (quantity === null || quantity === undefined)) {
          // Location without quantity - item only
          stockWarning = 'Quantity was blank, item created without stock';
        }

        // Save item
        const saved = saveItem(itemData);
        
        if (saved) {
          if (existingItem) {
            itemsUpdated++;
          } else {
            itemsCreated++;
          }

          processedRows?.push({
            rowNumber,
            itemName,
            category: finalCategory,
            location,
            quantity,
            status: stockStatus,
            warning: stockWarning,
            itemId: itemData?.id,
            isUpdate: !!existingItem
          });

          if (stockWarning) {
            warnings?.push({
              rowNumber,
              itemName,
              message: stockWarning
            });
          }
        } else {
          skippedRows?.push({
            rowNumber,
            itemName,
            quantity,
            reason: 'Failed to save item'
          });
        }
      });

      // POST-COMMIT VERIFICATION (DEBUG SAFETY)
      const liveItems = getAllItems();
      const liveItemsForAsset = liveItems?.filter(item => item?.assetId === assetId);
      const verificationData = {
        totalLiveItems: liveItems?.length,
        liveItemsForCurrentAsset: liveItemsForAsset?.length,
        assetId: assetId,
        categoriesInLiveData: [...new Set(liveItemsForAsset?.map(item => item?.category))]?.length
      };
      
      setLiveVerification(verificationData);
      
      // Check if live count is 0 (critical error)
      if (verificationData?.liveItemsForCurrentAsset === 0 && (itemsCreated > 0 || itemsUpdated > 0)) {
        setImportError('Import completed but no live records were found for current asset. Check collection wiring.');
      }

      setResults({
        totalRows: rows?.length,
        itemsCreated,
        itemsUpdated,
        locationsCreated: locationsCreated?.size,
        categoriesUpdated: categoriesTracked?.size,
        stockLocationsCreated,
        processedRows,
        skippedRows,
        warnings
      });

      setProcessing(false);
      
      // Show success modal if any items were processed
      if (itemsCreated > 0 || itemsUpdated > 0) {
        setShowSuccessModal(true);
      } else if (skippedRows?.length === rows?.length) {
        // All rows skipped - show error
        setImportError('0 rows imported — check Item Name column exists and contains data');
      }
    } catch (error) {
      console.error('Import processing error:', error);
      setImportError(`Import failed: ${error?.message || 'Unknown error occurred'}`);
      setProcessing(false);
    }
  };

  const toggleRowExpansion = (rowNumber) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded?.has(rowNumber)) {
      newExpanded?.delete(rowNumber);
    } else {
      newExpanded?.add(rowNumber);
    }
    setExpandedRows(newExpanded);
  };

  const handleViewInventory = () => {
    sessionStorage.removeItem('cargo_template_import_data');
    // Force reload of inventory data by navigating with state
    navigate('/inventory', { state: { refresh: true, fromImport: true } });
  };

  const handleNewImport = () => {
    sessionStorage.removeItem('cargo_template_import_data');
    navigate('/template-based-inventory-import');
  };

  if (!importData || processing) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container mx-auto px-6 py-8 max-w-7xl">
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <Icon name="Loader2" size={48} className="text-primary animate-spin mx-auto mb-4" />
              <p className="text-lg text-muted-foreground">Importing inventory...</p>
              <p className="text-sm text-muted-foreground mt-2">Committing data to live inventory system</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto px-6 py-8 max-w-7xl">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => navigate('/template-based-inventory-import')}
              className="p-2 hover:bg-muted rounded-lg transition-colors"
            >
              <Icon name="ArrowLeft" size={20} className="text-muted-foreground" />
            </button>
            <div className="flex-1">
              <h1 className="text-4xl font-semibold text-foreground mb-2 font-heading">
                Import Status & Review
              </h1>
              <p className="text-base text-muted-foreground">
                Complete transparency in template-based inventory processing
              </p>
            </div>
          </div>
          
          {/* Error Alert */}
          {importError && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 flex items-start gap-3">
              <Icon name="AlertCircle" size={20} className="text-destructive flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-destructive mb-1">Import Error</h4>
                <p className="text-sm text-destructive/90">{importError}</p>
              </div>
            </div>
          )}
        </div>

        {results && (
          <div className="space-y-6">
            {/* Summary Statistics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-card rounded-2xl border border-border shadow-sm p-6">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center">
                    <Icon name="CheckCircle2" size={20} className="text-success" />
                  </div>
                  <span className="text-sm font-medium text-muted-foreground">Items Created</span>
                </div>
                <p className="text-3xl font-semibold text-foreground">{results?.itemsCreated}</p>
              </div>

              <div className="bg-card rounded-2xl border border-border shadow-sm p-6">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Icon name="RefreshCw" size={20} className="text-primary" />
                  </div>
                  <span className="text-sm font-medium text-muted-foreground">Items Updated</span>
                </div>
                <p className="text-3xl font-semibold text-foreground">{results?.itemsUpdated}</p>
              </div>

              <div className="bg-card rounded-2xl border border-border shadow-sm p-6">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg bg-warning/10 flex items-center justify-center">
                    <Icon name="AlertTriangle" size={20} className="text-warning" />
                  </div>
                  <span className="text-sm font-medium text-muted-foreground">Warnings</span>
                </div>
                <p className="text-3xl font-semibold text-foreground">{results?.warnings?.length}</p>
              </div>

              <div className="bg-card rounded-2xl border border-border shadow-sm p-6">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg bg-destructive/10 flex items-center justify-center">
                    <Icon name="XCircle" size={20} className="text-destructive" />
                  </div>
                  <span className="text-sm font-medium text-muted-foreground">Rows Skipped</span>
                </div>
                <p className="text-3xl font-semibold text-foreground">{results?.skippedRows?.length}</p>
              </div>
            </div>

            {/* Additional Stats */}
            <div className="bg-card rounded-2xl border border-border shadow-sm p-6">
              <h3 className="text-lg font-semibold text-foreground mb-4">Import Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Total Rows Processed</p>
                  <p className="text-2xl font-semibold text-foreground">{results?.totalRows}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Categories Updated</p>
                  <p className="text-2xl font-semibold text-foreground">{results?.categoriesUpdated}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Locations Created</p>
                  <p className="text-2xl font-semibold text-foreground">{results?.locationsCreated}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Stock Entries Created</p>
                  <p className="text-2xl font-semibold text-foreground">{results?.stockLocationsCreated}</p>
                </div>
              </div>
            </div>

            {/* Processed Rows Table */}
            <div className="bg-card rounded-2xl border border-border shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-foreground">Processed Rows</h3>
                <span className="text-sm text-muted-foreground">
                  {results?.processedRows?.length} rows imported successfully
                </span>
              </div>
              
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="overflow-x-auto max-h-96">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Row</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Item Name</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Category</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Location</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Quantity</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {results?.processedRows?.map((row) => (
                        <React.Fragment key={row?.rowNumber}>
                          <tr className="hover:bg-muted/30">
                            <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                              {row?.rowNumber}
                            </td>
                            <td className="px-4 py-3 font-medium text-foreground">
                              {row?.itemName}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {row?.category}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {row?.location || '-'}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {row?.quantity !== null && row?.quantity !== undefined ? row?.quantity : '-'}
                            </td>
                            <td className="px-4 py-3">
                              {row?.status === 'item-with-stock' ? (
                                <span className="inline-flex items-center gap-1 px-2 py-1 bg-success/10 text-success rounded-full text-xs font-medium">
                                  <Icon name="CheckCircle2" size={12} />
                                  {row?.isUpdate ? 'Updated + Stock' : 'Success + Stock'}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded-full text-xs font-medium">
                                  <Icon name="Check" size={12} />
                                  {row?.isUpdate ? 'Updated' : 'Imported'}
                                </span>
                              )}
                              {row?.warning && (
                                <span className="inline-flex items-center gap-1 px-2 py-1 bg-warning/10 text-warning rounded-full text-xs font-medium ml-2">
                                  <Icon name="AlertTriangle" size={12} />
                                  Warning
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <button
                                onClick={() => toggleRowExpansion(row?.rowNumber)}
                                className="text-primary hover:text-primary/80 text-xs font-medium"
                              >
                                {expandedRows?.has(row?.rowNumber) ? 'Hide' : 'Details'}
                              </button>
                            </td>
                          </tr>
                          {expandedRows?.has(row?.rowNumber) && (
                            <tr>
                              <td colSpan="7" className="px-4 py-4 bg-muted/20">
                                <div className="space-y-2 text-sm">
                                  <p className="text-foreground">
                                    <strong>Processing Details:</strong>
                                  </p>
                                  <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-4">
                                    <li>Item {row?.isUpdate ? 'updated' : 'created'} successfully</li>
                                    {row?.status === 'item-with-stock' && (
                                      <li>Stock location assigned: {row?.location} with quantity {row?.quantity}</li>
                                    )}
                                    {row?.warning && (
                                      <li className="text-warning">{row?.warning}</li>
                                    )}
                                    <li>Item ID: {row?.itemId}</li>
                                  </ul>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Skipped Rows */}
            {results?.skippedRows?.length > 0 && (
              <div className="bg-card rounded-2xl border border-destructive/20 shadow-sm p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Icon name="XCircle" size={20} className="text-destructive" />
                  <h3 className="text-lg font-semibold text-foreground">Skipped Rows</h3>
                  <span className="text-sm text-muted-foreground">({results?.skippedRows?.length} rows)</span>
                </div>
                
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Row</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Item Name</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Quantity</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {results?.skippedRows?.map((row) => (
                        <tr key={row?.rowNumber}>
                          <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                            {row?.rowNumber}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {row?.itemName || '(blank)'}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {row?.quantity || '(blank)'}
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-destructive/10 text-destructive rounded-full text-xs font-medium">
                              {row?.reason}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center gap-4 pt-4">
              <Button
                onClick={handleViewInventory}
                variant="primary"
                className="flex-1"
              >
                <Icon name="Package" size={16} />
                View Inventory
              </Button>
              <Button
                onClick={handleNewImport}
                variant="outline"
              >
                <Icon name="Upload" size={16} />
                New Import
              </Button>
            </div>
          </div>
        )}
      </div>
      {/* Success Modal */}
      {showSuccessModal && results && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border border-border shadow-xl max-w-md w-full p-8 animate-in fade-in zoom-in duration-200">
            {/* Success Icon */}
            <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-6">
              <Icon name="CheckCircle2" size={32} className="text-success" />
            </div>
            
            {/* Title */}
            <h2 className="text-2xl font-semibold text-foreground text-center mb-2">
              Inventory Imported Successfully
            </h2>
            <p className="text-sm text-muted-foreground text-center mb-6">
              Your inventory data has been committed to the live system and is now visible in the Inventory dashboard
            </p>
            
            {/* Statistics */}
            <div className="space-y-3 mb-6">
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <span className="text-sm text-muted-foreground">Items Added</span>
                <span className="text-lg font-semibold text-foreground">{results?.itemsCreated}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <span className="text-sm text-muted-foreground">Items Updated</span>
                <span className="text-lg font-semibold text-foreground">{results?.itemsUpdated}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <span className="text-sm text-muted-foreground">Categories Updated</span>
                <span className="text-lg font-semibold text-foreground">{results?.categoriesUpdated}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <span className="text-sm text-muted-foreground">Locations Added</span>
                <span className="text-lg font-semibold text-foreground">{results?.locationsCreated}</span>
              </div>
              
              {/* LIVE VERIFICATION DISPLAY */}
              {liveVerification && (
                <div className="border-t border-border pt-3 mt-3">
                  <div className="flex items-center justify-between p-3 bg-success/10 rounded-lg">
                    <span className="text-sm font-medium text-success">Live Items Now</span>
                    <span className="text-lg font-semibold text-success">{liveVerification?.liveItemsForCurrentAsset}</span>
                  </div>
                  <p className="text-xs text-muted-foreground text-center mt-2">
                    Verified in live inventory for asset: {liveVerification?.assetId}
                  </p>
                </div>
              )}
            </div>
            
            {/* Actions */}
            <div className="space-y-3">
              <Button
                onClick={handleViewInventory}
                variant="primary"
                className="w-full"
              >
                <Icon name="Package" size={16} />
                View Inventory
              </Button>
              <Button
                onClick={() => setShowSuccessModal(false)}
                variant="outline"
                className="w-full"
              >
                Review Details
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImportStatusReview;