import React, { useState, useEffect } from 'react';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Icon from '../../../components/AppIcon';
import { showToast } from '../../../utils/toast';
import { updateTrip } from '../../trips-management-dashboard/utils/tripStorage';

const EditCharterDetailsModal = ({ isOpen, onClose, onSave, tripId, trip }) => {
  const [formData, setFormData] = useState({
    agencyName: '',
    brokerName: '',
    email: '',
    phone: '',
    centralAgentName: '',
    centralAgentEmail: '',
    centralAgentPhone: '',
    notes: ''
  });

  useEffect(() => {
    if (isOpen && trip?.brokerDetails) {
      setFormData({
        agencyName: trip?.brokerDetails?.agencyName || '',
        brokerName: trip?.brokerDetails?.brokerName || '',
        email: trip?.brokerDetails?.email || '',
        phone: trip?.brokerDetails?.phone || '',
        centralAgentName: trip?.brokerDetails?.centralAgentName || '',
        centralAgentEmail: trip?.brokerDetails?.centralAgentEmail || '',
        centralAgentPhone: trip?.brokerDetails?.centralAgentPhone || '',
        notes: trip?.brokerDetails?.notes || ''
      });
    } else if (isOpen) {
      setFormData({
        agencyName: '',
        brokerName: '',
        email: '',
        phone: '',
        centralAgentName: '',
        centralAgentEmail: '',
        centralAgentPhone: '',
        notes: ''
      });
    }
  }, [isOpen, trip]);

  if (!isOpen) return null;

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    const updated = await updateTrip(tripId, { brokerDetails: formData });
    if (updated) {
      showToast('Charter details updated successfully', 'success');
      onSave();
    } else {
      showToast('Failed to update charter details', 'error');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-semibold text-foreground">Edit Charter Details</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
          >
            <Icon name="X" size={20} className="text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Broker / Agency Section */}
          <div>
            <h3 className="font-semibold text-foreground mb-3">Broker / Agency</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Agency Name
                </label>
                <Input
                  value={formData?.agencyName}
                  onChange={(e) => handleChange('agencyName', e?.target?.value)}
                  placeholder="Agency name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Broker Name
                </label>
                <Input
                  value={formData?.brokerName}
                  onChange={(e) => handleChange('brokerName', e?.target?.value)}
                  placeholder="Broker name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Email
                </label>
                <Input
                  type="email"
                  value={formData?.email}
                  onChange={(e) => handleChange('email', e?.target?.value)}
                  placeholder="broker@example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Phone
                </label>
                <Input
                  value={formData?.phone}
                  onChange={(e) => handleChange('phone', e?.target?.value)}
                  placeholder="+1 234 567 8900"
                />
              </div>
            </div>
          </div>

          {/* Central Agent Section */}
          <div>
            <h3 className="font-semibold text-foreground mb-3">Central Agent</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Name
                </label>
                <Input
                  value={formData?.centralAgentName}
                  onChange={(e) => handleChange('centralAgentName', e?.target?.value)}
                  placeholder="Agent name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Email
                </label>
                <Input
                  type="email"
                  value={formData?.centralAgentEmail}
                  onChange={(e) => handleChange('centralAgentEmail', e?.target?.value)}
                  placeholder="agent@example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Phone
                </label>
                <Input
                  value={formData?.centralAgentPhone}
                  onChange={(e) => handleChange('centralAgentPhone', e?.target?.value)}
                  placeholder="+1 234 567 8900"
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Notes (Optional)
            </label>
            <textarea
              value={formData?.notes}
              onChange={(e) => handleChange('notes', e?.target?.value)}
              placeholder="Additional notes (non-financial)"
              rows={4}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          {/* Document Upload Placeholder */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Documents
            </label>
            <p className="text-xs text-muted-foreground">Document upload functionality coming soon.</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>
            Save Details
          </Button>
        </div>
      </div>
    </div>
  );
};

export default EditCharterDetailsModal;