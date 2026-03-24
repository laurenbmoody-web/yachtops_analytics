import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import Header from '../../components/navigation/Header';
import SpreadsheetCanvas from './components/SpreadsheetCanvas';
import SelectionContextMenu from './components/SelectionContextMenu';
import ReviewConfirmModal from './components/ReviewConfirmModal';
import { processSelections } from './utils/selectionProcessor';

const DirectExcelSelectionInterface = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  
  const [fileName, setFileName] = useState(null);
  const [error, setError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Excel data
  const [excelWorkbook, setExcelWorkbook] = useState(null);
  const [availableSheets, setAvailableSheets] = useState([]);
  const [selectedSheet, setSelectedSheet] = useState(null);
  const [sheetData, setSheetData] = useState(null);
  const [headers, setHeaders] = useState([]);
  
  // Selection state
  const [selectedColumns, setSelectedColumns] = useState([]);
  const [selectedRows, setSelectedRows] = useState([]);
  const [columnMappings, setColumnMappings] = useState({});
  const [rowMappings, setRowMappings] = useState({});
  
  // Context menu
  const [contextMenu, setContextMenu] = useState(null);
  
  // Review modal
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [transformedData, setTransformedData] = useState(null);

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  const handleFileSelect = (e) => {
    const file = e?.target?.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const processFile = (file) => {
    setError(null);
    setIsProcessing(true);

    const isXLSX = file?.name?.endsWith('.xlsx') || file?.name?.endsWith('.xls');
    
    if (!isXLSX) {
      setError('Please upload an Excel (.xlsx) file');
      setIsProcessing(false);
      return;
    }

    if (file?.size > MAX_FILE_SIZE) {
      setError('File size exceeds 10MB limit');
      setIsProcessing(false);
      return;
    }

    setFileName(file?.name);
    parseXLSXFile(file);
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

        setExcelWorkbook(workbook);
        setAvailableSheets(workbook?.SheetNames);
        
        // Auto-select first sheet
        const firstSheet = workbook?.SheetNames?.[0];
        loadSheet(workbook, firstSheet);
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

  const loadSheet = (workbook, sheetName) => {
    try {
      const worksheet = workbook?.Sheets?.[sheetName];
      const jsonData = XLSX?.utils?.sheet_to_json(worksheet, { header: 1, defval: '' });
      
      if (jsonData?.length === 0) {
        setError('Selected sheet is empty');
        setIsProcessing(false);
        return;
      }

      const extractedHeaders = jsonData?.[0]?.map((h, idx) => h || `Column ${idx + 1}`);
      const dataRows = jsonData?.slice(1);

      setSelectedSheet(sheetName);
      setHeaders(extractedHeaders);
      setSheetData(dataRows);
      setIsProcessing(false);
      
      // Reset selections
      setSelectedColumns([]);
      setSelectedRows([]);
      setColumnMappings({});
      setRowMappings({});
    } catch (error) {
      setError('Failed to load sheet: ' + error?.message);
      setIsProcessing(false);
    }
  };

  const handleSheetChange = (sheetName) => {
    if (excelWorkbook) {
      loadSheet(excelWorkbook, sheetName);
    }
  };

  const handleColumnClick = (columnIndex, event) => {
    const rect = event?.currentTarget?.getBoundingClientRect();
    
    setContextMenu({
      type: 'column',
      index: columnIndex,
      x: rect?.left,
      y: rect?.bottom + 5,
      currentMapping: columnMappings?.[columnIndex]
    });
  };

  const handleRowClick = (rowIndex, event) => {
    const rect = event?.currentTarget?.getBoundingClientRect();
    
    setContextMenu({
      type: 'row',
      index: rowIndex,
      x: rect?.left,
      y: rect?.top,
      currentMapping: rowMappings?.[rowIndex]
    });
  };

  const handleColumnMapping = (columnIndex, mapping) => {
    setColumnMappings(prev => {
      const updated = { ...prev };
      
      if (mapping === 'ignore' || mapping === null) {
        delete updated?.[columnIndex];
        setSelectedColumns(prev => prev?.filter(idx => idx !== columnIndex));
      } else {
        updated[columnIndex] = mapping;
        if (!selectedColumns?.includes(columnIndex)) {
          setSelectedColumns(prev => [...prev, columnIndex]);
        }
      }
      
      return updated;
    });
    
    setContextMenu(null);
  };

  const handleMultiColumnLocationMapping = (columnIndices) => {
    setColumnMappings(prev => {
      const updated = { ...prev };
      columnIndices?.forEach(idx => {
        updated[idx] = 'location';
      });
      return updated;
    });
    
    setSelectedColumns(prev => {
      const newSelected = [...prev];
      columnIndices?.forEach(idx => {
        if (!newSelected?.includes(idx)) {
          newSelected?.push(idx);
        }
      });
      return newSelected;
    });
  };

  const handleRowMapping = (rowIndex, mapping) => {
    setRowMappings(prev => {
      const updated = { ...prev };
      
      if (mapping === null) {
        delete updated?.[rowIndex];
        setSelectedRows(prev => prev?.filter(idx => idx !== rowIndex));
      } else {
        updated[rowIndex] = mapping;
        if (!selectedRows?.includes(rowIndex)) {
          setSelectedRows(prev => [...prev, rowIndex]);
        }
      }
      
      return updated;
    });
    
    setContextMenu(null);
  };

  const handleCloseContextMenu = () => {
    setContextMenu(null);
  };

  const validateSelections = () => {
    // Check minimum requirements: Item Name + (Location OR Quantity)
    const hasItemName = Object.values(columnMappings)?.includes('itemName');
    const hasLocation = Object.values(columnMappings)?.includes('location');
    const hasQuantity = Object.values(columnMappings)?.includes('quantity');
    
    return hasItemName && (hasLocation || hasQuantity);
  };

  const handleProceedToReview = () => {
    if (!validateSelections()) {
      setError('Please select at least: Item Name column + one Location or Quantity column');
      return;
    }

    // Transform data based on selections
    const transformed = processSelections({
      headers,
      data: sheetData,
      columnMappings,
      rowMappings
    });

    setTransformedData(transformed);
    setShowReviewModal(true);
  };

  const handleConfirmImport = () => {
    // Store in sessionStorage and navigate to inventory
    sessionStorage.setItem('cargo_direct_import_data', JSON.stringify(transformedData));
    navigate('/inventory');
  };

  const handleAdjustSelections = () => {
    setShowReviewModal(false);
  };

  const isValid = validateSelections();

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[1600px] mx-auto">
        {/* Page Header */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={() => navigate('/inventory')}
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
          >
            <Icon name="ArrowLeft" size={24} className="text-foreground" />
          </button>
          <div className="flex-1">
            <h1 className="text-4xl font-semibold text-foreground mb-2 font-heading">
              Direct Excel Selection
            </h1>
            <p className="text-base text-muted-foreground">
              Click columns and rows to tell us what they represent
            </p>
          </div>
        </div>

        {/* Upload Section */}
        {!sheetData && (
          <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
            <div className="max-w-2xl mx-auto text-center">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Icon name="FileSpreadsheet" size={32} className="text-primary" />
              </div>
              <h2 className="text-2xl font-semibold text-foreground mb-2">
                Upload Your Excel File
              </h2>
              <p className="text-muted-foreground mb-6">
                We'll show you an interactive preview where you can select what each column and row represents
              </p>
              
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileSelect}
                className="hidden"
              />
              
              <Button
                onClick={() => fileInputRef?.current?.click()}
                iconName="Upload"
                size="lg"
                disabled={isProcessing}
                loading={isProcessing}
              >
                {isProcessing ? 'Processing...' : 'Select Excel File'}
              </Button>

              {error && (
                <div className="mt-4 p-3 bg-error/10 border border-error/20 rounded-lg">
                  <p className="text-error text-sm">{error}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Spreadsheet Canvas */}
        {sheetData && (
          <>
            {/* Sheet Selector & Actions */}
            <div className="bg-card border border-border rounded-2xl p-4 shadow-sm mb-4">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Icon name="FileSpreadsheet" size={20} className="text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">{fileName}</span>
                  </div>
                  
                  {availableSheets?.length > 1 && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Sheet:</span>
                      <select
                        value={selectedSheet}
                        onChange={(e) => handleSheetChange(e?.target?.value)}
                        className="px-3 py-1 border border-border rounded-md text-sm bg-background text-foreground"
                      >
                        {availableSheets?.map(sheet => (
                          <option key={sheet} value={sheet}>{sheet}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-sm text-muted-foreground">
                    {selectedColumns?.length} columns selected
                  </div>
                  <Button
                    onClick={handleProceedToReview}
                    disabled={!isValid}
                    iconName="ArrowRight"
                    iconPosition="right"
                  >
                    Review & Import
                  </Button>
                </div>
              </div>

              {!isValid && (
                <div className="mt-3 p-3 bg-warning/10 border border-warning/20 rounded-lg">
                  <div className="flex items-start gap-2">
                    <Icon name="AlertCircle" size={16} className="text-warning mt-0.5" />
                    <p className="text-warning text-sm">
                      Minimum required: Select one column as <strong>Item Name</strong> and at least one <strong>Location</strong> or <strong>Quantity</strong> column
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Interactive Spreadsheet */}
            <SpreadsheetCanvas
              headers={headers}
              data={sheetData}
              selectedColumns={selectedColumns}
              selectedRows={selectedRows}
              columnMappings={columnMappings}
              rowMappings={rowMappings}
              onColumnClick={handleColumnClick}
              onRowClick={handleRowClick}
            />

            {/* Context Menu */}
            {contextMenu && (
              <SelectionContextMenu
                type={contextMenu?.type}
                index={contextMenu?.index}
                x={contextMenu?.x}
                y={contextMenu?.y}
                currentMapping={contextMenu?.currentMapping}
                onColumnMapping={handleColumnMapping}
                onRowMapping={handleRowMapping}
                onClose={handleCloseContextMenu}
              />
            )}

            {/* Review Modal */}
            {showReviewModal && transformedData && (
              <ReviewConfirmModal
                data={transformedData}
                onConfirm={handleConfirmImport}
                onAdjust={handleAdjustSelections}
                onClose={() => setShowReviewModal(false)}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default DirectExcelSelectionInterface;