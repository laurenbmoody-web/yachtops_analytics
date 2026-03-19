import React, { useState, useEffect } from 'react';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Icon from '../../../components/AppIcon';
import { showToast } from '../../../utils/toast';
import { addSpecialDate, updateSpecialDate, SpecialDateType } from '../../trips-management-dashboard/utils/tripStorage';

const AddSpecialDateModal = ({ isOpen, onClose, onSave, tripId, guests, editingDate }) => {
  const [formData, setFormData] = useState({
    date: '',
    type: SpecialDateType?.BIRTHDAY,
    guestId: null,
    title: '',
    notes: ''
  });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (isOpen) {
      if (editingDate) {
        setFormData({
          date: editingDate?.date || '',
          type: editingDate?.type || SpecialDateType?.BIRTHDAY,
          guestId: editingDate?.guestId || null,
          title: editingDate?.title || '',
          notes: editingDate?.notes || ''
        });
      } else {
        setFormData({
          date: '',
          type: SpecialDateType?.BIRTHDAY,
          guestId: null,
          title: '',
          notes: ''
        });
      }
      setErrors({});
    }
  }, [isOpen, editingDate]);

  if (!isOpen) return null;

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors?.[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  const validate = () => {
    const newErrors = {};

    if (!formData?.date) {
      newErrors.date = 'Date is required';
    }

    if (!formData?.title?.trim()) {
      newErrors.title = 'Title is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors)?.length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;

    if (editingDate) {
      const updated = updateSpecialDate(tripId, editingDate?.id, formData);
      if (updated) {
        showToast('Special occasion updated successfully', 'success');
        onSave();
      } else {
        showToast('Failed to update special occasion', 'error');
      }
    } else {
      const created = addSpecialDate(tripId, formData);
      if (created) {
        showToast('Special occasion added successfully', 'success');
        onSave();
      } else {
        showToast('Failed to add special occasion', 'error');
      }
    }
  };

  const typeOptions = [
    { value: SpecialDateType?.BIRTHDAY, label: 'Birthday' },
    { value: SpecialDateType?.ANNIVERSARY, label: 'Anniversary' },
    { value: SpecialDateType?.CELEBRATION, label: 'Celebration' },
    { value: SpecialDateType?.OTHER, label: 'Other' }
  ];

  const guestOptions = [
    { value: null, label: 'None (General)' },
    ...guests?.map(g => ({ value: g?.id, label: `${g?.firstName} ${g?.lastName}` }))
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-semibold text-foreground">
            {editingDate ? 'Edit Special Occasion' : 'Add Special Occasion'}
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
          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Date <span className="text-destructive">*</span>
            </label>
            <Input
              type="date"
              value={formData?.date}
              onChange={(e) => handleChange('date', e?.target?.value)}
              error={errors?.date}
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Type <span className="text-destructive">*</span>
            </label>
            <Select
              options={typeOptions}
              value={formData?.type}
              onChange={(value) => handleChange('type', value)}
              placeholder="Select type"
            />
          </div>

          {/* Guest */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Linked Guest (Optional)
            </label>
            <Select
              options={guestOptions}
              value={formData?.guestId}
              onChange={(value) => handleChange('guestId', value)}
              placeholder="Select guest"
            />
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Title <span className="text-destructive">*</span>
            </label>
            <Input
              value={formData?.title}
              onChange={(e) => handleChange('title', e?.target?.value)}
              placeholder="e.g., John's 50th Birthday"
              error={errors?.title}
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Notes (Optional)
            </label>
            <textarea
              value={formData?.notes}
              onChange={(e) => handleChange('notes', e?.target?.value)}
              placeholder="Additional notes"
              rows={3}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>
            {editingDate ? 'Update Occasion' : 'Add Occasion'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AddSpecialDateModal;