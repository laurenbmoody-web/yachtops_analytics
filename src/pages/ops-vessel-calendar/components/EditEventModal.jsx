import React, { useState, useRef } from 'react';
import { format, parseISO } from 'date-fns';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import { Checkbox } from '../../../components/ui/Checkbox';
import { useAuth } from '../../../contexts/AuthContext';
import { updateOpsEvent, deleteOpsEvent } from '../utils/opsEventStorage';
import { DEPARTMENTS } from '../../../utils/authStorage';

const EditEventModal = ({ event, onClose, onSuccess }) => {
  const { currentUser, isCommand, isChief, isHOD } = useAuth();
  const [showAllHandsConfirm, setShowAllHandsConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const endTimeManuallyEdited = useRef(false);
  const [formData, setFormData] = useState({
    title: event?.title || '',
    description: event?.description || '',
    startDate: event?.startDate ? format(parseISO(event?.startDate), 'yyyy-MM-dd') : '',
    startTime: event?.startDate ? format(parseISO(event?.startDate), 'HH:mm') : '',
    endDate: event?.endDate ? format(parseISO(event?.endDate), 'yyyy-MM-dd') : '',
    endTime: event?.endDate ? format(parseISO(event?.endDate), 'HH:mm') : '',
    location: event?.location || '',
    category: event?.category || '',
    isPrivate: event?.isPrivate || false,
    visibility: event?.visibility || [],
    attachments: event?.attachments || []
  });

  const categoryOptions = [
    { value: 'Contractor', label: 'Contractor' },
    { value: 'Charter', label: 'Charter' },
    { value: 'Owner', label: 'Owner' },
    { value: 'Yacht Show', label: 'Yacht Show' },
    { value: 'Guest Movement', label: 'Guest Movement' },
    { value: 'Maintenance Window', label: 'Maintenance Window' },
    { value: 'Other', label: 'Other' }
  ];

  const getVisibilityOptions = () => {
    if (isCommand) {
      return [
        { value: 'All Hands', label: 'All Hands' },
        { value: 'Chiefs', label: 'Chiefs' },
        { value: 'HODs', label: 'HODs' },
        { value: 'Crew', label: 'Crew' },
        ...DEPARTMENTS?.map(dept => ({ value: dept, label: dept }))
      ];
    } else if (isChief) {
      return [
        { value: 'All Hands', label: 'All Hands' },
        { value: 'Chiefs', label: 'Chiefs' },
        { value: 'HODs + Crew', label: 'HODs + Crew' },
        ...DEPARTMENTS?.map(dept => ({ value: dept, label: dept }))
      ];
    } else if (isHOD) {
      return [
        { value: 'HODs + Crew', label: 'HODs + Crew' },
        { value: currentUser?.department, label: `${currentUser?.department} (My Department)` }
      ];
    } else {
      return [
        { value: currentUser?.department, label: `${currentUser?.department} (My Department)` }
      ];
    }
  };

  const handleSubmit = (e) => {
    e?.preventDefault();
    if (!formData?.title?.trim()) return;

    // Check for All Hands confirmation
    const hadAllHands = event?.visibility?.includes('All Hands');
    const hasAllHands = formData?.visibility?.includes('All Hands');
    if (!formData?.isPrivate && hasAllHands && !hadAllHands && !showAllHandsConfirm) {
      setShowAllHandsConfirm(true);
      return;
    }

    // Create date-time objects
    const startDateTime = new Date(`${formData?.startDate}T${formData?.startTime}`);
    const endDateTime = formData?.endDate && formData?.endTime 
      ? new Date(`${formData?.endDate}T${formData?.endTime}`)
      : null;

    updateOpsEvent(event?.id, {
      title: formData?.title,
      description: formData?.description,
      startDate: startDateTime?.toISOString(),
      endDate: endDateTime?.toISOString(),
      location: formData?.location,
      category: formData?.category,
      isPrivate: formData?.isPrivate,
      visibility: formData?.isPrivate ? [] : formData?.visibility,
      attachments: formData?.attachments
    }, currentUser?.id, currentUser?.name);

    onSuccess();
  };

  const handleDelete = () => {
    deleteOpsEvent(event?.id);
    onSuccess();
  };

  const handleAllHandsConfirm = () => {
    setShowAllHandsConfirm(false);
    handleSubmit(new Event('submit'));
  };

  // Auto-set End Time when End Date changes
  const handleEndDateChange = (e) => {
    const newEndDate = e?.target?.value;
    setFormData(prev => {
      const updates = { endDate: newEndDate };
      
      // If End Date is set and Start Time exists, auto-fill End Time to match Start Time-of-day
      if (newEndDate && prev?.startTime && !endTimeManuallyEdited?.current) {
        updates.endTime = prev?.startTime;
      }
      
      return { ...prev, ...updates };
    });
  };

  // Track manual End Time edits
  const handleEndTimeChange = (e) => {
    endTimeManuallyEdited.current = true;
    setFormData(prev => ({ ...prev, endTime: e?.target?.value }));
  };

  // Sync End Time when Start Time changes (if End Time not manually edited)
  const handleStartTimeChange = (e) => {
    const newStartTime = e?.target?.value;
    setFormData(prev => {
      const updates = { startTime: newStartTime };
      
      // If End Date is set and End Time hasn't been manually edited, sync End Time
      if (prev?.endDate && !endTimeManuallyEdited?.current) {
        updates.endTime = newStartTime;
      }
      
      return { ...prev, ...updates };
    });
  };

  if (showAllHandsConfirm) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-card rounded-xl border border-border shadow-xl max-w-md w-full p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-full bg-warning/10">
              <Icon name="AlertTriangle" size={24} className="text-warning" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">All Hands Confirmation</h2>
          </div>
          <p className="text-muted-foreground mb-6">
            This event will be visible to <strong>ALL crew members</strong>. Are you sure you want to proceed?
          </p>
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={() => setShowAllHandsConfirm(false)}>
              Cancel
            </Button>
            <Button variant="warning" onClick={handleAllHandsConfirm}>
              Confirm & Save
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (showDeleteConfirm) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-card rounded-xl border border-border shadow-xl max-w-md w-full p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-full bg-error/10">
              <Icon name="Trash2" size={24} className="text-error" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">Delete Event</h2>
          </div>
          <p className="text-muted-foreground mb-6">
            Are you sure you want to delete this event? This action cannot be undone.
          </p>
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete}>
              Delete Event
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-card rounded-xl border border-border shadow-xl max-w-2xl w-full my-8">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Edit Event</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Update event details
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-accent rounded-lg transition-smooth">
            <Icon name="X" size={20} className="text-muted-foreground" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Title */}
          <Input
            label="Title"
            value={formData?.title}
            onChange={(e) => setFormData(prev => ({ ...prev, title: e?.target?.value }))}
            placeholder="Enter event title"
            required
          />

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Description / Notes</label>
            <textarea
              value={formData?.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e?.target?.value }))}
              placeholder="Enter event description"
              rows={3}
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Start Date & Time */}
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Start Date"
              type="date"
              value={formData?.startDate}
              onChange={(e) => setFormData(prev => ({ ...prev, startDate: e?.target?.value }))}
              required
            />
            <Input
              label="Start Time"
              type="time"
              value={formData?.startTime}
              onChange={handleStartTimeChange}
              required
            />
          </div>

          {/* End Date & Time */}
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="End Date"
              type="date"
              value={formData?.endDate}
              onChange={handleEndDateChange}
            />
            <Input
              label="End Time"
              type="time"
              value={formData?.endTime}
              onChange={handleEndTimeChange}
            />
          </div>

          {/* Location */}
          <Input
            label="Location"
            value={formData?.location}
            onChange={(e) => setFormData(prev => ({ ...prev, location: e?.target?.value }))}
            placeholder="Enter location"
          />

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Category</label>
            <Select
              options={categoryOptions}
              value={formData?.category}
              onChange={(value) => setFormData(prev => ({ ...prev, category: value }))}
              placeholder="Select category"
            />
          </div>

          {/* Private Toggle */}
          <div className="p-4 rounded-lg border border-border bg-muted/30">
            <Checkbox
              checked={formData?.isPrivate}
              onChange={(e) => setFormData(prev => ({ ...prev, isPrivate: e?.target?.checked, visibility: e?.target?.checked ? [] : prev?.visibility }))}
              label="Private Event"
              description="Only you will be able to see this event"
            />
          </div>

          {/* Visibility Selector */}
          {!formData?.isPrivate && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Visibility</label>
              <Select
                options={getVisibilityOptions()}
                value={formData?.visibility}
                onChange={(value) => setFormData(prev => ({ ...prev, visibility: value }))}
                placeholder="Select who can see this event"
                multiple
                searchable
              />
            </div>
          )}

          {/* Activity Log */}
          {(isCommand || isChief) && event?.activity?.length > 0 && (
            <div className="p-4 rounded-lg border border-border bg-muted/30">
              <h4 className="text-sm font-medium text-foreground mb-2">Activity Log</h4>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {event?.activity?.map((log, idx) => (
                  <div key={idx} className="text-xs text-muted-foreground">
                    <span className="font-medium">{log?.userName}</span> {log?.action} - {format(parseISO(log?.timestamp), 'MMM d, h:mm a')}
                  </div>
                ))}
              </div>
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="flex gap-3 justify-between p-6 border-t border-border">
          <Button variant="danger" onClick={() => setShowDeleteConfirm(true)}>
            Delete Event
          </Button>
          <div className="flex gap-3">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>
              Save Changes
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditEventModal;