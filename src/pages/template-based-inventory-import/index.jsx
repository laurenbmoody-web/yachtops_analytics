import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import Header from '../../components/navigation/Header';

const TemplateBasedInventoryImport = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState(null);
  const [error, setError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [validationStatus, setValidationStatus] = useState(null);

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  // Template column headers (case-insensitive)
  const TEMPLATE_HEADERS = [
    'item name',
    'category',
    'subcategory',
    'brand',
    'location',
    'quantity',
    'unit',
    'condition',
    'par level',
    'reorder point',
    'notes',
    'photo',
    'image url'
  ];

  const handleDragOver = (e) => {
    e?.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e?.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e?.preventDefault();
    setIsDragging(false);
    const file = e?.dataTransfer?.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleFileSelect = (e) => {
    const file = e?.target?.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const processFile = (file) => {
    setError(null);
    setIsProcessing(true);
    setValidationStatus(null);
    setPreviewData(null);

    const isXLSX = file?.name?.endsWith('.xlsx') || file?.name?.endsWith('.xls');
    const isCSV = file?.name?.endsWith('.csv');
    
    if (!isXLSX && !isCSV) {
      setError('Please upload an Excel (.xlsx) or CSV file');
      setIsProcessing(false);
      return;
    }

    if (file?.size > MAX_FILE_SIZE) {
      setError('File size exceeds 10MB limit');
      setIsProcessing(false);
      return;
    }

    setFileName(file?.name);
    setUploadedFile(file);

    if (isXLSX) {
      parseXLSXFile(file);
    } else {
      parseCSVFile(file);
    }
  };

  const parseXLSXFile = (file) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e?.target?.result);
        const workbook = XLSX?.read(data, { type: 'array' });

        if (!workbook?.SheetNames || workbook?.SheetNames?.length === 0) {
          setError('Excel file contains no sheets');
          setIsProcessing(false);
          return;
        }

        // Look for "Inventory" sheet (case-insensitive)
        const inventorySheet = workbook?.SheetNames?.find(
          name => name?.toLowerCase() === 'inventory'
        );

        if (!inventorySheet) {
          setError('Please use the Cargo Inventory Template (sheet must be named "Inventory")');
          setIsProcessing(false);
          return;
        }

        const worksheet = workbook?.Sheets?.[inventorySheet];
        const jsonData = XLSX?.utils?.sheet_to_json(worksheet, { header: 1, defval: '' });

        if (!jsonData || jsonData?.length < 2) {
          setError('Inventory sheet is empty or contains no data rows');
          setIsProcessing(false);
          return;
        }

        validateAndPreview(jsonData);
      } catch (error) {
        setError('Failed to parse Excel file: ' + error?.message);
        setIsProcessing(false);
      }
    };

    reader.onerror = () => {
      setError('Failed to read Excel file');
      setIsProcessing(false);
    };

    reader?.readAsArrayBuffer(file);
  };

  const parseCSVFile = (file) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const text = e?.target?.result;
        const lines = text?.split('\n')?.filter(line => line?.trim());
        
        if (lines?.length < 2) {
          setError('CSV file is empty or contains no data rows');
          setIsProcessing(false);
          return;
        }

        // Parse CSV manually
        const jsonData = lines?.map(line => {
          // Simple CSV parsing (handles basic cases)
          const values = [];
          let current = '';
          let inQuotes = false;
          
          for (let i = 0; i < line?.length; i++) {
            const char = line?.[i];
            if (char === '"') {
              inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
              values?.push(current?.trim());
              current = '';
            } else {
              current += char;
            }
          }
          values?.push(current?.trim());
          return values;
        });

        validateAndPreview(jsonData);
      } catch (error) {
        setError('Failed to parse CSV file: ' + error?.message);
        setIsProcessing(false);
      }
    };

    reader.onerror = () => {
      setError('Failed to read CSV file');
      setIsProcessing(false);
    };

    reader?.readAsText(file);
  };

  const validateAndPreview = (jsonData) => {
    const headers = jsonData?.[0] || [];
    const dataRows = jsonData?.slice(1);

    // Normalize headers for comparison
    const normalizedHeaders = headers?.map(h => 
      String(h || '')?.toLowerCase()?.trim()
    );

    // Find Item Name column (REQUIRED)
    const itemNameIndex = normalizedHeaders?.findIndex(h => 
      h === 'item name' || h === 'item' || h === 'name' || h === 'product name'
    );

    if (itemNameIndex === -1) {
      setError('Template validation failed: "Item Name" column is required but not found');
      setIsProcessing(false);
      return;
    }

    // Map recognized columns
    const columnMapping = {};
    normalizedHeaders?.forEach((header, index) => {
      if (TEMPLATE_HEADERS?.includes(header) || header === 'item' || header === 'name' || header === 'product name') {
        columnMapping[index] = header;
      }
    });

    // Count valid rows (only need Item Name)
    let validRows = 0;
    let blankItemNameRows = 0;

    dataRows?.forEach(row => {
      const itemName = String(row?.[itemNameIndex] || '')?.trim();
      if (itemName) {
        validRows++;
      } else {
        blankItemNameRows++;
      }
    });

    setValidationStatus({
      success: true,
      itemNameColumn: headers?.[itemNameIndex],
      recognizedColumns: Object.keys(columnMapping)?.length,
      totalColumns: headers?.length,
      validRows,
      blankItemNameRows,
      totalRows: dataRows?.length
    });

    setPreviewData({
      headers,
      rows: dataRows?.slice(0, 20), // Preview first 20 rows
      columnMapping,
      itemNameIndex,
      allRows: dataRows
    });

    setIsProcessing(false);
  };

  const handleProcessImport = () => {
    if (!previewData) return;

    // Store import data in sessionStorage for review page
    const importData = {
      fileName,
      headers: previewData?.headers,
      rows: previewData?.allRows,
      columnMapping: previewData?.columnMapping,
      itemNameIndex: previewData?.itemNameIndex,
      timestamp: new Date()?.toISOString()
    };

    sessionStorage.setItem('cargo_template_import_data', JSON.stringify(importData));
    navigate('/import-status-review');
  };

  const handleDownloadTemplate = () => {
    // Create template workbook
    const templateHeaders = [
      'Item Name',
      'Category',
      'Subcategory',
      'Brand',
      'Location',
      'Quantity',
      'Unit',
      'Condition',
      'Par Level',
      'Reorder Point',
      'Notes',
      'Photo'
    ];

    const sampleData = [
      ['Coffee Beans - Arabica', 'Galley', 'Beverages', 'Premium Roast', 'Pantry', '5', 'kg', 'New', '10', '3', 'Organic fair trade', ''],
      ['Olive Oil - Extra Virgin', 'Galley', 'Cooking', 'Mediterranean', 'Pantry', '2', 'litre', 'New', '5', '1', '750ml bottles', ''],
      ['Towels - Bath', 'Housekeeping', 'Linens', 'Luxury', 'Laundry', '24', 'each', 'Good', '30', '10', 'White cotton', '']
    ];

    const ws = XLSX?.utils?.aoa_to_sheet([templateHeaders, ...sampleData]);
    const wb = XLSX?.utils?.book_new();
    XLSX?.utils?.book_append_sheet(wb, ws, 'Inventory');
    XLSX?.writeFile(wb, 'Cargo_Inventory_Template.xlsx');
  };

  const handleReset = () => {
    setFileName(null);
    setUploadedFile(null);
    setPreviewData(null);
    setValidationStatus(null);
    setError(null);
    if (fileInputRef?.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <div className="container mx-auto px-6 py-8 max-w-7xl">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => navigate('/inventory')}
              className="p-2 hover:bg-muted rounded-lg transition-colors"
            >
              <Icon name="ArrowLeft" size={20} className="text-muted-foreground" />
            </button>
            <div className="flex-1">
              <h1 className="text-4xl font-semibold text-foreground mb-2 font-heading">
                Template-Based Inventory Import
              </h1>
              <p className="text-base text-muted-foreground">
                Upload your Cargo Inventory Template for streamlined import
              </p>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Upload Zone */}
          <div className="lg:col-span-2">
            <div className="bg-card rounded-2xl border border-border shadow-sm p-8">
              {!previewData ? (
                <>
                  {/* Upload Area */}
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`border-2 border-dashed rounded-xl p-12 text-center transition-all ${
                      isDragging
                        ? 'border-primary bg-primary/5' :'border-border hover:border-primary/50 hover:bg-muted/30'
                    }`}
                  >
                    <div className="flex flex-col items-center gap-4">
                      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                        <Icon name="Upload" size={32} className="text-primary" />
                      </div>
                      
                      <div>
                        <h3 className="text-xl font-semibold text-foreground mb-2">
                          {fileName || 'Drop your Inventory Template here'}
                        </h3>
                        <p className="text-sm text-muted-foreground mb-4">
                          or click to browse files
                        </p>
                      </div>

                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                      
                      <Button
                        onClick={() => fileInputRef?.current?.click()}
                        variant="primary"
                        disabled={isProcessing}
                      >
                        {isProcessing ? (
                          <>
                            <Icon name="Loader2" size={16} className="animate-spin" />
                            Processing...
                          </>
                        ) : (
                          <>
                            <Icon name="FileUp" size={16} />
                            Select File
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Error Display */}
                  {error && (
                    <div className="mt-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-3">
                      <Icon name="AlertCircle" size={20} className="text-destructive mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-destructive">{error}</p>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* Preview & Validation */}
                  <div className="space-y-6">
                    {/* File Info */}
                    <div className="flex items-center justify-between pb-4 border-b border-border">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center">
                          <Icon name="FileCheck" size={20} className="text-success" />
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold text-foreground">{fileName}</h3>
                          <p className="text-sm text-muted-foreground">Template validated successfully</p>
                        </div>
                      </div>
                      <Button onClick={handleReset} variant="ghost" size="sm">
                        <Icon name="X" size={16} />
                        Clear
                      </Button>
                    </div>

                    {/* Validation Status */}
                    {validationStatus && (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-muted/50 rounded-lg">
                          <div className="flex items-center gap-2 mb-1">
                            <Icon name="CheckCircle2" size={16} className="text-success" />
                            <span className="text-sm font-medium text-muted-foreground">Valid Rows</span>
                          </div>
                          <p className="text-2xl font-semibold text-foreground">
                            {validationStatus?.validRows}
                          </p>
                        </div>
                        <div className="p-4 bg-muted/50 rounded-lg">
                          <div className="flex items-center gap-2 mb-1">
                            <Icon name="Columns" size={16} className="text-primary" />
                            <span className="text-sm font-medium text-muted-foreground">Recognized Columns</span>
                          </div>
                          <p className="text-2xl font-semibold text-foreground">
                            {validationStatus?.recognizedColumns} / {validationStatus?.totalColumns}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Column Recognition */}
                    <div>
                      <h4 className="text-sm font-medium text-foreground mb-3">Recognized Template Columns</h4>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(previewData?.columnMapping || {})?.map(([index, header]) => (
                          <div
                            key={index}
                            className="px-3 py-1.5 bg-primary/10 text-primary rounded-full text-xs font-medium flex items-center gap-1.5"
                          >
                            <Icon name="Check" size={12} />
                            {previewData?.headers?.[index]}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Preview Table */}
                    <div>
                      <h4 className="text-sm font-medium text-foreground mb-3">
                        Data Preview (First {Math.min(20, previewData?.rows?.length)} rows)
                      </h4>
                      <div className="border border-border rounded-lg overflow-hidden">
                        <div className="overflow-x-auto max-h-96">
                          <table className="w-full text-sm">
                            <thead className="bg-muted/50 sticky top-0">
                              <tr>
                                {previewData?.headers?.map((header, index) => (
                                  <th
                                    key={index}
                                    className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap"
                                  >
                                    {header}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {previewData?.rows?.map((row, rowIndex) => {
                                const itemName = String(row?.[previewData?.itemNameIndex] || '')?.trim();
                                const isValid = itemName !== '';
                                
                                return (
                                  <tr
                                    key={rowIndex}
                                    className={!isValid ? 'bg-muted/30 opacity-50' : ''}
                                  >
                                    {row?.map((cell, cellIndex) => (
                                      <td
                                        key={cellIndex}
                                        className="px-4 py-3 whitespace-nowrap text-foreground"
                                      >
                                        {cell || '-'}
                                      </td>
                                    ))}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    {/* Warnings */}
                    {validationStatus?.blankItemNameRows > 0 && (
                      <div className="p-4 bg-warning/10 border border-warning/20 rounded-lg flex items-start gap-3">
                        <Icon name="AlertTriangle" size={20} className="text-warning mt-0.5" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-warning mb-1">
                            {validationStatus?.blankItemNameRows} row(s) will be skipped
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Rows with blank Item Name cannot be imported
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex items-center gap-3 pt-4 border-t border-border">
                      <Button
                        onClick={handleProcessImport}
                        variant="primary"
                        className="flex-1"
                      >
                        <Icon name="Upload" size={16} />
                        Process Import ({validationStatus?.validRows} items)
                      </Button>
                      <Button onClick={handleReset} variant="outline">
                        Cancel
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Sidebar - Instructions */}
          <div className="space-y-6">
            {/* Template Download */}
            <div className="bg-card rounded-2xl border border-border shadow-sm p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Icon name="Download" size={20} className="text-primary" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">Get Template</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Download the official Cargo Inventory Template with standardized headers and sample data.
              </p>
              <Button
                onClick={handleDownloadTemplate}
                variant="outline"
                className="w-full"
              >
                <Icon name="Download" size={16} />
                Download Template
              </Button>
            </div>

            {/* Requirements */}
            <div className="bg-card rounded-2xl border border-border shadow-sm p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center">
                  <Icon name="CheckCircle2" size={20} className="text-success" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">Requirements</h3>
              </div>
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <Icon name="Check" size={16} className="text-success mt-0.5" />
                  <span>File must contain a sheet named <strong>"Inventory"</strong></span>
                </li>
                <li className="flex items-start gap-2">
                  <Icon name="Check" size={16} className="text-success mt-0.5" />
                  <span>Only <strong>Item Name</strong> is required per row</span>
                </li>
                <li className="flex items-start gap-2">
                  <Icon name="Check" size={16} className="text-success mt-0.5" />
                  <span>All other fields are optional</span>
                </li>
                <li className="flex items-start gap-2">
                  <Icon name="Check" size={16} className="text-success mt-0.5" />
                  <span>Blank optional fields are handled gracefully</span>
                </li>
              </ul>
            </div>

            {/* Supported Columns */}
            <div className="bg-card rounded-2xl border border-border shadow-sm p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Icon name="List" size={20} className="text-primary" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">Supported Columns</h3>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Icon name="Star" size={14} className="text-warning" />
                  <span className="font-medium text-foreground">Item Name</span>
                  <span className="text-xs text-warning">(Required)</span>
                </div>
                {['Category', 'Subcategory', 'Brand', 'Location', 'Quantity', 'Unit', 'Condition', 'Par Level', 'Reorder Point', 'Notes', 'Photo']?.map(col => (
                  <div key={col} className="flex items-center gap-2 text-muted-foreground">
                    <Icon name="Minus" size={14} />
                    <span>{col}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TemplateBasedInventoryImport;