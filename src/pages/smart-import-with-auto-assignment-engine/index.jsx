import React, { useState, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import { parseCSVFile, validateTemplate, processImportWithResolutions } from '../inventory/utils/excelImportProcessor';
import { getCurrentUser, hasCommandAccess, hasChiefAccess, hasHODAccess } from '../../utils/authStorage';

import UploadZone from './components/UploadZone';
import ClassificationPreview from './components/ClassificationPreview';
import ProcessingPanel from './components/ProcessingPanel';
import ResultsSummary from './components/ResultsSummary';

const SmartImportWithAutoAssignmentEngine = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  
  const [step, setStep] = useState('upload'); // upload, preview, processing, complete
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState('');
  const [error, setError] = useState(null);
  const [validationResult, setValidationResult] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [rowResolutions, setRowResolutions] = useState({});
  const [showBulkResolve, setShowBulkResolve] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  
  const currentUser = getCurrentUser();
  const canImport = hasCommandAccess(currentUser) || hasChiefAccess(currentUser) || hasHODAccess(currentUser);

  if (!canImport) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="max-w-4xl mx-auto px-4 py-12 text-center">
          <Icon name="AlertCircle" size={48} className="text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h2>
          <p className="text-gray-600">You don't have permission to import inventory items.</p>
          <Button onClick={() => navigate('/inventory')} className="mt-6">
            Back to Inventory
          </Button>
        </div>
      </div>
    );
  }

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
    const droppedFile = e?.dataTransfer?.files?.[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  };

  const handleFileInput = (e) => {
    const selectedFile = e?.target?.files?.[0];
    if (selectedFile) {
      handleFileSelect(selectedFile);
    }
  };

  const handleFileSelect = async (selectedFile) => {
    setError(null);
    setFile(selectedFile);
    setFileName(selectedFile?.name);
    
    const sizeInKB = (selectedFile?.size / 1024)?.toFixed(2);
    const sizeInMB = (selectedFile?.size / (1024 * 1024))?.toFixed(2);
    setFileSize(selectedFile?.size > 1024 * 1024 ? `${sizeInMB} MB` : `${sizeInKB} KB`);

    const isXLSX = selectedFile?.name?.endsWith('.xlsx') || selectedFile?.name?.endsWith('.xls');
    const isCSV = selectedFile?.name?.endsWith('.csv');

    // Block Excel files with clear error message
    if (isXLSX) {
      setError("Excel files aren't supported yet. Please upload a .csv file.");
      return;
    }

    if (!isCSV) {
      setError('Please upload a CSV file (.csv)');
      return;
    }

    try {
      const jsonData = await parseCSVFile(selectedFile);
      const validation = validateTemplate(jsonData);
      
      if (!validation?.success) {
        setError(validation?.error);
        return;
      }

      setValidationResult(validation);
      
      // Initialize row resolutions for unresolved rows
      const initialResolutions = {};
      validation?.parsedRows?.forEach((row, index) => {
        if (!row?.isResolved) {
          initialResolutions[index] = {
            categoryL1Id: row?.resolvedTaxonomy?.categoryL1Id || '',
            categoryL2Id: row?.resolvedTaxonomy?.categoryL2Id || '',
            categoryL3Id: row?.resolvedTaxonomy?.categoryL3Id || '',
            createNewL2: false,
            createNewL3: false,
            newL2Name: row?.rawData?.subcategoryL2 || '',
            newL3Name: row?.rawData?.subcategoryL3 || ''
          };
        }
      });
      setRowResolutions(initialResolutions);
      
      setStep('preview');
    } catch (err) {
      setError(err?.message || 'Failed to process file');
    }
  };

  // Separate auto-assigned and needs review rows
  const autoAssignedRows = useMemo(() => {
    if (!validationResult?.parsedRows) return [];
    return validationResult?.parsedRows?.filter(row => row?.autoAssigned);
  }, [validationResult]);

  const needsReviewRows = useMemo(() => {
    if (!validationResult?.parsedRows) return [];
    return validationResult?.parsedRows?.filter(row => row?.needsReview);
  }, [validationResult]);

  // Check if all rows are resolved
  const allRowsResolved = useMemo(() => {
    if (!validationResult?.parsedRows) return false;
    
    return validationResult?.parsedRows?.every((row, index) => {
      if (row?.isResolved) return true;
      
      const resolution = rowResolutions?.[index];
      if (!resolution) return false;
      
      if (!resolution?.categoryL1Id) return false;
      if (!resolution?.categoryL2Id && !resolution?.createNewL2) return false;
      if (resolution?.createNewL2 && !resolution?.newL2Name?.trim()) return false;
      
      return true;
    });
  }, [validationResult, rowResolutions]);

  const handleResolutionChange = (rowIndex, field, value) => {
    setRowResolutions(prev => ({
      ...prev,
      [rowIndex]: {
        ...prev?.[rowIndex],
        [field]: value,
        ...(field === 'categoryL1Id' ? { categoryL2Id: '', categoryL3Id: '' } : {}),
        ...(field === 'categoryL2Id' ? { categoryL3Id: '' } : {}),
        ...(field === 'createNewL2' && value ? { categoryL2Id: '' } : {}),
        ...(field === 'createNewL3' && value ? { categoryL3Id: '' } : {})
      }
    }));
  };

  const handleProcessImport = () => {
    setStep('processing');
    setError(null);

    try {
      const result = processImportWithResolutions(validationResult, rowResolutions);
      setImportResult(result);
      setStep('complete');
    } catch (err) {
      setError(err?.message || 'Import failed');
      setStep('preview');
    }
  };

  const handleReset = () => {
    setStep('upload');
    setFile(null);
    setFileName('');
    setFileSize('');
    setError(null);
    setValidationResult(null);
    setImportResult(null);
    setRowResolutions({});
  };

  const handleUploadClick = () => {
    fileInputRef?.current?.click();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Page Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
            <button onClick={() => navigate('/dashboard')} className="hover:text-gray-900">
              Dashboard
            </button>
            <Icon name="ChevronRight" size={14} />
            <button onClick={() => navigate('/inventory')} className="hover:text-gray-900">
              Inventory
            </button>
            <Icon name="ChevronRight" size={14} />
            <span className="text-gray-900 font-medium">Smart Import</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Smart Import with Auto-Assignment Engine</h1>
          <p className="text-gray-600 mt-1">
            Intelligent keyword-based taxonomy assignment with automated L1/L2 classification
          </p>
        </div>

        {/* Main Content */}
        {step === 'upload' && (
          <UploadZone
            isDragging={isDragging}
            fileName={fileName}
            fileSize={fileSize}
            error={error}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onUploadClick={handleUploadClick}
          />
        )}

        {step === 'preview' && (
          <ClassificationPreview
            autoAssignedRows={autoAssignedRows}
            needsReviewRows={needsReviewRows}
            rowResolutions={rowResolutions}
            allRowsResolved={allRowsResolved}
            onResolutionChange={handleResolutionChange}
            onProcessImport={handleProcessImport}
            onCancel={handleReset}
          />
        )}

        {step === 'processing' && (
          <ProcessingPanel />
        )}

        {step === 'complete' && (
          <ResultsSummary
            importResult={importResult}
            onViewInventory={() => navigate('/inventory')}
            onImportMore={handleReset}
          />
        )}

        {/* Hidden File Input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleFileInput}
          className="hidden"
        />
      </div>
    </div>
  );
};

export default SmartImportWithAutoAssignmentEngine;