import React, { useState, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import { showToast } from '../../../utils/toast';

const CloseDefectModal = ({ defect, onClose, onConfirm }) => {
  const [closeNotes, setCloseNotes] = useState('');
  const [closePhoto, setClosePhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef(null);

  const handlePhotoChange = (e) => {
    const file = e?.target?.files?.[0];
    if (file) {
      if (file?.size > 10 * 1024 * 1024) {
        showToast('Photo must be less than 10MB', 'error');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setClosePhoto(reader?.result);
        setPhotoPreview(reader?.result);
      };
      reader?.readAsDataURL(file);
    }
  };

  const handleRemovePhoto = () => {
    setClosePhoto(null);
    setPhotoPreview(null);
    if (fileInputRef?.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async () => {
    if (!closeNotes?.trim()) {
      showToast('Close-out notes are required', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      await onConfirm({
        closeNotes: closeNotes?.trim(),
        closePhoto: closePhoto
      });
    } catch (error) {
      showToast('Failed to close defect', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl shadow-xl max-w-lg w-full">
        {/* Header */}
        <div className="border-b border-border px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Close defect?</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted/50 rounded-lg transition-smooth"
          >
            <Icon name="X" size={20} className="text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {/* Defect Title */}
          <div>
            <p className="text-sm text-muted-foreground mb-1">Defect</p>
            <p className="text-foreground font-medium">{defect?.title}</p>
          </div>

          {/* Close-out Notes (Required) */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Close-out notes <span className="text-error">*</span>
            </label>
            <textarea
              value={closeNotes}
              onChange={(e) => setCloseNotes(e?.target?.value)}
              placeholder="Describe how the defect was resolved..."
              rows={4}
              className="w-full px-4 py-3 bg-background border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-smooth resize-none"
            />
          </div>

          {/* Close-out Photo (Optional) */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Add close-out photo (optional)
            </label>
            
            {!photoPreview ? (
              <label
                htmlFor="close-photo-upload"
                className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-border rounded-xl hover:border-primary/50 transition-smooth cursor-pointer bg-muted/20"
              >
                <Icon name="Camera" size={32} className="text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Tap to add photo</p>
                <input
                  id="close-photo-upload"
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoChange}
                  className="hidden"
                />
              </label>
            ) : (
              <div className="relative">
                <img
                  src={photoPreview}
                  alt="Close-out preview"
                  className="w-full h-48 object-cover rounded-xl"
                />
                <button
                  onClick={handleRemovePhoto}
                  className="absolute top-2 right-2 p-2 bg-error text-white rounded-lg hover:bg-error/90 transition-smooth"
                >
                  <Icon name="Trash2" size={16} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-4 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-foreground hover:bg-muted/50 rounded-lg transition-smooth disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !closeNotes?.trim()}
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-smooth disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Closing...' : 'Close defect'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CloseDefectModal;