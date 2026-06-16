import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import { supabase } from '../../../lib/supabaseClient';
import { useTenant } from '../../../contexts/TenantContext';
import { showToast } from '../../../utils/toast';
import { fetchTenantCrew } from '../utils/tenantCrew';
import {
  fetchMonthStatusesForMonth,
  fetchVesselHorSettings,
  approveMonth,
  reopenMonth,
} from '../utils/horMonthStatus';
import SignOffModal from './SignOffModal';

// Vessel HOR command view — the Captain's fleet oversight of every crew member's
// monthly Hours-of-Rest workflow state, DB-backed (hor_month_status). Submitted
// months can be multi-selected and counter-signed in one signing action; the
// drawn signature is captured once and applied to every selected month.
//
// Per-crew detail (the calendar, breaches, single approve/reopen) lives on the
// crew member's own profile HOR tab — "View" routes there.

const STATUS_META = {
  open:      { label: 'Open',      cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' },
  submitted: { label: 'Submitted', cls: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300' },
  confirmed: { label: 'Confirmed', cls: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' },
  locked:    { label: 'Locked',    cls: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400' },
};

const fmt = (ts) => (ts ? new Date(ts).toLocaleString('en-GB') : '—');

const VesselHORDashboard = ({ currentMonth, onMonthChange, viewerTier }) => {
  const { activeTenantId } = useTenant();
  const navigate = useNavigate();

  const [crew, setCrew] = useState([]);
  const [statuses, setStatuses] = useState({});       // subject_user_id -> hor_month_status row
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selectedIds, setSelectedIds] = useState([]);
  const [signOff, setSignOff] = useState(null);
  const [myName, setMyName] = useState('');

  const year = currentMonth?.getFullYear();
  const jsMonth = currentMonth?.getMonth();
  const monthName = currentMonth?.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const approverTier = settings?.approverTier || 'COMMAND';
  const canApprove = viewerTier === 'COMMAND' || viewerTier === approverTier;

  const load = async () => {
    if (!activeTenantId) return;
    setLoading(true);
    const [crewRows, statusMap, vesselSettings] = await Promise.all([
      fetchTenantCrew(activeTenantId),
      fetchMonthStatusesForMonth({ tenantId: activeTenantId, year, jsMonth }),
      fetchVesselHorSettings(activeTenantId),
    ]);
    setCrew(crewRows);
    setStatuses(statusMap);
    setSettings(vesselSettings);
    setSelectedIds([]);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeTenantId, year, jsMonth]);

  // Current user's name, to prefill the counter-signature.
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data?.user?.id;
      if (!uid) return;
      const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', uid).maybeSingle();
      setMyName(prof?.full_name || '');
    })();
  }, []);

  const rows = useMemo(
    () => crew.map((c) => {
      const statusRow = statuses[c.id] || null;
      return { ...c, status: statusRow?.status || 'open', statusRow };
    }),
    [crew, statuses],
  );

  const departmentOptions = useMemo(() => {
    const set = Array.from(new Set(crew.map((c) => c.department).filter(Boolean))).sort();
    return [{ value: 'All', label: 'All departments' }, ...set.map((d) => ({ value: d, label: d }))];
  }, [crew]);

  const statusOptions = [
    { value: 'All', label: 'All statuses' },
    { value: 'open', label: 'Open' },
    { value: 'submitted', label: 'Submitted' },
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'locked', label: 'Locked' },
  ];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !(`${r.fullName} ${r.roleTitle} ${r.department}`.toLowerCase().includes(q))) return false;
      if (departmentFilter !== 'All' && r.department !== departmentFilter) return false;
      if (statusFilter !== 'All' && r.status !== statusFilter) return false;
      return true;
    });
  }, [rows, search, departmentFilter, statusFilter]);

  // Only submitted months awaiting approval are selectable for counter-sign.
  const selectableIds = useMemo(
    () => filtered.filter((r) => r.status === 'submitted').map((r) => r.id),
    [filtered],
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.includes(id));

  const toggle = (id) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleAll = () =>
    setSelectedIds(allSelected ? [] : selectableIds);

  const openBulkSign = (ids) => {
    const targets = rows.filter((r) => ids.includes(r.id) && r.status === 'submitted');
    if (targets.length === 0) return;
    setSignOff({
      subjectIds: targets.map((r) => r.id),
      title: targets.length === 1 ? 'Counter-sign Hours of Rest' : `Counter-sign ${targets.length} months`,
      declaration:
        targets.length === 1
          ? `I have reviewed the Hours of Rest for ${targets[0].fullName} for ${monthName} and, as Master, approve them as an accurate record.`
          : `I have reviewed the Hours of Rest for the ${targets.length} selected crew members for ${monthName} and, as Master, approve them as accurate records.`,
    });
  };

  // One signature → applied to every selected month. Partial failures are
  // reported but don't abort the batch.
  const runBulkSign = async (signature) => {
    const ids = signOff?.subjectIds || [];
    let ok = 0;
    const errors = [];
    for (const subjectUserId of ids) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await approveMonth({ tenantId: activeTenantId, subjectUserId, year, jsMonth, signature });
        ok += 1;
      } catch (e) {
        errors.push(e?.message || 'error');
      }
    }
    if (ok) showToast(`Counter-signed ${ok} month${ok > 1 ? 's' : ''}`, 'success');
    if (errors.length) showToast(`${errors.length} could not be signed`, 'error');
    await load();
  };

  const handleReopen = async (crewRow) => {
    if (!window.confirm(`Reopen ${crewRow.fullName}'s ${monthName} for corrections? This clears the existing signatures.`)) return;
    try {
      await reopenMonth({ tenantId: activeTenantId, subjectUserId: crewRow.id, year, jsMonth });
      showToast('Month reopened', 'success');
      await load();
    } catch (e) {
      showToast(e?.message || 'Failed to reopen', 'error');
    }
  };

  const viewCrew = (crewRow) => navigate(`/profile/${crewRow.id}?tab=hor`);

  const stepMonth = (dir) => {
    const next = new Date(year, jsMonth + dir, 1);
    if (next > new Date()) return; // no future months
    onMonthChange(next);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-semibold text-foreground">Vessel HOR</h3>
        <p className="text-sm text-muted-foreground mt-1">Monthly sign-off status by crew member</p>
      </div>

      {/* Controls */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        <div className="flex items-center gap-2">
          <button onClick={() => stepMonth(-1)} className="p-2 hover:bg-muted rounded-lg transition-smooth">
            <Icon name="ChevronLeft" size={18} className="text-foreground" />
          </button>
          <span className="text-sm font-medium text-foreground min-w-[140px] text-center">{monthName}</span>
          <button onClick={() => stepMonth(1)} className="p-2 hover:bg-muted rounded-lg transition-smooth">
            <Icon name="ChevronRight" size={18} className="text-foreground" />
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Input placeholder="Search by name, rank, department…" value={search} onChange={(e) => setSearch(e?.target?.value)} icon="Search" />
          <Select value={departmentFilter} onChange={setDepartmentFilter} options={departmentOptions} />
          <Select value={statusFilter} onChange={setStatusFilter} options={statusOptions} />
        </div>
      </div>

      {/* Bulk action bar */}
      {canApprove && selectedIds.length > 0 && (
        <div className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded-xl px-4 py-3">
          <span className="text-sm text-foreground">
            {selectedIds.length} submitted month{selectedIds.length > 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setSelectedIds([])}>Clear</Button>
            <Button onClick={() => openBulkSign(selectedIds)}>
              <Icon name="PenLine" size={16} />
              Counter-sign selected
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/30 border-b border-border">
              <tr>
                {canApprove && (
                  <th className="w-12 p-4">
                    <input
                      type="checkbox"
                      aria-label="Select all submitted"
                      checked={allSelected}
                      disabled={selectableIds.length === 0}
                      onChange={toggleAll}
                      className="w-4 h-4 rounded border-border"
                    />
                  </th>
                )}
                <th className="text-left p-4 text-sm font-medium text-foreground">Crew Member</th>
                <th className="text-left p-4 text-sm font-medium text-foreground">Department</th>
                <th className="text-left p-4 text-sm font-medium text-foreground">Month Status</th>
                <th className="text-left p-4 text-sm font-medium text-foreground">Submitted</th>
                <th className="text-left p-4 text-sm font-medium text-foreground">Counter-signed</th>
                <th className="text-right p-4 text-sm font-medium text-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={canApprove ? 7 : 6} className="p-8 text-center text-muted-foreground">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={canApprove ? 7 : 6} className="p-8 text-center text-muted-foreground">No crew members found</td></tr>
              ) : (
                filtered.map((r) => {
                  const meta = STATUS_META[r.status] || STATUS_META.open;
                  const selectable = r.status === 'submitted';
                  return (
                    <tr key={r.id} className="border-b border-border hover:bg-muted/20 transition-smooth">
                      {canApprove && (
                        <td className="p-4">
                          <input
                            type="checkbox"
                            aria-label={`Select ${r.fullName}`}
                            checked={selectedIds.includes(r.id)}
                            disabled={!selectable}
                            onChange={() => toggle(r.id)}
                            className="w-4 h-4 rounded border-border disabled:opacity-30"
                          />
                        </td>
                      )}
                      <td className="p-4">
                        <div className="text-sm font-medium text-foreground">{r.fullName}</div>
                        <div className="text-xs text-muted-foreground">{r.roleTitle}</div>
                      </td>
                      <td className="p-4"><span className="text-sm text-foreground">{r.department}</span></td>
                      <td className="p-4">
                        <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${meta.cls}`}>{meta.label}</span>
                      </td>
                      <td className="p-4"><span className="text-xs text-muted-foreground">{fmt(r.statusRow?.submitted_at)}</span></td>
                      <td className="p-4">
                        {r.statusRow?.approve_signed_name ? (
                          <div>
                            <div className="text-xs font-medium text-foreground">{r.statusRow.approve_signed_name}</div>
                            <div className="text-xs text-muted-foreground">{fmt(r.statusRow?.confirmed_at)}</div>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center justify-end gap-2">
                          {canApprove && r.status === 'submitted' && (
                            <button onClick={() => openBulkSign([r.id])} className="p-1.5 hover:bg-muted rounded-lg transition-smooth" title="Counter-sign">
                              <Icon name="PenLine" size={16} className="text-foreground" />
                            </button>
                          )}
                          {canApprove && (r.status === 'confirmed') && (
                            <button onClick={() => handleReopen(r)} className="p-1.5 hover:bg-muted rounded-lg transition-smooth" title="Reopen">
                              <Icon name="RotateCcw" size={16} className="text-foreground" />
                            </button>
                          )}
                          <button onClick={() => viewCrew(r)} className="p-1.5 hover:bg-muted rounded-lg transition-smooth" title="View">
                            <Icon name="Eye" size={16} className="text-foreground" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {signOff && (
        <SignOffModal
          isOpen={!!signOff}
          onClose={() => setSignOff(null)}
          onConfirm={runBulkSign}
          title={signOff.title}
          declaration={signOff.declaration}
          periodLabel={monthName}
          defaultName={myName}
          confirmLabel="Sign & approve"
          kind="approve"
        />
      )}
    </div>
  );
};

export default VesselHORDashboard;
