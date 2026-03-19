import React, { useState, useEffect } from 'react';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Icon from '../../../components/AppIcon';
import { showToast } from '../../../utils/toast';
import { addItineraryDay, updateItineraryDay } from '../../trips-management-dashboard/utils/tripStorage';

const AddEditDayModal = ({ isOpen, onClose, tripId, editingDay, suggestedDate }) => {
  const [formData, setFormData] = useState({
    date: '',
    locationTitle: '',
    stopType: 'ANCHOR',
    stopDetail: '',
    notes: '',
    mapImageUrl: ''
  });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (isOpen) {
      if (editingDay) {
        setFormData({
          date: editingDay?.date || '',
          locationTitle: editingDay?.locationTitle || '',
          stopType: editingDay?.stopType || 'ANCHOR',
          stopDetail: editingDay?.stopDetail || '',
          notes: editingDay?.notes || '',
          mapImageUrl: editingDay?.mapImageUrl || ''
        });
      } else {
        setFormData({
          date: suggestedDate || '',
          locationTitle: '',
          stopType: 'ANCHOR',
          stopDetail: '',
          notes: '',
          mapImageUrl: ''
        });
      }
      setErrors({});
    }
  }, [isOpen, editingDay, suggestedDate]);

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

    if (!formData?.locationTitle?.trim()) {
      newErrors.locationTitle = 'Location is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors)?.length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;

    if (editingDay) {
      const updated = updateItineraryDay(tripId, editingDay?.id, formData);
      if (updated) {
        showToast('Itinerary day updated successfully', 'success');
        onClose();
      } else {
        showToast('Failed to update itinerary day', 'error');
      }
    } else {
      const created = addItineraryDay(tripId, formData);
      if (created) {
        showToast('Itinerary day added successfully', 'success');
        onClose();
      } else {
        showToast('Failed to add itinerary day', 'error');
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-semibold text-foreground">
            {editingDay ? 'Edit Itinerary Day' : 'Add Itinerary Day'}
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

          {/* Location */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Location <span className="text-destructive">*</span>
            </label>
            <Input
              value={formData?.locationTitle}
              onChange={(e) => handleChange('locationTitle', e?.target?.value)}
              placeholder="e.g., St Martin"
              error={errors?.locationTitle}
            />
          </div>

          {/* Stop Type */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Stop Type <span className="text-destructive">*</span>
            </label>
            <div className="flex gap-3">
              {['DOCK', 'ANCHOR', 'UNDERWAY']?.map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => handleChange('stopType', type)}
                  className={`flex-1 px-4 py-3 rounded-lg border transition-smooth ${
                    formData?.stopType === type
                      ? 'border-primary bg-primary/10 text-primary font-medium' :'border-border bg-card text-foreground hover:border-primary/50'
                  }`}
                >
                  {type === 'DOCK' && <Icon name="Anchor" size={16} className="inline mr-2" />}
                  {type === 'ANCHOR' && <Icon name="Anchor" size={16} className="inline mr-2" />}
                  {type === 'UNDERWAY' && <Icon name="Ship" size={16} className="inline mr-2" />}
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Stop Detail */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Stop Detail (Optional)
            </label>
            <Input
              value={formData?.stopDetail}
              onChange={(e) => handleChange('stopDetail', e?.target?.value)}
              placeholder="e.g., St Martin Anchorage, Nassau Marine"
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
              placeholder="e.g., Evening cruise, Pick up"
              rows={3}
              className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-smooth"
            />
          </div>

          {/* Map Image URL (optional) */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Map Image URL (Optional)
            </label>
            <Input
              value={formData?.mapImageUrl}
              onChange={(e) => handleChange('mapImageUrl', e?.target?.value)}
              placeholder="https://example.com/map.jpg"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Leave empty to use default placeholder
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>
            {editingDay ? 'Save Changes' : 'Add Day'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AddEditDayModal;