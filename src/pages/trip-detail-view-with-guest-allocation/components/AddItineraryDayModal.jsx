import React, { useState, useEffect } from 'react';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Icon from '../../../components/AppIcon';
import { showToast } from '../../../utils/toast';
import { setItineraryDayLegacyExtras } from '../../trips-management-dashboard/utils/tripStorage';

// Overview-tab modal — simpler shape than the timeline modal. Writes
// the Supabase day record (date, location, notes) via the hook's
// addDay/updateDay, plus the legacy keyEvents / guestMovements to a
// localStorage sidecar keyed by the new Supabase day uuid (A3.7a). The
// LS sidecar surfaces alongside Supabase fields via tripStorage's
// merge layer so existing readers (TodayOverview, TripCalendar) keep
// rendering keyEvents / guestMovements without rewrite.
const AddItineraryDayModal = ({
  isOpen,
  onClose,
  onSave,
  tripId,
  editingDay,
  addDay,
  updateDay,
}) => {
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
          date: editingDay?.date || editingDay?.event_date || '',
          locationTitle: editingDay?.locationTitle || editingDay?.location || '',
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
      setFormData(prev => ({ ...prev, keyEvents: [...prev.keyEvents, keyEventInput.trim()] }));
      setKeyEventInput('');
    }
  };

  const handleRemoveKeyEvent = (index) => {
    setFormData(prev => ({ ...prev, keyEvents: prev.keyEvents.filter((_, i) => i !== index) }));
  };

  const handleAddGuestMovement = () => {
    if (guestMovementInput?.trim()) {
      setFormData(prev => ({ ...prev, guestMovements: [...prev.guestMovements, guestMovementInput.trim()] }));
      setGuestMovementInput('');
    }
  };

  const handleRemoveGuestMovement = (index) => {
    setFormData(prev => ({ ...prev, guestMovements: prev.guestMovements.filter((_, i) => i !== index) }));
  };

  const validate = () => {
    const newErrors = {};
    if (!formData?.date) newErrors.date = 'Date is required';
    if (!formData?.locationTitle?.trim()) newErrors.locationTitle = 'Location is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    const supabasePayload = {
      event_date: formData.date,
      location:   formData.locationTitle.trim(),
      notes:      formData.notes?.trim() || null,
      // Overview modal doesn't ask for these — Supabase column is
      // nullable / default-empty.
      stop_type:        null,
      stop_detail:      null,
      aboard_guest_ids: [],
    };
    const legacyExtras = {
      keyEvents:      formData.keyEvents,
      guestMovements: formData.guestMovements,
    };

    if (editingDay) {
      const updated = await updateDay(editingDay.id, supabasePayload);
      if (!updated) {
        showToast('Failed to update itinerary day', 'error');
        return;
      }
      setItineraryDayLegacyExtras(tripId, editingDay.id, legacyExtras);
      showToast('Itinerary day updated', 'success');
      onSave?.();
    } else {
      const created = await addDay(supabasePayload);
      if (!created) {
        showToast('Failed to add itinerary day', 'error');
        return;
      }
      if (legacyExtras.keyEvents.length || legacyExtras.guestMovements.length) {
        setItineraryDayLegacyExtras(tripId, created.id, legacyExtras);
      }
      showToast('Itinerary day added', 'success');
      onSave?.();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-semibold text-foreground">
            {editingDay ? 'Edit Itinerary Day' : 'Add Itinerary Day'}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-smooth">
            <Icon name="X" size={20} className="text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
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
                  if (e?.key === 'Enter') { e.preventDefault(); handleAddKeyEvent(); }
                }}
              />
              <Button onClick={handleAddKeyEvent} variant="outline" className="flex-shrink-0">Add</Button>
            </div>
            {formData?.keyEvents?.length > 0 && (
              <div className="space-y-1">
                {formData.keyEvents.map((event, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-2 bg-muted/30 rounded">
                    <span className="flex-1 text-sm text-foreground">- {event}</span>
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
                  if (e?.key === 'Enter') { e.preventDefault(); handleAddGuestMovement(); }
                }}
              />
              <Button onClick={handleAddGuestMovement} variant="outline" className="flex-shrink-0">Add</Button>
            </div>
            {formData?.guestMovements?.length > 0 && (
              <div className="space-y-1">
                {formData.guestMovements.map((movement, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-2 bg-muted/30 rounded">
                    <span className="flex-1 text-sm text-foreground">- {movement}</span>
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

        <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit}>
            {editingDay ? 'Update Day' : 'Add Day'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AddItineraryDayModal;
