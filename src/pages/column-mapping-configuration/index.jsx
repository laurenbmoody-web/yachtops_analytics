import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import Select from '../../components/ui/Select';
import Header from '../../components/navigation/Header';
import { getBatchById, saveBatch } from '../csv-import-interface/utils/importStorage';



const ColumnMappingConfiguration = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const batchId = searchParams?.get('batchId');

  const [batch, setBatch] = useState(null);
  const [mapping, setMapping] = useState({});
  const [duplicateErrors, setDuplicateErrors] = useState({});
  const [unmappedRequired, setUnmappedRequired] = useState([]);
  const [missingRecommended, setMissingRecommended] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [focusedColumn, setFocusedColumn] = useState(null);

  // Cargo inventory fields with "— Ignore this column —" as first option
  const cargoFields = [
    { value: '', label: '— Ignore this column —', required: false, singleUse: false },
    { value: 'name', label: 'Item Name', required: true, singleUse: true },
    { value: 'category', label: 'Category', required: false, singleUse: true, recommended: true },
    { value: 'subcategory', label: 'Subcategory', required: false, singleUse: true },
    { value: 'unit', label: 'Unit of Measure', required: false, singleUse: true, recommended: true },
    { value: 'primaryLocation', label: 'Primary Location', required: false, singleUse: true },
    { value: 'quantity', label: 'Quantity', required: false, singleUse: true },
    { value: 'locationQuantity', label: 'Location Quantity Column', required: false, singleUse: false },
    { value: 'parLevel', label: 'Par Level', required: false, singleUse: true },
    { value: 'reorderPoint', label: 'Reorder Point', required: false, singleUse: true },
    { value: 'supplier', label: 'Supplier', required: false, singleUse: true },
    { value: 'purchasePrice', label: 'Purchase Price', required: false, singleUse: true },
    { value: 'purchaseDate', label: 'Purchase Date', required: false, singleUse: true },
    { value: 'condition', label: 'Condition', required: false, singleUse: true },
    { value: 'notes', label: 'Notes', required: false, singleUse: false },
    { value: 'imageUrl', label: 'Image URL', required: false, singleUse: false },
    { value: 'attachmentUrl', label: 'Attachment URL', required: false, singleUse: false }
  ];

  // Auto-detection mapping
  const commonMappings = {
    'item name': 'name',
    'name': 'name',
    'product': 'name',
    'item': 'name',
    'category': 'category',
    'subcategory': 'subcategory',
    'sub category': 'subcategory',
    'unit': 'unit',
    'unit of measure': 'unit',
    'uom': 'unit',
    'location': 'primaryLocation',
    'primary location': 'primaryLocation',
    'storage location': 'primaryLocation',
    'quantity': 'quantity',
    'qty': 'quantity',
    'amount': 'quantity',
    'par level': 'parLevel',
    'par': 'parLevel',
    'minimum': 'parLevel',
    'reorder point': 'reorderPoint',
    'reorder': 'reorderPoint',
    'min stock': 'reorderPoint',
    'supplier': 'supplier',
    'vendor': 'supplier',
    'price': 'purchasePrice',
    'purchase price': 'purchasePrice',
    'cost': 'purchasePrice',
    'purchase date': 'purchaseDate',
    'date': 'purchaseDate',
    'condition': 'condition',
    'status': 'condition',
    'notes': 'notes',
    'description': 'notes',
    'comments': 'notes',
    'image': 'imageUrl',
    'image url': 'imageUrl',
    'photo': 'imageUrl',
    'attachment': 'attachmentUrl',
    'attachment url': 'attachmentUrl',
    'file': 'attachmentUrl'
  };

  useEffect(() => {
    loadBatch();
  }, [batchId]);

  const loadBatch = () => {
    if (!batchId) {
      navigate('/csv-upload-staging');
      return;
    }

    const loadedBatch = getBatchById(batchId);
    if (!loadedBatch) {
      navigate('/csv-upload-staging');
      return;
    }

    setBatch(loadedBatch);

    // Auto-detect mapping if not already mapped, but default all to empty (ignore)
    if (!loadedBatch?.mapping || Object.keys(loadedBatch?.mapping)?.length === 0) {
      const autoMapping = {};
      // Initialize all columns to empty (ignore) by default
      loadedBatch?.headers?.forEach(header => {
        autoMapping[header] = '';
      });
      setMapping(autoMapping);
      validateMapping(autoMapping);
    } else {
      setMapping(loadedBatch?.mapping);
      validateMapping(loadedBatch?.mapping);
    }

    setIsLoading(false);
  };

  const validateMapping = (currentMapping) => {
    // NEW VALIDATION RULES:
    // Required: Item Name + at least one quantity source (Quantity OR Location Quantity Column)
    const mappedCargoFields = Object.values(currentMapping)?.filter(v => v);
    
    // Check if Item Name is mapped
    const hasItemName = mappedCargoFields?.includes('name');
    
    // Check if at least one quantity source is mapped
    const hasQuantity = mappedCargoFields?.includes('quantity');
    const hasLocationQuantity = mappedCargoFields?.includes('locationQuantity');
    const hasQuantitySource = hasQuantity || hasLocationQuantity;
    
    // Build unmapped required list (only hard requirements)
    const unmapped = [];
    if (!hasItemName) {
      unmapped?.push({ value: 'name', label: 'Item Name' });
    }
    if (!hasQuantitySource) {
      unmapped?.push({ value: 'quantity', label: 'Quantity or Location Quantity Column' });
    }
    setUnmappedRequired(unmapped);
    
    // Check for missing recommended fields (soft warnings)
    const recommended = [];
    if (!mappedCargoFields?.includes('category')) {
      recommended?.push('Category (items will import as "Uncategorised")');
    }
    if (!mappedCargoFields?.includes('unit')) {
      recommended?.push('Unit of Measure (will default to "each")');
    }
    setMissingRecommended(recommended);

    // Check for duplicate single-use fields
    const duplicates = {};
    const fieldUsage = {};

    Object.entries(currentMapping)?.forEach(([csvHeader, cargoFieldValue]) => {
      if (!cargoFieldValue) return; // Skip ignored columns

      const cargoField = cargoFields?.find(f => f?.value === cargoFieldValue);
      if (!cargoField?.singleUse) return;

      if (fieldUsage?.[cargoFieldValue]) {
        duplicates[csvHeader] = `"${cargoField?.label}" is already mapped to "${fieldUsage?.[cargoFieldValue]}"`;
      } else {
        fieldUsage[cargoFieldValue] = csvHeader;
      }
    });

    setDuplicateErrors(duplicates);
  };

  const handleMappingChange = (csvHeader, cargoFieldValue) => {
    const newMapping = {
      ...mapping,
      [csvHeader]: cargoFieldValue
    };

    setMapping(newMapping);
    validateMapping(newMapping);
  };

  const getAvailableCargoFields = (currentCsvHeader) => {
    return cargoFields?.map(field => {
      if (field?.value === '') return field; // "Not Mapped" always available

      const isMappedToOtherColumn = Object.entries(mapping)?.some(
        ([csvHeader, cargoFieldValue]) =>
          csvHeader !== currentCsvHeader &&
          cargoFieldValue === field?.value &&
          field?.singleUse
      );

      return {
        ...field,
        disabled: isMappedToOtherColumn
      };
    });
  };

  const handleSaveMapping = () => {
    if (unmappedRequired?.length > 0 || Object.keys(duplicateErrors)?.length > 0) {
      return;
    }

    setIsSaving(true);

    // Update batch with mapping
    const updatedBatch = {
      ...batch,
      mapping: mapping,
      status: 'mapped'
    };

    saveBatch(updatedBatch);

    // Navigate to dry-run preview
    setTimeout(() => {
      setIsSaving(false);
      navigate(`/column-mapping-configuration/preview?batchId=${batchId}`);
    }, 500);
  };

  const handleBack = () => {
    navigate('/csv-upload-staging');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background transition-colors duration-300">
        <Header />
        <main className="p-6 max-w-[1400px] mx-auto">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <Icon name="Loader" size={40} className="text-primary animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground">Loading batch data...</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const canContinue = unmappedRequired?.length === 0 && Object.keys(duplicateErrors)?.length === 0;

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[1600px] mx-auto">
        {/* Page Header */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={handleBack}
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
          >
            <Icon name="ArrowLeft" size={24} className="text-foreground" />
          </button>
          <div className="flex-1">
            <h1 className="text-4xl font-semibold text-foreground mb-2 font-heading">Map & Preview</h1>
            <p className="text-base text-muted-foreground">Map CSV columns to Cargo fields while viewing your data</p>
          </div>
        </div>

        {/* Batch Info */}
        <div className="bg-card border border-border rounded-2xl shadow-sm p-6 mb-6">
          <div className="flex items-center gap-4">
            <Icon name="FileText" size={24} className="text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">File</p>
              <p className="text-lg font-semibold text-foreground">{batch?.filename}</p>
            </div>
            <div className="ml-auto">
              <p className="text-sm text-muted-foreground">Rows</p>
              <p className="text-lg font-semibold text-foreground">{batch?.stats?.row_count}</p>
            </div>
          </div>
        </div>

        {/* Validation Alerts */}
        {unmappedRequired?.length > 0 && (
          <div className="bg-error/10 border border-error rounded-xl p-4 mb-6">
            <div className="flex items-start gap-3">
              <Icon name="XCircle" size={20} className="text-error mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">Missing Required Mappings</p>
                <p className="text-sm text-muted-foreground">
                  Please map: {unmappedRequired?.map(f => f?.label)?.join(', ')}
                </p>
              </div>
            </div>
          </div>
        )}
        
        {missingRecommended?.length > 0 && unmappedRequired?.length === 0 && (
          <div className="bg-warning/10 border border-warning rounded-xl p-4 mb-6">
            <div className="flex items-start gap-3">
              <Icon name="AlertTriangle" size={20} className="text-warning mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">Missing Recommended Mappings</p>
                <p className="text-sm text-muted-foreground">
                  {missingRecommended?.join(' • ')} — You can continue, defaults will be applied.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Combined Map & Preview Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Left Panel: Mapping Controls (40% on desktop) */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-card border border-border rounded-2xl shadow-sm p-6">
              <h3 className="text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
                <Icon name="Settings" size={20} className="text-primary" />
                Column Mapping
              </h3>

              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
                {batch?.headers?.map((header, index) => {
                  const currentValue = mapping?.[header] || '';
                  const hasError = duplicateErrors?.[header];
                  const availableOptions = getAvailableCargoFields(header);
                  const isFocused = focusedColumn === header;

                  return (
                    <div
                      key={`${header}-${index}`}
                      className={`border rounded-xl p-4 transition-all duration-200 ${
                        hasError ? 'border-error bg-error/5' : isFocused ?'border-primary bg-primary/5 shadow-md': 'border-border bg-muted/20'
                      }`}
                    >
                      {/* CSV Column Name */}
                      <div className="mb-3">
                        <p className="text-xs font-medium text-muted-foreground mb-1">CSV Column</p>
                        <div className="flex items-center gap-2">
                          <Icon name="Table" size={14} className="text-primary" />
                          <p className="text-sm font-semibold text-foreground">{header}</p>
                        </div>
                      </div>

                      {/* Cargo Field Dropdown */}
                      <div
                        onFocus={() => setFocusedColumn(header)}
                        onBlur={() => setFocusedColumn(null)}
                      >
                        <Select
                          key={`${header}-${currentValue}-${index}`}
                          label="Maps to"
                          value={currentValue}
                          options={availableOptions}
                          onChange={(value) => handleMappingChange(header, value)}
                          placeholder="Select field..."
                          error={hasError}
                        />
                      </div>

                      {/* Error Message */}
                      {hasError && (
                        <div className="mt-2 flex items-center gap-2 text-error">
                          <Icon name="AlertCircle" size={12} />
                          <span className="text-xs">{hasError}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="bg-card border border-border rounded-2xl shadow-sm p-6">
              <div className="flex flex-col gap-3">
                <Button
                  variant="default"
                  iconName="ArrowRight"
                  iconPosition="right"
                  onClick={handleSaveMapping}
                  disabled={!canContinue}
                  loading={isSaving}
                  className="w-full"
                >
                  {isSaving ? 'Saving...' : 'Continue to Preview'}
                </Button>
                <Button variant="outline" iconName="ArrowLeft" onClick={handleBack} className="w-full">
                  Back to Upload
                </Button>
              </div>
            </div>
          </div>

          {/* Right Panel: Preview Table (60% on desktop) */}
          <div className="lg:col-span-3">
            <div className="bg-card border border-border rounded-2xl shadow-sm p-6">
              <h3 className="text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
                <Icon name="Eye" size={20} className="text-primary" />
                Data Preview
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  (First {batch?.sample_rows?.length || 0} rows)
                </span>
              </h3>

              {/* Preview Table */}
              <div className="overflow-x-auto border border-border rounded-xl">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b border-border">
                    <tr>
                      {batch?.headers?.map((header, index) => {
                        const isFocused = focusedColumn === header;
                        return (
                          <th
                            key={`header-${index}`}
                            className={`px-4 py-3 text-left font-semibold text-foreground whitespace-nowrap transition-all duration-200 ${
                              isFocused ? 'bg-primary/20 text-primary' : ''
                            }`}
                          >
                            {header}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {batch?.sample_rows?.map((row, rowIndex) => (
                      <tr
                        key={`row-${rowIndex}`}
                        className="border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors"
                      >
                        {batch?.headers?.map((header, colIndex) => {
                          const isFocused = focusedColumn === header;
                          return (
                            <td
                              key={`cell-${rowIndex}-${colIndex}`}
                              className={`px-4 py-3 text-muted-foreground whitespace-nowrap transition-all duration-200 ${
                                isFocused ? 'bg-primary/10 font-medium text-foreground' : ''
                              }`}
                            >
                              {row?.[header] || '-'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Preview Info */}
              <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                <Icon name="Info" size={14} />
                <span>
                  Showing preview of {batch?.sample_rows?.length} rows. Total rows in file: {batch?.stats?.row_count}
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default ColumnMappingConfiguration;
