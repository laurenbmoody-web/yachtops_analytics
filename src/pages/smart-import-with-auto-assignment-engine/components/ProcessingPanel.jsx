import React from 'react';
import Icon from '../../../components/AppIcon';

const ProcessingPanel = () => {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 text-center">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-100 rounded-full mb-6 animate-pulse">
          <Icon name="Loader" size={40} className="text-blue-600 animate-spin" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Processing Import</h2>
        <p className="text-gray-600 mb-8">
          Importing items with intelligent taxonomy assignment...
        </p>

        <div className="space-y-4 text-left max-w-md mx-auto">
          <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
            <Icon name="CheckCircle" size={20} className="text-green-600 flex-shrink-0" />
            <span className="text-sm text-gray-700">Validating taxonomy assignments</span>
          </div>
          <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
            <Icon name="CheckCircle" size={20} className="text-green-600 flex-shrink-0" />
            <span className="text-sm text-gray-700">Creating inventory items</span>
          </div>
          <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <Icon name="Loader" size={20} className="text-blue-600 flex-shrink-0 animate-spin" />
            <span className="text-sm text-gray-700">Finalizing import...</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProcessingPanel;