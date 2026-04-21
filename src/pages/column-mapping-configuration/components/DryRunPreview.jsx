import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import LogoSpinner from '../../../components/LogoSpinner';
import Button from '../../../components/ui/Button';
import Header from '../../../components/navigation/Header';
import { getBatchById, saveBatch, getRowsByBatchId, normalizeText, findClosestCategory, findClosestUnit, findClosestLocation, getCategoryId } from '../../csv-import-interface/utils/importStorage';
import { getAllItems, saveItem } from '../../inventory-management/utils/inventoryStorage';

const DryRunPreview = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const batchId = searchParams?.get('batchId');

  const [batch, setBatch] = useState(null);
  const [rows, setRows] = useState([]);
  const [isProcessing, setIsProcessing] = useState(true);
  const [dryRunResults, setDryRunResults] = useState(null);
  const [isCommitting, setIsCommitting] = useState(false);

  useEffect(() => {
    loadAndProcessBatch();
  }, [batchId]);

  const loadAndProcessBatch = () => {
    if (!batchId) {
      navigate('/csv-upload-staging');
      return;
    }

    const loadedBatch = getBatchById(batchId);
    if (!loadedBatch || !loadedBatch?.mapping) {
      navigate('/csv-upload-staging');
      return;
    }

    const loadedRows = getRowsByBatchId(batchId);
    setBatch(loadedBatch);
    setRows(loadedRows);

    // Run dry-run transformation
    runDryRun(loadedBatch, loadedRows);
  };

  const runDryRun = (batchData, rowsData) => {
    setIsProcessing(true);

    const results = {
      items_to_create: [],
      items_to_update: [],
      locations_to_create: [],
      rows_skipped: [],
      total_rows: rowsData?.length,
      processed_rows: 0,
      skipped_rows: 0
    };

    const existingItems = getAllItems();
    const reverseMapping = {};
    const locationQuantityColumns = []; // Track Location Quantity Column mappings
    
    Object.entries(batchData?.mapping)?.forEach(([csvHeader, cargoField]) => {
      if (cargoField) {
        if (cargoField === 'locationQuantity') {
          // Store Location Quantity Column mappings separately
          locationQuantityColumns?.push(csvHeader);
        } else {
          reverseMapping[cargoField] = csvHeader;
        }
      }
    });

    const uniqueLocations = new Set();
    const itemUniquenessMap = {}; // Track items by uniqueness key

    rowsData?.forEach((row, index) => {
      const rawData = row?.raw;

      // MINIMUM REQUIRED FIELDS VALIDATION (STRICT)
      // 1) Item Name must be present (non-empty string)
      const rawName = rawData?.[reverseMapping?.['name']];
      const name = rawName?.toString()?.trim();
      
      if (!name) {
        results?.rows_skipped?.push({
          row_index: row?.row_index,
          raw_item_name: rawName,
          raw_quantity: rawData?.[reverseMapping?.['quantity']] || '(no quantity column)',
          name: '(blank)',
          reasons: ['Missing Item Name']
        });
        results.skipped_rows++;
        return;
      }

      // Skip totals/summary rows (common pattern)
      const nameLower = name?.toLowerCase();
      if (nameLower?.includes('total') || nameLower?.includes('subtotal') || nameLower?.includes('summary')) {
        results?.rows_skipped?.push({
          row_index: row?.row_index,
          raw_item_name: rawName,
          raw_quantity: rawData?.[reverseMapping?.['quantity']] || '(no quantity column)',
          name: name,
          reasons: ['Appears to be a totals/summary row']
        });
        results.skipped_rows++;
        return;
      }

      // OPTIONAL FIELDS - Apply defaults when blank (NEVER SKIP)
      const rawCategory = rawData?.[reverseMapping?.['category']];
      const category = rawCategory?.toString()?.trim() || 'Imported'; // DEFAULT
      
      const rawSubcategory = rawData?.[reverseMapping?.['subcategory']];
      const subcategory = rawSubcategory?.toString()?.trim() || ''; // Blank OK
      
      const rawUnit = rawData?.[reverseMapping?.['unit']];
      const unit = rawUnit?.toString()?.trim() || 'each'; // DEFAULT
      
      const rawPrimaryLocation = rawData?.[reverseMapping?.['primaryLocation']];
      const primaryLocationInput = rawPrimaryLocation?.toString()?.trim() || ''; // Will set default later
      
      const rawQuantity = rawData?.[reverseMapping?.['quantity']];
      
      // QUANTITY PARSING (IMPORTANT)
      // 2) Quantity must be present and parseable as a number
      // Process Location Quantity Columns
      const additionalLocations = [];
      let firstLocationWithQty = null;
      let totalQuantityFromLocations = 0;
      
      locationQuantityColumns?.forEach(columnHeader => {
        const locationName = columnHeader?.trim(); // Column header is the location name
        const rawLocationQty = rawData?.[columnHeader];
        
        // Trim spaces and convert safely
        if (rawLocationQty !== null && rawLocationQty !== undefined && rawLocationQty?.toString()?.trim()) {
          const parsedLocationQty = parseFloat(rawLocationQty?.toString()?.trim());
          
          if (!isNaN(parsedLocationQty) && parsedLocationQty > 0) {
            const normalizedLocationName = findClosestLocation(locationName);
            uniqueLocations?.add(normalizedLocationName);
            
            additionalLocations?.push({
              location: normalizedLocationName,
              quantity: parsedLocationQty
            });
            
            totalQuantityFromLocations += parsedLocationQty;
            
            // Track first location with non-zero quantity for primary location
            if (!firstLocationWithQty) {
              firstLocationWithQty = normalizedLocationName;
            }
          }
        }
      });
      
      // Determine final quantity and primary location
      let finalQuantity = 0;
      let finalPrimaryLocation = '';
      
      // Check if we have quantity from regular Quantity column
      // Trim spaces and convert safely - accept numeric values stored as strings
      let hasRegularQuantity = false;
      let parsedQuantity = 0;
      
      if (rawQuantity !== null && rawQuantity !== undefined && rawQuantity?.toString()?.trim()) {
        parsedQuantity = parseFloat(rawQuantity?.toString()?.trim());
        hasRegularQuantity = !isNaN(parsedQuantity) && parsedQuantity > 0;
      }
      
      if (hasRegularQuantity) {
        finalQuantity = parsedQuantity;
        // Use mapped primary location or default
        const normalizedPrimaryLocation = primaryLocationInput ? findClosestLocation(primaryLocationInput) : '';
        finalPrimaryLocation = normalizedPrimaryLocation || firstLocationWithQty || 'Unassigned'; // DEFAULT
        if (normalizedPrimaryLocation) {
          uniqueLocations?.add(normalizedPrimaryLocation);
        }
      } else if (totalQuantityFromLocations > 0) {
        // Use total from location quantity columns
        finalQuantity = totalQuantityFromLocations;
        finalPrimaryLocation = firstLocationWithQty || 'Unassigned'; // DEFAULT
      } else {
        // No quantity found anywhere - skip this row with accurate reason
        results?.rows_skipped?.push({
          row_index: row?.row_index,
          raw_item_name: rawName,
          raw_quantity: rawQuantity,
          name: name,
          reasons: ['Missing Quantity']
        });
        results.skipped_rows++;
        return;
      }

      // Normalize category (with default)
      const normalizedCategory = findClosestCategory(category);
      const normalizedUnit = findClosestUnit(unit);
      
      // OPTIONAL FIELDS - Extract with safe defaults (blanks OK)
      const rawParLevel = rawData?.[reverseMapping?.['parLevel']];
      const parLevel = rawParLevel ? parseFloat(rawParLevel?.toString()?.trim()) : null; // null OK
      
      const rawReorderPoint = rawData?.[reverseMapping?.['reorderPoint']];
      const reorderPoint = rawReorderPoint ? parseFloat(rawReorderPoint?.toString()?.trim()) : null; // null OK
      
      const rawSupplier = rawData?.[reverseMapping?.['supplier']];
      const supplier = rawSupplier?.toString()?.trim() || ''; // Blank OK
      
      const rawPurchasePrice = rawData?.[reverseMapping?.['purchasePrice']];
      const purchasePrice = rawPurchasePrice ? parseFloat(rawPurchasePrice?.toString()?.trim()) : 0; // 0 OK
      
      const rawPurchaseDate = rawData?.[reverseMapping?.['purchaseDate']];
      const purchaseDate = rawPurchaseDate?.toString()?.trim() || ''; // Blank OK
      
      const rawCondition = rawData?.[reverseMapping?.['condition']];
      const condition = rawCondition?.toString()?.trim() || ''; // Blank OK
      
      const rawNotes = rawData?.[reverseMapping?.['notes']];
      const notes = rawNotes?.toString()?.trim() || ''; // Blank OK
      
      const rawImageUrl = rawData?.[reverseMapping?.['imageUrl']];
      const imageUrl = rawImageUrl?.toString()?.trim() || null; // null OK

      // Create item data
      const itemData = {
        name: name,
        category: normalizedCategory,
        categoryId: getCategoryId(normalizedCategory),
        subcategory: subcategory,
        unit: normalizedUnit,
        primaryLocation: finalPrimaryLocation,
        quantity: finalQuantity,
        parLevel: parLevel || 0,
        reorderPoint: reorderPoint || 0,
        supplier: supplier,
        purchasePrice: purchasePrice,
        purchaseDate: purchaseDate,
        condition: condition,
        notes: notes,
        imageUrl: imageUrl,
        additionalLocations: additionalLocations,
        hasVariants: false,
        variants: []
      };

      // Generate uniqueness key
      const uniquenessKey = `${normalizeText(itemData?.name)}_${normalizeText(itemData?.category)}_${normalizeText(itemData?.subcategory)}`;

      // Check if item already exists in inventory
      const existingItem = existingItems?.find(item => {
        const existingKey = `${normalizeText(item?.name)}_${normalizeText(item?.category)}_${normalizeText(item?.subcategory || '')}`;
        return existingKey === uniquenessKey;
      });

      if (existingItem) {
        // Item exists - will update
        results?.items_to_update?.push({
          ...itemData,
          id: existingItem?.id,
          action: 'update',
          existing_quantity: existingItem?.quantity,
          new_quantity: finalQuantity
        });
      } else {
        // Check if this item appears multiple times in CSV
        if (itemUniquenessMap?.[uniquenessKey]) {
          // Duplicate within CSV - combine quantities
          const existingEntry = results?.items_to_create?.find(item => {
            const key = `${normalizeText(item?.name)}_${normalizeText(item?.category)}_${normalizeText(item?.subcategory || '')}`;
            return key === uniquenessKey;
          });
          if (existingEntry) {
            existingEntry.quantity += finalQuantity;
            existingEntry.duplicate_count = (existingEntry?.duplicate_count || 1) + 1;
          }
        } else {
          // New item - will create
          itemUniquenessMap[uniquenessKey] = true;
          results?.items_to_create?.push({
            ...itemData,
            action: 'create'
          });
        }
      }

      results.processed_rows++;
    });

    // Identify new locations
    const existingLocations = [
      'Bar Storage',
      'Wine Cellar',
      'Pantry',
      'Cold Room',
      'Galley',
      'Crew Mess',
      'Guest Cabins',
      'Laundry Room',
      'Engine Room',
      'Deck Storage',
      'Other'
    ];

    uniqueLocations?.forEach(loc => {
      if (!existingLocations?.some(existing => normalizeText(existing) === normalizeText(loc))) {
        results?.locations_to_create?.push(loc);
      }
    });

    setDryRunResults(results);
    setIsProcessing(false);

    // Update batch status
    const updatedBatch = {
      ...batchData,
      status: 'dry_run_ready',
      stats: {
        ...batchData?.stats,
        processed_count: results?.processed_rows,
        skipped_count: results?.skipped_rows
      }
    };
    saveBatch(updatedBatch);
  };

  const handleCommit = () => {
    setIsCommitting(true);

    // Commit items to inventory
    let successCount = 0;
    let errorCount = 0;

    // Create new items
    dryRunResults?.items_to_create?.forEach(item => {
      const { action, duplicate_count, ...itemData } = item;
      const saved = saveItem(itemData);
      if (saved) {
        successCount++;
      } else {
        errorCount++;
      }
    });

    // Update existing items
    dryRunResults?.items_to_update?.forEach(item => {
      const { action, existing_quantity, new_quantity, ...itemData } = item;
      const saved = saveItem(itemData);
      if (saved) {
        successCount++;
      } else {
        errorCount++;
      }
    });

    // Update batch status
    const updatedBatch = {
      ...batch,
      status: 'committed',
      stats: {
        ...batch?.stats,
        success_count: successCount,
        error_count: errorCount
      }
    };
    saveBatch(updatedBatch);

    setTimeout(() => {
      setIsCommitting(false);
      navigate('/inventory');
    }, 1000);
  };

  const handleBackToMapping = () => {
    navigate(`/column-mapping-configuration?batchId=${batchId}`);
  };

  if (isProcessing) {
    return (
      <div className="min-h-screen bg-background transition-colors duration-300">
        <Header />
        <main className="p-6 max-w-[1400px] mx-auto">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <LogoSpinner size={40} className="mx-auto mb-4" />
              <p className="text-muted-foreground">Processing dry-run transformation...</p>
            </div>
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
            onClick={handleBackToMapping}
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
          >
            <Icon name="ArrowLeft" size={24} className="text-foreground" />
          </button>
          <div className="flex-1">
            <h1 className="text-4xl font-semibold text-foreground mb-2 font-heading">Dry-Run Preview</h1>
            <p className="text-base text-muted-foreground">Review transformation results before committing to inventory</p>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Icon name="FileText" size={20} className="text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Rows</p>
                <p className="text-2xl font-semibold text-foreground">{dryRunResults?.total_rows}</p>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center">
                <Icon name="Plus" size={20} className="text-success" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Items to Create</p>
                <p className="text-2xl font-semibold text-foreground">{dryRunResults?.items_to_create?.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center">
                <Icon name="RefreshCw" size={20} className="text-warning" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Items to Update</p>
                <p className="text-2xl font-semibold text-foreground">{dryRunResults?.items_to_update?.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
                <Icon name="XCircle" size={20} className="text-error" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Rows Skipped</p>
                <p className="text-2xl font-semibold text-foreground">{dryRunResults?.skipped_rows}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Items to Create */}
        {dryRunResults?.items_to_create?.length > 0 && (
          <div className="bg-card border border-border rounded-2xl shadow-sm p-6 mb-6">
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <Icon name="Plus" size={20} className="text-success" />
              Items to Create ({dryRunResults?.items_to_create?.length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-2 font-semibold text-foreground">Item Name</th>
                    <th className="text-left p-2 font-semibold text-foreground">Category</th>
                    <th className="text-left p-2 font-semibold text-foreground">Unit</th>
                    <th className="text-left p-2 font-semibold text-foreground">Location</th>
                    <th className="text-right p-2 font-semibold text-foreground">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {dryRunResults?.items_to_create?.slice(0, 10)?.map((item, index) => (
                    <tr key={index} className="border-b border-border hover:bg-muted/20">
                      <td className="p-2 text-foreground">{item?.name}</td>
                      <td className="p-2 text-muted-foreground">{item?.category}</td>
                      <td className="p-2 text-muted-foreground">{item?.unit}</td>
                      <td className="p-2 text-muted-foreground">{item?.primaryLocation}</td>
                      <td className="p-2 text-right text-foreground font-medium">{item?.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {dryRunResults?.items_to_create?.length > 10 && (
                <p className="text-sm text-muted-foreground mt-3 text-center">
                  Showing first 10 of {dryRunResults?.items_to_create?.length} items
                </p>
              )}
            </div>
          </div>
        )}

        {/* Items to Update */}
        {dryRunResults?.items_to_update?.length > 0 && (
          <div className="bg-card border border-border rounded-2xl shadow-sm p-6 mb-6">
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <Icon name="RefreshCw" size={20} className="text-warning" />
              Items to Update ({dryRunResults?.items_to_update?.length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-2 font-semibold text-foreground">Item Name</th>
                    <th className="text-left p-2 font-semibold text-foreground">Category</th>
                    <th className="text-right p-2 font-semibold text-foreground">Current Qty</th>
                    <th className="text-right p-2 font-semibold text-foreground">New Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {dryRunResults?.items_to_update?.slice(0, 10)?.map((item, index) => (
                    <tr key={index} className="border-b border-border hover:bg-muted/20">
                      <td className="p-2 text-foreground">{item?.name}</td>
                      <td className="p-2 text-muted-foreground">{item?.category}</td>
                      <td className="p-2 text-right text-muted-foreground">{item?.existing_quantity}</td>
                      <td className="p-2 text-right text-warning font-medium">{item?.new_quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {dryRunResults?.items_to_update?.length > 10 && (
                <p className="text-sm text-muted-foreground mt-3 text-center">
                  Showing first 10 of {dryRunResults?.items_to_update?.length} items
                </p>
              )}
            </div>
          </div>
        )}

        {/* Skipped Rows */}
        {dryRunResults?.rows_skipped?.length > 0 && (
          <div className="bg-card border border-border rounded-2xl shadow-sm p-6 mb-6">
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <Icon name="XCircle" size={20} className="text-error" />
              Skipped Rows ({dryRunResults?.rows_skipped?.length})
            </h3>
            <div className="bg-muted/30 border border-border rounded-lg p-3 mb-4">
              <p className="text-xs font-semibold text-muted-foreground mb-1">DEBUG SAMPLE (showing raw values from spreadsheet)</p>
              <p className="text-xs text-muted-foreground">This helps confirm the parser is reading the correct columns</p>
            </div>
            <div className="space-y-2">
              {dryRunResults?.rows_skipped?.slice(0, 10)?.map((skip, index) => (
                <div key={index} className="bg-error/5 border border-error/20 rounded-lg p-3">
                  <p className="text-sm font-medium text-foreground mb-1">
                    Row {skip?.row_index + 1}: {skip?.name}
                  </p>
                  <div className="text-xs text-muted-foreground mb-2 space-y-1">
                    <p>• Raw Item Name: <span className="font-mono bg-muted px-1 rounded">{skip?.raw_item_name !== null && skip?.raw_item_name !== undefined ? `"${skip?.raw_item_name}"` : '(null/undefined)'}</span></p>
                    <p>• Raw Quantity: <span className="font-mono bg-muted px-1 rounded">{skip?.raw_quantity !== null && skip?.raw_quantity !== undefined ? `"${skip?.raw_quantity}"` : '(null/undefined)'}</span></p>
                  </div>
                  <ul className="text-xs text-error space-y-1">
                    {skip?.reasons?.map((reason, i) => (
                      <li key={i}>• {reason}</li>
                    ))}
                  </ul>
                </div>
              ))}
              {dryRunResults?.rows_skipped?.length > 10 && (
                <p className="text-sm text-muted-foreground mt-3 text-center">
                  Showing first 10 of {dryRunResults?.rows_skipped?.length} skipped rows
                </p>
              )}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-between items-center">
          <Button variant="outline" iconName="ArrowLeft" onClick={handleBackToMapping}>
            Back to Mapping
          </Button>
          <Button
            variant="default"
            iconName="Check"
            onClick={handleCommit}
            loading={isCommitting}
            disabled={dryRunResults?.processed_rows === 0}
          >
            {isCommitting ? 'Committing...' : 'Commit Import'}
          </Button>
        </div>
      </main>
    </div>
  );
};

export default DryRunPreview;
