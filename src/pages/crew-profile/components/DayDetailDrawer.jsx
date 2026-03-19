import React from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { VERIFICATION_STATUS, SEA_SERVICE_SOURCE, SEA_SERVICE_STATE } from '../utils/seaTimeStorage';
import { format } from 'date-fns';

const DayDetailDrawer = ({ isOpen, onClose, selectedDate, dayData, onUpdate }) => {
  if (!isOpen || !selectedDate) return null;

  const getStatusLabel = () => {
    if (!dayData) return 'No sea service recorded';

    if (dayData?.state === SEA_SERVICE_STATE?.VERIFIED) {
      return 'Qualifying & Verified';
    } else if (dayData?.state === SEA_SERVICE_STATE?.PENDING) {
      return 'Pending Verification';
    } else if (dayData?.state === SEA_SERVICE_STATE?.MANUAL) {
      return 'Manual Entry (Unverified)';
    } else if (dayData?.state === SEA_SERVICE_STATE?.NON_QUALIFYING) {
      return 'Not Qualifying';
    }

    return 'Unknown Status';
  };

  const getStatusColor = () => {
    if (!dayData) return 'text-muted-foreground';

    if (dayData?.state === SEA_SERVICE_STATE?.VERIFIED) {
      return 'text-green-600 dark:text-green-400';
    } else if (dayData?.state === SEA_SERVICE_STATE?.PENDING) {
      return 'text-yellow-600 dark:text-yellow-400';
    } else if (dayData?.state === SEA_SERVICE_STATE?.MANUAL) {
      return 'text-gray-600 dark:text-gray-400';
    } else if (dayData?.state === SEA_SERVICE_STATE?.NON_QUALIFYING) {
      return 'text-blue-600 dark:text-blue-400';
    }

    return 'text-muted-foreground';
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={onClose}
      ></div>
      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-background border-l border-border z-50 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-background border-b border-border p-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-foreground">
              {format(selectedDate, 'dd MMMM yyyy')}
            </h2>
            <p className={`text-sm font-medium mt-1 ${getStatusColor()}`}>
              {getStatusLabel()}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-accent rounded-lg transition-smooth"
          >
            <Icon name="X" size={20} className="text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {!dayData ? (
            <div className="text-center py-8">
              <Icon name="Calendar" size={48} className="text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No sea service recorded for this date</p>
            </div>
          ) : (
            <>
              {/* Qualification Section */}
              <div className="bg-card border border-border rounded-xl p-4">
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Icon name="Award" size={16} className="text-primary" />
                  Qualification
                </h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Qualifies for path:</span>
                    <span className={`text-sm font-medium ${
                      dayData?.qualifiesForSelectedPath
                        ? 'text-green-600 dark:text-green-400' :'text-red-600 dark:text-red-400'
                    }`}>
                      {dayData?.qualifiesForSelectedPath ? 'YES' : 'NO'}
                    </span>
                  </div>
                  {!dayData?.qualifiesForSelectedPath && dayData?.nonQualifyingReasons && (
                    <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                      <p className="text-xs font-semibold text-red-600 dark:text-red-400 mb-2">
                        Why not qualifying:
                      </p>
                      <ul className="text-xs text-red-600 dark:text-red-400 space-y-1">
                        {dayData?.nonQualifyingReasons?.map((reason, index) => (
                          <li key={index}>• {reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              {/* Verification Section */}
              <div className="bg-card border border-border rounded-xl p-4">
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Icon name="CheckCircle" size={16} className="text-primary" />
                  Verification
                </h3>
                <div className="space-y-2">
                  {dayData?.verificationStatus === VERIFICATION_STATUS?.VERIFIED && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Status:</span>
                        <span className="text-sm font-medium text-green-600 dark:text-green-400">
                          Verified
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Verified by:</span>
                        <span className="text-sm font-medium text-foreground">
                          {dayData?.verifiedBy || 'Command'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Verified date:</span>
                        <span className="text-sm font-medium text-foreground">
                          {dayData?.verifiedAt ? format(new Date(dayData.verifiedAt), 'dd MMM yyyy') : 'N/A'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Source:</span>
                        <span className="text-sm font-medium text-foreground">
                          {dayData?.source === SEA_SERVICE_SOURCE?.VESSEL_AUTO ? 'Vessel log (Cargo)' : 'Manual entry'}
                        </span>
                      </div>
                    </>
                  )}
                  {dayData?.verificationStatus === VERIFICATION_STATUS?.SUBMITTED && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Status:</span>
                        <span className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
                          Submitted
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Submitted date:</span>
                        <span className="text-sm font-medium text-foreground">
                          {dayData?.submittedAt ? format(new Date(dayData.submittedAt), 'dd MMM yyyy') : 'N/A'}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        Awaiting verification from Command
                      </p>
                    </>
                  )}
                  {dayData?.verificationStatus === VERIFICATION_STATUS?.NOT_SUBMITTED && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Status:</span>
                        <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                          Not Submitted
                        </span>
                      </div>
                      <Button
                        onClick={() => onUpdate?.(dayData?.id, { verificationStatus: VERIFICATION_STATUS?.SUBMITTED, submittedAt: new Date()?.toISOString() })}
                        variant="outline"
                        className="w-full mt-3"
                      >
                        Submit for Verification
                      </Button>
                    </>
                  )}
                  {dayData?.source === SEA_SERVICE_SOURCE?.MANUAL && (
                    <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                      <p className="text-xs text-yellow-600 dark:text-yellow-400">
                        Manual entry (unverified). Requires external verification.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Vessel Details Section */}
              <div className="bg-card border border-border rounded-xl p-4">
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Icon name="Ship" size={16} className="text-primary" />
                  Vessel Details
                </h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Vessel:</span>
                    <span className="text-sm font-medium text-foreground">
                      {dayData?.vesselName || 'N/A'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Status:</span>
                    <span className="text-sm font-medium text-foreground">
                      {dayData?.vesselStatus || 'N/A'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Capacity served:</span>
                    <span className="text-sm font-medium text-foreground">
                      {dayData?.capacityServed || 'N/A'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Notes Section */}
              <div className="bg-card border border-border rounded-xl p-4">
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Icon name="FileText" size={16} className="text-primary" />
                  Notes / Reason
                </h3>
                <textarea
                  value={dayData?.noteReason || ''}
                  onChange={(e) => onUpdate?.(dayData?.id, { noteReason: e?.target?.value })}
                  placeholder="Add notes or reason for this entry..."
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[100px]"
                />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default DayDetailDrawer;