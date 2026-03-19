import React, { useState, useEffect } from 'react';
import Button from '../../../components/ui/Button';
import Icon from '../../../components/AppIcon';
import Select from '../../../components/ui/Select';
import { getAllTaxonomyL1, getTaxonomyL2ByL1, getTaxonomyL3ByL2, getTaxonomyL4ByL3 } from '../utils/taxonomyStorage';
import { getItemsByTaxonomy, getAllItems } from '../utils/inventoryStorage';
import { generateInventoryPDF } from '../utils/pdfExportGenerator';
import { getDepartmentScope, filterByDepartmentScope } from '../../../utils/departmentScopeStorage';
import { getCurrentUser } from '../../../utils/authStorage';
import { canViewCost } from '../../../utils/costPermissions';

const ExportInventoryModal = ({ onClose, currentTaxonomyPath, currentItems, searchQuery }) => {
  const [scope, setScope] = useState('current');
  const [includeImages, setIncludeImages] = useState(false);
  const [includeCost, setIncludeCost] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showActionModal, setShowActionModal] = useState(false);
  const [generatedPdfBlob, setGeneratedPdfBlob] = useState(null);
  const [generatedFileName, setGeneratedFileName] = useState('');
  const [emailAddress, setEmailAddress] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);

  // Section selector state
  const [selectedL1, setSelectedL1] = useState('');
  const [selectedL2, setSelectedL2] = useState('');
  const [selectedL3, setSelectedL3] = useState('');
  const [selectedL4, setSelectedL4] = useState('');

  const [taxonomyL1, setTaxonomyL1] = useState([]);
  const [taxonomyL2, setTaxonomyL2] = useState([]);
  const [taxonomyL3, setTaxonomyL3] = useState([]);
  const [taxonomyL4, setTaxonomyL4] = useState([]);

  const currentUser = getCurrentUser();
  const departmentFilter = getDepartmentScope();
  const canSeeCost = canViewCost();

  useEffect(() => {
    setTaxonomyL1(getAllTaxonomyL1());
  }, []);

  useEffect(() => {
    if (selectedL1) {
      setTaxonomyL2(getTaxonomyL2ByL1(selectedL1));
      setSelectedL2('');
      setSelectedL3('');
      setSelectedL4('');
    } else {
      setTaxonomyL2([]);
      setTaxonomyL3([]);
      setTaxonomyL4([]);
    }
  }, [selectedL1]);

  useEffect(() => {
    if (selectedL2) {
      setTaxonomyL3(getTaxonomyL3ByL2(selectedL2));
      setSelectedL3('');
      setSelectedL4('');
    } else {
      setTaxonomyL3([]);
      setTaxonomyL4([]);
    }
  }, [selectedL2]);

  useEffect(() => {
    if (selectedL3) {
      setTaxonomyL4(getTaxonomyL4ByL3(selectedL3));
      setSelectedL4('');
    } else {
      setTaxonomyL4([]);
    }
  }, [selectedL3]);

  const handleGeneratePDF = async () => {
    setIsGenerating(true);

    try {
      let itemsToExport = [];
      let taxonomyPath = {};
      let exportScope = scope;

      if (scope === 'current') {
        // Export current view
        itemsToExport = currentItems || [];
        taxonomyPath = currentTaxonomyPath || {};
      } else if (scope === 'entire') {
        // Export entire inventory (with department filter applied)
        const allItems = getAllItems();
        itemsToExport = filterByDepartmentScope(allItems, departmentFilter, currentUser);
        taxonomyPath = {};
      } else if (scope === 'section') {
        // Export chosen section
        if (!selectedL1) {
          alert('Please select at least an Inventory Group');
          setIsGenerating(false);
          return;
        }

        const sectionItems = getItemsByTaxonomy(
          selectedL1,
          selectedL2 || null,
          selectedL3 || null,
          selectedL4 || null
        );

        itemsToExport = filterByDepartmentScope(sectionItems, departmentFilter, currentUser);
        taxonomyPath = {
          l1Id: selectedL1,
          l2Id: selectedL2 || null,
          l3Id: selectedL3 || null,
          l4Id: selectedL4 || null
        };
      }

      // Generate PDF and get blob
      const { blob, fileName } = await generateInventoryPDF(itemsToExport, {
        scope: exportScope,
        taxonomyPath,
        departmentFilter,
        includeImages,
        includeCost,
        searchQuery: scope === 'current' ? searchQuery : '',
        returnBlob: true
      });

      // Try native share first (iOS/Android share sheet)
      await handleNativeShare(blob, fileName);

    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Failed to generate PDF. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleNativeShare = async (blob, fileName) => {
    try {
      // Create File object from blob
      const file = new File([blob], fileName, { type: 'application/pdf' });

      // Check if Web Share API with files is supported
      if (navigator?.canShare && navigator?.canShare({ files: [file] })) {
        // Use native share sheet (iOS/Android)
        await navigator?.share({
          files: [file],
          title: 'Inventory Report',
          text: 'Cargo Inventory PDF'
        });
        
        // Share succeeded or was cancelled - close modal
        onClose();
        return;
      }

      // Fallback A: iOS-friendly - open in new tab with native share controls
      if (/iPad|iPhone|iPod/?.test(navigator?.userAgent)) {
        const url = URL?.createObjectURL(blob);
        window?.open(url, '_blank');
        
        // Clean up after delay
        setTimeout(() => URL?.revokeObjectURL(url), 10000);
        
        onClose();
        return;
      }

      // Fallback B: Download link for other browsers
      const url = URL?.createObjectURL(blob);
      const a = document?.createElement('a');
      a.href = url;
      a.download = fileName;
      document?.body?.appendChild(a);
      a?.click();
      document?.body?.removeChild(a);
      
      // Clean up
      setTimeout(() => URL?.revokeObjectURL(url), 10000);
      
      onClose();
    } catch (error) {
      // User cancelled share or error occurred
      if (error?.name === 'AbortError') {
        // User cancelled - just close modal, no error
        onClose();
      } else {
        console.error('Share failed:', error);
        // Fallback to download
        const url = URL?.createObjectURL(blob);
        const a = document?.createElement('a');
        a.href = url;
        a.download = fileName;
        document?.body?.appendChild(a);
        a?.click();
        document?.body?.removeChild(a);
        setTimeout(() => URL?.revokeObjectURL(url), 10000);
        onClose();
      }
    }
  };

  const handleDownloadPDF = () => {
    if (generatedPdfBlob && generatedFileName) {
      const url = URL.createObjectURL(generatedPdfBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = generatedFileName;
      document.body?.appendChild(link);
      link?.click();
      document.body?.removeChild(link);
      URL.revokeObjectURL(url);
      
      // Close both modals
      setShowActionModal(false);
      onClose();
    }
  };

  const handleSendEmail = async () => {
    if (!emailAddress || !emailAddress?.includes('@')) {
      alert('Please enter a valid email address');
      return;
    }

    setIsSendingEmail(true);

    try {
      // Convert blob to base64
      const reader = new FileReader();
      reader?.readAsDataURL(generatedPdfBlob);
      
      reader.onloadend = () => {
        const base64data = reader?.result;
        
        // Create mailto link with PDF attachment simulation
        // Note: Real email sending requires backend integration
        const subject = encodeURIComponent(`Inventory Report - ${generatedFileName}`);
        const body = encodeURIComponent(
          `Please find attached the inventory report.\n\n` +
          `Note: Due to browser limitations, the PDF cannot be automatically attached. ` +
          `Please download the PDF separately and attach it to your email.\n\n` +
          `Generated: ${new Date()?.toLocaleString()}`
        );
        
        // Open email client
        window.location.href = `mailto:${emailAddress}?subject=${subject}&body=${body}`;
        
        // Also trigger download since we can't actually attach via mailto
        handleDownloadPDF();
        
        alert(
          'Email client opened. Please note: Due to browser security, the PDF must be manually attached.\n\n' + 'The PDF has been downloaded to your device for easy attachment.'
        );
      };
    } catch (error) {
      console.error('Error sending email:', error);
      alert('Failed to prepare email. Please download the PDF and send manually.');
    } finally {
      setIsSendingEmail(false);
    }
  };

  const handleCloseActionModal = () => {
    setShowActionModal(false);
    onClose();
  };

  // Action Modal (shown after PDF generation) - REMOVED, now using native share
  if (showActionModal) {
    return null; // No longer used
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">Export Inventory</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <Icon name="X" size={20} className="text-gray-600" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Body copy */}
          <p className="text-gray-600 text-sm">
            This will generate a PDF of the inventory.
          </p>

          {/* Scope Section */}
          <div className="space-y-3">
            <label className="block text-sm font-semibold text-gray-900">Scope</label>
            
            {/* Current view */}
            <label className="flex items-start gap-3 p-3 border-2 border-gray-200 rounded-lg cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition-all">
              <input
                type="radio"
                name="scope"
                value="current"
                checked={scope === 'current'}
                onChange={(e) => setScope(e?.target?.value)}
                className="mt-0.5 w-4 h-4 text-blue-600 focus:ring-blue-500"
              />
              <div className="flex-1">
                <div className="font-medium text-gray-900">Current view (recommended)</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Exports exactly what you're viewing now, including filters
                </div>
              </div>
            </label>

            {/* Entire inventory */}
            <label className="flex items-start gap-3 p-3 border-2 border-gray-200 rounded-lg cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition-all">
              <input
                type="radio"
                name="scope"
                value="entire"
                checked={scope === 'entire'}
                onChange={(e) => setScope(e?.target?.value)}
                className="mt-0.5 w-4 h-4 text-blue-600 focus:ring-blue-500"
              />
              <div className="flex-1">
                <div className="font-medium text-gray-900">Entire inventory</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Exports all items you have permission to see
                </div>
              </div>
            </label>

            {/* Choose a section */}
            <label className="flex items-start gap-3 p-3 border-2 border-gray-200 rounded-lg cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition-all">
              <input
                type="radio"
                name="scope"
                value="section"
                checked={scope === 'section'}
                onChange={(e) => setScope(e?.target?.value)}
                className="mt-0.5 w-4 h-4 text-blue-600 focus:ring-blue-500"
              />
              <div className="flex-1">
                <div className="font-medium text-gray-900">Choose a section…</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Select a specific section to export
                </div>
              </div>
            </label>

            {/* Section Selector (shown when 'section' is selected) */}
            {scope === 'section' && (
              <div className="ml-7 mt-3 space-y-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                {/* Inventory Group */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Inventory Group</label>
                  <Select
                    value={selectedL1}
                    onChange={(e) => setSelectedL1(e?.target?.value)}
                    className="w-full"
                  >
                    <option value="">Select Inventory Group</option>
                    {taxonomyL1?.map((l1) => (
                      <option key={l1?.id} value={l1?.id}>
                        {l1?.name}
                      </option>
                    ))}
                  </Select>
                </div>

                {/* Category */}
                {selectedL1 && taxonomyL2?.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Category (optional)</label>
                    <Select
                      value={selectedL2}
                      onChange={(e) => setSelectedL2(e?.target?.value)}
                      className="w-full"
                    >
                      <option value="">All Categories</option>
                      {taxonomyL2?.map((l2) => (
                        <option key={l2?.id} value={l2?.id}>
                          {l2?.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}

                {/* Sub-Category */}
                {selectedL2 && taxonomyL3?.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Sub-Category (optional)</label>
                    <Select
                      value={selectedL3}
                      onChange={(e) => setSelectedL3(e?.target?.value)}
                      className="w-full"
                    >
                      <option value="">All Sub-Categories</option>
                      {taxonomyL3?.map((l3) => (
                        <option key={l3?.id} value={l3?.id}>
                          {l3?.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}

                {/* Type */}
                {selectedL3 && taxonomyL4?.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Type (optional)</label>
                    <Select
                      value={selectedL4}
                      onChange={(e) => setSelectedL4(e?.target?.value)}
                      className="w-full"
                    >
                      <option value="">All Types</option>
                      {taxonomyL4?.map((l4) => (
                        <option key={l4?.id} value={l4?.id}>
                          {l4?.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Include images toggle */}
          <div className="space-y-2">
            <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex-1">
                <div className="font-medium text-gray-900 text-sm">Include images</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Including images increases file size
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIncludeImages(!includeImages)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                  includeImages ? 'bg-blue-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    includeImages ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </label>

            {/* Include cost & value toggle - Only visible to Command/Chief/HOD */}
            {canSeeCost && (
              <label className="flex items-center justify-between p-4 bg-green-50 rounded-lg border border-green-200">
                <div className="flex-1">
                  <div className="font-medium text-gray-900 text-sm">Include cost & value</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    Shows unit cost and total value for each item
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIncludeCost(!includeCost)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
                    includeCost ? 'bg-green-600' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      includeCost ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </label>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3">
          <Button onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button
            onClick={handleGeneratePDF}
            disabled={isGenerating}
            loading={isGenerating}
            iconName={isGenerating ? null : 'Download'}
          >
            {isGenerating ? 'Generating...' : 'Generate PDF'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ExportInventoryModal;
