import React, { useState, useEffect } from 'react';
import Button from '../../../components/ui/Button';
import Select from '../../../components/ui/Select';
import Icon from '../../../components/AppIcon';
import { 
  getAllTaxonomyL1, 
  getTaxonomyL2ByL1, 
  getTaxonomyL3ByL2, 
  getTaxonomyL4ByL3 
} from '../utils/taxonomyStorage';
import { saveItem, deleteItem } from '../utils/inventoryStorage';
import { getCurrentUser, hasCommandAccess, hasChiefAccess } from '../../../utils/authStorage';

const BulkActionsModal = ({ selectedItems, items, onClose, onComplete }) => {
  const [action, setAction] = useState(''); // 'move', 'delete'
  const [targetL1, setTargetL1] = useState('');
  const [targetL2, setTargetL2] = useState('');
  const [targetL3, setTargetL3] = useState('');
  const [targetL4, setTargetL4] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [taxonomyL1, setTaxonomyL1] = useState([]);
  const [taxonomyL2, setTaxonomyL2] = useState([]);
  const [taxonomyL3, setTaxonomyL3] = useState([]);
  const [taxonomyL4, setTaxonomyL4] = useState([]);

  const currentUser = getCurrentUser();
  const canDelete = hasCommandAccess(currentUser) || hasChiefAccess(currentUser);

  const selectedItemsData = items?.filter(item => selectedItems?.includes(item?.id));

  useEffect(() => {
    setTaxonomyL1(getAllTaxonomyL1());
  }, []);

  useEffect(() => {
    if (targetL1) {
      setTaxonomyL2(getTaxonomyL2ByL1(targetL1));
      setTargetL2('');
      setTargetL3('');
      setTargetL4('');
    }
  }, [targetL1]);

  useEffect(() => {
    if (targetL2) {
      setTaxonomyL3(getTaxonomyL3ByL2(targetL2));
      setTargetL3('');
      setTargetL4('');
    }
  }, [targetL2]);

  useEffect(() => {
    if (targetL3) {
      setTaxonomyL4(getTaxonomyL4ByL3(targetL3));
      setTargetL4('');
    }
  }, [targetL3]);

  const handleMove = async () => {
    if (!targetL1) {
      alert('Please select at least a Level 1 category');
      return;
    }

    setIsProcessing(true);
    for (const item of selectedItemsData) {
      saveItem({
        ...item,
        l1Id: targetL1,
        l2Id: targetL2 || null,
        l3Id: targetL3 || null,
        l4Id: targetL4 || null
      });
    }
    setIsProcessing(false);
    onComplete?.();
    onClose();
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    if (!canDelete) {
      alert('You do not have permission to delete items');
      return;
    }

    setIsProcessing(true);
    for (const itemId of selectedItems) {
      deleteItem(itemId);
    }
    setIsProcessing(false);
    onComplete?.();
    onClose();
  };

  const handleExecute = () => {
    switch (action) {
      case 'move':
        handleMove();
        break;
      case 'delete':
        handleDelete();
        break;
      default:
        break;
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">
            Bulk Actions ({selectedItems?.length} items)
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <Icon name="X" size={20} className="text-gray-600" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Action Selection */}
          {!action && (
            <div className="space-y-3">
              <button
                onClick={() => setAction('move')}
                className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-all text-left"
              >
                <div className="flex items-center gap-3">
                  <Icon name="FolderTree" size={24} className="text-blue-600" />
                  <div>
                    <h3 className="font-semibold text-gray-900">Move Items</h3>
                    <p className="text-sm text-gray-600">Change taxonomy category</p>
                  </div>
                </div>
              </button>
              {canDelete && (
                <button
                  onClick={() => setAction('delete')}
                  className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-red-500 hover:bg-red-50 transition-all text-left"
                >
                  <div className="flex items-center gap-3">
                    <Icon name="Trash2" size={24} className="text-red-600" />
                    <div>
                      <h3 className="font-semibold text-gray-900">Delete Items</h3>
                      <p className="text-sm text-gray-600">Permanently remove items</p>
                    </div>
                  </div>
                </button>
              )}
            </div>
          )}

          {/* Move Action */}
          {action === 'move' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Level 1 Category *</label>
                <Select
                  value={targetL1}
                  onChange={(e) => setTargetL1(e?.target?.value)}
                  options={[
                    { value: '', label: 'Select L1...' },
                    ...taxonomyL1?.map(cat => ({ value: cat?.id, label: cat?.name }))
                  ]}
                />
              </div>
              {targetL1 && taxonomyL2?.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Level 2 Category</label>
                  <Select
                    value={targetL2}
                    onChange={(e) => setTargetL2(e?.target?.value)}
                    options={[
                      { value: '', label: 'Select L2...' },
                      ...taxonomyL2?.map(cat => ({ value: cat?.id, label: cat?.name }))
                    ]}
                  />
                </div>
              )}
              {targetL2 && taxonomyL3?.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Level 3 Category</label>
                  <Select
                    value={targetL3}
                    onChange={(e) => setTargetL3(e?.target?.value)}
                    options={[
                      { value: '', label: 'Select L3...' },
                      ...taxonomyL3?.map(cat => ({ value: cat?.id, label: cat?.name }))
                    ]}
                  />
                </div>
              )}
              {targetL3 && taxonomyL4?.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Level 4 Category</label>
                  <Select
                    value={targetL4}
                    onChange={(e) => setTargetL4(e?.target?.value)}
                    options={[
                      { value: '', label: 'Select L4...' },
                      ...taxonomyL4?.map(cat => ({ value: cat?.id, label: cat?.name }))
                    ]}
                  />
                </div>
              )}
            </div>
          )}

          {/* Delete Action */}
          {action === 'delete' && (
            <div className="space-y-4">
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-800 font-medium">⚠️ Warning: This action cannot be undone</p>
                <p className="text-red-700 text-sm mt-2">
                  You are about to permanently delete {selectedItems?.length} item(s).
                </p>
              </div>
              {!confirmDelete && (
                <p className="text-gray-600 text-sm">Click Delete again to confirm.</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3">
          <Button
            onClick={onClose}
            variant="outline"
            disabled={isProcessing}
          >
            Cancel
          </Button>
          {action && (
            <Button
              onClick={handleExecute}
              disabled={isProcessing}
              className={action === 'delete' ? 'bg-red-600 hover:bg-red-700' : ''}
            >
              {isProcessing ? 'Processing...' : action === 'delete' ? 'Delete' : 'Move'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default BulkActionsModal;