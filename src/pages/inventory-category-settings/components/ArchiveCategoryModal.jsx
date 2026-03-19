import React, { useState } from 'react';
import Button from '../../../components/ui/Button';
import Icon from '../../../components/AppIcon';
import { archiveCategoryL2, archiveCategoryL3, getItemCountForCategoryL2, getItemCountForCategoryL3 } from '../../inventory/utils/taxonomyStorage';

const ArchiveCategoryModal = ({ level, category, onClose, onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const itemCount = level === 'L2' 
    ? getItemCountForCategoryL2(category?.id)
    : getItemCountForCategoryL3(category?.id);

  const handleArchive = async () => {
    setError('');
    setLoading(true);
    try {
      if (level === 'L2') {
        archiveCategoryL2(category?.id);
      } else if (level === 'L3') {
        archiveCategoryL3(category?.id);
      }
      onSuccess?.();
    } catch (err) {
      setError(err?.message || 'Failed to archive category');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-xl font-bold text-gray-900">Archive Category</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <Icon name="X" size={24} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex gap-2">
              <Icon name="AlertTriangle" size={20} className="text-yellow-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-yellow-900">
                <p className="font-medium mb-2">Archive Category: {category?.name}</p>
                <ul className="space-y-1 text-yellow-800">
                  <li>• This category will be hidden from Add/Edit Item dropdowns</li>
                  <li>• Existing items ({itemCount}) will remain attached to this category</li>
                  <li>• No inventory items will be deleted</li>
                  <li>• You can view archived items in the inventory list</li>
                </ul>
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              fullWidth
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="warning"
              onClick={handleArchive}
              fullWidth
              loading={loading}
              disabled={loading}
            >
              Archive Category
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ArchiveCategoryModal;