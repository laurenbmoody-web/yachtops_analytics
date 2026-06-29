import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import LogoSpinner from '../../../components/LogoSpinner';
import { showToast } from '../../../utils/toast';
import { fetchProfileStatement, saveProfileStatement, draftStatementWithAI } from '../utils/crewProfileStatement';

const Field = ({ label, value, onChange, placeholder, readOnly }) => (
  <label className="ps-field">
    <span>{label}</span>
    <input value={value} disabled={readOnly} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
  </label>
);

const ProfileStatementTab = ({ userId, tenantId, currentUserId, crewName, role, nationality, canEdit, isOwnProfile }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [form, setForm] = useState({ statement: '', headline: '', hometown: '', languages: '', interests: '' });

  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetchProfileStatement(userId);
    if (d) setForm({ statement: d.statement || '', headline: d.headline || '', hometown: d.hometown || '', languages: d.languages || '', interests: d.interests || '' });
    setLoading(false);
  }, [userId]);
  useEffect(() => { if (userId) load(); }, [userId, load]);

  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try { await saveProfileStatement({ userId, tenantId, actorId: currentUserId, ...form }); showToast('Profile statement saved', 'success'); }
    catch (e) { showToast(e.message || 'Could not save', 'error'); }
    finally { setSaving(false); }
  };

  const runAI = async () => {
    setAiBusy(true);
    try {
      const statement = await draftStatementWithAI({
        mode: form.statement.trim() ? 'polish' : 'draft',
        name: crewName, role, nationality,
        hometown: form.hometown, languages: form.languages, interests: form.interests,
        draft: form.statement,
      });
      if (statement) { setF('statement', statement); showToast('Draft ready — review and tweak it', 'success'); }
      else showToast('No draft returned — try adding a few details', 'error');
    } catch (e) { showToast(e.message || 'AI assist is unavailable right now', 'error'); }
    finally { setAiBusy(false); }
  };

  if (loading) return <div className="flex items-center justify-center py-16"><LogoSpinner size={32} /></div>;
  const readOnly = !canEdit;
  const words = form.statement.trim() ? form.statement.trim().split(/\s+/).length : 0;

  return (
    <div>
      <div className="cp-section-head">
        <span className="cp-section-num">02 /</span>
        <h3>Profile statement</h3>
      </div>
      <p className="cd-muted" style={{ marginTop: -6, marginBottom: 18, maxWidth: 580 }}>
        A short, guest-facing introduction for the guest information book.{' '}
        {isOwnProfile ? 'Write it in your own voice — or let AI give you a head start.' : 'Written by the crew member; COMMAND can edit.'}
      </p>

      <label className="ps-label">Your statement <em>shown to guests</em></label>
      <textarea
        className="ps-area" rows={5} value={form.statement} disabled={readOnly}
        onChange={(e) => setF('statement', e.target.value)}
        placeholder="e.g. Hi, I'm Lauren — your Captain for this charter. Originally from Cornwall, I've spent over a decade exploring the world by sea, and there's nothing I love more than sharing a sunset passage with guests."
      />
      <div className="ps-meta">
        <span className={words > 90 ? 'ps-over' : ''}>{words} {words === 1 ? 'word' : 'words'}</span>
        <span className="ps-hint">· aim for ~60–80 to fit three crew to a page</span>
      </div>
      {canEdit && (
        <div className="ps-aibar">
          <button type="button" className="ps-aibtn" onClick={runAI} disabled={aiBusy}>
            <Icon name={aiBusy ? 'Loader2' : 'Sparkles'} size={15} className={aiBusy ? 'animate-spin' : ''} />
            {aiBusy ? 'Writing…' : (form.statement.trim() ? 'Polish with AI' : 'Write with AI')}
          </button>
          <span className="ps-aihint">Uses the details below as a starting point.</span>
        </div>
      )}

      <div className="ps-grid">
        <Field label="Headline / tagline" value={form.headline} onChange={(v) => setF('headline', v)} placeholder="e.g. Adventurous captain, keen freediver" readOnly={readOnly} />
        <Field label="Hometown" value={form.hometown} onChange={(v) => setF('hometown', v)} placeholder="e.g. Cornwall, UK" readOnly={readOnly} />
        <Field label="Languages" value={form.languages} onChange={(v) => setF('languages', v)} placeholder="e.g. English, French" readOnly={readOnly} />
        <Field label="Interests / hobbies" value={form.interests} onChange={(v) => setF('interests', v)} placeholder="e.g. Freediving, cooking, photography" readOnly={readOnly} />
      </div>

      {canEdit && (
        <div style={{ marginTop: 22 }}>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save statement'}</Button>
        </div>
      )}
    </div>
  );
};

export default ProfileStatementTab;
