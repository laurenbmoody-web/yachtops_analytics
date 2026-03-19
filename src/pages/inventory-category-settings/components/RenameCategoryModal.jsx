import React, { useState, useEffect } from 'react';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Icon from '../../../components/AppIcon';
import { renameCategoryL1, renameCategoryL2, renameCategoryL3 } from '../../inventory/utils/taxonomyStorage';

const RenameCategoryModal = ({ level, category, onClose, onSuccess }) => {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (category?.name) {
      setName(category?.name);
    }
  }, [category]);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    setError('');

    if (!name?.trim()) {
      setError('Category name is required');
      return;
    }

    if (name?.trim() === category?.name) {
      setError('Please enter a different name');
      return;
    }

    setLoading(true);
    try {
      if (level === 'L1') {
        renameCategoryL1(category?.id, name?.trim());
      } else if (level === 'L2') {
        renameCategoryL2(category?.id, name?.trim());
      } else if (level === 'L3') {
        renameCategoryL3(category?.id, name?.trim());
      }
      onSuccess?.();
    } catch (err) {
      setError(err?.message || 'Failed to rename category');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-xl font-bold text-gray-900">Rename Category</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <Icon name="X" size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">Current Name</div>
            <div className="font-medium text-gray-900">{category?.name}</div>
          </div>

          <Input
            label="New Name"
            required
            value={name}
            onChange={(e) => setName(e?.target?.value)}
            error={error}
            placeholder="Enter new category name"
            autoFocus
          />

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
              type="submit"
              fullWidth
              loading={loading}
              disabled={loading}
            >
              Rename
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RenameCategoryModal;