import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { supabase } from '../../../lib/supabaseClient';
import LogoSpinner from '../../../components/LogoSpinner';
import { showToast } from '../../../utils/toast';
import {
  CREW_STATUSES, getStatusLabel, getStatusCellClass,
  buildStatusPeriods, getStatusForDay,
} from '../../../utils/crewStatus';
import { fetchProfileActivity, ACTIVITY_CATEGORIES, activityCat } from '../utils/profileActivity';
import {
  CALENDAR_KINDS, calKind, TRANSPORTS, travelSummary,
  fetchCalendarEntries, saveCalendarEntry, deleteCalendarEntry, entryForDay,
} from '../utils/crewCalendar';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const fmtDay = (d) => {
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(x.getDate())}/${p(x.getMonth() + 1)}/${x.getFullYear()}`;
};
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
const today0 = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };
const todayIso = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

// ── Status month-grid calendar (entries colour the days) ─────────────────────
function MonthCalendar({ periods, entries, onDayEntry }) {
  const today = today0();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const totalDays = daysInMonth(calYear, calMonth);
  const firstDow = (new Date(calYear, calMonth, 1).getDay() + 6) % 7;

  const prev = () => { if (calMonth === 0) { setCalYear((y) => y - 1); setCalMonth(11); } else setCalMonth((m) => m - 1); };
  const next = () => { if (calMonth === 11) { setCalYear((y) => y + 1); setCalMonth(0); } else setCalMonth((m) => m + 1); };
  const goToday = () => { setCalYear(today.getFullYear()); setCalMonth(today.getMonth()); };

  const cells = [...Array(firstDow).fill(null), ...Array.from({ length: totalDays }, (_, i) => i + 1)];

  return (
    <div className="act-cal">
      <div className="act-cal-nav">
        <button type="button" onClick={prev} aria-label="Previous month"><Icon name="ChevronLeft" size={16} /></button>
        <span>{MONTHS[calMonth]} {calYear}</span>
        <button type="button" onClick={next} aria-label="Next month"><Icon name="ChevronRight" size={16} /></button>
        <button type="button" className="act-cal-today" onClick={goToday}>Today</button>
      </div>
      <div className="act-mgrid act-mhead">{WEEKDAYS.map((w) => <div key={w} className="act-mwd">{w}</div>)}</div>
      <div className="act-mgrid">
        {cells.map((d, i) => {
          if (d === null) return <div key={`b${i}`} className="act-mcell is-blank" />;
          const day = new Date(calYear, calMonth, d);
          const entry = entryForDay(entries, day);
          const stat = entry ? calKind(entry.kind).status : getStatusForDay(periods, day);
          const label = entry ? calKind(entry.kind).label : (stat ? getStatusLabel(stat) : '');
          const isToday = day.getTime() === today.getTime();
          return (
            <div
              key={d}
              title={`${d} ${MONTHS[calMonth]}: ${label || 'No data'}${entry && travelSummary(entry) ? ` — ${travelSummary(entry)}` : ''}`}
              className={`act-mcell ${stat ? getStatusCellClass(stat) : 'act-mcell-empty'} ${day > today ? 'is-future' : ''} ${isToday ? 'is-today' : ''} ${entry ? 'has-entry' : ''}`}
              onClick={entry && onDayEntry ? () => onDayEntry(entry) : undefined}
              style={entry && onDayEntry ? { cursor: 'pointer' } : undefined}
            >
              <span className="act-mnum">{d}</span>
              {label && <span className="act-mstat">{entry?.transport_no || label}</span>}
            </div>
          );
        })}
      </div>
      <div className="act-cal-legend">
        {CREW_STATUSES.map(({ value, label }) => (
          <span key={value}><i className={`act-sw ${getStatusCellClass(value)}`} />{label}</span>
        ))}
      </div>
    </div>
  );
}

const blankEntry = () => ({
  kind: 'leave', startDate: todayIso(), endDate: todayIso(),
  fromLocation: '', toLocation: '', transport: '', transportNo: '', departTime: '', arriveTime: '', note: '',
});

const StatusHistoryTab = ({ userId, tenantId, canManage, currentUserId, currentUserName }) => {
  const [activity, setActivity] = useState([]);
  const [statusRows, setStatusRows] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('timeline');
  const [filter, setFilter] = useState('all');

  const [entryOpen, setEntryOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankEntry());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    const [acts, sh, ents] = await Promise.all([
      fetchProfileActivity(userId),
      supabase.from('crew_status_history').select('*').eq('user_id', userId).order('changed_at', { ascending: true }),
      fetchCalendarEntries(userId),
    ]);
    setActivity(acts);
    setStatusRows(sh.data || []);
    setEntries(ents);
    setLoading(false);
  }, [userId]);
  useEffect(() => { load(); }, [load, tenantId]);

  const periods = buildStatusPeriods(statusRows);
  const presentCats = ACTIVITY_CATEGORIES.filter((c) => activity.some((e) => e.category === c.id));
  const shown = filter === 'all' ? activity : activity.filter((e) => e.category === filter);

  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const openAdd = () => { setEditing(null); setForm(blankEntry()); setEntryOpen(true); };
  const openEdit = (e) => {
    setEditing(e);
    setForm({
      kind: e.kind || 'leave', startDate: String(e.start_date).slice(0, 10), endDate: String(e.end_date).slice(0, 10),
      fromLocation: e.from_location || '', toLocation: e.to_location || '', transport: e.transport || '',
      transportNo: e.transport_no || '', departTime: e.depart_time || '', arriveTime: e.arrive_time || '', note: e.note || '',
    });
    setEntryOpen(true);
  };

  const saveEntry = async () => {
    if (!form.startDate) { showToast('Pick a start date', 'error'); return; }
    if (form.endDate && form.endDate < form.startDate) { showToast('End date is before the start date', 'error'); return; }
    setBusy(true);
    try {
      await saveCalendarEntry({
        id: editing?.id, userId, tenantId, actorId: currentUserId, actorName: currentUserName, ...form,
      });
      showToast(editing ? 'Entry updated' : 'Entry added', 'success');
      setEntryOpen(false);
      load();
    } catch (e) { showToast(e.message || 'Could not save entry', 'error'); }
    finally { setBusy(false); }
  };

  const removeEntry = async (e) => {
    if (!window.confirm(`Remove this ${calKind(e.kind).label.toLowerCase()} entry?`)) return;
    try { await deleteCalendarEntry(e.id); showToast('Entry removed', 'success'); load(); }
    catch { showToast('Delete failed', 'error'); }
  };

  return (
    <div>
      <div className="cd-controls" style={{ marginTop: 0 }}>
        <div className="cp-section-head">
          <span className="cp-section-num">08 /</span>
          <h3>Activity</h3>
        </div>
        <div className="cd-seg">
          <button type="button" className={view === 'timeline' ? 'on' : ''} onClick={() => setView('timeline')}>Timeline</button>
          <button type="button" className={view === 'calendar' ? 'on' : ''} onClick={() => setView('calendar')}>Status calendar</button>
        </div>
      </div>
      <p className="kit-sub">Everything recorded on this profile — status, leave &amp; travel, documents, kit, compliance, banking and profile edits.</p>

      {loading ? (
        <div className="flex items-center justify-center py-16"><LogoSpinner size={32} /></div>
      ) : view === 'calendar' ? (
        <>
          {canManage && (
            <div className="flex justify-end mb-3">
              <Button variant="outline" size="sm" iconName="Plus" onClick={openAdd}>Add leave / travel</Button>
            </div>
          )}
          <MonthCalendar periods={periods} entries={entries} onDayEntry={canManage ? openEdit : undefined} />

          {entries.length > 0 && (
            <div className="cp-group" style={{ marginTop: 22 }}>
              <div className="cp-group-head"><span className="dia">◆</span><span className="t">Leave &amp; travel</span><span className="line" /></div>
              <div className="space-y-2">
                {entries.map((e) => (
                  <div key={e.id} className="cp-doc-row">
                    <div className="min-w-0">
                      <div className="cp-doc-title">{calKind(e.kind).label} · {fmtDay(e.start_date)}{String(e.end_date).slice(0, 10) !== String(e.start_date).slice(0, 10) ? ` – ${fmtDay(e.end_date)}` : ''}</div>
                      <div className="cp-doc-meta">
                        {travelSummary(e) && <span>{travelSummary(e)}</span>}
                        {(e.depart_time || e.arrive_time) && <span>{[e.depart_time, e.arrive_time].filter(Boolean).join(' – ')}</span>}
                        {e.note && <span>{e.note}</span>}
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button onClick={() => openEdit(e)} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground" title="Edit"><Icon name="Pencil" size={15} /></button>
                        <button onClick={() => removeEntry(e)} className="p-1.5 hover:bg-red-50 rounded-lg text-red-500" title="Remove"><Icon name="Trash2" size={15} /></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {presentCats.length > 0 && (
            <div className="act-pills">
              <button type="button" className={`act-pill ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>All</button>
              {presentCats.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`act-pill ${filter === c.id ? 'on' : ''}`}
                  onClick={() => setFilter(c.id)}
                  style={filter === c.id ? { borderColor: c.color, color: c.color, background: c.bg } : undefined}
                >{c.label}</button>
              ))}
            </div>
          )}
          {shown.length === 0 ? (
            <p className="cd-muted">No activity recorded yet.</p>
          ) : (
            <div className="act-list">
              {shown.map((e) => {
                const c = activityCat(e.category);
                return (
                  <div key={e.id} className="act-item">
                    <span className="act-ic" style={{ background: c.bg }}><Icon name={c.icon} size={15} style={{ color: c.color }} /></span>
                    <div className="act-body">
                      <div className="act-title">{e.title}</div>
                      {e.detail && <div className="act-detail">{e.detail}</div>}
                      {e.actor && <div className="act-actor">by {e.actor}</div>}
                    </div>
                    <div className="act-when">{fmtDay(e.at)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Add / edit leave-travel modal */}
      {entryOpen && (
        <div className="kit-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setEntryOpen(false); }}>
          <div className="kit-panel">
            <div className="kit-panel-head">
              <h4>{editing ? 'Edit entry' : 'Add leave / travel'}</h4>
              <button onClick={() => setEntryOpen(false)} className="kit-x" title="Close"><Icon name="X" size={18} /></button>
            </div>
            <div className="kit-form">
              <label className="kit-field"><span>Type</span>
                <select value={form.kind} onChange={(e) => setF('kind', e.target.value)}>
                  {CALENDAR_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                </select>
              </label>
              <label className="kit-field"><span>Transport</span>
                <select value={form.transport} onChange={(e) => setF('transport', e.target.value)}>
                  <option value="">—</option>
                  {TRANSPORTS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="kit-field"><span>Start date <em>required</em></span>
                <input type="date" value={form.startDate} onChange={(e) => setF('startDate', e.target.value)} />
              </label>
              <label className="kit-field"><span>End date</span>
                <input type="date" value={form.endDate} onChange={(e) => setF('endDate', e.target.value)} />
              </label>
              <label className="kit-field"><span>From</span>
                <input value={form.fromLocation} onChange={(e) => setF('fromLocation', e.target.value)} placeholder="e.g. London (LHR)" />
              </label>
              <label className="kit-field"><span>To</span>
                <input value={form.toLocation} onChange={(e) => setF('toLocation', e.target.value)} placeholder="e.g. Nice (NCE)" />
              </label>
              <label className="kit-field"><span>Flight / transport no.</span>
                <input value={form.transportNo} onChange={(e) => setF('transportNo', e.target.value)} placeholder="e.g. BA342" />
              </label>
              <div className="kit-field" style={{ flexDirection: 'row', gap: 10 }}>
                <label className="kit-field" style={{ flex: 1 }}><span>Depart</span>
                  <input value={form.departTime} onChange={(e) => setF('departTime', e.target.value)} placeholder="e.g. 09:40" />
                </label>
                <label className="kit-field" style={{ flex: 1 }}><span>Arrive</span>
                  <input value={form.arriveTime} onChange={(e) => setF('arriveTime', e.target.value)} placeholder="e.g. 12:55" />
                </label>
              </div>
              <label className="kit-field kit-col-2"><span>Note <em>optional</em></span>
                <input value={form.note} onChange={(e) => setF('note', e.target.value)} placeholder="anything worth recording" />
              </label>
            </div>
            <div className="kit-panel-foot">
              <Button variant="outline" size="sm" onClick={() => setEntryOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={saveEntry} disabled={busy}>{editing ? 'Save' : 'Add entry'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StatusHistoryTab;
