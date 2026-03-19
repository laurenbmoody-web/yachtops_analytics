import React, { useState, useEffect } from 'react';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Icon from '../../../components/AppIcon';
import { showToast } from '../../../utils/toast';
import { addItineraryDay, updateItineraryDay } from '../../trips-management-dashboard/utils/tripStorage';

const AddItineraryDayModal = ({ isOpen, onClose, onSave, tripId, editingDay }) => {
  const [formData, setFormData] = useState({
    date: '',
    locationTitle: '',
    keyEvents: [],
    guestMovements: [],
    notes: ''
  });
  const [errors, setErrors] = useState({});
  const [keyEventInput, setKeyEventInput] = useState('');
  const [guestMovementInput, setGuestMovementInput] = useState('');

  useEffect(() => {
    if (isOpen) {
      if (editingDay) {
        setFormData({
          date: editingDay?.date || '',
          locationTitle: editingDay?.locationTitle || '',
          keyEvents: editingDay?.keyEvents || [],
          guestMovements: editingDay?.guestMovements || [],
          notes: editingDay?.notes || ''
        });
      } else {
        setFormData({
          date: '',
          locationTitle: '',
          keyEvents: [],
          guestMovements: [],
          notes: ''
        });
      }
      setErrors({});
      setKeyEventInput('');
      setGuestMovementInput('');
    }
  }, [isOpen, editingDay]);

  if (!isOpen) return null;

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors?.[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  const handleAddKeyEvent = () => {
    if (keyEventInput?.trim()) {
      setFormData(prev => ({
        ...prev,
        keyEvents: [...prev?.keyEvents, keyEventInput?.trim()]
      }));
      setKeyEventInput('');
    }
  };

  const handleRemoveKeyEvent = (index) => {
    setFormData(prev => ({
      ...prev,
      keyEvents: prev?.keyEvents?.filter((_, i) => i !== index)
    }));
  };

  const handleAddGuestMovement = () => {
    if (guestMovementInput?.trim()) {
      setFormData(prev => ({
        ...prev,
        guestMovements: [...prev?.guestMovements, guestMovementInput?.trim()]
      }));
      setGuestMovementInput('');
    }
  };

  const handleRemoveGuestMovement = (index) => {
    setFormData(prev => ({
      ...prev,
      guestMovements: prev?.guestMovements?.filter((_, i) => i !== index)
    }));
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
        onSave();
      } else {
        showToast('Failed to update itinerary day', 'error');
      }
    } else {
      const created = addItineraryDay(tripId, formData);
      if (created) {
        showToast('Itinerary day added successfully', 'success');
        onSave();
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
              placeholder="e.g., Porto Cervo"
              error={errors?.locationTitle}
            />
          </div>

          {/* Key Events */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Key Events (Optional)
            </label>
            <div className="flex gap-2 mb-2">
              <Input
                value={keyEventInput}
                onChange={(e) => setKeyEventInput(e?.target?.value)}
                placeholder="Add an event"
                onKeyPress={(e) => {
                  if (e?.key === 'Enter') {
                    e?.preventDefault();
                    handleAddKeyEvent();
                  }
                }}
              />
              <Button onClick={handleAddKeyEvent} variant="outline" className="flex-shrink-0">
                Add
              </Button>
            </div>
            {formData?.keyEvents?.length > 0 && (
              <div className="space-y-1">
                {formData?.keyEvents?.map((event, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-2 bg-muted/30 rounded">
                    <span className="flex-1 text-sm text-foreground">• {event}</span>
                    <button
                      onClick={() => handleRemoveKeyEvent(idx)}
                      className="p-1 hover:bg-destructive/10 rounded transition-smooth"
                    >
                      <Icon name="X" size={14} className="text-destructive" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Guest Movements */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Guest Movements (Optional)
            </label>
            <div className="flex gap-2 mb-2">
              <Input
                value={guestMovementInput}
                onChange={(e) => setGuestMovementInput(e?.target?.value)}
                placeholder="Add a movement"
                onKeyPress={(e) => {
                  if (e?.key === 'Enter') {
                    e?.preventDefault();
                    handleAddGuestMovement();
                  }
                }}
              />
              <Button onClick={handleAddGuestMovement} variant="outline" className="flex-shrink-0">
                Add
              </Button>
            </div>
            {formData?.guestMovements?.length > 0 && (
              <div className="space-y-1">
                {formData?.guestMovements?.map((movement, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-2 bg-muted/30 rounded">
                    <span className="flex-1 text-sm text-foreground">• {movement}</span>
                    <button
                      onClick={() => handleRemoveGuestMovement(idx)}
                      className="p-1 hover:bg-destructive/10 rounded transition-smooth"
                    >
                      <Icon name="X" size={14} className="text-destructive" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Notes (Optional)
            </label>
            <textarea
              value={formData?.notes}
              onChange={(e) => handleChange('notes', e?.target?.value)}
              placeholder="Additional notes for this day"
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
            {editingDay ? 'Update Day' : 'Add Day'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AddItineraryDayModal;