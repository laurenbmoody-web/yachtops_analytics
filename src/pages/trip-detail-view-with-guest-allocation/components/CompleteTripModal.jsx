import React, { useState, useEffect } from 'react';
import Button from '../../../components/ui/Button';
import Icon from '../../../components/AppIcon';
import { showToast } from '../../../utils/toast';
import { updateTrip, TripStatus, updateSpecialRequest, SpecialRequestStatus, logTripActivity, TripActivityType } from '../../trips-management-dashboard/utils/tripStorage';
import { useNavigate } from 'react-router-dom';

const CompleteTripModal = ({ isOpen, onClose, trip, tripId, onComplete }) => {
  const navigate = useNavigate();
  const [openRequests, setOpenRequests] = useState([]);

  useEffect(() => {
    if (isOpen && trip) {
      const open = trip?.specialRequests?.filter(r => r?.status !== SpecialRequestStatus?.DONE) || [];
      setOpenRequests(open);
    }
  }, [isOpen, trip]);

  if (!isOpen) return null;

  const handleMarkAllRequestsDone = () => {
    openRequests?.forEach(request => {
      updateSpecialRequest(tripId, request?.id, { status: SpecialRequestStatus?.DONE });
    });
    setOpenRequests([]);
    showToast('All requests marked as done', 'success');
  };

  const handleComplete = () => {
    const updated = updateTrip(tripId, { status: TripStatus?.COMPLETED });
    if (updated) {
      logTripActivity(tripId, TripActivityType?.TRIP_COMPLETED, 'Trip marked as completed');
      showToast('Trip marked as completed', 'success');
      onComplete();
    } else {
      showToast('Failed to complete trip', 'error');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-semibold text-foreground">Complete Trip</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
          >
            <Icon name="X" size={20} className="text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <p className="text-sm text-muted-foreground">
            Before marking this trip as completed, please review the following checklist:
          </p>

          {/* Checklist Items */}
          <div className="space-y-4">
            {/* 1. Review Preferences */}
            <div className="p-4 bg-muted/30 rounded-lg">
              <div className="flex items-start gap-3">
                <Icon name="FileText" size={20} className="text-primary mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-semibold text-foreground mb-1">Review Trip Preferences</h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    Promote selected preferences to Master for future trips.
                  </p>
                  <Button 
                    variant="outline" 
                    onClick={() => navigate(`/trips/${tripId}/preferences`)}
                    className="flex items-center gap-2"
                  >
                    <Icon name="ExternalLink" size={14} />
                    Go to Preferences
                  </Button>
                </div>
              </div>
            </div>

            {/* 2. Provisioning Learnings */}
            <div className="p-4 bg-muted/30 rounded-lg">
              <div className="flex items-start gap-3">
                <Icon name="Package" size={20} className="text-primary mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-semibold text-foreground mb-1">Flag Provisioning Learnings</h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    Save provisioning insights as a template for future trips (placeholder).
                  </p>
                  <Button variant="outline" disabled className="flex items-center gap-2">
                    <Icon name="Save" size={14} />
                    Save as Template (Coming Soon)
                  </Button>
                </div>
              </div>
            </div>

            {/* 3. Close Outstanding Requests */}
            <div className="p-4 bg-muted/30 rounded-lg">
              <div className="flex items-start gap-3">
                <Icon name="AlertCircle" size={20} className="text-primary mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-semibold text-foreground mb-1">Close Outstanding Requests</h3>
                  {openRequests?.length > 0 ? (
                    <>
                      <p className="text-sm text-muted-foreground mb-3">
                        You have {openRequests?.length} open request{openRequests?.length !== 1 ? 's' : ''}.
                      </p>
                      <div className="space-y-2 mb-3">
                        {openRequests?.map(request => (
                          <div key={request?.id} className="text-sm text-foreground p-2 bg-background rounded">
                            • {request?.title} ({request?.status})
                          </div>
                        ))}
                      </div>
                      <Button 
                        variant="outline" 
                        onClick={handleMarkAllRequestsDone}
                        className="flex items-center gap-2"
                      >
                        <Icon name="Check" size={14} />
                        Mark All as Done
                      </Button>
                    </>
                  ) : (
                    <p className="text-sm text-green-600">✓ All requests are closed.</p>
                  )}
                </div>
              </div>
            </div>

            {/* 4. Lock Trip */}
            <div className="p-4 bg-muted/30 rounded-lg">
              <div className="flex items-start gap-3">
                <Icon name="Lock" size={20} className="text-primary mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-semibold text-foreground mb-1">Lock Trip as Read-Only</h3>
                  <p className="text-sm text-muted-foreground">
                    Once completed, this trip will be read-only for HOD/Crew. Command/Chief can still edit.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleComplete}>
            Mark Trip as Completed
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CompleteTripModal;