import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { supabase } from '../../../lib/supabaseClient';
import LogoSpinner from '../../../components/LogoSpinner';
import { showToast } from '../../../utils/toast';
import {
  CREW_STATUSES, getStatusLabel,
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

// Soft, low-saturation status tints — gentler than the shared cell classes.
const SOFT = {
  active: { bg: '#E7F6EC', ink: '#2E7D52' },
  on_leave: { bg: '#FBF1E1', ink: '#9A6A00' },
  rotational_leave: { bg: '#F1ECF9', ink: '#6E5B97' },
  medical_leave: { bg: '#FBECEB', ink: '#B23B3B' },
  training_leave: { bg: '#E9EFF8', ink: '#3E6A8E' },
  travelling: { bg: '#E5F0ED', ink: '#2E7D6B' },
  invited: { bg: '#F0F1F4', ink: '#6B7280' },
};
const soft = (s) => SOFT[s] || { bg: '#F6F5F1', ink: '#8B8478' };
const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// ── Compact status month-grid; clicking a day selects it ─────────────────────
function MonthCalendar({ periods, entries, selectedDay, onSelectDay }) {
  const today = today0();
  const [calYear, setCalYear] = useState((selectedDay || today).getFullYear());
  const [calMonth, setCalMonth] = useState((selectedDay || today).getMonth());
  const totalDays = daysInMonth(calYear, calMonth);
  const firstDow = (new Date(calYear, calMonth, 1).getDay() + 6) % 7;

  const prev = () => { if (calMonth === 0) { setCalYear((y) => y - 1); setCalMonth(11); } else setCalMonth((m) => m - 1); };
  const next = () => { if (calMonth === 11) { setCalYear((y) => y + 1); setCalMonth(0); } else setCalMonth((m) => m + 1); };
  const goToday = () => { setCalYear(today.getFullYear()); setCalMonth(today.getMonth()); onSelectDay(today); };

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
          const sc = soft(stat);
          const isToday = sameDay(day, today);
          const isSel = sameDay(day, selectedDay);
          return (
            <button
              key={d}
              type="button"
              className={`act-mcell ${day > today ? 'is-future' : ''} ${isToday ? 'is-today' : ''} ${isSel ? 'is-sel' : ''}`}
              style={{ background: stat ? sc.bg : '#F8F7F3' }}
              onClick={() => onSelectDay(day)}
              title={stat ? getStatusLabel(stat) : 'No data'}
            >
              <span className="act-mnum" style={{ color: stat ? sc.ink : '#AEB4C2' }}>{d}</span>
              {entry && <span className="act-mdot" style={{ background: sc.ink }} />}
            </button>
          );
        })}
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
  const [selectedDay, setSelectedDay] = useState(today0());

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
  const dateIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const openAdd = (iso) => { setEditing(null); setForm({ ...blankEntry(), ...(iso ? { startDate: iso, endDate: iso } : {}) }); setEntryOpen(true); };
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
        <div className="act-calwrap">
          <div className="act-calmain">
            <MonthCalendar periods={periods} entries={entries} selectedDay={selectedDay} onSelectDay={setSelectedDay} />
            <div className="act-cal-legend">
              {CREW_STATUSES.map(({ value, label }) => (
                <span key={value}><i className="act-sw" style={{ background: soft(value).bg, boxShadow: `inset 0 0 0 1px ${soft(value).ink}40` }} />{label}</span>
              ))}
            </div>
          </div>
          {(() => {
            const day = selectedDay;
            const entry = entryForDay(entries, day);
            const stat = entry ? calKind(entry.kind).status : getStatusForDay(periods, day);
            const wd = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day.getDay()];
            const oneDay = String(entry?.end_date).slice(0, 10) === String(entry?.start_date).slice(0, 10);
            return (
              <div className="act-daypanel">
                <div className="act-dp-date">{wd}<span>{fmtDay(day)}</span></div>
                <div className="act-dp-status">
                  <i className="act-dp-dot" style={{ background: soft(stat).ink }} />
                  {stat ? getStatusLabel(stat) : 'No status recorded'}
                </div>
                {entry ? (
                  <div className="act-dp-entry">
                    <div className="act-dp-kind">{calKind(entry.kind).label}</div>
                    <div className="act-dp-line">{fmtDay(entry.start_date)}{oneDay ? '' : ` – ${fmtDay(entry.end_date)}`}</div>
                    {travelSummary(entry) && <div className="act-dp-line">{travelSummary(entry)}</div>}
                    {(entry.depart_time || entry.arrive_time) && <div className="act-dp-line">Dep {entry.depart_time || '—'} · Arr {entry.arrive_time || '—'}</div>}
                    {entry.note && <div className="act-dp-note">{entry.note}</div>}
                    {canManage && (
                      <div className="act-dp-actions">
                        <button type="button" onClick={() => openEdit(entry)}><Icon name="Pencil" size={13} /> Edit</button>
                        <button type="button" className="rm" onClick={() => removeEntry(entry)}><Icon name="Trash2" size={13} /> Remove</button>
                      </div>
                    )}
                  </div>
                ) : canManage ? (
                  <button type="button" className="act-dp-add" onClick={() => openAdd(dateIso(day))}>
                    <Icon name="Plus" size={14} /> Add leave / travel
                  </button>
                ) : (
                  <p className="act-dp-empty">No leave or travel logged for this day.</p>
                )}
              </div>
            );
          })()}
        </div>
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
