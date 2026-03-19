import React, { useState, useEffect } from 'react';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Icon from '../../../components/AppIcon';
import { showToast } from '../../../utils/toast';
import { createPreference, updatePreference, PreferenceCategory, PreferencePriority } from '../../trips-management-dashboard/utils/tripStorage';

const AddPreferenceModal = ({ isOpen, onClose, onSave, tripId, guestId, editingPreference }) => {
  const [formData, setFormData] = useState({
    category: '',
    key: '',
    value: '',
    priority: PreferencePriority?.NORMAL,
    tags: []
  });
  const [errors, setErrors] = useState({});
  const [tagInput, setTagInput] = useState('');

  useEffect(() => {
    if (isOpen) {
      if (editingPreference) {
        setFormData({
          category: editingPreference?.category || '',
          key: editingPreference?.key || '',
          value: editingPreference?.value || '',
          priority: editingPreference?.priority || PreferencePriority?.NORMAL,
          tags: editingPreference?.tags || []
        });
      } else {
        setFormData({
          category: '',
          key: '',
          value: '',
          priority: PreferencePriority?.NORMAL,
          tags: []
        });
      }
      setErrors({});
      setTagInput('');
    }
  }, [isOpen, editingPreference]);

  if (!isOpen) return null;

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors?.[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  const handleAddTag = () => {
    if (tagInput?.trim() && !formData?.tags?.includes(tagInput?.trim())) {
      setFormData(prev => ({
        ...prev,
        tags: [...prev?.tags, tagInput?.trim()]
      }));
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove) => {
    setFormData(prev => ({
      ...prev,
      tags: prev?.tags?.filter(tag => tag !== tagToRemove)
    }));
  };

  const validate = () => {
    const newErrors = {};

    if (!formData?.category) {
      newErrors.category = 'Category is required';
    }

    if (!formData?.key?.trim()) {
      newErrors.key = 'Key is required';
    }

    if (!formData?.value?.trim()) {
      newErrors.value = 'Value is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors)?.length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;

    if (editingPreference) {
      const updated = updatePreference(editingPreference?.id, formData);
      if (updated) {
        showToast('Preference updated successfully', 'success');
        onSave();
      } else {
        showToast('Failed to update preference', 'error');
      }
    } else {
      const newPreference = createPreference({
        ...formData,
        tripId,
        guestId
      });
      if (newPreference) {
        showToast('Preference added successfully', 'success');
        onSave();
      } else {
        showToast('Failed to add preference', 'error');
      }
    }
  };

  const categoryOptions = [
    { value: PreferenceCategory?.FOOD_BEVERAGE, label: 'Food & Beverage' },
    { value: PreferenceCategory?.DIETARY, label: 'Dietary' },
    { value: PreferenceCategory?.WINE_SPIRITS, label: 'Wine/Spirits' },
    { value: PreferenceCategory?.ALLERGIES, label: 'Allergies' },
    { value: PreferenceCategory?.ACTIVITIES, label: 'Activities' },
    { value: PreferenceCategory?.CABIN, label: 'Cabin' },
    { value: PreferenceCategory?.SERVICE, label: 'Service' },
    { value: PreferenceCategory?.OTHER, label: 'Other' }
  ];

  const priorityOptions = [
    { value: PreferencePriority?.LOW, label: 'Low' },
    { value: PreferencePriority?.NORMAL, label: 'Normal' },
    { value: PreferencePriority?.HIGH, label: 'High' }
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-semibold text-foreground">
            {editingPreference ? 'Edit Preference' : 'Add Preference'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
          >
            <Icon name="X" size={20} className="text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Category <span className="text-destructive">*</span>
            </label>
            <Select
              options={categoryOptions}
              value={formData?.category}
              onChange={(value) => handleChange('category', value)}
              placeholder="Select category"
            />
            {errors?.category && (
              <p className="text-sm text-destructive mt-1">{errors?.category}</p>
            )}
          </div>

          {/* Key */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Key <span className="text-destructive">*</span>
            </label>
            <Input
              value={formData?.key}
              onChange={(e) => handleChange('key', e?.target?.value)}
              placeholder="e.g., Coffee"
              error={errors?.key}
            />
          </div>

          {/* Value */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Value <span className="text-destructive">*</span>
            </label>
            <textarea
              value={formData?.value}
              onChange={(e) => handleChange('value', e?.target?.value)}
              placeholder="e.g., Oat milk flat white, 1 sugar"
              rows={3}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
            {errors?.value && (
              <p className="text-sm text-destructive mt-1">{errors?.value}</p>
            )}
          </div>

          {/* Priority */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Priority (Optional)
            </label>
            <Select
              options={priorityOptions}
              value={formData?.priority}
              onChange={(value) => handleChange('priority', value)}
              placeholder="Select priority"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Tags (Optional)
            </label>
            <div className="flex gap-2 mb-2">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e?.target?.value)}
                placeholder="Add a tag"
                onKeyPress={(e) => {
                  if (e?.key === 'Enter') {
                    e?.preventDefault();
                    handleAddTag();
                  }
                }}
              />
              <Button onClick={handleAddTag} variant="outline" className="flex-shrink-0">
                Add
              </Button>
            </div>
            {formData?.tags?.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {formData?.tags?.map((tag, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-muted text-foreground rounded-full text-sm"
                  >
                    {tag}
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      className="hover:text-destructive transition-smooth"
                    >
                      <Icon name="X" size={14} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>
            {editingPreference ? 'Update Preference' : 'Add Preference'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AddPreferenceModal;