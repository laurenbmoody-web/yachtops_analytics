import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import LogoSpinner from '../../../components/LogoSpinner';
import Button from '../../../components/ui/Button';
import Select from '../../../components/ui/Select';
import { Checkbox } from '../../../components/ui/Checkbox';
import { showToast } from '../../../utils/toast';

import { shareMultipleHORAuditPDFs } from '../utils/horPDFGenerator';

const ExportAuditModal = ({ isOpen, onClose, currentMonth, crewList }) => {
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [crewScope, setCrewScope] = useState('all');
  const [selectedCrewIds, setSelectedCrewIds] = useState([]);
  const [includeAuditTrail, setIncludeAuditTrail] = useState(true);
  const [includeCSV, setIncludeCSV] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedFiles, setGeneratedFiles] = useState([]);
  const [showSuccess, setShowSuccess] = useState(false);

  if (!isOpen) return null;

  const handleCrewToggle = (crewId) => {
    setSelectedCrewIds(prev => {
      if (prev?.includes(crewId)) {
        return prev?.filter(id => id !== crewId);
      } else {
        return [...prev, crewId];
      }
    });
  };

  const handleSelectAll = () => {
    if (selectedCrewIds?.length === crewList?.length) {
      setSelectedCrewIds([]);
    } else {
      setSelectedCrewIds(crewList?.map(c => c?.id));
    }
  };

  const handleGenerate = async () => {
    if (crewScope === 'selected' && selectedCrewIds?.length === 0) {
      showToast('Please select at least one crew member', 'error');
      return;
    }

    setIsGenerating(true);

    try {
      const crewToExport = crewScope === 'all' 
        ? crewList 
        : crewList?.filter(c => selectedCrewIds?.includes(c?.id));

      // Use Web Share API for iOS compatibility
      const results = await shareMultipleHORAuditPDFs(
        crewToExport,
        selectedMonth,
        includeAuditTrail
      );

      const successCount = results?.filter(r => r?.success)?.length;
      const cancelledCount = results?.filter(r => r?.cancelled)?.length;
      
      if (successCount > 0) {
        showToast(`Successfully shared ${successCount} HOR report(s)`, 'success');
      }
      
      if (cancelledCount > 0) {
        showToast(`${cancelledCount} share(s) cancelled`, 'info');
      }
      
      // Handle CSV if requested
      if (includeCSV) {
        await handleCSVExport(crewToExport, selectedMonth);
      }
      
      // Close modal after sharing
      onClose();
    } catch (error) {
      console.error('Export error:', error);
      showToast('Failed to generate export', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCSVExport = async (crew, month) => {
    try {
      const csvBlob = generateCSVSummary(crew, month);
      const csvFileName = `HOR_Summary_${month?.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })?.replace(/\s+/g, '_')}.csv`;
      
      // Use Web Share API for CSV too
      if (navigator?.share && navigator?.canShare) {
        const file = new File([csvBlob], csvFileName, { type: 'text/csv' });
        
        if (navigator?.canShare({ files: [file] })) {
          await navigator?.share({
            files: [file],
            title: 'HOR Summary CSV',
            text: 'Hours of Rest summary report'
          });
          return;
        }
      }
      
      // Fallback: traditional download
      const csvUrl = URL?.createObjectURL(csvBlob);
      const a = document?.createElement('a');
      a.href = csvUrl;
      a.download = csvFileName;
      document?.body?.appendChild(a);
      a?.click();
      document?.body?.removeChild(a);
      URL?.revokeObjectURL(csvUrl);
    } catch (error) {
      console.error('CSV export error:', error);
      showToast('Failed to export CSV', 'error');
    }
  };

  const generateCSVSummary = (crew, month) => {
    const headers = ['Crew Member', 'Department', 'Role', 'Days Logged', 'Last 24h Rest', 'Last 7d Rest', 'Compliance Status'];
    const rows = crew?.map(c => [
      c?.fullName,
      c?.department,
      c?.roleTitle,
      c?.uniqueDatesLogged || 0,
      `${c?.last24HoursRest || 0} hrs`,
      `${c?.last7DaysRest || 0} hrs`,
      c?.overallStatus || 'Unknown'
    ]);

    const csvContent = [
      headers?.join(','),
      ...rows?.map(row => row?.join(','))
    ]?.join('\n');

    return new Blob([csvContent], { type: 'text/csv' });
  };

  const handleDownloadAll = () => {
    // This function is no longer used - sharing happens in handleGenerate
    // Kept for backwards compatibility if referenced elsewhere
    showToast('Use Generate button to share files', 'info');
  };

  const handleDownloadSingle = (file) => {
    // This function is no longer used - sharing happens in handleGenerate
    // Kept for backwards compatibility if referenced elsewhere
    showToast('Use Generate button to share files', 'info');
  };

  const handleClose = () => {
    // Cleanup URLs
    generatedFiles?.forEach(file => {
      if (file?.cleanup) {
        file?.cleanup();
      }
    });
    setGeneratedFiles([]);
    setShowSuccess(false);
    onClose();
  };

  const monthName = selectedMonth?.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 z-40"
        onClick={handleClose}
      />
      {/* Modal */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl z-50 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Export Audit Pack</h2>
              <p className="text-sm text-muted-foreground mt-1">Generate HOR audit reports for crew members</p>
            </div>
            <button
              onClick={handleClose}
              className="p-2 hover:bg-muted rounded-lg transition-smooth"
            >
              <Icon name="X" size={20} className="text-foreground" />
            </button>
          </div>

          {showSuccess ? (
            // Success State
            (<div className="space-y-6">
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-6 text-center">
                <Icon name="CheckCircle" size={48} className="text-green-600 dark:text-green-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-foreground mb-2">Export Complete</h3>
                <p className="text-sm text-muted-foreground">{generatedFiles?.length} file(s) generated successfully</p>
              </div>
              {/* File List */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-foreground mb-3">Generated Files</h4>
                {generatedFiles?.map((file, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3 flex-1">
                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                        <Icon name="FileText" size={20} className="text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{file?.fileName}</p>
                        <p className="text-xs text-gray-500">{(file?.blob?.size / 1024)?.toFixed(1)} KB</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDownloadSingle(file)}
                      className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                      aria-label="Download file"
                    >
                      <Icon name="Download" size={18} className="text-gray-600" />
                    </button>
                  </div>
                ))}
              </div>
              {/* Actions */}
              <div className="flex items-center gap-3">
                <Button onClick={handleDownloadAll} fullWidth>
                  <Icon name="Download" size={18} />
                  Download All
                </Button>
                <Button variant="outline" onClick={handleClose} fullWidth>
                  Close
                </Button>
              </div>
            </div>)
          ) : (
            // Configuration State
            (<div className="space-y-6">
              {/* Month Selector */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Month *</label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const newMonth = new Date(selectedMonth?.getFullYear(), selectedMonth?.getMonth() - 1, 1);
                      setSelectedMonth(newMonth);
                    }}
                    className="p-2 hover:bg-muted rounded-lg transition-smooth"
                  >
                    <Icon name="ChevronLeft" size={18} className="text-foreground" />
                  </button>
                  <span className="flex-1 text-center text-sm font-medium text-foreground">{monthName}</span>
                  <button
                    onClick={() => {
                      const newMonth = new Date(selectedMonth?.getFullYear(), selectedMonth?.getMonth() + 1, 1);
                      const today = new Date();
                      if (newMonth <= today) {
                        setSelectedMonth(newMonth);
                      }
                    }}
                    className="p-2 hover:bg-muted rounded-lg transition-smooth"
                  >
                    <Icon name="ChevronRight" size={18} className="text-foreground" />
                  </button>
                </div>
              </div>
              {/* Crew Scope */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-3">Crew Scope</label>
                <div className="space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="crewScope"
                      value="all"
                      checked={crewScope === 'all'}
                      onChange={(e) => setCrewScope(e?.target?.value)}
                      className="w-4 h-4 text-primary"
                    />
                    <span className="text-sm text-foreground">All crew ({crewList?.length})</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="crewScope"
                      value="selected"
                      checked={crewScope === 'selected'}
                      onChange={(e) => setCrewScope(e?.target?.value)}
                      className="w-4 h-4 text-primary"
                    />
                    <span className="text-sm text-foreground">Selected crew</span>
                  </label>
                </div>
              </div>
              {/* Crew Selection */}
              {crewScope === 'selected' && (
                <div className="bg-muted/30 rounded-xl p-4 max-h-[300px] overflow-y-auto">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-foreground">Select Crew Members</span>
                    <button
                      onClick={handleSelectAll}
                      className="text-xs text-primary hover:underline"
                    >
                      {selectedCrewIds?.length === crewList?.length ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {crewList?.map(crew => (
                      <label key={crew?.id} className="flex items-center gap-3 cursor-pointer hover:bg-muted/50 rounded-lg p-2 transition-smooth">
                        <Checkbox
                          checked={selectedCrewIds?.includes(crew?.id)}
                          onChange={() => handleCrewToggle(crew?.id)}
                        />
                        <div className="flex-1">
                          <div className="text-sm font-medium text-foreground">{crew?.fullName}</div>
                          <div className="text-xs text-muted-foreground">{crew?.roleTitle} • {crew?.department}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {/* Options */}
              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <Checkbox
                    checked={includeAuditTrail}
                    onChange={(e) => setIncludeAuditTrail(e?.target?.checked)}
                  />
                  <div>
                    <div className="text-sm font-medium text-foreground">Include audit trail</div>
                    <div className="text-xs text-muted-foreground">Edits, confirms, locks, correction requests</div>
                  </div>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <Checkbox
                    checked={includeCSV}
                    onChange={(e) => setIncludeCSV(e?.target?.checked)}
                  />
                  <div>
                    <div className="text-sm font-medium text-foreground">Include CSV summary</div>
                    <div className="text-xs text-muted-foreground">Monthly totals in spreadsheet format</div>
                  </div>
                </label>
              </div>
              {/* Actions */}
              <div className="flex items-center gap-3 pt-4 border-t border-border">
                <Button variant="outline" onClick={handleClose} fullWidth>
                  Cancel
                </Button>
                <Button 
                  onClick={handleGenerate} 
                  fullWidth
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <>
                      <LogoSpinner size={18} />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Icon name="Download" size={18} />
                      Generate Export
                    </>
                  )}
                </Button>
              </div>
            </div>)
          )}
        </div>
      </div>
    </>
  );
};

export default ExportAuditModal;