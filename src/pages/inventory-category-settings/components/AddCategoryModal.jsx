import React, { useState } from 'react';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Icon from '../../../components/AppIcon';
import { createCategoryL2, createCategoryL3 } from '../../inventory/utils/taxonomyStorage';

const AddCategoryModal = ({ level, parentId, parentL1Id, parentL2Id, onClose, onSuccess }) => {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    setError('');

    if (!name?.trim()) {
      setError('Category name is required');
      return;
    }

    setLoading(true);
    try {
      if (level === 'L2') {
        createCategoryL2(parentId, name?.trim());
      } else if (level === 'L3') {
        createCategoryL3(parentL1Id, parentL2Id, name?.trim());
      }
      onSuccess?.();
    } catch (err) {
      setError(err?.message || 'Failed to create category');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-xl font-bold text-gray-900">
            Add Level {level === 'L2' ? '2' : '3'} Subcategory
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <Icon name="X" size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <Input
            label="Category Name"
            required
            value={name}
            onChange={(e) => setName(e?.target?.value)}
            error={error}
            placeholder="Enter category name"
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
              Add Category
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddCategoryModal;