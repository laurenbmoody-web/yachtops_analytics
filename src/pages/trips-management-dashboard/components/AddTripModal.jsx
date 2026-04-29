import React, { useState, useEffect } from 'react';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Icon from '../../../components/AppIcon';
import { showToast } from '../../../utils/toast';
import { createTrip, updateTrip, TripType } from '../utils/tripStorage';
import { useNavigate } from 'react-router-dom';
import Select from '../../../components/ui/Select';


const AddTripModal = ({ isOpen, onClose, onSave, editingTrip, guests }) => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: '',
    startDate: '',
    endDate: '',
    notes: '',
    guestIds: [],
    activeGuestIds: [],
    tripType: TripType?.OWNER,
    itinerarySummary: ''
  });
  const [errors, setErrors] = useState({});
  const [guestSearchQuery, setGuestSearchQuery] = useState('');

  useEffect(() => {
    if (isOpen) {
      if (editingTrip) {
        setFormData({
          name: editingTrip?.name || '',
          startDate: editingTrip?.startDate || '',
          endDate: editingTrip?.endDate || '',
          notes: editingTrip?.notes || '',
          guestIds: editingTrip?.guestIds || [],
          activeGuestIds: editingTrip?.activeGuestIds || [],
          tripType: editingTrip?.tripType || TripType?.OWNER,
          itinerarySummary: editingTrip?.itinerarySummary || ''
        });
      } else {
        setFormData({
          name: '',
          startDate: '',
          endDate: '',
          notes: '',
          guestIds: [],
          activeGuestIds: [],
          tripType: TripType?.OWNER,
          itinerarySummary: ''
        });
      }
      setErrors({});
      setGuestSearchQuery('');
    }
  }, [isOpen, editingTrip]);

  if (!isOpen) return null;

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors?.[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  const handleGuestToggle = (guestId) => {
    setFormData(prev => {
      const isSelected = prev?.guestIds?.includes(guestId);
      if (isSelected) {
        return {
          ...prev,
          guestIds: prev?.guestIds?.filter(id => id !== guestId),
          activeGuestIds: prev?.activeGuestIds?.filter(id => id !== guestId)
        };
      } else {
        return {
          ...prev,
          guestIds: [...prev?.guestIds, guestId]
        };
      }
    });
  };

  const handleActiveToggle = (guestId) => {
    setFormData(prev => {
      const isActive = prev?.activeGuestIds?.includes(guestId);
      if (isActive) {
        return {
          ...prev,
          activeGuestIds: prev?.activeGuestIds?.filter(id => id !== guestId)
        };
      } else {
        return {
          ...prev,
          activeGuestIds: [...prev?.activeGuestIds, guestId]
        };
      }
    });
  };

  const validate = () => {
    const newErrors = {};

    if (!formData?.name?.trim()) {
      newErrors.name = 'Trip name is required';
    }

    if (!formData?.startDate) {
      newErrors.startDate = 'Start date is required';
    }

    if (!formData?.endDate) {
      newErrors.endDate = 'End date is required';
    }

    if (formData?.startDate && formData?.endDate) {
      if (new Date(formData.endDate) < new Date(formData.startDate)) {
        newErrors.endDate = 'End date must be after start date';
      }
    }

    if (formData?.guestIds?.length === 0) {
      newErrors.guests = 'Please select at least one guest';
    }

    setErrors(newErrors);
    return Object.keys(newErrors)?.length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    if (editingTrip) {
      const updated = await updateTrip(editingTrip?.id, formData);
      if (updated) {
        showToast('Trip updated successfully', 'success');
        onSave();
      } else {
        showToast('Failed to update trip', 'error');
      }
    } else {
      const newTrip = await createTrip(formData);
      if (newTrip) {
        showToast('Trip created successfully', 'success');
        onSave();
        // Navigate to trip detail page
        navigate(`/trips/${newTrip?.id}`);
      } else {
        showToast('Failed to create trip', 'error');
      }
    }
  };

  const filteredGuests = guests?.filter(guest => {
    if (!guestSearchQuery?.trim()) return true;
    const query = guestSearchQuery?.toLowerCase();
    const fullName = `${guest?.firstName} ${guest?.lastName}`?.toLowerCase();
    const cabin = (guest?.cabinLocationPath || '')?.toLowerCase();
    return fullName?.includes(query) || cabin?.includes(query);
  });

  const formatCabinLevel3 = (cabinValue) => {
    if (!cabinValue) return '';
    const raw = String(cabinValue)?.trim();
    if (!raw) return '';
    const parts = raw?.split('>')?.map(p => p?.trim())?.filter(Boolean);
    if (parts?.length === 0) return '';
    return parts?.[parts?.length - 1];
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-semibold text-foreground">
            {editingTrip ? 'Edit Trip' : 'Add Trip'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
          >
            <Icon name="X" size={20} className="text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Trip Details */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Trip Name <span className="text-destructive">*</span>
              </label>
              <Input
                value={formData?.name}
                onChange={(e) => handleChange('name', e?.target?.value)}
                placeholder="e.g., Summer Mediterranean Charter"
                error={errors?.name}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Trip Type <span className="text-destructive">*</span>
              </label>
              <Select
                options={[
                  { value: TripType?.OWNER, label: 'Owner' },
                  { value: TripType?.CHARTER, label: 'Charter' },
                  { value: TripType?.FRIENDS_FAMILY, label: 'Friends/Family' },
                  { value: TripType?.OTHER, label: 'Other' }
                ]}
                value={formData?.tripType}
                onChange={(value) => handleChange('tripType', value)}
                placeholder="Select trip type"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Itinerary Summary (Optional)
              </label>
              <Input
                value={formData?.itinerarySummary}
                onChange={(e) => handleChange('itinerarySummary', e?.target?.value)}
                placeholder="e.g., Sardinia → Corsica → Monaco"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Start Date <span className="text-destructive">*</span>
                </label>
                <Input
                  type="date"
                  value={formData?.startDate}
                  onChange={(e) => handleChange('startDate', e?.target?.value)}
                  error={errors?.startDate}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  End Date <span className="text-destructive">*</span>
                </label>
                <Input
                  type="date"
                  value={formData?.endDate}
                  onChange={(e) => handleChange('endDate', e?.target?.value)}
                  error={errors?.endDate}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Notes (Optional)
              </label>
              <textarea
                value={formData?.notes}
                onChange={(e) => handleChange('notes', e?.target?.value)}
                placeholder="Add any additional notes about this trip..."
                rows={3}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
            </div>
          </div>

          {/* Guest Allocation */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-3">
              Guest Allocation <span className="text-destructive">*</span>
            </label>
            {errors?.guests && (
              <p className="text-sm text-destructive mb-2">{errors?.guests}</p>
            )}

            {/* Guest Search */}
            <div className="relative mb-3">
              <Icon
                name="Search"
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="text"
                placeholder="Search guests..."
                value={guestSearchQuery}
                onChange={(e) => setGuestSearchQuery(e?.target?.value)}
                className="w-full pl-9 pr-4 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Guest List */}
            <div className="border border-border rounded-lg max-h-64 overflow-y-auto">
              {filteredGuests?.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  No guests found
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {filteredGuests?.map((guest) => {
                    const isSelected = formData?.guestIds?.includes(guest?.id);
                    const isActive = formData?.activeGuestIds?.includes(guest?.id);
                    const cabin = formatCabinLevel3(guest?.cabinLocationPath);

                    return (
                      <div
                        key={guest?.id}
                        className="p-3 hover:bg-muted/50 transition-smooth"
                      >
                        <div className="flex items-center gap-3">
                          {/* Selection Checkbox */}
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleGuestToggle(guest?.id)}
                            className="w-4 h-4 rounded border-border text-primary focus:ring-2 focus:ring-ring"
                          />

                          {/* Guest Photo */}
                          {guest?.photo ? (
                            <img
                              src={guest?.photo}
                              alt={`${guest?.firstName} ${guest?.lastName}`}
                              className="w-10 h-10 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                              <Icon name="User" size={20} className="text-muted-foreground" />
                            </div>
                          )}

                          {/* Guest Info */}
                          <div className="flex-1">
                            <p className="text-sm font-medium text-foreground">
                              {guest?.firstName} {guest?.lastName}
                            </p>
                            {cabin && (
                              <p className="text-xs text-muted-foreground">{cabin}</p>
                            )}
                          </div>

                          {/* Active Toggle */}
                          {isSelected && (
                            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                              <input
                                type="checkbox"
                                checked={isActive}
                                onChange={() => handleActiveToggle(guest?.id)}
                                className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-2 focus:ring-ring"
                              />
                              Active on trip
                            </label>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <p className="text-xs text-muted-foreground mt-2">
              {formData?.guestIds?.length} guest{formData?.guestIds?.length !== 1 ? 's' : ''} selected
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>
            {editingTrip ? 'Save Changes' : 'Create Trip'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AddTripModal;
