import React, { useState } from 'react';
import Button from '../../../components/ui/Button';
import Icon from '../../../components/AppIcon';
import Select from '../../../components/ui/Select';
import { getAllTaxonomyL1, getTaxonomyL2ByL1 } from '../../inventory/utils/taxonomyStorage';

const ClassificationPreview = ({
  autoAssignedRows,
  needsReviewRows,
  rowResolutions,
  allRowsResolved,
  onResolutionChange,
  onProcessImport,
  onCancel
}) => {
  const [activeTab, setActiveTab] = useState('auto-assigned');
  const [expandedRows, setExpandedRows] = useState({});

  const taxonomyL1 = getAllTaxonomyL1();

  const toggleRowExpansion = (rowIndex) => {
    setExpandedRows(prev => ({
      ...prev,
      [rowIndex]: !prev?.[rowIndex]
    }));
  };

  const getConfidenceBadge = (row) => {
    if (!row?.autoAssigned) return null;
    
    // High confidence: keyword match
    const confidence = row?.matchedKeyword ? 'high' : 'medium';
    
    if (confidence === 'high') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">
          <Icon name="CheckCircle" size={12} />
          High Confidence
        </span>
      );
    }
    
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-medium rounded-full">
        <Icon name="AlertCircle" size={12} />
        Medium Confidence
      </span>
    );
  };

  const getTaxonomyL2Options = (l1Id) => {
    if (!l1Id) return [];
    const l2Categories = getTaxonomyL2ByL1(l1Id);
    return l2Categories?.map(cat => ({ value: cat?.id, label: cat?.name }));
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
              <Icon name="FileSpreadsheet" size={24} className="text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Total Items</p>
              <p className="text-2xl font-bold text-gray-900">
                {autoAssignedRows?.length + needsReviewRows?.length}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
              <Icon name="CheckCircle" size={24} className="text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Auto-Assigned</p>
              <p className="text-2xl font-bold text-gray-900">{autoAssignedRows?.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
              <Icon name="AlertCircle" size={24} className="text-orange-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Needs Review</p>
              <p className="text-2xl font-bold text-gray-900">{needsReviewRows?.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="border-b border-gray-200">
          <div className="flex">
            <button
              onClick={() => setActiveTab('auto-assigned')}
              className={`flex-1 px-6 py-4 text-sm font-medium transition-colors ${
                activeTab === 'auto-assigned' ?'text-blue-600 border-b-2 border-blue-600' :'text-gray-600 hover:text-gray-900'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <Icon name="CheckCircle" size={16} />
                Auto-Assigned ({autoAssignedRows?.length})
              </div>
            </button>
            <button
              onClick={() => setActiveTab('needs-review')}
              className={`flex-1 px-6 py-4 text-sm font-medium transition-colors ${
                activeTab === 'needs-review' ?'text-orange-600 border-b-2 border-orange-600' :'text-gray-600 hover:text-gray-900'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <Icon name="AlertCircle" size={16} />
                Needs Review ({needsReviewRows?.length})
              </div>
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'auto-assigned' && (
            <div className="space-y-3">
              {autoAssignedRows?.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <Icon name="Inbox" size={48} className="mx-auto mb-3 text-gray-400" />
                  <p>No auto-assigned items</p>
                </div>
              ) : (
                autoAssignedRows?.map((row, index) => (
                  <div
                    key={index}
                    className="border border-gray-200 rounded-xl p-4 hover:border-gray-300 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="font-semibold text-gray-900">{row?.rawData?.itemName}</h3>
                          {getConfidenceBadge(row)}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <span className="font-medium">{row?.resolvedTaxonomy?.l1Name}</span>
                          <Icon name="ChevronRight" size={12} />
                          <span className="font-medium">{row?.resolvedTaxonomy?.l2Name}</span>
                          <Icon name="ChevronRight" size={12} />
                          <span>{row?.resolvedTaxonomy?.l3Name || 'General'}</span>
                        </div>
                        {row?.matchedKeyword && (
                          <p className="text-xs text-gray-500 mt-1">
                            Matched keyword: "{row?.matchedKeyword}"
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'needs-review' && (
            <div className="space-y-3">
              {needsReviewRows?.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <Icon name="CheckCircle" size={48} className="mx-auto mb-3 text-green-400" />
                  <p className="font-medium text-gray-900">All items auto-assigned!</p>
                  <p className="text-sm">No manual review required</p>
                </div>
              ) : (
                needsReviewRows?.map((row, rowIndex) => {
                  const actualIndex = autoAssignedRows?.length + rowIndex;
                  const resolution = rowResolutions?.[actualIndex] || {};
                  const isExpanded = expandedRows?.[actualIndex];

                  return (
                    <div
                      key={actualIndex}
                      className="border-2 border-orange-200 rounded-xl p-4 bg-orange-50"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <h3 className="font-semibold text-gray-900 mb-1">
                            {row?.rawData?.itemName}
                          </h3>
                          <p className="text-sm text-gray-600">
                            Could not auto-assign - please select taxonomy
                          </p>
                        </div>
                        <button
                          onClick={() => toggleRowExpansion(actualIndex)}
                          className="text-orange-600 hover:text-orange-700"
                        >
                          <Icon name={isExpanded ? 'ChevronUp' : 'ChevronDown'} size={20} />
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="space-y-3 pt-3 border-t border-orange-200">
                          <Select
                            label="L1 Operational Domain"
                            required
                            value={resolution?.categoryL1Id || ''}
                            onChange={(e) => onResolutionChange(actualIndex, 'categoryL1Id', e?.target?.value)}
                            options={[
                              { value: '', label: 'Select L1 Domain...' },
                              ...taxonomyL1?.map(cat => ({ value: cat?.id, label: cat?.name }))
                            ]}
                          />

                          {resolution?.categoryL1Id && (
                            <Select
                              label="L2 Category"
                              required
                              value={resolution?.categoryL2Id || ''}
                              onChange={(e) => onResolutionChange(actualIndex, 'categoryL2Id', e?.target?.value)}
                              options={[
                                { value: '', label: 'Select L2 Category...' },
                                ...getTaxonomyL2Options(resolution?.categoryL1Id)
                              ]}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-between bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          onClick={onProcessImport}
          disabled={!allRowsResolved}
          iconName="Upload"
        >
          Process Import ({autoAssignedRows?.length + needsReviewRows?.length} items)
        </Button>
      </div>

      {!allRowsResolved && needsReviewRows?.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-start gap-3">
          <Icon name="AlertCircle" size={20} className="text-orange-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-orange-900 mb-1">Action Required</p>
            <p className="text-sm text-orange-700">
              Please review and assign taxonomy for all items marked "Needs Review" before processing the import.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClassificationPreview;