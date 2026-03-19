import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

const PreviewStep = ({ csvData, fieldMapping, onValidationComplete, onBack }) => {
  const [validationResults, setValidationResults] = useState([]);
  const [isValidating, setIsValidating] = useState(true);
  const [errorCount, setErrorCount] = useState(0);
  const [warningCount, setWarningCount] = useState(0);

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

  // Valid units
  const validUnits = ['each', 'bottle', 'case', 'pack', 'litre', 'kg', 'g', 'ml', 'set', 'roll', 'box', 'other'];

  // Valid locations
  const validLocations = [
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

  // Reverse mapping (CSV header -> Cargo field)
  const reverseMapping = {};
  Object.entries(fieldMapping)?.forEach(([csvHeader, cargoField]) => {
    reverseMapping[cargoField] = csvHeader;
  });

  // Validate data
  useEffect(() => {
    setIsValidating(true);
    const results = csvData?.map((row, index) => {
      const errors = [];
      const warnings = [];

      // Get mapped values
      const name = row?.[reverseMapping?.['name']] || '';
      const category = row?.[reverseMapping?.['category']] || '';
      const unit = row?.[reverseMapping?.['unit']] || '';
      const location = row?.[reverseMapping?.['primaryLocation']] || '';
      const quantity = row?.[reverseMapping?.['quantity']] || '';

      // Required field validation
      if (!name?.trim()) {
        errors?.push('Item name is required');
      }
      if (!category?.trim()) {
        errors?.push('Category is required');
      }
      if (!unit?.trim()) {
        errors?.push('Unit is required');
      }
      if (!location?.trim()) {
        errors?.push('Primary location is required');
      }
      if (!quantity?.trim()) {
        errors?.push('Quantity is required');
      }

      // Category validation
      if (category && !validCategories?.some(c => c?.toLowerCase() === category?.toLowerCase())) {
        warnings?.push(`Category "${category}" not recognized. Will use closest match or "Pantry" as default.`);
      }

      // Unit validation
      if (unit && !validUnits?.some(u => u?.toLowerCase() === unit?.toLowerCase())) {
        warnings?.push(`Unit "${unit}" not recognized. Will use "each" as default.`);
      }

      // Location validation
      if (location && !validLocations?.some(l => l?.toLowerCase() === location?.toLowerCase())) {
        warnings?.push(`Location "${location}" not recognized. Will use "Other" as default.`);
      }

      // Quantity validation
      if (quantity && isNaN(parseFloat(quantity))) {
        errors?.push('Quantity must be a valid number');
      }

      // Check for duplicates (same name in same category)
      const duplicates = csvData?.filter((r, i) => 
        i !== index && 
        r?.[reverseMapping?.['name']]?.toLowerCase() === name?.toLowerCase() &&
        r?.[reverseMapping?.['category']]?.toLowerCase() === category?.toLowerCase()
      );
      if (duplicates?.length > 0) {
        warnings?.push('Duplicate item detected in CSV');
      }

      return {
        rowIndex: row?._rowIndex,
        row,
        errors,
        warnings,
        hasErrors: errors?.length > 0,
        hasWarnings: warnings?.length > 0
      };
    });

    setValidationResults(results);
    setErrorCount(results?.filter(r => r?.hasErrors)?.length);
    setWarningCount(results?.filter(r => r?.hasWarnings)?.length);
    setIsValidating(false);
  }, [csvData, fieldMapping]);

  const handleContinue = () => {
    onValidationComplete(validationResults);
  };

  const previewData = validationResults?.slice(0, 10);

  const getRowClassName = (result) => {
    if (result?.hasErrors) return 'bg-error/10 border-error';
    if (result?.hasWarnings) return 'bg-warning/10 border-warning';
    return 'bg-muted/30 border-transparent';
  };

  return (
    <div className="p-8">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-foreground mb-2">Preview & Validate Data</h2>
        <p className="text-sm text-muted-foreground">
          Review the first 10 rows and validation results before importing
        </p>
      </div>

      {/* Validation Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Icon name="FileText" size={24} className="text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{csvData?.length}</p>
              <p className="text-sm text-muted-foreground">Total Rows</p>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-error/10 flex items-center justify-center">
              <Icon name="XCircle" size={24} className="text-error" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{errorCount}</p>
              <p className="text-sm text-muted-foreground">Errors</p>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-warning/10 flex items-center justify-center">
              <Icon name="AlertTriangle" size={24} className="text-warning" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{warningCount}</p>
              <p className="text-sm text-muted-foreground">Warnings</p>
            </div>
          </div>
        </div>
      </div>

      {/* Error/Warning Alert */}
      {errorCount > 0 && (
        <div className="bg-error/10 border border-error rounded-xl p-4 mb-6">
          <div className="flex items-start gap-3">
            <Icon name="XCircle" size={20} className="text-error mt-0.5" />
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-1">
                {errorCount} row{errorCount !== 1 ? 's' : ''} with errors
              </h4>
              <p className="text-sm text-muted-foreground">
                Rows with errors will be skipped during import. Please fix errors in your CSV and re-upload.
              </p>
            </div>
          </div>
        </div>
      )}

      {warningCount > 0 && errorCount === 0 && (
        <div className="bg-warning/10 border border-warning rounded-xl p-4 mb-6">
          <div className="flex items-start gap-3">
            <Icon name="AlertTriangle" size={20} className="text-warning mt-0.5" />
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-1">
                {warningCount} row{warningCount !== 1 ? 's' : ''} with warnings
              </h4>
              <p className="text-sm text-muted-foreground">
                Warnings indicate potential issues but won't prevent import. Default values will be used where needed.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Preview Table */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">Data Preview (First 10 Rows)</h3>
        <div className="space-y-3 max-h-[500px] overflow-y-auto">
          {previewData?.map((result, index) => (
            <div
              key={index}
              className={`border rounded-xl p-4 transition-smooth ${getRowClassName(result)}`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-muted-foreground">
                    Row {result?.rowIndex}
                  </span>
                  {result?.hasErrors && (
                    <span className="flex items-center gap-1 text-xs text-error">
                      <Icon name="XCircle" size={14} />
                      Error
                    </span>
                  )}
                  {result?.hasWarnings && !result?.hasErrors && (
                    <span className="flex items-center gap-1 text-xs text-warning">
                      <Icon name="AlertTriangle" size={14} />
                      Warning
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Item Name</p>
                  <p className="text-sm font-medium text-foreground">
                    {result?.row?.[reverseMapping?.['name']] || '-'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Category</p>
                  <p className="text-sm font-medium text-foreground">
                    {result?.row?.[reverseMapping?.['category']] || '-'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Quantity</p>
                  <p className="text-sm font-medium text-foreground">
                    {result?.row?.[reverseMapping?.['quantity']] || '-'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Location</p>
                  <p className="text-sm font-medium text-foreground">
                    {result?.row?.[reverseMapping?.['primaryLocation']] || '-'}
                  </p>
                </div>
              </div>

              {(result?.errors?.length > 0 || result?.warnings?.length > 0) && (
                <div className="space-y-1">
                  {result?.errors?.map((error, i) => (
                    <p key={i} className="text-xs text-error flex items-start gap-1">
                      <Icon name="Circle" size={8} className="mt-1" />
                      {error}
                    </p>
                  ))}
                  {result?.warnings?.map((warning, i) => (
                    <p key={i} className="text-xs text-warning flex items-start gap-1">
                      <Icon name="Circle" size={8} className="mt-1" />
                      {warning}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        {csvData?.length > 10 && (
          <p className="text-sm text-muted-foreground mt-4 text-center">
            Showing 10 of {csvData?.length} rows
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-6 border-t border-border">
        <Button
          variant="outline"
          iconName="ArrowLeft"
          onClick={onBack}
        >
          Back
        </Button>
        <Button
          variant="default"
          iconName="Download"
          onClick={handleContinue}
        >
          Start Import
        </Button>
      </div>
    </div>
  );
};

export default PreviewStep;