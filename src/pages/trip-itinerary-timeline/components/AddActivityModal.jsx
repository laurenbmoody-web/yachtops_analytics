import React, { useState, useEffect } from 'react';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Icon from '../../../components/AppIcon';
import { showToast } from '../../../utils/toast';

const AddActivityModal = ({
  isOpen,
  onClose,
  dayId,
  editingActivity,
  guests = [],
  addActivity,
  updateActivity,
}) => {
  const [formData, setFormData] = useState({
    start_time: '',
    title: '',
    description: '',
    location: '',
    linked_guest_ids: [],
  });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (isOpen) {
      if (editingActivity) {
        setFormData({
          start_time:       editingActivity?.start_time       || '',
          title:            editingActivity?.title            || '',
          description:      editingActivity?.description      || '',
          location:         editingActivity?.location         || '',
          linked_guest_ids: Array.isArray(editingActivity?.linked_guest_ids)
            ? editingActivity.linked_guest_ids
            : [],
        });
      } else {
        setFormData({
          start_time: '',
          title: '',
          description: '',
          location: '',
          linked_guest_ids: [],
        });
      }
      setErrors({});
    }
  }, [isOpen, editingActivity]);

  if (!isOpen) return null;

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors?.[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  const toggleGuest = (guestId) => {
    setFormData(prev => {
      const set = new Set(prev.linked_guest_ids);
      if (set.has(guestId)) set.delete(guestId);
      else                  set.add(guestId);
      return { ...prev, linked_guest_ids: Array.from(set) };
    });
  };

  const validate = () => {
    const newErrors = {};
    if (!formData?.title?.trim()) newErrors.title = 'Title is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    const payload = {
      start_time:       formData.start_time || null,
      title:            formData.title.trim(),
      description:      formData.description?.trim() || null,
      location:         formData.location?.trim() || null,
      linked_guest_ids: formData.linked_guest_ids,
    };

    if (editingActivity) {
      const updated = await updateActivity(editingActivity.id, payload);
      if (updated) {
        showToast('Activity updated', 'success');
        onClose();
      } else {
        showToast('Failed to update activity', 'error');
      }
    } else {
      const created = await addActivity({ day_id: dayId, ...payload });
      if (created) {
        showToast('Activity added', 'success');
        onClose();
      } else {
        showToast('Failed to add activity', 'error');
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-semibold text-foreground">
            {editingActivity ? 'Edit Activity' : 'Add Activity'}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-smooth">
            <Icon name="X" size={20} className="text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Time (Optional)
            </label>
            <Input
              type="time"
              value={formData.start_time}
              onChange={(e) => handleChange('start_time', e?.target?.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Leave blank for activities without a specific time.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Title <span className="text-destructive">*</span>
            </label>
            <Input
              value={formData.title}
              onChange={(e) => handleChange('title', e?.target?.value)}
              placeholder="e.g., Tender to beach club"
              error={errors?.title}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Description (Optional)
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => handleChange('description', e?.target?.value)}
              placeholder="Notes about this activity"
              rows={3}
              className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-smooth"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Location (Optional)
            </label>
            <Input
              value={formData.location}
              onChange={(e) => handleChange('location', e?.target?.value)}
              placeholder="e.g., Beach Club Tahiti"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Linked Guests (Optional)
            </label>
            {guests?.length === 0 ? (
              <p className="text-xs text-muted-foreground">No guests on this trip yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {guests.map(g => {
                  const selected = formData.linked_guest_ids.includes(g?.id);
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
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit}>
            {editingActivity ? 'Save Changes' : 'Add Activity'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AddActivityModal;
