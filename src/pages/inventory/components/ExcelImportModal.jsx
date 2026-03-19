import React, { useState, useRef, useMemo } from 'react';
import Button from '../../../components/ui/Button';
import Icon from '../../../components/AppIcon';
import { parseCSVFile, validateTemplate, processImportWithResolutions } from '../utils/excelImportProcessor';
import { getCurrentUser, hasCommandAccess, hasChiefAccess, hasHODAccess } from '../../../utils/authStorage';
import { getAllCategoriesL1, getCategoriesL2ByL1, getCategoriesL3ByL2 } from '../utils/taxonomyStorage';
import { logActivity, InventoryActions } from '../../../utils/activityStorage';

const ExcelImportModal = ({ onClose, onSuccess }) => {
  const [step, setStep] = useState('upload'); // upload, preview, processing, complete
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState('');
  const [error, setError] = useState(null);
  const [validationResult, setValidationResult] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  
  // Taxonomy resolution state
  const [rowResolutions, setRowResolutions] = useState({});
  const [showBulkResolve, setShowBulkResolve] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  
  const fileInputRef = useRef(null);

  const currentUser = getCurrentUser();
  const canImport = hasCommandAccess(currentUser) || hasChiefAccess(currentUser) || hasHODAccess(currentUser);

  if (!canImport) {
    return null;
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
    
    // Format file size
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

  // Group unresolved rows by taxonomy text (ONLY for needs review)
  const unresolvedGroups = useMemo(() => {
    if (!validationResult?.parsedRows) return [];
    
    const groups = {};
    validationResult?.parsedRows?.forEach((row, index) => {
      if (row?.needsReview) {
        const key = `${row?.rawData?.category || ''}|${row?.rawData?.subcategoryL2 || ''}|${row?.rawData?.subcategoryL3 || ''}`;
        if (!groups?.[key]) {
          groups[key] = {
            key,
            category: row?.rawData?.category,
            subcategoryL2: row?.rawData?.subcategoryL2,
            subcategoryL3: row?.rawData?.subcategoryL3,
            rowIndices: []
          };
        }
        groups?.[key]?.rowIndices?.push(index);
      }
    });
    
    return Object.values(groups);
  }, [validationResult]);

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
      
      // Must have L1 and L2
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
        // Reset dependent fields
        ...(field === 'categoryL1Id' ? { categoryL2Id: '', categoryL3Id: '' } : {}),
        ...(field === 'categoryL2Id' ? { categoryL3Id: '' } : {}),
        ...(field === 'createNewL2' && value ? { categoryL2Id: '' } : {}),
        ...(field === 'createNewL3' && value ? { categoryL3Id: '' } : {})
      }
    }));
  };

  const handleBulkResolve = (group) => {
    setSelectedGroup(group);
    setShowBulkResolve(true);
  };

  const applyBulkResolution = (resolution) => {
    if (!selectedGroup) return;
    
    setRowResolutions(prev => {
      const updated = { ...prev };
      selectedGroup?.rowIndices?.forEach(index => {
        updated[index] = { ...resolution };
      });
      return updated;
    });
    
    setShowBulkResolve(false);
    setSelectedGroup(null);
  };

  const handleProcessImport = () => {
    setStep('processing');
    setError(null);

    try {
      const result = processImportWithResolutions(validationResult, rowResolutions);
      setImportResult(result);
      setStep('complete');
      
      // Log import completed activity
      try {
        const currentUser = getCurrentUser();
        const departmentScope = currentUser?.department || 'UNKNOWN';
        
        logActivity({
          actorUserId: currentUser?.id,
          actorName: currentUser?.name || 'Unknown User',
          actorDepartment: currentUser?.department || 'UNKNOWN',
          actorRoleTier: currentUser?.tier || 'CREW',
          departmentScope: departmentScope,
          module: 'inventory',
          action: InventoryActions?.IMPORT_COMPLETED,
          entityType: 'inventoryItem',
          entityId: `import-${Date.now()}`,
          summary: `${currentUser?.name || 'Unknown User'} imported ${result?.successCount || 0} items`,
          meta: {
            successCount: result?.successCount || 0,
            failedCount: result?.failedCount || 0,
            totalRows: result?.totalRows || 0,
            fileName: fileName
          }
        });
      } catch (error) {
        console.error('Activity logging failed (non-blocking):', error);
      }
    } catch (err) {
      setError(err?.message || 'Import failed');
      setStep('preview');
    }
  };

  const handleViewInventory = () => {
    onSuccess();
    onClose();
  };
  
  const handleUploadClick = () => {
    fileInputRef?.current?.click();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-6xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">Import Inventory</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <Icon name="X" size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Upload Step */}
          {step === 'upload' && (
            <div className="space-y-6">
              <div className="text-center">
                <p className="text-gray-600 mb-4">
                  Upload a CSV file using the Cargo Inventory Template.
                </p>
                <p className="text-sm text-gray-500">
                  The file must contain "Item Name" as a required column.
                </p>
              </div>

              {/* Drag & Drop Area */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-12 text-center transition-all ${
                  isDragging
                    ? 'border-blue-500 bg-blue-50' :'border-gray-300 hover:border-gray-400'
                }`}
              >
                <Icon name="Upload" size={48} className="mx-auto text-gray-400 mb-4" />
                <p className="text-gray-700 font-medium mb-2">
                  Drag and drop your file here
                </p>
                <p className="text-sm text-gray-500 mb-4">or</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileInput}
                  className="hidden"
                />
                <Button type="button" variant="outline" onClick={handleUploadClick}>
                  Upload
                </Button>
              </div>

              {fileName && (
                <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg">
                  <Icon name="FileText" size={20} className="text-blue-500" />
                  <div className="flex-1">
                    <span className="text-sm text-gray-700 font-medium">{fileName}</span>
                    <span className="text-xs text-gray-500 ml-2">({fileSize})</span>
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <Icon name="AlertCircle" size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
            </div>
          )}

          {/* Preview Step with Taxonomy Resolution */}
          {step === 'preview' && validationResult && (
            <div className="space-y-6">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Icon name="Info" size={20} className="text-blue-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-blue-900 mb-2">File parsed successfully</p>
                    <div className="text-sm text-blue-700 space-y-1">
                      <p>• Valid rows: {validationResult?.validRows}</p>
                      <p>• Rows to skip: {validationResult?.skippedRows}</p>
                      <p>• Auto-assigned: {autoAssignedRows?.length}</p>
                      <p>• Needs review: {needsReviewRows?.length}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Auto-Assigned Section (No Action Needed) */}
              {autoAssignedRows?.length > 0 && (
                <div className="border border-green-200 bg-green-50 rounded-lg p-4">
                  <div className="flex items-start gap-3 mb-3">
                    <Icon name="CheckCircle" size={20} className="text-green-500 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-green-900 mb-1">
                        Auto-assigned ({autoAssignedRows?.length} items)
                      </p>
                      <p className="text-xs text-green-700">
                        These items were automatically placed based on high-confidence keyword matching. No action needed.
                      </p>
                    </div>
                  </div>
                  
                  {/* Preview first few auto-assigned items */}
                  <div className="mt-3 space-y-2">
                    {autoAssignedRows?.slice(0, 5)?.map((row, idx) => (
                      <div key={idx} className="bg-white border border-green-200 rounded px-3 py-2 text-xs">
                        <span className="font-medium text-gray-900">{row?.rawData?.itemName}</span>
                        <span className="text-gray-500 mx-2">→</span>
                        <span className="text-green-700">
                          {getCategoryPath(row?.resolvedTaxonomy)}
                        </span>
                      </div>
                    ))}
                    {autoAssignedRows?.length > 5 && (
                      <p className="text-xs text-green-600 italic">+ {autoAssignedRows?.length - 5} more items...</p>
                    )}
                  </div>
                </div>
              )}

              {/* Needs Review Section */}
              {needsReviewRows?.length > 0 && (
                <div className="border border-orange-200 bg-orange-50 rounded-lg p-4">
                  <div className="flex items-start gap-3 mb-4">
                    <Icon name="AlertTriangle" size={20} className="text-orange-500 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-orange-900 mb-1">
                        Needs review ({needsReviewRows?.length} items)
                      </p>
                      <p className="text-xs text-orange-700">
                        Select the correct category and subcategories for each group below, or choose "Create new" to add them to the taxonomy.
                      </p>
                    </div>
                  </div>

                  {/* Bulk Resolution Groups */}
                  <div className="space-y-4">
                    {unresolvedGroups?.map((group, groupIndex) => (
                      <UnresolvedGroupCard
                        key={group?.key}
                        group={group}
                        rowResolutions={rowResolutions}
                        onResolutionChange={handleResolutionChange}
                        onBulkResolve={() => handleBulkResolve(group)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Simplified Preview Table - Show only needs review if any, otherwise show auto-assigned */}
              {(needsReviewRows?.length > 0 || autoAssignedRows?.length > 0) && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">
                    Preview (First 20 Rows)
                  </h3>
                  <div className="border border-gray-200 rounded-lg overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium text-gray-700">Item Name</th>
                          <th className="px-4 py-3 text-left font-medium text-gray-700">Assigned Path</th>
                          <th className="px-4 py-3 text-left font-medium text-gray-700">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {validationResult?.parsedRows?.slice(0, 20)?.map((row, rowIndex) => (
                          <tr key={rowIndex} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="px-4 py-3 text-gray-900 font-medium">{row?.rawData?.itemName}</td>
                            <td className="px-4 py-3 text-gray-600 text-xs">
                              {row?.isResolved || row?.autoAssigned ? (
                                getCategoryPath(row?.resolvedTaxonomy)
                              ) : (
                                <span className="text-orange-600">Awaiting placement</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {row?.autoAssigned ? (
                                <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-100 px-2 py-1 rounded">
                                  <Icon name="Zap" size={12} />
                                  Auto-assigned
                                </span>
                              ) : row?.isResolved ? (
                                <span className="inline-flex items-center gap-1 text-xs text-blue-700 bg-blue-100 px-2 py-1 rounded">
                                  <Icon name="CheckCircle" size={12} />
                                  From file
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs text-orange-700 bg-orange-100 px-2 py-1 rounded">
                                  <Icon name="AlertCircle" size={12} />
                                  Needs review
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <Button variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <div className="flex items-center gap-3">
                  {!allRowsResolved && (
                    <p className="text-sm text-orange-600 font-medium">
                      Resolve all rows to continue
                    </p>
                  )}
                  <Button 
                    onClick={handleProcessImport} 
                    iconName="Upload"
                    disabled={!allRowsResolved}
                  >
                    Process Import
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Processing Step */}
          {step === 'processing' && (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-blue-500 mb-4"></div>
              <p className="text-gray-700 font-medium">Processing import...</p>
              <p className="text-sm text-gray-500 mt-2">Please wait while we import your items</p>
            </div>
          )}

          {/* Complete Step */}
          {step === 'complete' && importResult && (
            <div className="space-y-6">
              <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
                <Icon name="CheckCircle" size={48} className="mx-auto text-green-500 mb-4" />
                <h3 className="text-xl font-bold text-green-900 mb-2">Import Complete!</h3>
                <div className="text-sm text-green-700 space-y-1">
                  <p>• Items created: {importResult?.itemsCreated}</p>
                  <p>• Items updated: {importResult?.itemsUpdated}</p>
                  <p>• Rows skipped: {importResult?.rowsSkipped}</p>
                  <p>• Subcategories created: {importResult?.subcategoriesCreated || 0}</p>
                </div>
              </div>

              {importResult?.errors?.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <p className="text-sm font-medium text-yellow-900 mb-2">Warnings:</p>
                  <ul className="text-sm text-yellow-700 space-y-1">
                    {importResult?.errors?.map((err, index) => (
                      <li key={index}>• {err}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex items-center justify-center">
                <Button onClick={handleViewInventory} iconName="Package">
                  View Inventory
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bulk Resolution Modal */}
      {showBulkResolve && selectedGroup && (
        <BulkResolveModal
          group={selectedGroup}
          onApply={applyBulkResolution}
          onClose={() => {
            setShowBulkResolve(false);
            setSelectedGroup(null);
          }}
        />
      )}
    </div>
  );
};

// Helper function to get category path display
const getCategoryPath = (taxonomy) => {
  const categoriesL1 = getAllCategoriesL1();
  const l1 = categoriesL1?.find(cat => cat?.id === taxonomy?.categoryL1Id);
  
  if (!l1) return 'Unknown';
  
  const categoriesL2 = getCategoriesL2ByL1(taxonomy?.categoryL1Id);
  const l2 = categoriesL2?.find(cat => cat?.id === taxonomy?.categoryL2Id);
  
  if (!l2) return l1?.name;
  
  if (!taxonomy?.categoryL3Id) {
    return `${l1?.name} → ${l2?.name}`;
  }
  
  const categoriesL3 = getCategoriesL3ByL2(taxonomy?.categoryL2Id);
  const l3 = categoriesL3?.find(cat => cat?.id === taxonomy?.categoryL3Id);
  
  return l3 ? `${l1?.name} → ${l2?.name} → ${l3?.name}` : `${l1?.name} → ${l2?.name}`;
};

// Unresolved Group Card Component
const UnresolvedGroupCard = ({ group, rowResolutions, onResolutionChange, onBulkResolve }) => {
  const firstRowIndex = group?.rowIndices?.[0];
  const resolution = rowResolutions?.[firstRowIndex] || {};
  
  const categoriesL1 = getAllCategoriesL1();
  const categoriesL2 = resolution?.categoryL1Id ? getCategoriesL2ByL1(resolution?.categoryL1Id) : [];
  const categoriesL3 = resolution?.categoryL2Id ? getCategoriesL3ByL2(resolution?.categoryL2Id) : [];

  const handleChange = (field, value) => {
    // Apply to all rows in this group
    group?.rowIndices?.forEach(index => {
      onResolutionChange(index, field, value);
    });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-900 mb-1">
            {group?.rowIndices?.length} row{group?.rowIndices?.length > 1 ? 's' : ''} with:
          </p>
          <div className="text-xs text-gray-600 space-y-0.5">
            {group?.category && <p>Inventory Group: <span className="font-medium">{group?.category}</span></p>}
            {group?.subcategoryL2 && <p>Category: <span className="font-medium">{group?.subcategoryL2}</span></p>}
            {group?.subcategoryL3 && <p>Sub-Category: <span className="font-medium">{group?.subcategoryL3}</span></p>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Inventory Group */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Inventory Group <span className="text-red-500">*</span>
          </label>
          <select
            value={resolution?.categoryL1Id || ''}
            onChange={(e) => handleChange('categoryL1Id', e?.target?.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select Inventory Group...</option>
            {categoriesL1?.map(cat => (
              <option key={cat?.id} value={cat?.id}>{cat?.name}</option>
            ))}
          </select>
        </div>

        {/* Category */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Category <span className="text-red-500">*</span>
          </label>
          {resolution?.createNewL2 ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={resolution?.newL2Name || ''}
                onChange={(e) => handleChange('newL2Name', e?.target?.value)}
                placeholder="New Category name"
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={() => handleChange('createNewL2', false)}
                className="px-2 py-2 text-gray-500 hover:text-gray-700"
                title="Cancel create new"
              >
                <Icon name="X" size={16} />
              </button>
            </div>
          ) : (
            <select
              value={resolution?.categoryL2Id || ''}
              onChange={(e) => {
                if (e?.target?.value === '__CREATE_NEW__') {
                  handleChange('createNewL2', true);
                } else {
                  handleChange('categoryL2Id', e?.target?.value);
                }
              }}
              disabled={!resolution?.categoryL1Id}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            >
              <option value="">Select Category...</option>
              {categoriesL2?.map(cat => (
                <option key={cat?.id} value={cat?.id}>{cat?.name}</option>
              ))}
              <option value="__CREATE_NEW__">+ Create new Category...</option>
            </select>
          )}
          {group?.subcategoryL2 && (
            <p className="text-xs text-gray-500 mt-1">Suggested: {group?.subcategoryL2}</p>
          )}
        </div>

        {/* Sub-Category */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Sub-Category (optional)
          </label>
          {resolution?.createNewL3 ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={resolution?.newL3Name || ''}
                onChange={(e) => handleChange('newL3Name', e?.target?.value)}
                placeholder="New Sub-Category name"
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={() => handleChange('createNewL3', false)}
                className="px-2 py-2 text-gray-500 hover:text-gray-700"
                title="Cancel create new"
              >
                <Icon name="X" size={16} />
              </button>
            </div>
          ) : (
            <select
              value={resolution?.categoryL3Id || ''}
              onChange={(e) => {
                if (e?.target?.value === '__CREATE_NEW__') {
                  handleChange('createNewL3', true);
                } else {
                  handleChange('categoryL3Id', e?.target?.value);
                }
              }}
              disabled={!resolution?.categoryL2Id || resolution?.createNewL2}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            >
              <option value="">None / Leave blank</option>
              {categoriesL3?.map(cat => (
                <option key={cat?.id} value={cat?.id}>{cat?.name}</option>
              ))}
              <option value="__CREATE_NEW__">+ Create new Sub-Category...</option>
            </select>
          )}
          {group?.subcategoryL3 && (
            <p className="text-xs text-gray-500 mt-1">Suggested: {group?.subcategoryL3}</p>
          )}
        </div>
      </div>
    </div>
  );
};

// Bulk Resolve Modal Component
const BulkResolveModal = ({ group, onApply, onClose }) => {
  const [resolution, setResolution] = useState({
    categoryL1Id: '',
    categoryL2Id: '',
    categoryL3Id: '',
    createNewL2: false,
    createNewL3: false,
    newL2Name: group?.subcategoryL2 || '',
    newL3Name: group?.subcategoryL3 || ''
  });

  const categoriesL1 = getAllCategoriesL1();
  const categoriesL2 = resolution?.categoryL1Id ? getCategoriesL2ByL1(resolution?.categoryL1Id) : [];
  const categoriesL3 = resolution?.categoryL2Id ? getCategoriesL3ByL2(resolution?.categoryL2Id) : [];

  const canApply = resolution?.categoryL1Id && 
    (resolution?.categoryL2Id || (resolution?.createNewL2 && resolution?.newL2Name?.trim()));

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full">
        <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">
            Bulk Resolve {group?.rowIndices?.length} Rows
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <Icon name="X" size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm">
            <p className="text-gray-700 mb-1">Applying to rows with:</p>
            <div className="text-xs text-gray-600 space-y-0.5">
              {group?.category && <p>Inventory Group: <span className="font-medium">{group?.category}</span></p>}
              {group?.subcategoryL2 && <p>Category: <span className="font-medium">{group?.subcategoryL2}</span></p>}
              {group?.subcategoryL3 && <p>Sub-Category: <span className="font-medium">{group?.subcategoryL3}</span></p>}
            </div>
          </div>

          {/* Resolution fields */}
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Inventory Group <span className="text-red-500">*</span>
              </label>
              <select
                value={resolution?.categoryL1Id || ''}
                onChange={(e) => setResolution(prev => ({ ...prev, categoryL1Id: e?.target?.value, categoryL2Id: '', categoryL3Id: '' }))}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select Inventory Group...</option>
                {categoriesL1?.map(cat => (
                  <option key={cat?.id} value={cat?.id}>{cat?.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Category <span className="text-red-500">*</span>
              </label>
              {resolution?.createNewL2 ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={resolution?.newL2Name || ''}
                    onChange={(e) => setResolution(prev => ({ ...prev, newL2Name: e?.target?.value }))}
                    placeholder="New Category name"
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={() => setResolution(prev => ({ ...prev, createNewL2: false }))}
                    className="px-2 py-2 text-gray-500 hover:text-gray-700"
                  >
                    <Icon name="X" size={16} />
                  </button>
                </div>
              ) : (
                <select
                  value={resolution?.categoryL2Id || ''}
                  onChange={(e) => {
                    if (e?.target?.value === '__CREATE_NEW__') {
                      setResolution(prev => ({ ...prev, createNewL2: true, categoryL2Id: '' }));
                    } else {
                      setResolution(prev => ({ ...prev, categoryL2Id: e?.target?.value, categoryL3Id: '' }));
                    }
                  }}
                  disabled={!resolution?.categoryL1Id}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                >
                  <option value="">Select Category...</option>
                  {categoriesL2?.map(cat => (
                    <option key={cat?.id} value={cat?.id}>{cat?.name}</option>
                  ))}
                  <option value="__CREATE_NEW__">+ Create new Category...</option>
                </select>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Sub-Category (optional)
              </label>
              {resolution?.createNewL3 ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={resolution?.newL3Name || ''}
                    onChange={(e) => setResolution(prev => ({ ...prev, newL3Name: e?.target?.value }))}
                    placeholder="New Sub-Category name"
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={() => setResolution(prev => ({ ...prev, createNewL3: false }))}
                    className="px-2 py-2 text-gray-500 hover:text-gray-700"
                  >
                    <Icon name="X" size={16} />
                  </button>
                </div>
              ) : (
                <select
                  value={resolution?.categoryL3Id || ''}
                  onChange={(e) => {
                    if (e?.target?.value === '__CREATE_NEW__') {
                      setResolution(prev => ({ ...prev, createNewL3: true, categoryL3Id: '' }));
                    } else {
                      setResolution(prev => ({ ...prev, categoryL3Id: e?.target?.value }));
                    }
                  }}
                  disabled={!resolution?.categoryL2Id || resolution?.createNewL2}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                >
                  <option value="">None / Leave blank</option>
                  {categoriesL3?.map(cat => (
                    <option key={cat?.id} value={cat?.id}>{cat?.name}</option>
                  ))}
                  <option value="__CREATE_NEW__">+ Create new Sub-Category...</option>
                </select>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 px-6 py-4 flex items-center justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onApply(resolution)} disabled={!canApply}>
            Apply to All {group?.rowIndices?.length} Rows
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ExcelImportModal;
