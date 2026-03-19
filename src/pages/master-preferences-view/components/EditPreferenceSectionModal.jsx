import React, { useState, useEffect, useRef } from 'react';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Icon from '../../../components/AppIcon';
import { showToast } from '../../../utils/toast';
import { createPreference, updatePreference, deletePreference, PreferencePriority } from '../../../utils/preferencesStorage';
import { createAuditLog, EntityType, AuditAction } from '../../../utils/auditLogger';
import { supabase } from '../../../lib/supabaseClient';

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

const uploadPreferenceImage = async (file, tenantId, guestId, preferenceId) => {
  const ext = file?.name?.split('.')?.pop()?.toLowerCase();
  const path = `${tenantId}/${guestId}/${preferenceId}/image.${ext}`;
  const { error } = await supabase?.storage?.from('preference-images')?.upload(path, file, { upsert: true, contentType: file?.type });
  if (error) throw error;
  const { data } = supabase?.storage?.from('preference-images')?.getPublicUrl(path);
  return data?.publicUrl || null;
};

const deletePreferenceImage = async (imageUrl) => {
  if (!imageUrl) return;
  try {
    // Extract path from URL: everything after /preference-images/
    const match = imageUrl?.match(/preference-images\/(.+)$/);
    if (match?.[1]) {
      await supabase?.storage?.from('preference-images')?.remove([decodeURIComponent(match?.[1])]);
    }
  } catch (err) {
    console.error('[EditPreferenceSectionModal] deletePreferenceImage error:', err);
  }
};

const EditPreferenceSectionModal = ({ isOpen, onClose, onSave, guestId, tenantId, section, existingPreferences, initialEditPrefId, prefType: initialPrefType }) => {
  const [preferences, setPreferences] = useState([]);
  const [editingIndex, setEditingIndex] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    key: '',
    value: '',
    priority: PreferencePriority?.NORMAL,
    tags: [],
    confidence: '',
    timeOfDay: '',
    prefType: initialPrefType || 'preference'
  });
  const [tagInput, setTagInput] = useState('');

  // Image state
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [existingImageUrl, setExistingImageUrl] = useState(null);
  const [removeExistingImage, setRemoveExistingImage] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      const prefs = existingPreferences || [];
      setPreferences(prefs);
      if (initialEditPrefId) {
        const idx = prefs?.findIndex(p => p?.id === initialEditPrefId);
        if (idx !== -1) {
          const pref = prefs?.[idx];
          setFormData({
            key: pref?.key,
            value: pref?.value,
            priority: pref?.priority,
            tags: pref?.tags || [],
            confidence: pref?.confidence || '',
            timeOfDay: pref?.timeOfDay || '',
            prefType: pref?.prefType || 'preference'
          });
          setTagInput('');
          setEditingIndex(idx);
          // Load existing image
          setExistingImageUrl(pref?.preferenceImageUrl || null);
          setImageFile(null);
          setImagePreview(null);
          setRemoveExistingImage(false);
        } else {
          resetForm();
        }
      } else {
        resetForm(initialPrefType);
      }
    }
  }, [isOpen, existingPreferences, initialEditPrefId, initialPrefType]);

  if (!isOpen) return null;

  const resetForm = (type) => {
    setFormData({
      key: '',
      value: '',
      priority: PreferencePriority?.NORMAL,
      tags: [],
      confidence: '',
      timeOfDay: '',
      prefType: type || initialPrefType || 'preference'
    });
    setTagInput('');
    setEditingIndex(null);
    setImageFile(null);
    setImagePreview(null);
    setExistingImageUrl(null);
    setRemoveExistingImage(false);
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
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

  const handleImageSelect = (e) => {
    const file = e?.target?.files?.[0];
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES?.includes(file?.type)) {
      showToast('Please select a JPG, PNG, WebP, or GIF image', 'error');
      return;
    }
    if (file?.size > MAX_IMAGE_SIZE) {
      showToast('Image must be under 5MB', 'error');
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setRemoveExistingImage(false);
    // Reset file input
    if (fileInputRef?.current) fileInputRef.current.value = '';
  };

  const handleRemoveImage = () => {
    if (imageFile) {
      setImageFile(null);
      setImagePreview(null);
    } else if (existingImageUrl) {
      setRemoveExistingImage(true);
      setExistingImageUrl(null);
    }
  };

  const handleAddPreference = async () => {
    if (!formData?.key?.trim() || !formData?.value?.trim()) {
      showToast('Key and value are required', 'error');
      return;
    }

    setSaving(true);
    try {
      const newPref = await createPreference({
        guestId,
        tripId: null, // Master preferences are not trip-scoped
        category: section?.category,
        key: formData?.key,
        value: formData?.value,
        priority: formData?.priority,
        tags: formData?.tags,
        confidence: formData?.confidence || null,
        timeOfDay: formData?.timeOfDay || null,
        prefType: formData?.prefType || 'preference',
        source: 'master'
      }, tenantId);

      if (newPref) {
        // Upload image if selected
        if (imageFile && newPref?.id) {
          try {
            const imageUrl = await uploadPreferenceImage(imageFile, tenantId, guestId, newPref?.id);
            if (imageUrl) {
              await supabase?.from('guest_preferences')?.update({ preference_image_url: imageUrl })?.eq('id', newPref?.id)?.eq('tenant_id', tenantId);
              newPref.preferenceImageUrl = imageUrl;
            }
          } catch (imgErr) {
            console.error('[EditPreferenceSectionModal] image upload error:', imgErr);
            showToast('Preference saved but image upload failed', 'warning');
          }
        }

        // Create audit log
        createAuditLog({
          entityType: EntityType?.GUEST,
          entityId: guestId,
          entityName: `Guest Preference`,
          action: AuditAction?.CREATED,
          changes: [
            { field: 'category', before: null, after: section?.category },
            { field: 'key', before: null, after: formData?.key },
            { field: 'value', before: null, after: formData?.value }
          ]
        });

        setPreferences(prev => [...prev, newPref]);
        resetForm();
        showToast('Preference added successfully', 'success');
      } else {
        showToast('Failed to add preference', 'error');
      }
    } catch (err) {
      console.error('[EditPreferenceSectionModal] handleAddPreference error:', err);
      showToast('Failed to add preference', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleEditPreference = (index) => {
    const pref = preferences?.[index];
    setFormData({
      key: pref?.key,
      value: pref?.value,
      priority: pref?.priority,
      tags: pref?.tags || [],
      confidence: pref?.confidence || '',
      timeOfDay: pref?.timeOfDay || '',
      prefType: pref?.prefType || 'preference'
    });
    setEditingIndex(index);
    setExistingImageUrl(pref?.preferenceImageUrl || null);
    setImageFile(null);
    setImagePreview(null);
    setRemoveExistingImage(false);
  };

  const handleUpdatePreference = async () => {
    if (!formData?.key?.trim() || !formData?.value?.trim()) {
      showToast('Key and value are required', 'error');
      return;
    }

    setSaving(true);
    try {
      const pref = preferences?.[editingIndex];

      // Handle image changes
      let newImageUrl = pref?.preferenceImageUrl || null;
      if (removeExistingImage && pref?.preferenceImageUrl) {
        await deletePreferenceImage(pref?.preferenceImageUrl);
        newImageUrl = null;
      }
      if (imageFile && pref?.id) {
        try {
          newImageUrl = await uploadPreferenceImage(imageFile, tenantId, guestId, pref?.id);
        } catch (imgErr) {
          console.error('[EditPreferenceSectionModal] image upload error:', imgErr);
          showToast('Preference saved but image upload failed', 'warning');
        }
      }

      const updated = await updatePreference(pref?.id, {
        key: formData?.key,
        value: formData?.value,
        priority: formData?.priority,
        tags: formData?.tags,
        confidence: formData?.confidence || null,
        timeOfDay: formData?.timeOfDay || null,
        prefType: formData?.prefType || 'preference',
        preferenceImageUrl: newImageUrl
      }, tenantId);

      // Also update image URL directly in DB
      if (pref?.id) {
        await supabase?.from('guest_preferences')?.update({ preference_image_url: newImageUrl })?.eq('id', pref?.id)?.eq('tenant_id', tenantId);
      }

      if (updated) {
        updated.preferenceImageUrl = newImageUrl;
        const changes = [];
        if (pref?.key !== formData?.key) changes?.push({ field: 'key', before: pref?.key, after: formData?.key });
        if (pref?.value !== formData?.value) changes?.push({ field: 'value', before: pref?.value, after: formData?.value });
        if (pref?.priority !== formData?.priority) changes?.push({ field: 'priority', before: pref?.priority, after: formData?.priority });

        createAuditLog({
          entityType: EntityType?.GUEST,
          entityId: guestId,
          entityName: `Guest Preference`,
          action: AuditAction?.UPDATED,
          changes
        });

        const updatedPrefs = [...preferences];
        updatedPrefs[editingIndex] = updated;
        setPreferences(updatedPrefs);
        resetForm();
        showToast('Preference updated successfully', 'success');
      } else {
        showToast('Failed to update preference', 'error');
      }
    } catch (err) {
      console.error('[EditPreferenceSectionModal] handleUpdatePreference error:', err);
      showToast('Failed to update preference', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePreference = async (index) => {
    const pref = preferences?.[index];
    if (window.confirm('Are you sure you want to delete this preference?')) {
      setSaving(true);
      try {
        // Delete image from storage if exists
        if (pref?.preferenceImageUrl) {
          await deletePreferenceImage(pref?.preferenceImageUrl);
        }

        const success = await deletePreference(pref?.id, tenantId);
        if (success) {
          // Create audit log
          createAuditLog({
            entityType: EntityType?.GUEST,
            entityId: guestId,
            entityName: `Guest Preference`,
            action: AuditAction?.DELETED,
            changes: [
              { field: 'key', before: pref?.key, after: null },
              { field: 'value', before: pref?.value, after: null }
            ]
          });

          setPreferences(prev => prev?.filter((_, i) => i !== index));
          showToast('Preference deleted successfully', 'success');
        } else {
          showToast('Failed to delete preference', 'error');
        }
      } catch (err) {
        console.error('[EditPreferenceSectionModal] handleDeletePreference error:', err);
        showToast('Failed to delete preference', 'error');
      } finally {
        setSaving(false);
      }
    }
  };

  const handleSave = async () => {
    if (editingIndex !== null) {
      await handleUpdatePreference();
    } else if (formData?.key?.trim() && formData?.value?.trim()) {
      await handleAddPreference();
    }
    onClose();
    onSave();
  };

  const priorityOptions = [
    { value: PreferencePriority?.LOW, label: 'Low' },
    { value: PreferencePriority?.NORMAL, label: 'Normal' },
    { value: PreferencePriority?.HIGH, label: 'High' }
  ];

  const confidenceOptions = [
    { value: '', label: 'Not set' },
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'observed', label: 'Observed' },
    { value: 'suggested', label: 'Suggested' }
  ];

  const timeOfDayOptions = [
    { value: '', label: 'Not set' },
    { value: 'morning', label: 'Morning' },
    { value: 'midday', label: 'Midday' },
    { value: 'afternoon', label: 'Afternoon' },
    { value: 'evening', label: 'Evening' },
    { value: 'night', label: 'Night' }
  ];

  const currentImageSrc = imagePreview || (removeExistingImage ? null : existingImageUrl);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              section?.isPriority ? 'bg-red-100 dark:bg-red-900/30' : 'bg-primary/10'
            }`}>
              <Icon
                name={section?.icon}
                size={20}
                className={section?.isPriority ? 'text-red-600 dark:text-red-400' : 'text-primary'}
              />
            </div>
            <h2 className="text-xl font-semibold text-foreground">
              Edit {section?.title}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
          >
            <Icon name="X" size={20} className="text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Add/Edit Form */}
          <div className="bg-muted/30 rounded-lg p-4 space-y-4 overflow-visible">
            <h3 className="text-sm font-semibold text-foreground">
              {editingIndex !== null ? 'Edit Entry' : (formData?.prefType === 'avoid' ? 'Add Avoid Item' : 'Add New Preference')}
            </h3>

            {/* Type selector */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, prefType: 'preference' }))}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  formData?.prefType === 'preference' ?'bg-primary text-primary-foreground border-primary' :'bg-background text-muted-foreground border-border hover:border-primary/50'
                }`}
              >
                Preference
              </button>
              <button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, prefType: 'avoid' }))}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  formData?.prefType === 'avoid' ?'bg-red-500/10 text-red-600 border-red-400/60' :'bg-background text-muted-foreground border-border hover:border-red-400/50'
                }`}
              >
                Avoid / Do Not
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Description"
                value={formData?.key}
                onChange={(e) => handleChange('key', e?.target?.value)}
                placeholder="e.g., Coffee, Pillow type"
              />
              <Select
                label="Priority"
                options={priorityOptions}
                value={formData?.priority}
                onChange={(value) => handleChange('priority', value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Further Information</label>
                <textarea
                  value={formData?.value}
                  onChange={(e) => handleChange('value', e?.target?.value)}
                  placeholder="Describe the preference in detail"
                  rows={3}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>
              <div className="space-y-4">
                <Select
                  label="Confidence"
                  options={confidenceOptions}
                  value={formData?.confidence}
                  onChange={(value) => handleChange('confidence', value)}
                />
                <Select
                  label="Time of Day"
                  options={timeOfDayOptions}
                  value={formData?.timeOfDay}
                  onChange={(value) => handleChange('timeOfDay', value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Tags</label>
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
                <Button variant="outline" size="sm" onClick={handleAddTag}>Add</Button>
              </div>
              {formData?.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {formData?.tags?.map((tag, idx) => (
                    <span
                      key={idx}
                      className="flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary rounded-full text-xs"
                    >
                      {tag}
                      <button onClick={() => handleRemoveTag(tag)} className="hover:text-red-500">
                        <Icon name="X" size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Image Upload Section */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Image <span className="text-xs text-muted-foreground font-normal">(optional, not included in exports)</span></label>
              {currentImageSrc ? (
                <div className="relative inline-block">
                  <img
                    src={currentImageSrc}
                    alt="Preference image preview"
                    className="h-32 w-auto max-w-full rounded-lg object-cover border border-border"
                  />
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-md transition-colors"
                    title="Remove image"
                  >
                    <Icon name="X" size={12} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef?.current?.click()}
                  className="flex items-center gap-2 px-4 py-2.5 border border-dashed border-border rounded-lg text-sm text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors bg-background"
                >
                  <Icon name="ImagePlus" size={16} />
                  <span>Upload image (JPG, PNG, WebP, GIF · max 5MB)</span>
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handleImageSelect}
                className="hidden"
              />
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Update'}</Button>
        </div>
      </div>
    </div>
  );
};

export default EditPreferenceSectionModal;