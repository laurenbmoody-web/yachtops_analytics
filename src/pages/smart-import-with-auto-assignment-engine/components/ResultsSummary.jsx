import React from 'react';
import Button from '../../../components/ui/Button';
import Icon from '../../../components/AppIcon';

const ResultsSummary = ({ importResult, onViewInventory, onImportMore }) => {
  const totalItems = importResult?.imported || 0;
  const autoAssigned = importResult?.autoAssigned || 0;
  const manuallyAssigned = totalItems - autoAssigned;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        {/* Success Icon */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-4">
            <Icon name="CheckCircle" size={48} className="text-green-600" />
          </div>
          <h2 className="text-3xl font-bold text-gray-900 mb-2">Import Successful!</h2>
          <p className="text-gray-600">
            {totalItems} {totalItems === 1 ? 'item' : 'items'} imported successfully
          </p>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-6 border border-blue-200">
            <div className="flex items-center gap-3 mb-2">
              <Icon name="Zap" size={24} className="text-blue-600" />
              <h3 className="font-semibold text-gray-900">Auto-Assigned</h3>
            </div>
            <p className="text-3xl font-bold text-blue-600">{autoAssigned}</p>
            <p className="text-sm text-gray-600 mt-1">
              {totalItems > 0 ? Math.round((autoAssigned / totalItems) * 100) : 0}% of total items
            </p>
          </div>

          <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-6 border border-purple-200">
            <div className="flex items-center gap-3 mb-2">
              <Icon name="User" size={24} className="text-purple-600" />
              <h3 className="font-semibold text-gray-900">Manually Assigned</h3>
            </div>
            <p className="text-3xl font-bold text-purple-600">{manuallyAssigned}</p>
            <p className="text-sm text-gray-600 mt-1">
              {totalItems > 0 ? Math.round((manuallyAssigned / totalItems) * 100) : 0}% of total items
            </p>
          </div>
        </div>

        {/* Import Details */}
        <div className="bg-gray-50 rounded-xl p-6 mb-6">
          <h3 className="font-semibold text-gray-900 mb-4">Import Summary</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Total Items Processed</span>
              <span className="font-medium text-gray-900">{totalItems}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Smart Auto-Assignment Rate</span>
              <span className="font-medium text-green-600">
                {totalItems > 0 ? Math.round((autoAssigned / totalItems) * 100) : 0}%
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Import Status</span>
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">
                <Icon name="CheckCircle" size={12} />
                Completed
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3">
          <Button onClick={onViewInventory} className="flex-1" iconName="Package">
            View Inventory
          </Button>
          <Button onClick={onImportMore} variant="outline" className="flex-1" iconName="Upload">
            Import More Items
          </Button>
        </div>
      </div>

      {/* Tips Card */}
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-xl p-6">
        <div className="flex items-start gap-3">
          <Icon name="Lightbulb" size={20} className="text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-gray-900 mb-2">Smart Import Tips</h3>
            <ul className="text-sm text-gray-700 space-y-1">
              <li>• The auto-assignment engine learns from your item names and brands</li>
              <li>• Use consistent naming conventions for better auto-classification</li>
              <li>• Review the Settings → Inventory → Categories page to manage taxonomy</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResultsSummary;