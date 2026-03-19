import React, { useState, useEffect } from 'react';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Icon from '../../../components/AppIcon';
import { showToast } from '../../../utils/toast';
import { addSpecialRequest, updateSpecialRequest, SpecialRequestStatus } from '../../trips-management-dashboard/utils/tripStorage';

const AddSpecialRequestModal = ({ isOpen, onClose, onSave, tripId, guests, editingRequest }) => {
  const [formData, setFormData] = useState({
    title: '',
    guestId: null,
    status: SpecialRequestStatus?.PLANNED,
    dueDate: '',
    notes: '',
    attachments: []
  });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (isOpen) {
      if (editingRequest) {
        setFormData({
          title: editingRequest?.title || '',
          guestId: editingRequest?.guestId || null,
          status: editingRequest?.status || SpecialRequestStatus?.PLANNED,
          dueDate: editingRequest?.dueDate || '',
          notes: editingRequest?.notes || '',
          attachments: editingRequest?.attachments || []
        });
      } else {
        setFormData({
          title: '',
          guestId: null,
          status: SpecialRequestStatus?.PLANNED,
          dueDate: '',
          notes: '',
          attachments: []
        });
      }
      setErrors({});
    }
  }, [isOpen, editingRequest]);

  if (!isOpen) return null;

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors?.[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  const validate = () => {
    const newErrors = {};

    if (!formData?.title?.trim()) {
      newErrors.title = 'Title is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors)?.length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;

    if (editingRequest) {
      const updated = updateSpecialRequest(tripId, editingRequest?.id, formData);
      if (updated) {
        showToast('Request updated successfully', 'success');
        onSave();
      } else {
        showToast('Failed to update request', 'error');
      }
    } else {
      const created = addSpecialRequest(tripId, formData);
      if (created) {
        showToast('Request added successfully', 'success');
        onSave();
      } else {
        showToast('Failed to add request', 'error');
      }
    }
  };

  const statusOptions = [
    { value: SpecialRequestStatus?.PLANNED, label: 'Planned' },
    { value: SpecialRequestStatus?.IN_PROGRESS, label: 'In progress' },
    { value: SpecialRequestStatus?.DONE, label: 'Done' }
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
            {editingRequest ? 'Edit Special Request' : 'Add Special Request'}
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
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Title <span className="text-destructive">*</span>
            </label>
            <Input
              value={formData?.title}
              onChange={(e) => handleChange('title', e?.target?.value)}
              placeholder="e.g., Arrange private chef dinner"
              error={errors?.title}
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

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Status <span className="text-destructive">*</span>
            </label>
            <Select
              options={statusOptions}
              value={formData?.status}
              onChange={(value) => handleChange('status', value)}
              placeholder="Select status"
            />
          </div>

          {/* Due Date */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Due Date (Optional)
            </label>
            <Input
              type="date"
              value={formData?.dueDate}
              onChange={(e) => handleChange('dueDate', e?.target?.value)}
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
              placeholder="Additional details"
              rows={4}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          {/* Attachments Placeholder */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Attachments (Optional)
            </label>
            <p className="text-xs text-muted-foreground">File upload functionality coming soon.</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>
            {editingRequest ? 'Update Request' : 'Add Request'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AddSpecialRequestModal;