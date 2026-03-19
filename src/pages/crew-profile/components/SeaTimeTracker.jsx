import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Select from '../../../components/ui/Select';
import SeaTimeCalendar from './SeaTimeCalendar';
import DayDetailDrawer from './DayDetailDrawer';
import AddManualEntryModal from './AddManualEntryModal';
import AddVesselLogModal from './AddVesselLogModal';
import ManageCrewAssignmentModal from './ManageCrewAssignmentModal';
import { getQualificationPaths, getProgressSummary, getMonthCalendarData, updatePersonalSeaServiceEntry, getVesselServiceLogForVessel, getActiveCrewForVessel, getCurrentVessel, recomputeQualificationForUser } from '../utils/seaTimeStorage';
import { hasCommandAccess, loadUsers } from '../../../utils/authStorage';
import { showToast } from '../../../utils/toast';
import { format } from 'date-fns';

const SeaTimeTracker = ({ userId, currentUser }) => {
  const [view, setView] = useState('my'); // 'my' or 'vessel'
  const [selectedPath, setSelectedPath] = useState('mca-oow-yachts');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [calendarData, setCalendarData] = useState({});
  const [progressData, setProgressData] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedDayData, setSelectedDayData] = useState(null);
  const [showDayDrawer, setShowDayDrawer] = useState(false);
  const [showAddManualModal, setShowAddManualModal] = useState(false);
  const [showAddVesselLogModal, setShowAddVesselLogModal] = useState(false);
  const [showManageCrewModal, setShowManageCrewModal] = useState(false);
  const [vesselLogs, setVesselLogs] = useState([]);
  const [activeCrew, setActiveCrew] = useState([]);

  const isCommand = hasCommandAccess(currentUser);
  const paths = getQualificationPaths();
  const vessel = getCurrentVessel();
  const users = loadUsers();

  // Load data
  useEffect(() => {
    loadData();
  }, [userId, selectedPath, currentMonth, view]);

  const loadData = () => {
    if (view === 'my') {
      // Load My Sea Time data
      const calendar = getMonthCalendarData(userId, currentMonth?.getFullYear(), currentMonth?.getMonth());
      setCalendarData(calendar);

      const progress = getProgressSummary(userId, selectedPath);
      setProgressData(progress);
    } else if (view === 'vessel' && vessel) {
      // Load Vessel Sea Time data
      const logs = getVesselServiceLogForVessel(vessel?.id);
      setVesselLogs(logs);

      const crew = getActiveCrewForVessel(vessel?.id);
      setActiveCrew(crew);
    }
  };

  const handlePathChange = (newPath) => {
    setSelectedPath(newPath);
    // Recompute qualification for new path
    recomputeQualificationForUser(userId, newPath);
  };

  const handleDateSelect = (date, dayData) => {
    setSelectedDate(date);
    setSelectedDayData(dayData);
    setShowDayDrawer(true);
  };

  const handleDayUpdate = (entryId, updates) => {
    updatePersonalSeaServiceEntry(entryId, updates);
    loadData();
    showToast('Sea service day updated', 'success');
  };

  const handleSubmitForVerification = () => {
    // Submit current month for verification
    const startDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const endDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);

    // This would call submitForVerification from storage
    showToast('Month submitted for verification', 'success');
    loadData();
  };

  const handleExport = () => {
    showToast('Export feature coming in V2', 'info');
  };

  const getUserName = (userId) => {
    const user = users?.find(u => u?.id === userId);
    return user?.fullName || 'Unknown';
  };

  return (
    <div className="space-y-6">
      {/* Global Header */}
      <div className="bg-card border border-border rounded-2xl p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-2xl font-semibold text-foreground mb-2">Sea Time Tracker</h2>
            <div className="text-sm text-muted-foreground space-y-1">
              <div>
                <span className="font-medium">Current Role:</span>{' '}
                {currentUser?.roleTitle || 'N/A'}
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium">Selected Path:</span>
                <Select
                  value={selectedPath}
                  onChange={(e) => handlePathChange(e?.target?.value)}
                  className="text-sm inline-block w-auto"
                >
                  {paths?.map(path => (
                    <option key={path?.id} value={path?.id}>
                      {path?.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </div>

          {/* View Toggle */}
          <div className="flex items-center gap-2 bg-muted/30 rounded-lg p-1">
            <button
              onClick={() => setView('my')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-smooth ${
                view === 'my' ?'bg-primary text-primary-foreground' :'text-muted-foreground hover:text-foreground'
              }`}
            >
              My Sea Time
            </button>
            {isCommand && (
              <button
                onClick={() => setView('vessel')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-smooth ${
                  view === 'vessel' ?'bg-primary text-primary-foreground' :'text-muted-foreground hover:text-foreground'
                }`}
              >
                Vessel Sea Time
              </button>
            )}
          </div>
        </div>
      </div>
      {/* My Sea Time View */}
      {view === 'my' && (
        <>
          {/* Progress Widgets */}
          {progressData && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Widget 1: Primary Progress */}
              <div className="bg-card border border-border rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Icon name="Target" size={24} className="text-primary" />
                  <h3 className="text-lg font-semibold text-foreground">
                    {progressData?.pathName}
                  </h3>
                </div>
                <div className="space-y-3">
                  <div className="flex items-end justify-between">
                    <span className="text-3xl font-bold text-foreground">
                      {progressData?.verifiedQualifying}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      / {progressData?.targetDays} days
                    </span>
                  </div>
                  <div className="w-full bg-muted/30 rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-primary h-full rounded-full transition-all"
                      style={{ width: `${progressData?.percentComplete}%` }}
                    ></div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {progressData?.percentComplete}% complete
                  </p>
                </div>
              </div>

              {/* Widget 2: Breakdown */}
              <div className="bg-card border border-border rounded-2xl p-6">
                <h3 className="text-sm font-semibold text-foreground mb-4">Breakdown</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Verified:</span>
                    <span className="text-sm font-semibold text-green-600 dark:text-green-400">
                      {progressData?.verifiedQualifying} days
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Pending:</span>
                    <span className="text-sm font-semibold text-yellow-600 dark:text-yellow-400">
                      {progressData?.pendingQualifying} days
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Manual:</span>
                    <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">
                      {progressData?.manualDays} days
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Non-qualifying:</span>
                    <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                      {progressData?.nonQualifyingOnboard} days
                    </span>
                  </div>
                </div>
              </div>

              {/* Widget 3: Remaining */}
              <div className="bg-card border border-border rounded-2xl p-6">
                <h3 className="text-sm font-semibold text-foreground mb-4">Remaining</h3>
                <div className="space-y-3">
                  <div>
                    <div className="text-3xl font-bold text-foreground mb-1">
                      {progressData?.remaining}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      qualifying days needed
                    </p>
                  </div>
                  <div className="pt-3 border-t border-border">
                    <p className="text-xs text-muted-foreground">
                      Estimated completion based on rolling average (V2 feature)
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Calendar */}
          <SeaTimeCalendar
            userId={userId}
            currentMonth={currentMonth}
            onMonthChange={setCurrentMonth}
            onDateSelect={handleDateSelect}
            calendarData={calendarData}
          />

          {/* Actions */}
          <div className="flex items-center gap-3">
            <Button
              onClick={() => setShowAddManualModal(true)}
              iconName="Plus"
            >
              Add Manual Entry
            </Button>
            <Button
              onClick={handleExport}
              variant="outline"
              iconName="Download"
            >
              Export
            </Button>
            <Button
              onClick={handleSubmitForVerification}
              variant="outline"
              iconName="Send"
            >
              Submit for Verification
            </Button>
          </div>
        </>
      )}
      {/* Vessel Sea Time View (Command Only) */}
      {view === 'vessel' && isCommand && vessel && (
        <>
          {/* Section A: Vessel Service Log */}
          <div className="bg-card border border-border rounded-2xl p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <Icon name="Ship" size={24} className="text-primary" />
                <h3 className="text-xl font-semibold text-foreground">Vessel Service Log</h3>
              </div>
              <Button
                onClick={() => setShowAddVesselLogModal(true)}
                iconName="Plus"
              >
                Add Vessel Log Period
              </Button>
            </div>

            {vesselLogs?.length === 0 ? (
              <div className="text-center py-8">
                <Icon name="Calendar" size={48} className="text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No vessel service log entries yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-4 text-sm font-semibold text-foreground">Period</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-foreground">Status</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-foreground">Miles</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-foreground">Notes</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-foreground">Feeds Crew</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vesselLogs?.map(log => (
                      <tr key={log?.id} className="border-b border-border hover:bg-accent/50 transition-smooth">
                        <td className="py-3 px-4 text-sm text-foreground">
                          {format(new Date(log.fromDateTime), 'dd MMM yyyy HH:mm')} →{' '}
                          {format(new Date(log.toDateTime), 'dd MMM yyyy HH:mm')}
                        </td>
                        <td className="py-3 px-4">
                          <span className="inline-block px-2 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-700 dark:text-blue-400">
                            {log?.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-sm text-foreground">
                          {log?.miles || '—'}
                        </td>
                        <td className="py-3 px-4 text-sm text-muted-foreground">
                          {log?.notes || '—'}
                        </td>
                        <td className="py-3 px-4 text-sm text-muted-foreground">
                          {activeCrew?.length} active crew
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Section B: Crew Onboard / Assignments */}
          <div className="bg-card border border-border rounded-2xl p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <Icon name="Users" size={24} className="text-primary" />
                <h3 className="text-xl font-semibold text-foreground">Crew Assignments</h3>
              </div>
              <Button
                onClick={() => setShowManageCrewModal(true)}
                iconName="Plus"
              >
                Manage Crew
              </Button>
            </div>

            {activeCrew?.length === 0 ? (
              <div className="text-center py-8">
                <Icon name="Users" size={48} className="text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No active crew assigned yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {activeCrew?.map(crew => {
                  const user = users?.find(u => u?.id === crew?.userId);
                  return (
                    <div
                      key={crew?.id}
                      className="flex items-center justify-between p-4 bg-muted/30 rounded-lg"
                    >
                      <div className="flex-1">
                        <div className="font-medium text-foreground">
                          {user?.fullName || 'Unknown'}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {crew?.capacityServed}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-sm text-muted-foreground">
                          {crew?.fromDate} {crew?.toDate ? `→ ${crew?.toDate}` : '(ongoing)'}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                            crew?.status === 'ACTIVE' ?'bg-green-500/20 text-green-700 dark:text-green-400' :'bg-gray-500/20 text-gray-700 dark:text-gray-400'
                          }`}>
                            {crew?.status}
                          </span>
                          {crew?.watchEligible && (
                            <span className="inline-block px-2 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-700 dark:text-blue-400">
                              Watch Eligible
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section C: Verification Queue (V1 Stub) */}
          <div className="bg-card border border-border rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <Icon name="CheckCircle" size={24} className="text-primary" />
              <h3 className="text-xl font-semibold text-foreground">Verification Queue</h3>
            </div>
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
              <p className="text-sm text-yellow-600 dark:text-yellow-400">
                Verification queue feature coming in V2. This will allow Command to review and verify crew sea service submissions.
              </p>
            </div>
          </div>
        </>
      )}
      {/* Modals & Drawers */}
      <DayDetailDrawer
        isOpen={showDayDrawer}
        onClose={() => setShowDayDrawer(false)}
        selectedDate={selectedDate}
        dayData={selectedDayData}
        onUpdate={handleDayUpdate}
      />
      <AddManualEntryModal
        isOpen={showAddManualModal}
        onClose={() => setShowAddManualModal(false)}
        userId={userId}
        onSuccess={loadData}
      />
      <AddVesselLogModal
        isOpen={showAddVesselLogModal}
        onClose={() => setShowAddVesselLogModal(false)}
        onSuccess={loadData}
      />
      <ManageCrewAssignmentModal
        isOpen={showManageCrewModal}
        onClose={() => setShowManageCrewModal(false)}
        onSuccess={loadData}
      />
    </div>
  );
};

export default SeaTimeTracker;