import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import Header from '../../components/navigation/Header';
import { saveBatch, saveRows } from '../csv-import-interface/utils/importStorage';

const CSVUploadStaging = () => {
  const navigate = useNavigate();
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState(null);
  const [error, setError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadedBatch, setUploadedBatch] = useState(null);
  const [sampleRows, setSampleRows] = useState([]);
  const fileInputRef = useRef(null);
  
  // Excel sheet selection state
  const [excelWorkbook, setExcelWorkbook] = useState(null);
  const [availableSheets, setAvailableSheets] = useState([]);
  const [selectedSheets, setSelectedSheets] = useState([]);
  const [showSheetSelection, setShowSheetSelection] = useState(false);
  const [activePreviewSheet, setActivePreviewSheet] = useState(null);
  const [sheetPreviews, setSheetPreviews] = useState({});

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

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
    setUploadedBatch(null);
    setSampleRows([]);

    // Validate file type
    const isCSV = file?.name?.endsWith('.csv');
    const isXLSX = file?.name?.endsWith('.xlsx') || file?.name?.endsWith('.xls');
    
    if (!isCSV && !isXLSX) {
      setError('Please upload a CSV or XLSX file');
      setIsProcessing(false);
      return;
    }

    // Validate file size
    if (file?.size > MAX_FILE_SIZE) {
      setError('File size exceeds 10MB limit');
      setIsProcessing(false);
      return;
    }

    setFileName(file?.name);

    if (isCSV) {
      parseCSVFile(file);
    } else {
      parseXLSXFile(file);
    }
  };

  const parseCSVFile = (file) => {
    Papa?.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results?.errors?.length > 0) {
          setError('Failed to parse CSV file. Please check the format.');
          setIsProcessing(false);
          return;
        }

        if (!results?.data || results?.data?.length === 0) {
          setError('CSV file is empty or contains no valid data');
          setIsProcessing(false);
          return;
        }

        const headers = results?.meta?.fields || [];
        const rows = results?.data;

        createBatchAndRows(file?.name, 'csv', headers, rows);
      },
      error: (error) => {
        setError('Failed to parse CSV file: ' + error?.message);
        setIsProcessing(false);
      }
    });
  };

  const parseXLSXFile = (file) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e?.target?.result);
        const workbook = XLSX?.read(data, { type: 'array' });
        
        if (!workbook?.SheetNames || workbook?.SheetNames?.length === 0) {
          setError('XLSX file contains no sheets');
          setIsProcessing(false);
          return;
        }

        // Store workbook and show sheet selection UI
        setExcelWorkbook(workbook);
        setAvailableSheets(workbook?.SheetNames);
        setSelectedSheets([workbook?.SheetNames?.[0]]); // Default to first sheet
        setShowSheetSelection(true);
        setIsProcessing(false);
      } catch (error) {
        setError('Failed to parse XLSX file: ' + error?.message);
        setIsProcessing(false);
      }
    };

    reader.onerror = () => {
      setError('Failed to read XLSX file');
      setIsProcessing(false);
    };

    reader?.readAsArrayBuffer(file);
  };

  const handleSheetToggle = (sheetName) => {
    setSelectedSheets(prev => {
      if (prev?.includes(sheetName)) {
        // Deselect - but keep at least one selected
        if (prev?.length === 1) return prev;
        return prev?.filter(s => s !== sheetName);
      } else {
        // Select
        return [...prev, sheetName];
      }
    });
  };

  const handleProcessSelectedSheets = () => {
    if (!excelWorkbook || selectedSheets?.length === 0) {
      setError('Please select at least one sheet');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // Parse all selected sheets
      const allRows = [];
      const previews = {};
      let combinedHeaders = [];

      selectedSheets?.forEach((sheetName, sheetIndex) => {
        const worksheet = excelWorkbook?.Sheets?.[sheetName];
        const jsonData = XLSX?.utils?.sheet_to_json(worksheet, { header: 1 });

        if (!jsonData || jsonData?.length < 1) return;

        // First row is headers
        const sheetHeaders = jsonData?.[0]?.map(h => String(h || '')?.trim());
        
        // For first sheet, use its headers as base
        if (sheetIndex === 0) {
          combinedHeaders = sheetHeaders;
        }

        // Remaining rows are data
        const sheetRows = jsonData?.slice(1)?.map(row => {
          const rowObj = {};
          sheetHeaders?.forEach((header, index) => {
            rowObj[header] = String(row?.[index] || '')?.trim();
          });
          // Add sheet source metadata
          rowObj['__sheet_source'] = sheetName;
          return rowObj;
        })?.filter(row => {
          // Filter out completely empty rows
          const values = Object.entries(row)
            ?.filter(([key]) => key !== '__sheet_source')
            ?.map(([, val]) => val);
          return values?.some(val => val !== '');
        });

        allRows?.push(...sheetRows);
        
        // Store preview for this sheet
        previews[sheetName] = {
          headers: sheetHeaders,
          rows: sheetRows?.slice(0, 10)
        };
      });

      if (allRows?.length === 0) {
        setError('Selected sheets contain no valid data');
        setIsProcessing(false);
        return;
      }

      // Store sheet previews for multi-sheet preview UI
      setSheetPreviews(previews);
      setActivePreviewSheet(selectedSheets?.[0]);

      createBatchAndRows(fileName, 'xlsx', combinedHeaders, allRows, selectedSheets);
    } catch (error) {
      setError('Failed to process selected sheets: ' + error?.message);
      setIsProcessing(false);
    }
  };

  const createBatchAndRows = (filename, fileType, headers, rows, selectedSheetNames = null) => {
    try {
      // Get current user (simplified - in real app would use auth context)
      const currentUser = JSON.parse(localStorage.getItem('cargo_current_user') || '{}');
      
      // Create ImportBatch
      const batchData = {
        filename: filename,
        file_type: fileType,
        uploaded_by: currentUser?.id || 'unknown',
        status: 'uploaded',
        headers: headers,
        sample_rows: rows?.slice(0, 10), // First 10 rows for preview
        mapping: {}, // Empty mapping initially
        stats: {
          row_count: rows?.length,
          skipped_count: 0,
          error_count: 0
        },
        // Store selected sheet names for Excel files
        selected_sheets: selectedSheetNames || null
      };

      const savedBatch = saveBatch(batchData);

      if (!savedBatch) {
        setError('Failed to save batch data');
        setIsProcessing(false);
        return;
      }

      // Create ImportRow entries
      const rowsData = rows?.map((row, index) => ({
        batch_id: savedBatch?.id,
        row_index: index,
        raw: row,
        errors: []
      }));

      saveRows(rowsData);

      setUploadedBatch(savedBatch);
      setSampleRows(savedBatch?.sample_rows || []);
      setShowSheetSelection(false);
      setIsProcessing(false);
    } catch (error) {
      setError('Failed to process file data: ' + error?.message);
      setIsProcessing(false);
    }
  };

  const handleContinueToMapping = () => {
    if (uploadedBatch?.id) {
      navigate(`/column-mapping-configuration?batchId=${uploadedBatch?.id}`);
    }
  };

  const handleDownloadTemplate = () => {
    const template = `Item Name,Category,Subcategory,Unit,Primary Location,Quantity,Par Level,Reorder Point,Supplier,Purchase Price,Notes
Sample Item,Pantry,Dry Goods,each,Pantry,10,20,5,Sample Supplier,15.99,Sample notes
`;
    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cargo_inventory_template.csv';
    a?.click();
    URL.revokeObjectURL(url);
  };

  const handleBackToInventory = () => {
    navigate('/inventory');
  };

  const handleCancelSheetSelection = () => {
    setShowSheetSelection(false);
    setExcelWorkbook(null);
    setAvailableSheets([]);
    setSelectedSheets([]);
    setFileName(null);
    setSheetPreviews({});
    setActivePreviewSheet(null);
  };

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[1400px] mx-auto pt-24">
        {/* Page Header */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={handleBackToInventory}
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
          >
            <Icon name="ArrowLeft" size={24} className="text-foreground" />
          </button>
          <div className="flex-1">
            <h1 className="text-4xl font-semibold text-foreground mb-2 font-heading">CSV Upload & Staging</h1>
            <p className="text-base text-muted-foreground">Upload your CSV or XLSX file to begin the import process</p>
          </div>
        </div>

        {/* Excel Sheet Selection UI */}
        {showSheetSelection && (
          <div className="bg-card border border-border rounded-2xl shadow-sm p-8 mb-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Icon name="FileSpreadsheet" size={24} className="text-primary" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-foreground">Select Excel Sheets</h3>
                <p className="text-sm text-muted-foreground">Choose one or more sheets to import from {fileName}</p>
              </div>
            </div>

            {/* Sheet Selection List */}
            <div className="space-y-3 mb-6">
              {availableSheets?.map((sheetName, index) => {
                const isSelected = selectedSheets?.includes(sheetName);
                return (
                  <button
                    key={index}
                    onClick={() => handleSheetToggle(sheetName)}
                    className={`w-full flex items-center gap-3 p-4 rounded-xl border-2 transition-smooth text-left ${
                      isSelected
                        ? 'border-primary bg-primary/5' :'border-border hover:border-primary/30 hover:bg-muted/30'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-smooth ${
                      isSelected ? 'border-primary bg-primary' : 'border-border'
                    }`}>
                      {isSelected && <Icon name="Check" size={14} className="text-white" />}
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold text-foreground">{sheetName}</div>
                      {index === 0 && (
                        <div className="text-xs text-muted-foreground mt-1">Default sheet</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Selection Summary */}
            <div className="bg-muted/30 rounded-xl p-4 mb-6">
              <div className="flex items-center gap-2 text-sm">
                <Icon name="Info" size={16} className="text-primary" />
                <span className="text-muted-foreground">
                  {selectedSheets?.length} {selectedSheets?.length === 1 ? 'sheet' : 'sheets'} selected
                  {selectedSheets?.length > 1 && ' - rows from all sheets will be combined into one import batch'}
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 justify-end">
              <Button
                variant="outline"
                onClick={handleCancelSheetSelection}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                iconName="ArrowRight"
                iconPosition="right"
                onClick={handleProcessSelectedSheets}
                disabled={selectedSheets?.length === 0 || isProcessing}
                loading={isProcessing}
              >
                {isProcessing ? 'Processing...' : 'Process Selected Sheets'}
              </Button>
            </div>
          </div>
        )}

        {/* Upload Zone - Hide when showing sheet selection */}
        {!showSheetSelection && (
          <div className="bg-card border border-border rounded-2xl shadow-sm p-8 mb-6">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-2xl p-12 text-center transition-smooth ${
                isDragging
                  ? 'border-primary bg-primary/5' :'border-border hover:border-primary/50 hover:bg-muted/30'
              }`}
            >
              <div className="flex flex-col items-center gap-4">
                <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
                  <Icon name="Upload" size={40} className="text-primary" />
                </div>

                <div>
                  <h3 className="text-xl font-semibold text-foreground mb-2">
                    {fileName && !uploadedBatch ? fileName : 'Drop your CSV or XLSX file here'}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    or click to browse files
                  </p>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileSelect}
                  className="hidden"
                />

                <Button
                  variant="default"
                  iconName="FileUp"
                  onClick={() => fileInputRef?.current?.click()}
                  disabled={isProcessing}
                  loading={isProcessing}
                >
                  {isProcessing ? 'Processing...' : 'Select File'}
                </Button>

                {error && (
                  <div className="flex items-center gap-2 text-error mt-4">
                    <Icon name="AlertCircle" size={16} />
                    <span className="text-sm">{error}</span>
                  </div>
                )}
              </div>
            </div>

            {/* File Requirements */}
            <div className="mt-8 bg-muted/30 rounded-xl p-6">
              <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <Icon name="Info" size={16} />
                File Requirements
              </h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <Icon name="Check" size={16} className="text-success mt-0.5" />
                  <span>CSV (.csv) or Excel (.xlsx, .xls) format</span>
                </li>
                <li className="flex items-start gap-2">
                  <Icon name="Check" size={16} className="text-success mt-0.5" />
                  <span>Maximum file size: 10MB</span>
                </li>
                <li className="flex items-start gap-2">
                  <Icon name="Check" size={16} className="text-success mt-0.5" />
                  <span>First row must contain column headers</span>
                </li>
                <li className="flex items-start gap-2">
                  <Icon name="Check" size={16} className="text-success mt-0.5" />
                  <span>At least one data row required</span>
                </li>
                <li className="flex items-start gap-2">
                  <Icon name="Check" size={16} className="text-success mt-0.5" />
                  <span>For Excel files: Select one or multiple sheets to import</span>
                </li>
              </ul>
            </div>

            {/* Template Download */}
            <div className="mt-6 flex justify-center">
              <Button
                variant="outline"
                iconName="Download"
                onClick={handleDownloadTemplate}
              >
                Download CSV Template
              </Button>
            </div>
          </div>
        )}

        {/* Upload Summary (shown after successful upload) */}
        {uploadedBatch && (
          <div className="bg-card border border-border rounded-2xl shadow-sm p-8 mb-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center">
                <Icon name="CheckCircle" size={24} className="text-success" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-foreground">File Uploaded Successfully</h3>
                <p className="text-sm text-muted-foreground">
                  {uploadedBatch?.file_type === 'xlsx' && uploadedBatch?.selected_sheets
                    ? `Imported ${uploadedBatch?.selected_sheets?.length} sheet(s) from ${uploadedBatch?.filename}`
                    : 'Your file has been parsed and staged for mapping'
                  }
                </p>
              </div>
            </div>

            {/* Batch Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-muted/30 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon name="FileText" size={20} className="text-primary" />
                  <span className="text-sm font-medium text-muted-foreground">Filename</span>
                </div>
                <p className="text-lg font-semibold text-foreground">{uploadedBatch?.filename}</p>
              </div>
              <div className="bg-muted/30 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon name="List" size={20} className="text-primary" />
                  <span className="text-sm font-medium text-muted-foreground">Total Rows</span>
                </div>
                <p className="text-lg font-semibold text-foreground">{uploadedBatch?.stats?.row_count}</p>
              </div>
              <div className="bg-muted/30 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon name="Columns" size={20} className="text-primary" />
                  <span className="text-sm font-medium text-muted-foreground">Columns Detected</span>
                </div>
                <p className="text-lg font-semibold text-foreground">{uploadedBatch?.headers?.length}</p>
              </div>
            </div>

            {/* Sheet Tabs for Multi-Sheet Excel Imports */}
            {uploadedBatch?.file_type === 'xlsx' && uploadedBatch?.selected_sheets && uploadedBatch?.selected_sheets?.length > 1 && (
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <Icon name="FileSpreadsheet" size={16} className="text-primary" />
                  <span className="text-sm font-semibold text-foreground">Preview by Sheet</span>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {uploadedBatch?.selected_sheets?.map((sheetName, index) => (
                    <button
                      key={index}
                      onClick={() => setActivePreviewSheet(sheetName)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-smooth whitespace-nowrap ${
                        activePreviewSheet === sheetName
                          ? 'bg-primary text-white' :'bg-muted/30 text-muted-foreground hover:bg-muted/50'
                      }`}
                    >
                      {sheetName}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Sample Data Preview */}
            <div className="mb-6">
              <h4 className="text-sm font-semibold text-foreground mb-3">
                Sample Data (First 10 Rows)
                {activePreviewSheet && uploadedBatch?.selected_sheets?.length > 1 && (
                  <span className="text-muted-foreground font-normal ml-2">- {activePreviewSheet}</span>
                )}
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {uploadedBatch?.headers?.map((header, index) => (
                        <th key={index} className="text-left p-2 font-semibold text-foreground bg-muted/30">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // Filter rows by active sheet if multi-sheet Excel
                      const displayRows = activePreviewSheet && sheetPreviews?.[activePreviewSheet]
                        ? sheetPreviews?.[activePreviewSheet]?.rows
                        : sampleRows;
                      
                      return displayRows?.map((row, rowIndex) => (
                        <tr key={rowIndex} className="border-b border-border hover:bg-muted/20">
                          {uploadedBatch?.headers?.map((header, colIndex) => (
                            <td key={colIndex} className="p-2 text-muted-foreground">
                              {row?.[header] || '-'}
                            </td>
                          ))}
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Continue Button */}
            <div className="flex justify-end">
              <Button
                variant="default"
                iconName="ArrowRight"
                iconPosition="right"
                onClick={handleContinueToMapping}
              >
                Continue to Mapping
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default CSVUploadStaging;
