import React, { useEffect, useState } from 'react';
import ModalShell from '../../../components/ui/ModalShell';
import Icon from '../../../components/AppIcon';
import { showToast } from '../../../utils/toast';
import { TRANSPORTS, saveJourney, deleteJourney } from '../../crew-profile/utils/crewCalendar';
import './travel-modal.css';

const KINDS = [
  ['active', 'Arriving / joining'], ['on_leave', 'Departing — leave'], ['rotational_leave', 'Rotational leave'],
  ['travelling', 'Travelling'], ['training_leave', 'Training'], ['medical_leave', 'Medical'],
];
const blankLeg = () => ({ transport: 'Flight', transportNo: '', from: '', to: '', departTime: '', arriveTime: '' });
const todayStr = () => new Date().toISOString().slice(0, 10);

const TravelModal = ({ isOpen, onClose, tenantId, members = [], currentUserId, currentUserName, entry, legsForEntry = [], onSaved }) => {
  const editing = !!entry?.id;
  const [userId, setUserId] = useState('');
  const [kind, setKind] = useState('travelling');
  const [date, setDate] = useState(todayStr());
  const [note, setNote] = useState('');
  const [legs, setLegs] = useState([blankLeg()]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setDirty(false); setSaving(false);
    if (editing) {
      setUserId(entry.user_id);
      setKind(entry.kind || 'travelling');
      setDate((entry.start_date || todayStr()).slice(0, 10));
      setNote(entry.note || '');
      const leg1 = { transport: entry.transport || 'Flight', transportNo: entry.transport_no || '', from: entry.from_location || '', to: entry.to_location || '', departTime: entry.depart_time || '', arriveTime: entry.arrive_time || '' };
      const rest = (legsForEntry || []).sort((a, b) => a.seq - b.seq).map((l) => ({ transport: l.transport || 'Car', transportNo: l.transport_no || '', from: l.from_location || '', to: l.to_location || '', departTime: l.depart_time || '', arriveTime: l.arrive_time || '' }));
      setLegs([leg1, ...rest]);
    } else {
      setUserId(members[0]?.user_id || '');
      setKind('travelling'); setDate(todayStr()); setNote(''); setLegs([blankLeg()]);
    }
  }, [isOpen]); // eslint-disable-line

  if (!isOpen) return null;

  const touch = (fn) => { setDirty(true); fn(); };
  const setLeg = (i, k, v) => touch(() => setLegs((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l))));
  const addLeg = () => touch(() => setLegs((ls) => [...ls, { ...blankLeg(), transport: 'Car' }]));
  const delLeg = (i) => touch(() => setLegs((ls) => ls.filter((_, j) => j !== i)));

  const save = async () => {
    if (!userId) { showToast('Pick a crew member', 'error'); return; }
    setSaving(true);
    try {
      await saveJourney({ id: entry?.id, userId, tenantId, kind, date, note, legs, actorId: currentUserId, actorName: currentUserName });
      showToast(editing ? 'Travel updated' : 'Travel added', 'success');
      onSaved?.(); onClose?.();
    } catch (e) { showToast(e?.message || 'Could not save travel', 'error'); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!editing) return;
    setSaving(true);
    try { await deleteJourney(entry.id); showToast('Travel removed', 'success'); onSaved?.(); onClose?.(); }
    catch (e) { showToast(e?.message || 'Could not remove', 'error'); }
    finally { setSaving(false); }
  };

  return (
    <ModalShell onClose={onClose} isBusy={saving} isDirty={dirty} panelClassName="tv-panel">
      <div className="tv">
        <div className="tv-head">
          <div><div className="tv-ey">{editing ? 'Edit travel' : 'Add travel'}</div><h3>Journey</h3></div>
          <button type="button" className="tv-x" onClick={onClose} aria-label="Close"><Icon name="X" size={17} /></button>
        </div>

        <div className="tv-body">
          <div className="tv-row2">
            <label className="tv-field"><span className="k">Crew member</span>
              <select value={userId} onChange={(e) => touch(() => setUserId(e.target.value))} disabled={editing}>
                {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.fullName}</option>)}
              </select>
            </label>
            <label className="tv-field"><span className="k">Date</span>
              <input type="date" value={date} onChange={(e) => touch(() => setDate(e.target.value))} />
            </label>
          </div>
          <label className="tv-field"><span className="k">Reason</span>
            <select value={kind} onChange={(e) => touch(() => setKind(e.target.value))}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>

          <div className="tv-legs-head"><span className="k">Legs</span><span className="hint">a flight, then the taxi — one journey</span></div>
          {legs.map((l, i) => (
            <div className="tv-leg" key={i}>
              <div className="tv-legnum">{i + 1}</div>
              <div className="tv-leggrid">
                <select value={l.transport} onChange={(e) => setLeg(i, 'transport', e.target.value)}>{TRANSPORTS.map((t) => <option key={t}>{t}</option>)}</select>
                <input placeholder="No. (BA344)" value={l.transportNo} onChange={(e) => setLeg(i, 'transportNo', e.target.value)} />
                <input placeholder="From" value={l.from} onChange={(e) => setLeg(i, 'from', e.target.value)} />
                <input placeholder="To" value={l.to} onChange={(e) => setLeg(i, 'to', e.target.value)} />
                <input placeholder="Depart" value={l.departTime} onChange={(e) => setLeg(i, 'departTime', e.target.value)} />
                <input placeholder="Arrive" value={l.arriveTime} onChange={(e) => setLeg(i, 'arriveTime', e.target.value)} />
              </div>
              {legs.length > 1 && <button type="button" className="tv-legx" onClick={() => delLeg(i)} title="Remove leg">×</button>}
            </div>
          ))}
          <button type="button" className="tv-addleg" onClick={addLeg}>+ Add leg</button>

          <label className="tv-field"><span className="k">Note</span>
            <input placeholder="e.g. agent transfer, joins vessel…" value={note} onChange={(e) => touch(() => setNote(e.target.value))} />
          </label>
        </div>

        <div className="tv-foot">
          {editing ? <button type="button" className="tv-del" onClick={remove} disabled={saving}>Remove</button> : <span />}
          <div className="tv-btns">
            <button type="button" className="tv-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="button" className="tv-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save travel' : 'Add travel'}</button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
};

export default TravelModal;
