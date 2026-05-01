import React, { useState, useEffect } from 'react';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Icon from '../../../components/AppIcon';
import { showToast } from '../../../utils/toast';

const STOP_TYPES = ['Dock', 'Anchor', 'Underway'];

const AddEditDayModal = ({
  isOpen,
  onClose,
  editingDay,
  suggestedDate,
  guests = [],
  addDay,
  updateDay,
}) => {
  const [formData, setFormData] = useState({
    event_date: '',
    location: '',
    stop_type: '',
    stop_detail: '',
    notes: '',
    aboard_guest_ids: [],
  });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (isOpen) {
      if (editingDay) {
        setFormData({
          event_date:       editingDay?.date          || editingDay?.event_date      || '',
          location:         editingDay?.locationTitle || editingDay?.location        || '',
          stop_type:        editingDay?.stopType      || editingDay?.stop_type       || '',
          stop_detail:      editingDay?.stopDetail    || editingDay?.stop_detail     || '',
          notes:            editingDay?.notes         || '',
          aboard_guest_ids: Array.isArray(editingDay?.aboardGuestIds)
            ? editingDay.aboardGuestIds
            : Array.isArray(editingDay?.aboard_guest_ids)
              ? editingDay.aboard_guest_ids
              : [],
        });
      } else {
        setFormData({
          event_date:       suggestedDate || '',
          location:         '',
          stop_type:        '',
          stop_detail:      '',
          notes:            '',
          aboard_guest_ids: [],
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

  const toggleGuest = (guestId) => {
    setFormData(prev => {
      const set = new Set(prev.aboard_guest_ids);
      if (set.has(guestId)) set.delete(guestId);
      else                  set.add(guestId);
      return { ...prev, aboard_guest_ids: Array.from(set) };
    });
  };

  const validate = () => {
    const newErrors = {};
    if (!formData?.event_date) newErrors.event_date = 'Date is required';
    if (!formData?.location?.trim()) newErrors.location = 'Location is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    const payload = {
      event_date:       formData.event_date,
      location:         formData.location.trim(),
      stop_type:        formData.stop_type || null,
      stop_detail:      formData.stop_detail?.trim() || null,
      notes:            formData.notes?.trim() || null,
      aboard_guest_ids: formData.aboard_guest_ids,
    };

    if (editingDay) {
      const updated = await updateDay(editingDay.id, payload);
      if (updated) {
        showToast('Itinerary day updated', 'success');
        onClose();
      } else {
        showToast('Failed to update itinerary day', 'error');
      }
    } else {
      const created = await addDay(payload);
      if (created) {
        showToast('Itinerary day added', 'success');
        onClose();
      } else {
        showToast('Failed to add itinerary day', 'error');
      }
    }
  };

  const stopTypeIcon = (type) => {
    switch (type) {
      case 'Dock':     return 'Anchor';
      case 'Anchor':   return 'Anchor';
      case 'Underway': return 'Ship';
      default:         return 'MapPin';
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
              value={formData.event_date}
              onChange={(e) => handleChange('event_date', e?.target?.value)}
              error={errors?.event_date}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Location <span className="text-destructive">*</span>
            </label>
            <Input
              value={formData.location}
              onChange={(e) => handleChange('location', e?.target?.value)}
              placeholder="e.g., St Martin"
              error={errors?.location}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Stop Type
            </label>
            <div className="flex gap-3">
              {STOP_TYPES.map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => handleChange('stop_type', formData.stop_type === type ? '' : type)}
                  className={`flex-1 px-4 py-3 rounded-lg border transition-smooth ${
                    formData.stop_type === type
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-border bg-card text-foreground hover:border-primary/50'
                  }`}
                >
                  <Icon name={stopTypeIcon(type)} size={16} className="inline mr-2" />
                  {type}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Optional — leave blank if unspecified.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Stop Detail (Optional)
            </label>
            <Input
              value={formData.stop_detail}
              onChange={(e) => handleChange('stop_detail', e?.target?.value)}
              placeholder="e.g., St Martin Anchorage, Nassau Marina"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Notes (Optional)
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => handleChange('notes', e?.target?.value)}
              placeholder="e.g., Evening cruise, Pick up"
              rows={3}
              className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-smooth"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Aboard Guests (Optional)
            </label>
            {guests?.length === 0 ? (
              <p className="text-xs text-muted-foreground">No guests on this trip yet.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {guests.map(g => {
                    const selected = formData.aboard_guest_ids.includes(g?.id);
                    return (
                      <button
                        key={g?.id}
                        type="button"
                        onClick={() => toggleGuest(g?.id)}
                        className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-smooth ${
                          selected
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-card text-foreground hover:border-primary/50'
                        }`}
                      >
                        {g?.firstName || g?.first_name || g?.name || 'Guest'}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Empty selection = all trip guests aboard.
                </p>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit}>
            {editingDay ? 'Save Changes' : 'Add Day'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AddEditDayModal;
