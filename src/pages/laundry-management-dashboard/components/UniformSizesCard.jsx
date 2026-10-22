// Uniform sizes on the Wardrobe management → Crew member view. Reads the crew
// member's recorded sizes (crew_uniform_sizes) so the interior can see what to
// issue without opening the full crew profile, and lets a manager edit them
// in place. Read access is enforced server-side (can_read_uniform_sizes — any
// Interior member, CHIEF+/HOD-own-dept), so showing it here just surfaces what
// the viewer is already entitled to read.
import React, { useEffect, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { fetchUniformSizes, saveUniformSizes, UNIFORM_SIZE_KEYS } from '../../crew-profile/utils/crewKit';
import {
  FIT_OPTIONS, REGION_OPTIONS, FIELD_BY_KEY, SIZE_GROUPS, fieldVisible, fitLabel, sexToFit,
} from '../../crew-profile/utils/uniformSizeFields';
import { formatShoeTrio } from '../../crew-profile/utils/shoeSizes';
import './uniformSizesCard.css';

const UniformSizesCard = ({ userId, crewSex, canEdit = false }) => {
  const [sizes, setSizes] = useState({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let dead = false;
    setLoading(true); setEditing(false);
    fetchUniformSizes(userId)
      .then((s) => { if (!dead) setSizes(s || {}); })
      .catch(() => { if (!dead) setSizes({}); })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [userId]);

  const defaultFit = sexToFit(crewSex);
  const effectiveFit = (editing ? form.fit : sizes.fit) || defaultFit;

  const enter = () => { setForm({ ...sizes, fit: sizes.fit || defaultFit }); setEditing(true); };
  const cancel = () => setEditing(false);
  const save = async () => {
    const dirty = UNIFORM_SIZE_KEYS.some((k) => (form[k] || '') !== (sizes[k] || ''));
    if (!dirty) { setEditing(false); return; }
    setBusy(true);
    try {
      await saveUniformSizes(userId, form);
      setSizes(form);
      setEditing(false);
      window.showToast?.('Uniform sizes saved', 'success');
    } catch (e) {
      window.showToast?.(e.message || 'Could not save sizes', 'error');
    } finally { setBusy(false); }
  };

  if (loading) return null;

  const filled = Object.values(FIELD_BY_KEY).filter((f) => fieldVisible(f, effectiveFit) && sizes[f.key]);
  const empty = filled.length === 0 && !sizes.notes;

  return (
    <section className="ufs-card">
      <div className="ufs-head">
        <span className="ufs-t"><Icon name="Ruler" size={13} /> Uniform sizes</span>
        {!editing && effectiveFit && <span className="ufs-chip">{fitLabel(effectiveFit)}</span>}
        {!editing && sizes.region && <span className="ufs-chip">{sizes.region} sizes</span>}
        <span className="ufs-rule" />
        {canEdit && (editing
          ? (
            <span className="ufs-acts">
              <button type="button" className="ufs-btn ghost" onClick={cancel} disabled={busy}>Cancel</button>
              <button type="button" className="ufs-btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </span>
          )
          : <button type="button" className="ufs-edit" onClick={enter}><Icon name="Pencil" size={13} /> {empty ? 'Add sizes' : 'Edit'}</button>
        )}
      </div>

      {editing ? (
        <>
          <div className="ufs-profile">
            <label className="ufs-field">
              <span>Sizing profile</span>
              <select value={form.fit || ''} onChange={(e) => setForm((s) => ({ ...s, fit: e.target.value }))}>
                <option value="">Select…</option>
                {FIT_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
            <label className="ufs-field">
              <span>Size region</span>
              <select value={form.region || ''} onChange={(e) => setForm((s) => ({ ...s, region: e.target.value }))}>
                <option value="">Select…</option>
                {REGION_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
          </div>
          {SIZE_GROUPS.map((g) => {
            const fields = g.keys.map((k) => FIELD_BY_KEY[k]).filter((f) => f && fieldVisible(f, form.fit));
            if (!fields.length) return null;
            return (
              <div key={g.label} className="ufs-sgroup">
                <p className="ufs-sgroup-h">{g.label}</p>
                <div className="ufs-grid">
                  {fields.map((f) => (
                    <label key={f.key} className="ufs-field">
                      <span>{f.label}</span>
                      <input value={form[f.key] || ''} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} placeholder={f.ph} />
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
          <label className="ufs-field ufs-full">
            <span>Other sizing notes <em>optional</em></span>
            <input value={form.notes || ''} onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} placeholder="e.g. prefers long-sleeve, runs small" />
          </label>
        </>
      ) : empty ? (
        <p className="ufs-none">No sizes recorded yet.{canEdit ? ' Use “Add sizes” to record them.' : ''}</p>
      ) : (
        <>
          <div className="ufs-ledger">
            {SIZE_GROUPS.map((g) => {
              const rows = g.keys.map((k) => FIELD_BY_KEY[k]).filter((f) => f && fieldVisible(f, effectiveFit) && sizes[f.key]);
              if (!rows.length) return null;
              return (
                <div key={g.label} className="ufs-lgrp">
                  <p className="ufs-lgrp-h">{g.label}</p>
                  {rows.map((f) => {
                    const trio = f.key === 'shoe' ? formatShoeTrio(sizes.shoe, sizes.region, effectiveFit) : null;
                    return (
                      <div key={f.key} className="ufs-lrow">
                        <span className="l">{f.label}</span>
                        <span className="v">{trio || sizes[f.key]}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {sizes.notes && <p className="ufs-notes">{sizes.notes}</p>}
        </>
      )}
    </section>
  );
};

export default UniformSizesCard;
