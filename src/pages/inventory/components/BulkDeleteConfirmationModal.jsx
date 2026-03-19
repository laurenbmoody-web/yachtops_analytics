import React, { useState } from 'react';
import Button from '../../../components/ui/Button';
import { Checkbox } from '../../../components/ui/Checkbox';
import Icon from '../../../components/AppIcon';

const BulkDeleteConfirmationModal = ({ scope, itemCount, onConfirm, onClose }) => {
  const [typedConfirmation, setTypedConfirmation] = useState('');
  const [understood, setUnderstood] = useState(false);

  const canDelete = typedConfirmation === 'DELETE' && understood;

  const handleConfirm = () => {
    if (canDelete) {
      onConfirm();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
        <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">Confirm Bulk Delete</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <Icon name="X" size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Warning Message */}
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Icon name="AlertCircle" size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-900 mb-2">
                  You are about to delete {itemCount} item{itemCount !== 1 ? 's' : ''} from:
                </p>
                <div className="text-sm text-red-800 space-y-1">
                  {scope?.categoryL1Name && (
                    <p><span className="font-medium">Category:</span> {scope?.categoryL1Name}</p>
                  )}
                  {scope?.categoryL2Name && (
                    <p><span className="font-medium">Subcategory L2:</span> {scope?.categoryL2Name}</p>
                  )}
                  {scope?.categoryL3Name && (
                    <p><span className="font-medium">Subcategory L3:</span> {scope?.categoryL3Name}</p>
                  )}
                </div>
                <p className="text-sm font-semibold text-red-900 mt-3">
                  This action cannot be undone.
                </p>
              </div>
            </div>
          </div>

          {/* Typed Confirmation */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Type <span className="font-mono font-bold text-red-600">DELETE</span> to confirm:
            </label>
            <input
              type="text"
              value={typedConfirmation}
              onChange={(e) => setTypedConfirmation(e?.target?.value)}
              placeholder="Type DELETE"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              autoFocus
            />
          </div>

          {/* Understanding Checkbox */}
          <div className="flex items-start gap-3">
            <Checkbox
              checked={understood}
              onChange={(e) => setUnderstood(e?.target?.checked)}
              className="mt-0.5"
            />
            <label className="text-sm text-gray-700 cursor-pointer" onClick={() => setUnderstood(!understood)}>
              I understand this will permanently delete these items.
            </label>
          </div>
        </div>

        <div className="border-t border-gray-200 px-6 py-4 flex items-center justify-end gap-3">
          <Button onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canDelete}
            className={`${
              canDelete
                ? 'bg-red-600 hover:bg-red-700 text-white' :'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            Delete {itemCount} Item{itemCount !== 1 ? 's' : ''}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default BulkDeleteConfirmationModal;