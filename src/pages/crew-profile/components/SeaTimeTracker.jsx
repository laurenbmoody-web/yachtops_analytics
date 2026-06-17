import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Select from '../../../components/ui/Select';
import SeaTimeCalendar from './SeaTimeCalendar';
import DayDetailDrawer from './DayDetailDrawer';
import AddManualEntryModal from './AddManualEntryModal';
import AddVesselLogModal from './AddVesselLogModal';
import ManageCrewAssignmentModal from './ManageCrewAssignmentModal';
import ExportTestimonialModal from './ExportTestimonialModal';
import { getQualificationPaths, getVesselServiceLogForVessel, getActiveCrewForVessel, getCurrentVessel, SEA_SERVICE_TYPE, SEA_SERVICE_TYPE_LABELS } from '../utils/seaTimeStorage';
import * as seaTimeService from '../utils/seaTimeService';
import { hasCommandAccess, loadUsers } from '../../../utils/authStorage';
import { showToast } from '../../../utils/toast';
import { format } from 'date-fns';
import './sea-time.css';

const SeaTimeTracker = ({ userId, tenantId, currentUser }) => {
  const [view, setView] = useState('my'); // 'my' or 'vessel'
  const [selectedPath, setSelectedPath] = useState('mca-oow-yachts');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [calendarData, setCalendarData] = useState({});
  const [progressData, setProgressData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedDayData, setSelectedDayData] = useState(null);
  const [showDayDrawer, setShowDayDrawer] = useState(false);
  const [showAddManualModal, setShowAddManualModal] = useState(false);
  const [showAddVesselLogModal, setShowAddVesselLogModal] = useState(false);
  const [showManageCrewModal, setShowManageCrewModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [vesselLogs, setVesselLogs] = useState([]);
  const [activeCrew, setActiveCrew] = useState([]);

  const isCommand = hasCommandAccess(currentUser);
  const paths = getQualificationPaths();
  const vessel = getCurrentVessel();
  const users = loadUsers();

  // Icon + label per service-type bucket (status never encoded in colour alone).
  const BUCKET_META = {
    [SEA_SERVICE_TYPE.SEAGOING]: { icon: 'Ship', tone: 'text-blue-600 dark:text-blue-400' },
    [SEA_SERVICE_TYPE.WATCHKEEPING]: { icon: 'Compass', tone: 'text-green-600 dark:text-green-400' },
    [SEA_SERVICE_TYPE.STANDBY]: { icon: 'Anchor', tone: 'text-amber-600 dark:text-amber-400' },
    [SEA_SERVICE_TYPE.YARD]: { icon: 'Wrench', tone: 'text-slate-600 dark:text-slate-400' }
  };

  // Load data
  useEffect(() => {
    loadData();
  }, [userId, tenantId, selectedPath, currentMonth, view]);

  const loadData = async () => {
    if (view === 'my') {
      if (!tenantId || !userId) return;
      setLoading(true);
      try {
        const [calendar, progress] = await Promise.all([
          seaTimeService.getMonthCalendarData(tenantId, userId, selectedPath, currentMonth?.getFullYear(), currentMonth?.getMonth()),
          seaTimeService.getProgressSummary(tenantId, userId, selectedPath)
        ]);
        setCalendarData(calendar || {});
        setProgressData(progress);
      } catch (error) {
        console.error('Error loading sea time:', error);
        showToast('Failed to load sea time', 'error');
      } finally {
        setLoading(false);
      }
    } else if (view === 'vessel' && vessel) {
      // Command "Vessel Sea Time" view still runs on the localStorage prototype
      // (Phase 2 attestation cockpit will migrate it).
      setVesselLogs(getVesselServiceLogForVessel(vessel?.id));
      setActiveCrew(getActiveCrewForVessel(vessel?.id));
    }
  };

  const handlePathChange = (newPath) => {
    // Qualification is computed on read against the selected path; just reload.
    setSelectedPath(newPath);
  };

  const handleDateSelect = (date, dayData) => {
    setSelectedDate(date);
    setSelectedDayData(dayData);
    setShowDayDrawer(true);
  };

  const handleDayUpdate = async (entryId, updates) => {
    try {
      // The drawer's "Submit for Verification" passes a verificationStatus; route
      // that through the sign-off RPC. Everything else is a field edit.
      if (updates?.verificationStatus) {
        await seaTimeService.submitEntries(tenantId, [entryId]);
        showToast('Submitted for verification', 'success');
      } else {
        await seaTimeService.updateEntry(entryId, updates);
        showToast('Sea service day updated', 'success');
      }
      await loadData();
    } catch (error) {
      console.error('Error updating day:', error);
      showToast('Update failed', 'error');
    }
  };

  const handleSubmitForVerification = async () => {
    const ids = Object.values(calendarData || {})
      .filter(e => e?.rawVerificationStatus === 'draft')
      .map(e => e?.id);
    if (!ids.length) {
      showToast('No draft days this month to submit', 'info');
      return;
    }
    try {
      await seaTimeService.submitEntries(tenantId, ids);
      showToast(`${ids.length} day(s) submitted for verification`, 'success');
      await loadData();
    } catch (error) {
      console.error('Error submitting:', error);
      showToast('Submit failed', 'error');
    }
  };

  const handleExport = () => {
    setShowExportModal(true);
  };

  const getUserName = (userId) => {
    const user = users?.find(u => u?.id === userId);
    return user?.fullName || 'Unknown';
  };

  const TYPE_COLOR = {
    [SEA_SERVICE_TYPE.SEAGOING]: 'var(--t-seagoing)',
    [SEA_SERVICE_TYPE.WATCHKEEPING]: 'var(--t-watch)',
    [SEA_SERVICE_TYPE.STANDBY]: 'var(--t-standby)',
    [SEA_SERVICE_TYPE.YARD]: 'var(--t-yard)'
  };

  return (
    <div className="stt space-y-5">
      {/* Global Header — editorial */}
      <div className="stt-card feat stt-pad">
        <div className="stt-head">
          <div>
            <div className="stt-eyebrow">Profile · Compliance</div>
            <h2 className="stt-title">Sea Time Tracker</h2>
            <div className="flex items-center gap-3 mt-2" style={{ fontSize: '13px' }}>
              <span className="stt-muted">{currentUser?.roleTitle || 'Crew'}</span>
              <span className="stt-msoft">·</span>
              <select className="stt-select" value={selectedPath} onChange={(e) => handlePathChange(e?.target?.value)}>
                {paths?.map(path => <option key={path?.id} value={path?.id}>{path?.name}</option>)}
              </select>
            </div>
          </div>

          {isCommand && (
            <div className="stt-toggle">
              <button className={view === 'my' ? 'on' : ''} onClick={() => setView('my')}>My Sea Time</button>
              <button className={view === 'vessel' ? 'on' : ''} onClick={() => setView('vessel')}>Vessel Sea Time</button>
            </div>
          )}
        </div>
      </div>
      {/* My Sea Time View — editorial B-workspace */}
      {view === 'my' && (
        <>
          {!tenantId && (
            <div className="stt-notice">
              <Icon name="Info" size={20} style={{ color: 'var(--d-warn)', marginTop: 2 }} />
              <div>
                <p style={{ fontWeight: 700, color: 'var(--d-navy-deep)', fontSize: 14 }}>No active vessel selected</p>
                <p className="stt-muted" style={{ fontSize: 13, marginTop: 4 }}>
                  Sea time is recorded per vessel. Select a vessel to view and log sea service.
                </p>
              </div>
            </div>
          )}

          {/* First-run empty state */}
          {tenantId && !loading && progressData && progressData.totalDays === 0 && (
            <div className="stt-card feat">
              <div className="stt-empty">
                <Icon name="Ship" size={38} style={{ color: 'var(--d-orange)' }} />
                <h3>No sea service logged yet</h3>
                <p>Add your first entry to start building MCA-qualifying sea time. Days classify
                  automatically into seagoing, watchkeeping, standby and shipyard service.</p>
                <button className="stt-btn accent stt-ghost" style={{ width: 'auto', margin: '0 auto' }} onClick={() => setShowAddManualModal(true)}>
                  <Icon name="Plus" size={16} /> Add sea service
                </button>
              </div>
            </div>
          )}

          {tenantId && progressData && progressData.totalDays > 0 && (
            <div className="stt-grid">
              {/* LEFT RAIL — progress + service mix + actions */}
              <div className="stt-stack">
                <div className="stt-card feat stt-pad">
                  <div className="flex items-start justify-between gap-3" style={{ marginBottom: 6 }}>
                    <div>
                      <div className="stt-lbl">{progressData.pathName}</div>
                      {progressData.reference && <div className="stt-msoft" style={{ fontSize: 11, marginTop: 2 }}>{progressData.reference}</div>}
                    </div>
                    {progressData.reviewStatus !== 'VERIFIED' && (
                      <span className="stt-badge-uv"><Icon name="ShieldAlert" size={13} /> Draft</span>
                    )}
                  </div>

                  {progressData.requirements?.map(req => (
                    <div key={req.id} className="stt-req">
                      <div className="stt-req-top">
                        <div className="stt-req-name">{req.label}{req.gateLabel && <span className="stt-gate">{req.gateLabel}</span>}</div>
                        <div className="stt-req-count"><b>{req.verified}</b> <span className="stt-muted">/ {req.target}</span></div>
                      </div>
                      <div className="stt-bar" role="progressbar" aria-valuenow={req.verified} aria-valuemin={0} aria-valuemax={req.target}
                        aria-label={`${req.label}: ${req.verified} of ${req.target} verified days`}>
                        <div className="logged" style={{ width: `${req.percentLogged}%` }}></div>
                        <div className="verified" style={{ width: `${req.percentComplete}%` }}></div>
                      </div>
                      <div className="stt-req-legend">
                        <span className="v"><Icon name="Check" size={12} /> {req.verified} verified</span>
                        <span className="p"><Icon name="Clock" size={12} /> {req.pending} pending</span>
                        <span className="r">{req.remaining} to go</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Service mix */}
                <div className="stt-card stt-pad">
                  <div className="stt-lbl" style={{ marginBottom: 10 }}>Service mix · {progressData.totalDays} days</div>
                  {[SEA_SERVICE_TYPE.SEAGOING, SEA_SERVICE_TYPE.WATCHKEEPING, SEA_SERVICE_TYPE.STANDBY, SEA_SERVICE_TYPE.YARD].map(type => (
                    <div key={type} className="stt-mix-row">
                      <span className="stt-mix-name" style={{ color: TYPE_COLOR[type] }}>
                        <Icon name={BUCKET_META?.[type]?.icon} size={15} /> {SEA_SERVICE_TYPE_LABELS[type]}
                      </span>
                      <b>{progressData.buckets?.[type] || 0}</b>
                    </div>
                  ))}
                </div>

                <div className="stt-stack" style={{ gap: 10 }}>
                  <button className="stt-btn accent" onClick={() => setShowAddManualModal(true)}><Icon name="Plus" size={16} /> Add sea service</button>
                  <button className="stt-btn" onClick={handleExport}><Icon name="FileCheck" size={16} /> Generate testimonial</button>
                </div>
              </div>

              {/* RIGHT — calendar + verification */}
              <div className="stt-stack">
                <div className="stt-card stt-pad">
                  <SeaTimeCalendar
                    userId={userId}
                    currentMonth={currentMonth}
                    onMonthChange={setCurrentMonth}
                    onDateSelect={handleDateSelect}
                    calendarData={calendarData}
                  />
                </div>

                <div className="stt-card stt-pad">
                  <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
                    <div className="stt-lbl">Verification</div>
                    <button className="stt-btn primary stt-ghost" style={{ width: 'auto' }} onClick={handleSubmitForVerification}>
                      <Icon name="Send" size={14} /> Submit {progressData.statusCounts?.draft || 0} draft days
                    </button>
                  </div>
                  <div className="stt-vstat">
                    <div className="cell">
                      <div className="n">{progressData.statusCounts?.signed || 0}</div>
                      <div className="l" style={{ color: 'var(--d-sage-deep)' }}><Icon name="Check" size={12} /> Captain signed</div>
                    </div>
                    <div className="cell">
                      <div className="n">{progressData.statusCounts?.pending || 0}</div>
                      <div className="l" style={{ color: 'var(--d-warn)' }}><Icon name="Clock" size={12} /> Pending</div>
                    </div>
                    <div className="cell">
                      <div className="n">{progressData.statusCounts?.draft || 0}</div>
                      <div className="l stt-msoft"><Icon name="FileText" size={12} /> Draft</div>
                    </div>
                  </div>
                  {progressData.statusCounts?.rejected > 0 && (
                    <p style={{ fontSize: 12, color: 'var(--d-warn)', marginTop: 10 }}>
                      {progressData.statusCounts.rejected} day(s) were rejected — open them in the calendar for the reason.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
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
                          <span className="inline-block px-2 py-1 rounded-full text-xs font-medium bg-indigo-500/20 text-indigo-700 dark:text-indigo-400">
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
                            <span className="inline-block px-2 py-1 rounded-full text-xs font-medium bg-indigo-500/20 text-indigo-700 dark:text-indigo-400">
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
        tenantId={tenantId}
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
      <ExportTestimonialModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        userId={userId}
        tenantId={tenantId}
        currentUser={currentUser}
      />
    </div>
  );
};

export default SeaTimeTracker;