import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Select from '../../../components/ui/Select';

const FieldMappingStep = ({ csvHeaders, csvData, onMappingComplete, onBack }) => {
  const [mapping, setMapping] = useState({});
  const [unmappedFields, setUnmappedFields] = useState([]);
  const [duplicateErrors, setDuplicateErrors] = useState({});

  // Cargo inventory fields
  const cargoFields = [
    { value: 'name', label: 'Item Name', required: true, singleUse: true },
    { value: 'category', label: 'Category', required: true, singleUse: true },
    { value: 'subcategory', label: 'Subcategory', required: false, singleUse: true },
    { value: 'unit', label: 'Unit of Measure', required: true, singleUse: true },
    { value: 'primaryLocation', label: 'Primary Location', required: true, singleUse: true },
    { value: 'quantity', label: 'Quantity', required: true, singleUse: true },
    { value: 'locationQuantity', label: 'Location Quantity Column', required: false, singleUse: false },
    { value: 'parLevel', label: 'Par Level', required: false, singleUse: true },
    { value: 'reorderPoint', label: 'Reorder Point', required: false, singleUse: true },
    { value: 'supplier', label: 'Supplier', required: false, singleUse: true },
    { value: 'purchasePrice', label: 'Purchase Price', required: false, singleUse: true },
    { value: 'purchaseDate', label: 'Purchase Date', required: false, singleUse: true },
    { value: 'condition', label: 'Condition', required: false, singleUse: true },
    { value: 'notes', label: 'Notes', required: false, singleUse: false }
  ];

  // Auto-detect field mapping
  useEffect(() => {
    const autoMapping = {};
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
      'comments': 'notes'
    };

    csvHeaders?.forEach(header => {
      const normalized = header?.toLowerCase()?.trim();
      if (commonMappings?.[normalized]) {
        autoMapping[header] = commonMappings?.[normalized];
      }
    });

    setMapping(autoMapping);
    validateMapping(autoMapping);
  }, [csvHeaders]);

  // Validate mapping for required fields and duplicates
  const validateMapping = (currentMapping) => {
    // Check for unmapped required fields
    const mappedCargoFields = Object.values(currentMapping)?.filter(v => v);
    const unmapped = cargoFields?.filter(
      field => field?.required && !mappedCargoFields?.includes(field?.value)
    );
    setUnmappedFields(unmapped);

    // Check for duplicate single-use fields
    const duplicates = {};
    const fieldUsage = {};

    Object.entries(currentMapping)?.forEach(([csvHeader, cargoFieldValue]) => {
      if (!cargoFieldValue) return;

      const cargoField = cargoFields?.find(f => f?.value === cargoFieldValue);
      if (!cargoField?.singleUse) return; // Allow multi-use fields

      if (fieldUsage?.[cargoFieldValue]) {
        // This field is already mapped to another column
        duplicates[csvHeader] = `"${cargoField?.label}" is already mapped to "${fieldUsage?.[cargoFieldValue]}"`;
      } else {
        fieldUsage[cargoFieldValue] = csvHeader;
      }
    });

    setDuplicateErrors(duplicates);
  };

  const handleMappingChange = (csvHeader, cargoField) => {
    // Create new mapping with updated value for this specific CSV column
    const newMapping = {
      ...mapping,
      [csvHeader]: cargoField
    };

    setMapping(newMapping);
    validateMapping(newMapping);
  };

  const handleContinue = () => {
    if (unmappedFields?.length > 0 || Object.keys(duplicateErrors)?.length > 0) {
      return; // Don't proceed if required fields are unmapped or duplicates exist
    }
    onMappingComplete(mapping);
  };

  const getCargoFieldLabel = (value) => {
    const field = cargoFields?.find(f => f?.value === value);
    return field ? field?.label : 'Not Mapped';
  };

  // Generate available options for a specific CSV column
  const getAvailableCargoFields = (currentCsvHeader) => {
    return cargoFields?.map(field => {
      // Check if this field is mapped to a DIFFERENT CSV column
      const isMappedToOtherColumn = Object.entries(mapping)?.some(
        ([csvHeader, cargoFieldValue]) => 
          csvHeader !== currentCsvHeader && 
          cargoFieldValue === field?.value &&
          field?.singleUse // Only disable if it's a single-use field
      );

      return {
        value: field?.value,
        label: field?.label + (field?.required ? ' *' : ''),
        disabled: isMappedToOtherColumn
      };
    });
  };

  return (
    <div className="p-8">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-foreground mb-2">Map CSV Columns to Cargo Fields</h2>
        <p className="text-sm text-muted-foreground">
          Match your CSV columns to Cargo inventory fields. Required fields are marked with *
        </p>
      </div>

      {/* Unmapped Required Fields Warning */}
      {unmappedFields?.length > 0 && (
        <div className="bg-warning/10 border border-warning rounded-xl p-4 mb-6">
          <div className="flex items-start gap-3">
            <Icon name="AlertTriangle" size={20} className="text-warning mt-0.5" />
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-1">
                Required Fields Not Mapped
              </h4>
              <p className="text-sm text-muted-foreground mb-2">
                The following required fields need to be mapped:
              </p>
              <ul className="text-sm text-muted-foreground space-y-1">
                {unmappedFields?.map(field => (
                  <li key={field?.value} className="flex items-center gap-2">
                    <Icon name="Circle" size={8} className="text-warning" />
                    {field?.label}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Mapping Table */}
      <div className="space-y-3 mb-8">
        {csvHeaders?.map((header, index) => {
          const hasDuplicateError = duplicateErrors?.[header];
          const currentValue = mapping?.[header] || '';
          
          return (
            <div key={header} className="space-y-2">
              <div
                className={`bg-muted/30 rounded-xl p-4 flex items-center gap-4 ${
                  hasDuplicateError ? 'border-2 border-destructive' : ''
                }`}
              >
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground mb-1">CSV Column</p>
                  <p className="text-base text-foreground font-semibold">{header}</p>
                  {csvData?.[0]?.[header] && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Example: {csvData?.[0]?.[header]}
                    </p>
                  )}
                </div>

                <Icon name="ArrowRight" size={24} className="text-muted-foreground" />

                <div className="flex-1">
                  <Select
                    key={`${header}-${currentValue}`}
                    value={currentValue}
                    onChange={(value) => handleMappingChange(header, value)}
                    options={[
                      { value: '', label: 'Not Mapped' },
                      ...getAvailableCargoFields(header)
                    ]}
                    placeholder="Select Cargo field"
                    searchable
                  />
                </div>
              </div>

              {/* Duplicate Error Message */}
              {hasDuplicateError && (
                <div className="flex items-start gap-2 px-4">
                  <Icon name="AlertCircle" size={16} className="text-destructive mt-0.5" />
                  <p className="text-sm text-destructive">
                    {hasDuplicateError}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Auto-Detection Info */}
      <div className="bg-success/10 border border-success rounded-xl p-4 mb-6">
        <div className="flex items-start gap-3">
          <Icon name="Sparkles" size={20} className="text-success mt-0.5" />
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-1">
              Auto-Detection Active
            </h4>
            <p className="text-sm text-muted-foreground">
              {Object.keys(mapping)?.length} fields were automatically mapped based on common naming patterns.
              You can override any mapping using the dropdowns above.
            </p>
          </div>
        </div>
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
          iconName="ArrowRight"
          iconPosition="right"
          onClick={handleContinue}
          disabled={unmappedFields?.length > 0 || Object.keys(duplicateErrors)?.length > 0}
        >
          Continue to Preview
        </Button>
      </div>
    </div>
  );
};

export default FieldMappingStep;