import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import LogoSpinner from '../../components/LogoSpinner';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Header from '../../components/navigation/Header';
import { transformToInventoryItems } from '../auto-import-intelligence-engine/utils/headerIntelligence';
import { saveItem } from '../inventory-management/utils/inventoryStorage';
import { saveLocation, getAllLocations } from './utils/locationStorage';

const AutoImportReviewAdjustment = () => {
  const navigate = useNavigate();
  const [importData, setImportData] = useState(null);
  const [transformedData, setTransformedData] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importComplete, setImportComplete] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  
  // Adjustment state
  const [locationRenames, setLocationRenames] = useState({});
  const [categoryRenames, setCategoryRenames] = useState({});
  const [showAdjustments, setShowAdjustments] = useState(false);

  // Import results
  const [results, setResults] = useState({
    itemsCreated: 0,
    itemsUpdated: 0,
    locationsCreated: 0,
    categoriesUsed: 0,
    rowsSkipped: 0
  });

  useEffect(() => {
    const storedData = sessionStorage.getItem('cargo_auto_import_data');
    if (!storedData) {
      navigate('/auto-import-intelligence-engine');
      return;
    }

    try {
      const parsed = JSON.parse(storedData);
      setImportData(parsed);
      
      const transformed = transformToInventoryItems(
        parsed?.headers,
        parsed?.allRows,
        parsed?.interpretation
      );
      setTransformedData(transformed);

      // Initialize rename maps
      const locRenames = {};
      parsed?.interpretation?.locationColumns?.forEach(loc => {
        locRenames[loc] = loc;
      });
      setLocationRenames(locRenames);

      const catRenames = {};
      parsed?.dataAnalysis?.categoriesDetected?.forEach(cat => {
        catRenames[cat] = cat;
      });
      setCategoryRenames(catRenames);
    } catch (error) {
      console.error('Failed to parse import data:', error);
      navigate('/auto-import-intelligence-engine');
    }
  }, [navigate]);

  const handleLocationRename = (originalName, newName) => {
    setLocationRenames(prev => ({
      ...prev,
      [originalName]: newName
    }));
  };

  const handleCategoryRename = (originalName, newName) => {
    setCategoryRenames(prev => ({
      ...prev,
      [originalName]: newName
    }));
  };

  const getCategoryId = (categoryName) => {
    const categoryIdMap = {
      'alcohol & bar': 'alcohol-bar',
      'pantry': 'pantry',
      'cold stores': 'cold-stores',
      'guest amenities': 'guest-amenities',
      'cleaning & laundry': 'cleaning-laundry',
      'uniforms': 'uniforms',
      'spare parts': 'spare-parts',
      'safety & compliance': 'safety-compliance'
    };
    
    const normalized = categoryName?.toLowerCase()?.trim();
    return categoryIdMap?.[normalized] || 'pantry';
  };

  const handleCommitImport = async () => {
    if (!transformedData) return;

    setIsImporting(true);
    setImportProgress(0);

    const existingLocations = getAllLocations();
    const existingLocationNames = existingLocations?.map(loc => loc?.name?.toLowerCase());
    const newLocationsCreated = new Set();
    const categoriesUsed = new Set();
    let itemsCreated = 0;
    let itemsUpdated = 0;

    try {
      const totalItems = transformedData?.items?.length;

      for (let i = 0; i < totalItems; i++) {
        const item = transformedData?.items?.[i];
        
        // Apply category rename
        const finalCategory = categoryRenames?.[item?.category] || item?.category;
        categoriesUsed?.add(finalCategory);

        // Process location quantities with renames
        const processedLocations = [];
        
        for (const locQty of item?.locationQuantities || []) {
          const finalLocationName = locationRenames?.[locQty?.locationName] || locQty?.locationName;
          
          // Create location if it doesn't exist
          if (!existingLocationNames?.includes(finalLocationName?.toLowerCase()) && 
              !newLocationsCreated?.has(finalLocationName?.toLowerCase())) {
            saveLocation({
              name: finalLocationName,
              type: 'storage',
              description: `Auto-created from import`
            });
            newLocationsCreated?.add(finalLocationName?.toLowerCase());
          }

          processedLocations?.push({
            location: finalLocationName,
            quantity: locQty?.quantity
          });
        }

        // Create inventory item
        const itemData = {
          name: item?.name,
          category: finalCategory,
          categoryId: getCategoryId(finalCategory),
          unit: item?.unit || 'each',
          quantity: processedLocations?.[0]?.quantity || 0,
          primaryLocation: processedLocations?.[0]?.location || 'Other',
          additionalLocations: processedLocations?.slice(1)?.map(loc => ({
            location: loc?.location,
            quantity: loc?.quantity
          })),
          notes: item?.notes || '',
          parLevel: 0,
          reorderPoint: 0,
          supplier: '',
          purchasePrice: 0,
          purchaseDate: '',
          condition: '',
          hasVariants: false,
          variants: []
        };

        saveItem(itemData);
        itemsCreated++;

        // Update progress
        setImportProgress(Math.round(((i + 1) / totalItems) * 100));
        await new Promise(resolve => setTimeout(resolve, 30));
      }

      setResults({
        itemsCreated,
        itemsUpdated,
        locationsCreated: newLocationsCreated?.size,
        categoriesUsed: categoriesUsed?.size,
        rowsSkipped: transformedData?.skippedRows?.length || 0
      });

      setIsImporting(false);
      setImportComplete(true);
      sessionStorage.removeItem('cargo_auto_import_data');
    } catch (error) {
      console.error('Import failed:', error);
      setIsImporting(false);
    }
  };

  const handleBackToInventory = () => {
    sessionStorage.removeItem('cargo_auto_import_data');
    navigate('/inventory');
  };

  if (!importData || !transformedData) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <LogoSpinner size={48} className="mx-auto mb-4" />
          <p className="text-muted-foreground">Loading import data...</p>
        </div>
      </div>
    );
  }

  if (importComplete) {
    return (
      <div className="min-h-screen bg-background transition-colors duration-300">
        <Header />
        <main className="p-6 max-w-[1400px] mx-auto">
          <div className="bg-card border border-border rounded-2xl p-8 shadow-sm text-center">
            <div className="w-20 h-20 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-6">
              <Icon name="CheckCircle2" size={48} className="text-success" />
            </div>
            
            <h1 className="text-3xl font-semibold text-foreground mb-3">Import Complete!</h1>
            <p className="text-muted-foreground mb-8">Your inventory has been successfully updated</p>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
              <div className="bg-muted/30 rounded-xl p-4">
                <p className="text-xs text-muted-foreground mb-1">Items Created</p>
                <p className="text-3xl font-bold text-foreground">{results?.itemsCreated}</p>
              </div>
              <div className="bg-muted/30 rounded-xl p-4">
                <p className="text-xs text-muted-foreground mb-1">Locations Created</p>
                <p className="text-3xl font-bold text-foreground">{results?.locationsCreated}</p>
              </div>
              <div className="bg-muted/30 rounded-xl p-4">
                <p className="text-xs text-muted-foreground mb-1">Categories Used</p>
                <p className="text-3xl font-bold text-foreground">{results?.categoriesUsed}</p>
              </div>
              <div className="bg-muted/30 rounded-xl p-4">
                <p className="text-xs text-muted-foreground mb-1">Rows Skipped</p>
                <p className="text-3xl font-bold text-muted-foreground">{results?.rowsSkipped}</p>
              </div>
            </div>

            {transformedData?.skippedRows?.length > 0 && (
              <div className="bg-warning/10 border border-warning/20 rounded-xl p-4 mb-6 text-left">
                <h3 className="text-sm font-semibold text-warning mb-2 flex items-center gap-2">
                  <Icon name="AlertTriangle" size={16} />
                  Skipped Rows
                </h3>
                <div className="space-y-1 text-xs text-muted-foreground">
                  {transformedData?.skippedRows?.slice(0, 5)?.map((skip, idx) => (
                    <p key={idx}>Row {skip?.rowIndex}: {skip?.reason}</p>
                  ))}
                  {transformedData?.skippedRows?.length > 5 && (
                    <p className="text-warning">...and {transformedData?.skippedRows?.length - 5} more</p>
                  )}
                </div>
              </div>
            )}

            <Button
              variant="default"
              size="lg"
              onClick={handleBackToInventory}
              iconName="Package"
            >
              Go to Inventory
            </Button>
          </div>
        </main>
      </div>
    );
  }

  if (isImporting) {
    return (
      <div className="min-h-screen bg-background transition-colors duration-300">
        <Header />
        <main className="p-6 max-w-[1400px] mx-auto">
          <div className="bg-card border border-border rounded-2xl p-8 shadow-sm text-center">
            <div className="flex justify-center mb-8">
              <div className="relative w-48 h-48">
                <svg className="w-48 h-48 transform -rotate-90">
                  <circle
                    cx="96"
                    cy="96"
                    r="88"
                    stroke="currentColor"
                    strokeWidth="8"
                    fill="none"
                    className="text-muted"
                  />
                  <circle
                    cx="96"
                    cy="96"
                    r="88"
                    stroke="currentColor"
                    strokeWidth="8"
                    fill="none"
                    strokeDasharray={`${2 * Math.PI * 88}`}
                    strokeDashoffset={`${2 * Math.PI * 88 * (1 - importProgress / 100)}`}
                    className="text-primary transition-all duration-300"
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <p className="text-4xl font-bold text-foreground">{importProgress}%</p>
                  <p className="text-sm text-muted-foreground">Importing</p>
                </div>
              </div>
            </div>
            
            <h2 className="text-2xl font-semibold text-foreground mb-2">Creating Inventory...</h2>
            <p className="text-muted-foreground">Please wait while we process your items and locations</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[1400px] mx-auto">
        {/* Page Header */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={() => navigate('/auto-import-intelligence-engine')}
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
          >
            <Icon name="ArrowLeft" size={24} className="text-foreground" />
          </button>
          <div className="flex-1">
            <h1 className="text-4xl font-semibold text-foreground mb-2 font-heading">Review & Adjust Import</h1>
            <p className="text-base text-muted-foreground">Confirm automatic detection results and make optional adjustments</p>
          </div>
        </div>

        {/* Summary Dashboard */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm mb-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-semibold text-foreground">Import Summary</h2>
            <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 rounded-lg">
              <Icon name="Sparkles" size={20} className="text-primary" />
              <span className="text-sm font-medium text-primary">Auto-Detected</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-success/10 border border-success/20 rounded-xl p-4">
              <div className="flex items-center gap-3 mb-2">
                <Icon name="Package" size={24} className="text-success" />
                <p className="text-xs text-muted-foreground">Items to Create</p>
              </div>
              <p className="text-3xl font-bold text-foreground">{transformedData?.items?.length || 0}</p>
            </div>

            <div className="bg-primary/10 border border-primary/20 rounded-xl p-4">
              <div className="flex items-center gap-3 mb-2">
                <Icon name="MapPin" size={24} className="text-primary" />
                <p className="text-xs text-muted-foreground">New Locations</p>
              </div>
              <p className="text-3xl font-bold text-foreground">{Object.keys(locationRenames)?.length || 0}</p>
            </div>

            <div className="bg-primary/10 border border-primary/20 rounded-xl p-4">
              <div className="flex items-center gap-3 mb-2">
                <Icon name="FolderOpen" size={24} className="text-primary" />
                <p className="text-xs text-muted-foreground">Categories</p>
              </div>
              <p className="text-3xl font-bold text-foreground">{Object.keys(categoryRenames)?.length || 0}</p>
            </div>

            <div className="bg-muted/30 rounded-xl p-4">
              <div className="flex items-center gap-3 mb-2">
                <Icon name="AlertCircle" size={24} className="text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Rows Skipped</p>
              </div>
              <p className="text-3xl font-bold text-muted-foreground">{transformedData?.skippedRows?.length || 0}</p>
            </div>
          </div>
        </div>

        {/* Adjustment Toggle */}
        <div className="mb-6">
          <Button
            variant={showAdjustments ? "default" : "outline"}
            onClick={() => setShowAdjustments(!showAdjustments)}
            iconName={showAdjustments ? "ChevronUp" : "Settings"}
          >
            {showAdjustments ? 'Hide Adjustments' : 'Make Small Changes'}
          </Button>
        </div>

        {/* Adjustment Panels */}
        {showAdjustments && (
          <div className="space-y-6 mb-6">
            {/* Location Adjustments */}
            {Object.keys(locationRenames)?.length > 0 && (
              <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                  <Icon name="MapPin" size={20} />
                  Location Adjustments
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Rename detected locations before import. Changes will apply to all items using these locations.
                </p>

                <div className="space-y-3">
                  {Object.keys(locationRenames)?.map(originalName => (
                    <div key={originalName} className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl">
                      <div className="flex-1">
                        <p className="text-xs text-muted-foreground mb-1">Original</p>
                        <p className="text-sm font-medium text-foreground">{originalName}</p>
                      </div>
                      <Icon name="ArrowRight" size={16} className="text-muted-foreground" />
                      <div className="flex-1">
                        <Input
                          value={locationRenames?.[originalName]}
                          onChange={(e) => handleLocationRename(originalName, e?.target?.value)}
                          placeholder="New location name"
                          className="text-sm"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Category Adjustments */}
            {Object.keys(categoryRenames)?.length > 0 && (
              <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                  <Icon name="FolderOpen" size={20} />
                  Category Adjustments
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Rename or standardize detected categories. All items in a category will use the new name.
                </p>

                <div className="space-y-3">
                  {Object.keys(categoryRenames)?.map(originalName => (
                    <div key={originalName} className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl">
                      <div className="flex-1">
                        <p className="text-xs text-muted-foreground mb-1">Original</p>
                        <p className="text-sm font-medium text-foreground">{originalName}</p>
                      </div>
                      <Icon name="ArrowRight" size={16} className="text-muted-foreground" />
                      <div className="flex-1">
                        <Input
                          value={categoryRenames?.[originalName]}
                          onChange={(e) => handleCategoryRename(originalName, e?.target?.value)}
                          placeholder="New category name"
                          className="text-sm"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Preview Table */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm mb-6">
          <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <Icon name="Eye" size={20} />
            Final Data Preview
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            Preview of how items will appear after import with all adjustments applied
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Item Name</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Category</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Locations</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Total Qty</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Unit</th>
                </tr>
              </thead>
              <tbody>
                {transformedData?.items?.slice(0, 10)?.map((item, idx) => {
                  const finalCategory = categoryRenames?.[item?.category] || item?.category;
                  const finalLocations = item?.locationQuantities?.map(loc => ({
                    name: locationRenames?.[loc?.locationName] || loc?.locationName,
                    qty: loc?.quantity
                  }));

                  return (
                    <tr key={idx} className="border-b border-border hover:bg-muted/30">
                      <td className="p-3 text-xs text-foreground font-medium">{item?.name}</td>
                      <td className="p-3 text-xs text-foreground">{finalCategory}</td>
                      <td className="p-3 text-xs text-foreground">
                        <div className="flex flex-wrap gap-1">
                          {finalLocations?.map((loc, locIdx) => (
                            <span key={locIdx} className="px-2 py-1 bg-primary/10 text-primary rounded-md text-xs">
                              {loc?.name} ({loc?.qty})
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="p-3 text-xs text-foreground font-medium">{item?.totalQuantity}</td>
                      <td className="p-3 text-xs text-muted-foreground">{item?.unit}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {transformedData?.items?.length > 10 && (
            <p className="text-xs text-muted-foreground mt-3 text-center">
              Showing 10 of {transformedData?.items?.length} items
            </p>
          )}
        </div>

        {/* Skipped Rows Warning */}
        {transformedData?.skippedRows?.length > 0 && (
          <div className="bg-warning/10 border border-warning/20 rounded-2xl p-6 shadow-sm mb-6">
            <h3 className="text-lg font-semibold text-warning mb-3 flex items-center gap-2">
              <Icon name="AlertTriangle" size={20} />
              Rows That Will Be Skipped
            </h3>
            <div className="space-y-2">
              {transformedData?.skippedRows?.slice(0, 5)?.map((skip, idx) => (
                <div key={idx} className="flex items-start gap-2 text-sm">
                  <Icon name="X" size={16} className="text-warning mt-0.5" />
                  <p className="text-muted-foreground">
                    <span className="font-medium">Row {skip?.rowIndex}:</span> {skip?.reason}
                  </p>
                </div>
              ))}
              {transformedData?.skippedRows?.length > 5 && (
                <p className="text-sm text-warning ml-6">...and {transformedData?.skippedRows?.length - 5} more rows</p>
              )}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3">
          <Button
            variant="default"
            size="lg"
            onClick={handleCommitImport}
            iconName="CheckCircle2"
            disabled={isImporting}
          >
            Looks Good — Import {transformedData?.items?.length} Items
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={() => navigate('/auto-import-intelligence-engine')}
          >
            Back to Analysis
          </Button>
        </div>

        {/* Advanced Import Options Link */}
        <div className="mt-6 text-center">
          <button
            onClick={() => navigate('/csv-upload-staging')}
            className="text-sm text-muted-foreground hover:text-foreground transition-smooth"
          >
            Detection not working? <span className="underline">Use advanced import options</span>
          </button>
        </div>
      </main>
    </div>
  );
};

export default AutoImportReviewAdjustment;