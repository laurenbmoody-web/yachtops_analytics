import React from 'react';
import Button from '../../../components/ui/Button';
import Icon from '../../../components/AppIcon';

const UploadZone = ({
  isDragging,
  fileName,
  fileSize,
  error,
  onDragOver,
  onDragLeave,
  onDrop,
  onUploadClick
}) => {
  return (
    <div className="max-w-4xl mx-auto">
      {/* Upload Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
            <Icon name="Upload" size={32} className="text-blue-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Upload Inventory File</h2>
          <p className="text-gray-600">
            Upload a CSV file (.csv) using the Cargo Inventory Template
          </p>
        </div>

        {/* Drag & Drop Zone */}
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={`border-2 border-dashed rounded-xl p-12 transition-all ${
            isDragging
              ? 'border-blue-500 bg-blue-50' :'border-gray-300 bg-gray-50 hover:border-gray-400'
          }`}
        >
          <div className="text-center">
            <Icon
              name="FileSpreadsheet"
              size={48}
              className={`mx-auto mb-4 ${
                isDragging ? 'text-blue-600' : 'text-gray-400'
              }`}
            />
            <p className="text-lg font-medium text-gray-900 mb-2">
              {isDragging ? 'Drop file here' : 'Drag and drop your file here'}
            </p>
            <p className="text-sm text-gray-500 mb-4">or</p>
            <Button onClick={onUploadClick} iconName="Upload">
              Browse Files
            </Button>
          </div>
        </div>

        {/* File Info */}
        {fileName && !error && (
          <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-xl flex items-center gap-3">
            <Icon name="CheckCircle" size={24} className="text-green-600" />
            <div className="flex-1">
              <p className="font-medium text-gray-900">{fileName}</p>
              <p className="text-sm text-gray-600">{fileSize}</p>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
            <Icon name="AlertCircle" size={24} className="text-red-600 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-red-900 mb-1">Upload Failed</p>
              <p className="text-sm text-red-700">{error}</p>
            </div>
          </div>
        )}

        {/* Template Info */}
        <div className="mt-8 p-6 bg-blue-50 border border-blue-200 rounded-xl">
          <div className="flex items-start gap-3">
            <Icon name="Info" size={20} className="text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Template Requirements</h3>
              <ul className="text-sm text-gray-700 space-y-1">
                <li>• File must be in CSV format (.csv)</li>
                <li>• Required column: "Item Name"</li>
                <li>• Optional columns: Category, Subcategory L2, Subcategory L3, Notes, Unit, Photo, Usage Department</li>
                <li>• Smart engine will auto-assign items to L1/L2 categories based on keywords</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Feature Highlights */}
      <div className="grid grid-cols-3 gap-4 mt-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-purple-100 rounded-full mb-3">
            <Icon name="Zap" size={24} className="text-purple-600" />
          </div>
          <h3 className="font-semibold text-gray-900 mb-1">Smart Detection</h3>
          <p className="text-sm text-gray-600">
            Automatically assigns items to correct L1/L2 categories using keyword analysis
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-green-100 rounded-full mb-3">
            <Icon name="Target" size={24} className="text-green-600" />
          </div>
          <h3 className="font-semibold text-gray-900 mb-1">Confidence Scoring</h3>
          <p className="text-sm text-gray-600">
            Real-time confidence indicators show high, medium, and low match quality
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-orange-100 rounded-full mb-3">
            <Icon name="Shield" size={24} className="text-orange-600" />
          </div>
          <h3 className="font-semibold text-gray-900 mb-1">No Random Categories</h3>
          <p className="text-sm text-gray-600">
            Prevents creation of junk categories by enforcing preset taxonomy structure
          </p>
        </div>
      </div>
    </div>
  );
};

export default UploadZone;