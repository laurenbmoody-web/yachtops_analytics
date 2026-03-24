import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import Header from '../../components/navigation/Header';
import { interpretHeaders, analyzeDataSample } from './utils/headerIntelligence';

const AutoImportIntelligenceEngine = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState(null);
  const [error, setError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Excel sheet selection
  const [excelWorkbook, setExcelWorkbook] = useState(null);
  const [availableSheets, setAvailableSheets] = useState([]);
  const [selectedSheets, setSelectedSheets] = useState([]);
  const [showSheetSelection, setShowSheetSelection] = useState(false);
  
  // Intelligence analysis results
  const [detectionResults, setDetectionResults] = useState(null);
  const [showAnalysis, setShowAnalysis] = useState(false);

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
    setShowAnalysis(false);
    setDetectionResults(null);

    const isCSV = file?.name?.endsWith('.csv');
    const isXLSX = file?.name?.endsWith('.xlsx') || file?.name?.endsWith('.xls');
    
    if (!isCSV && !isXLSX) {
      setError('Please upload a CSV or Excel (.xlsx) file');
      setIsProcessing(false);
      return;
    }

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
      header: false,
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

        const headers = results?.data?.[0] || [];
        const dataRows = results?.data?.slice(1);

        analyzeAndDetect(file?.name, 'csv', headers, dataRows, null);
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
          setError('Excel file contains no sheets');
          setIsProcessing(false);
          return;
        }

        setExcelWorkbook(workbook);
        setAvailableSheets(workbook?.SheetNames);
        setSelectedSheets([workbook?.SheetNames?.[0]]);
        setShowSheetSelection(true);
        setIsProcessing(false);
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

  const handleSheetToggle = (sheetName) => {
    setSelectedSheets(prev => {
      if (prev?.includes(sheetName)) {
        return prev?.filter(s => s !== sheetName);
      } else {
        return [...prev, sheetName];
      }
    });
  };

  const handleProcessSelectedSheets = () => {
    if (selectedSheets?.length === 0) {
      setError('Please select at least one sheet');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const allHeaders = [];
      const allRows = [];
      const sheetCategories = [];

      selectedSheets?.forEach(sheetName => {
        const worksheet = excelWorkbook?.Sheets?.[sheetName];
        const jsonData = XLSX?.utils?.sheet_to_json(worksheet, { header: 1, defval: '' });
        
        if (jsonData?.length > 0) {
          const headers = jsonData?.[0] || [];
          const rows = jsonData?.slice(1);
          
          allHeaders?.push(...headers);
          allRows?.push(...rows);
          sheetCategories?.push(sheetName);
        }
      });

      const uniqueHeaders = [...new Set(allHeaders)];
      analyzeAndDetect(fileName, 'xlsx', uniqueHeaders, allRows, sheetCategories);
    } catch (error) {
      setError('Failed to process sheets: ' + error?.message);
      setIsProcessing(false);
    }
  };

  const analyzeAndDetect = (fileName, fileType, headers, dataRows, sheetNames) => {
    try {
      const sampleRows = dataRows?.slice(0, 10);
      
      const interpretation = interpretHeaders(headers, sheetNames);
      const dataAnalysis = analyzeDataSample(headers, sampleRows, interpretation);
      
      const results = {
        fileName,
        fileType,
        headers,
        sampleRows,
        sheetNames,
        interpretation,
        dataAnalysis,
        totalRows: dataRows?.length,
        allRows: dataRows
      };

      setDetectionResults(results);
      setShowAnalysis(true);
      setIsProcessing(false);
      setShowSheetSelection(false);
    } catch (error) {
      setError('Failed to analyze file: ' + error?.message);
      setIsProcessing(false);
    }
  };

  const handleProceedToReview = () => {
    if (!detectionResults) return;
    
    sessionStorage.setItem('cargo_auto_import_data', JSON.stringify(detectionResults));
    navigate('/auto-import-review-adjustment');
  };

  const handleAdvancedMapping = () => {
    navigate('/csv-upload-staging');
  };

  const getConfidenceBadge = (confidence) => {
    if (confidence >= 0.8) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-success/10 text-success text-xs font-medium">
          <Icon name="CheckCircle2" size={12} />
          High Confidence
        </span>
      );
    } else if (confidence >= 0.5) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-warning/10 text-warning text-xs font-medium">
          <Icon name="AlertCircle" size={12} />
          Medium Confidence
        </span>
      );
    } else {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted text-muted-foreground text-xs font-medium">
          <Icon name="HelpCircle" size={12} />
          Low Confidence
        </span>
      );
    }
  };

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[1400px] mx-auto">
        {/* Page Header */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={() => navigate('/inventory')}
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
          >
            <Icon name="ArrowLeft" size={24} className="text-foreground" />
          </button>
          <div className="flex-1">
            <h1 className="text-4xl font-semibold text-foreground mb-2 font-heading">Auto-Import Intelligence Engine</h1>
            <p className="text-base text-muted-foreground">Intelligent header interpretation and automated field detection</p>
          </div>
        </div>

        {/* Upload Zone */}
        {!showSheetSelection && !showAnalysis && (
          <div className="bg-card border border-border rounded-2xl p-8 shadow-sm mb-6">
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
                    {fileName ? fileName : 'Drop your Excel or CSV file here'}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Excel (.xlsx) recommended • CSV supported
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

            {/* Intelligence Features */}
            <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-muted/30 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Icon name="Brain" size={20} className="text-primary" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-foreground mb-1">Smart Detection</h4>
                    <p className="text-xs text-muted-foreground">Automatically identifies item names, locations, categories, and quantities from headers</p>
                  </div>
                </div>
              </div>

              <div className="bg-muted/30 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Icon name="MapPin" size={20} className="text-primary" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-foreground mb-1">Location Auto-Create</h4>
                    <p className="text-xs text-muted-foreground">Detects location columns and creates storage areas automatically</p>
                  </div>
                </div>
              </div>

              <div className="bg-muted/30 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Icon name="Zap" size={20} className="text-primary" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-foreground mb-1">Zero Configuration</h4>
                    <p className="text-xs text-muted-foreground">No manual mapping required - review and confirm in seconds</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Advanced Option */}
            <div className="mt-6 text-center">
              <button
                onClick={handleAdvancedMapping}
                className="text-sm text-muted-foreground hover:text-foreground transition-smooth"
              >
                Need manual control? <span className="underline">Use advanced mapping</span>
              </button>
            </div>
          </div>
        )}

        {/* Sheet Selection */}
        {showSheetSelection && (
          <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
            <div className="mb-6">
              <h2 className="text-2xl font-semibold text-foreground mb-2">Select Sheets to Import</h2>
              <p className="text-sm text-muted-foreground">Choose one or more sheets from your Excel file</p>
            </div>

            <div className="space-y-3 mb-6">
              {availableSheets?.map(sheetName => (
                <label
                  key={sheetName}
                  className="flex items-center gap-3 p-4 bg-muted/30 rounded-xl hover:bg-muted/50 cursor-pointer transition-smooth"
                >
                  <input
                    type="checkbox"
                    checked={selectedSheets?.includes(sheetName)}
                    onChange={() => handleSheetToggle(sheetName)}
                    className="w-5 h-5 rounded border-border text-primary focus:ring-2 focus:ring-primary"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">{sheetName}</p>
                  </div>
                  <Icon name="FileText" size={20} className="text-muted-foreground" />
                </label>
              ))}
            </div>

            <div className="flex gap-3">
              <Button
                variant="default"
                onClick={handleProcessSelectedSheets}
                disabled={selectedSheets?.length === 0 || isProcessing}
                loading={isProcessing}
                iconName="Sparkles"
              >
                Analyze Selected Sheets
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowSheetSelection(false);
                  setFileName(null);
                  setExcelWorkbook(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Analysis Results */}
        {showAnalysis && detectionResults && (
          <div className="space-y-6">
            {/* Summary Card */}
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-2xl font-semibold text-foreground mb-2">Analysis Complete</h2>
                  <p className="text-sm text-muted-foreground">Intelligent detection results for {detectionResults?.fileName}</p>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 bg-success/10 rounded-lg">
                  <Icon name="CheckCircle2" size={20} className="text-success" />
                  <span className="text-sm font-medium text-success">Ready to Import</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-muted/30 rounded-xl p-4">
                  <p className="text-xs text-muted-foreground mb-1">Total Rows</p>
                  <p className="text-2xl font-bold text-foreground">{detectionResults?.totalRows}</p>
                </div>
                <div className="bg-muted/30 rounded-xl p-4">
                  <p className="text-xs text-muted-foreground mb-1">Detected Locations</p>
                  <p className="text-2xl font-bold text-foreground">{detectionResults?.interpretation?.locationColumns?.length || 0}</p>
                </div>
                <div className="bg-muted/30 rounded-xl p-4">
                  <p className="text-xs text-muted-foreground mb-1">Categories Found</p>
                  <p className="text-2xl font-bold text-foreground">{detectionResults?.dataAnalysis?.categoriesDetected?.length || 0}</p>
                </div>
                <div className="bg-muted/30 rounded-xl p-4">
                  <p className="text-xs text-muted-foreground mb-1">Fields Detected</p>
                  <p className="text-2xl font-bold text-foreground">{Object.keys(detectionResults?.interpretation?.fieldMappings || {})?.length}</p>
                </div>
              </div>
            </div>

            {/* Field Detection Results */}
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                <Icon name="Target" size={20} />
                Field Detection Results
              </h3>

              <div className="space-y-3">
                {/* Item Name */}
                {detectionResults?.interpretation?.itemNameColumn && (
                  <div className="flex items-center justify-between p-4 bg-muted/30 rounded-xl">
                    <div className="flex items-center gap-3">
                      <Icon name="Package" size={20} className="text-primary" />
                      <div>
                        <p className="text-sm font-medium text-foreground">Item Name</p>
                        <p className="text-xs text-muted-foreground">Column: "{detectionResults?.interpretation?.itemNameColumn}"</p>
                      </div>
                    </div>
                    {getConfidenceBadge(detectionResults?.interpretation?.itemNameConfidence)}
                  </div>
                )}

                {/* Category */}
                {detectionResults?.interpretation?.categoryColumn && (
                  <div className="flex items-center justify-between p-4 bg-muted/30 rounded-xl">
                    <div className="flex items-center gap-3">
                      <Icon name="FolderOpen" size={20} className="text-primary" />
                      <div>
                        <p className="text-sm font-medium text-foreground">Category</p>
                        <p className="text-xs text-muted-foreground">Column: "{detectionResults?.interpretation?.categoryColumn}"</p>
                      </div>
                    </div>
                    {getConfidenceBadge(detectionResults?.interpretation?.categoryConfidence)}
                  </div>
                )}

                {/* Location Quantity Columns */}
                {detectionResults?.interpretation?.locationColumns?.length > 0 && (
                  <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl">
                    <div className="flex items-start gap-3 mb-3">
                      <Icon name="MapPin" size={20} className="text-primary" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground mb-1">Location Quantity Columns Detected</p>
                        <p className="text-xs text-muted-foreground mb-3">
                          These columns will create locations automatically. Column headers = location names, cell values = quantities.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {detectionResults?.interpretation?.locationColumns?.map((loc, idx) => (
                            <span key={idx} className="px-3 py-1 bg-primary/10 text-primary text-xs font-medium rounded-md">
                              {loc}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Unit of Measure */}
                {detectionResults?.interpretation?.unitColumn && (
                  <div className="flex items-center justify-between p-4 bg-muted/30 rounded-xl">
                    <div className="flex items-center gap-3">
                      <Icon name="Ruler" size={20} className="text-primary" />
                      <div>
                        <p className="text-sm font-medium text-foreground">Unit of Measure</p>
                        <p className="text-xs text-muted-foreground">Column: "{detectionResults?.interpretation?.unitColumn}"</p>
                      </div>
                    </div>
                    {getConfidenceBadge(detectionResults?.interpretation?.unitConfidence)}
                  </div>
                )}
              </div>
            </div>

            {/* Sample Data Preview */}
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                <Icon name="Eye" size={20} />
                Sample Data Preview
              </h3>
              
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {detectionResults?.headers?.slice(0, 8)?.map((header, idx) => (
                        <th key={idx} className="text-left p-3 text-xs font-medium text-muted-foreground">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detectionResults?.sampleRows?.slice(0, 5)?.map((row, rowIdx) => (
                      <tr key={rowIdx} className="border-b border-border hover:bg-muted/30">
                        {row?.slice(0, 8)?.map((cell, cellIdx) => (
                          <td key={cellIdx} className="p-3 text-xs text-foreground">
                            {cell || '-'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <Button
                variant="default"
                size="lg"
                onClick={handleProceedToReview}
                iconName="ArrowRight"
                iconPosition="right"
              >
                Proceed to Review
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={() => {
                  setShowAnalysis(false);
                  setDetectionResults(null);
                  setFileName(null);
                }}
              >
                Start Over
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default AutoImportIntelligenceEngine;