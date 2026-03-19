import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { saveItem } from '../../inventory-management/utils/inventoryStorage';
import { getCurrentUser } from '../../../utils/authStorage';
import { logActivity, InventoryActions, resolveActorName } from '../../../utils/activityStorage';

const ImportProgressStep = ({ csvData, fieldMapping, validationResults, onImportComplete, onStartOver, onBackToInventory }) => {
  const navigate = useNavigate();
  const [progress, setProgress] = useState(0);
  const [isImporting, setIsImporting] = useState(false);
  const [importComplete, setImportComplete] = useState(false);
  const [successCount, setSuccessCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [importErrors, setImportErrors] = useState([]);

  // Category ID mapping
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

  // Valid categories
  const validCategories = [
    'Alcohol & Bar',
    'Pantry',
    'Cold Stores',
    'Guest Amenities',
    'Cleaning & Laundry',
    'Uniforms',
    'Spare Parts',
    'Safety & Compliance'
  ];

  // Reverse mapping
  const reverseMapping = {};
  Object.entries(fieldMapping)?.forEach(([csvHeader, cargoField]) => {
    reverseMapping[cargoField] = csvHeader;
  });

  // Start import automatically
  useEffect(() => {
    startImport();
  }, []);

  const startImport = async () => {
    setIsImporting(true);
    let successfulImports = 0;
    let failedImports = 0;
    let skippedImports = 0;
    const errors = [];

    // Filter out rows with errors
    const validRows = validationResults?.filter(result => !result?.hasErrors);

    for (let i = 0; i < validationResults?.length; i++) {
      const result = validationResults?.[i];
      
      // Skip rows with errors
      if (result?.hasErrors) {
        skippedImports++;
        errors?.push({
          row: result?.rowIndex,
          errors: result?.errors
        });
        continue;
      }

      try {
        // Map CSV data to Cargo item format
        const row = result?.row;
        const category = row?.[reverseMapping?.['category']] || 'Pantry';
        const normalizedCategory = validCategories?.find(
          c => c?.toLowerCase() === category?.toLowerCase()
        ) || 'Pantry';

        const itemData = {
          name: row?.[reverseMapping?.['name']] || '',
          category: normalizedCategory,
          categoryId: categoryIdMap?.[normalizedCategory?.toLowerCase()] || 'pantry',
          subcategory: row?.[reverseMapping?.['subcategory']] || '',
          unit: row?.[reverseMapping?.['unit']]?.toLowerCase() || 'each',
          primaryLocation: row?.[reverseMapping?.['primaryLocation']] || 'Other',
          quantity: parseFloat(row?.[reverseMapping?.['quantity']]) || 0,
          parLevel: parseFloat(row?.[reverseMapping?.['parLevel']]) || 0,
          reorderPoint: parseFloat(row?.[reverseMapping?.['reorderPoint']]) || 0,
          supplier: row?.[reverseMapping?.['supplier']] || '',
          purchasePrice: parseFloat(row?.[reverseMapping?.['purchasePrice']]) || 0,
          purchaseDate: row?.[reverseMapping?.['purchaseDate']] || '',
          condition: row?.[reverseMapping?.['condition']] || '',
          notes: row?.[reverseMapping?.['notes']] || '',
          additionalLocations: [],
          hasVariants: false,
          variants: []
        };

        // Save item
        const saved = saveItem(itemData);
        if (saved) {
          successfulImports++;
        } else {
          failedImports++;
          errors?.push({
            row: result?.rowIndex,
            errors: ['Failed to save item']
          });
        }
      } catch (error) {
        failedImports++;
        errors?.push({
          row: result?.rowIndex,
          errors: [error?.message || 'Unknown error']
        });
      }

      // Update progress
      setProgress(Math.round(((i + 1) / validationResults?.length) * 100));
      setSuccessCount(successfulImports);
      setErrorCount(failedImports);
      setSkippedCount(skippedImports);

      // Simulate batch processing delay
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    setImportErrors(errors);
    setIsImporting(false);
    setImportComplete(true);
    
    // Log IMPORT_COMPLETED activity event
    try {
      const currentUser = getCurrentUser();
      const actorDisplayName = resolveActorName(currentUser);
      logActivity({
        actorUserId: currentUser?.id,
        actorName: actorDisplayName,
        actorDepartment: currentUser?.department || 'UNKNOWN',
        actorRoleTier: currentUser?.tier || 'CREW',
        departmentScope: currentUser?.department || 'INTERIOR',
        module: 'inventory',
        action: InventoryActions?.IMPORT_COMPLETED,
        entityType: 'inventoryItem',
        entityId: `import-${Date.now()}`,
        summary: `${actorDisplayName} completed CSV import (${successfulImports} items)`,
        meta: {
          successCount: successfulImports,
          errorCount: failedImports,
          skippedCount: skippedImports,
          totalRows: validationResults?.length
        }
      });
      
      // Trigger dashboard activity refresh
      window.dispatchEvent(new CustomEvent('activityUpdated'));
    } catch (error) {
      console.error('Error logging IMPORT_COMPLETED activity:', error);
    }
    
    onImportComplete(errors);
  };

  return (
    <div className="p-8">
      <div className="mb-8 text-center">
        <h2 className="text-2xl font-semibold text-foreground mb-2">
          {isImporting ? 'Importing Items...' : 'Import Complete'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {isImporting
            ? 'Please wait while we process your inventory data'
            : 'Your CSV import has finished processing'}
        </p>
      </div>

      {/* Progress Circle */}
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
              strokeDashoffset={`${2 * Math.PI * 88 * (1 - progress / 100)}`}
              className="text-primary transition-all duration-300"
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {isImporting ? (
              <>
                <p className="text-4xl font-bold text-foreground">{progress}%</p>
                <p className="text-sm text-muted-foreground">Processing</p>
              </>
            ) : (
              <>
                <Icon name="CheckCircle2" size={48} className="text-success mb-2" />
                <p className="text-sm font-medium text-foreground">Done</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Import Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-success/10 border border-success rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center">
              <Icon name="CheckCircle2" size={24} className="text-success" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{successCount}</p>
              <p className="text-sm text-muted-foreground">Imported</p>
            </div>
          </div>
        </div>

        <div className="bg-error/10 border border-error rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-error/20 flex items-center justify-center">
              <Icon name="XCircle" size={24} className="text-error" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{errorCount}</p>
              <p className="text-sm text-muted-foreground">Failed</p>
            </div>
          </div>
        </div>

        <div className="bg-warning/10 border border-warning rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-warning/20 flex items-center justify-center">
              <Icon name="AlertTriangle" size={24} className="text-warning" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{skippedCount}</p>
              <p className="text-sm text-muted-foreground">Skipped</p>
            </div>
          </div>
        </div>
      </div>

      {/* Error Details */}
      {importErrors?.length > 0 && (
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-foreground mb-4">Import Errors</h3>
          <div className="bg-error/10 border border-error rounded-xl p-4 max-h-60 overflow-y-auto">
            <div className="space-y-2">
              {importErrors?.map((error, index) => (
                <div key={index} className="text-sm">
                  <p className="font-medium text-foreground">Row {error?.row}:</p>
                  <ul className="ml-4 space-y-1">
                    {error?.errors?.map((err, i) => (
                      <li key={i} className="text-error flex items-start gap-1">
                        <Icon name="Circle" size={8} className="mt-1" />
                        {err}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      {importComplete && (
        <div className="flex items-center justify-center gap-4 pt-6 border-t border-border">
          <Button
            variant="outline"
            iconName="RotateCcw"
            onClick={onStartOver}
          >
            Import Another File
          </Button>
          <Button
            variant="default"
            iconName="Package"
            onClick={onBackToInventory}
          >
            View Inventory
          </Button>
        </div>
      )}
    </div>
  );
};

export default ImportProgressStep;