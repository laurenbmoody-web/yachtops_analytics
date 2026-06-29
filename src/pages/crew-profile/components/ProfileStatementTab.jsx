import React, { useState, useEffect, useCallback, useRef } from 'react';
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

// Prompts to help a crew member find their voice (and give the AI good material).
const PROMPTS = [
  'Where are you from — and how did you find your way into yachting?',
  'A favourite charter, crossing or destination?',
  'What do you get up to on your time off?',
  'A language you speak, or a hidden talent?',
  'Something guests are always surprised to learn about you?',
];

// Voice options for the AI assist — keep in step with the edge function's TONES map.
const TONES = [
  { key: 'warm', label: 'Warm' },
  { key: 'professional', label: 'Professional' },
  { key: 'playful', label: 'Playful' },
  { key: 'adventurous', label: 'Adventurous' },
];

// Light, client-side guard so nobody hammers the API: a per-user daily cap and a
// short cool-down between drafts. Not a security control (RLS/auth handle that) —
// just a courtesy throttle to keep AI cost sane.
const DAILY_CAP = 10;
const COOLDOWN_SECONDS = 12;
const todayKey = () => new Date().toISOString().slice(0, 10);
const usageKey = (userId) => `cargo.aiDrafts.${userId}.${todayKey()}`;
const readUsage = (userId) => {
  try { return Number(localStorage.getItem(usageKey(userId))) || 0; } catch { return 0; }
};
const bumpUsage = (userId) => {
  try {
    const n = readUsage(userId) + 1;
    localStorage.setItem(usageKey(userId), String(n));
    return n;
  } catch { return DAILY_CAP; }
};

const ProfileStatementTab = ({ userId, tenantId, currentUserId, crewName, role, nationality, vesselName, canEdit, isOwnProfile }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [tone, setTone] = useState('warm');
  const [used, setUsed] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const cdTimer = useRef(null);
  const [form, setForm] = useState({ statement: '', funFact: '', hometown: '', languages: '', interests: '', favouriteDestination: '', yearsYachting: '' });

  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetchProfileStatement(userId);
    if (d) setForm({
      statement: d.statement || '', funFact: d.fun_fact || '', hometown: d.hometown || '',
      languages: d.languages || '', interests: d.interests || '',
      favouriteDestination: d.favourite_destination || '', yearsYachting: d.years_yachting || '',
    });
    setLoading(false);
  }, [userId]);
  useEffect(() => { if (userId) load(); }, [userId, load]);

  // Seed today's usage count once we know whose profile this is.
  useEffect(() => { if (userId) setUsed(readUsage(userId)); }, [userId]);
  // Tick the cool-down down to zero.
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    cdTimer.current = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(cdTimer.current);
  }, [cooldown]);

  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try { await saveProfileStatement({ userId, tenantId, actorId: currentUserId, ...form }); showToast('Profile statement saved', 'success'); }
    catch (e) { showToast(e.message || 'Could not save', 'error'); }
    finally { setSaving(false); }
  };

  const capped = used >= DAILY_CAP;
  const runAI = async () => {
    if (capped) { showToast('Daily AI limit reached — edit by hand or try again tomorrow', 'error'); return; }
    setAiBusy(true);
    try {
      const statement = await draftStatementWithAI({
        mode: form.statement.trim() ? 'polish' : 'draft',
        name: crewName, role, nationality, vessel: vesselName, tone,
        hometown: form.hometown, languages: form.languages, interests: form.interests,
        funFact: form.funFact, favouriteDestination: form.favouriteDestination, yearsYachting: form.yearsYachting,
        draft: form.statement,
      });
      if (statement) {
        setF('statement', statement);
        setUsed(bumpUsage(userId));
        setCooldown(COOLDOWN_SECONDS);
        showToast('Draft ready — review and tweak it', 'success');
      } else showToast('No draft returned — try adding a few details', 'error');
    } catch (e) { showToast(e.message || 'AI assist is unavailable right now', 'error'); }
    finally { setAiBusy(false); }
  };

  if (loading) return <div className="flex items-center justify-center py-16"><LogoSpinner size={32} /></div>;
  const readOnly = !canEdit;
  const words = form.statement.trim() ? form.statement.trim().split(/\s+/).length : 0;
  const aiDisabled = aiBusy || cooldown > 0 || capped;
  const aiLabel = aiBusy ? 'Writing…' : cooldown > 0 ? `Wait ${cooldown}s` : (form.statement.trim() ? 'Polish with AI' : 'Write with AI');

  return (
    <div>
      <div className="cp-section-head">
        <span className="cp-section-num">02 /</span>
        <h3>Profile statement</h3>
      </div>
      <p className="cd-muted" style={{ marginTop: -6, marginBottom: 22, maxWidth: 640 }}>
        A short introduction for the guest information book — a glimpse of who you are, not just what you do.{' '}
        {isOwnProfile ? 'Write it in your own voice — or let AI give you a head start.' : 'Written by the crew member; COMMAND can edit.'}
      </p>

      <div className="ps-wrap">
        <div className="ps-main">
          <label className="ps-label">Your statement <em>shown to guests</em></label>
          <textarea
            className="ps-area" rows={8} value={form.statement} disabled={readOnly}
            onChange={(e) => setF('statement', e.target.value)}
            placeholder="e.g. Hi, I'm Lauren — your Captain for this charter. Originally from Cornwall, I've spent over a decade exploring the world by sea, and there's nothing I love more than sharing a sunset passage with guests."
          />
          <div className="ps-meta">
            <span className={words > 90 ? 'ps-over' : ''}>{words} {words === 1 ? 'word' : 'words'}</span>
            <span className="ps-hint">· aim for ~60–80 to fit three crew to a page</span>
          </div>

          {canEdit && (
            <>
              <div className="ps-voice">
                <span className="ps-voice-lbl">Voice</span>
                {TONES.map((t) => (
                  <button
                    key={t.key} type="button"
                    className={`ps-tone${tone === t.key ? ' on' : ''}`}
                    onClick={() => setTone(t.key)}
                  >{t.label}</button>
                ))}
              </div>
              <div className="ps-aibar">
                <button type="button" className="ps-aibtn" onClick={runAI} disabled={aiDisabled}>
                  <Icon name={aiBusy ? 'Loader2' : 'Sparkles'} size={15} className={aiBusy ? 'animate-spin' : ''} />
                  {aiLabel}
                </button>
                <span className="ps-aihint">
                  {capped
                    ? 'Daily AI limit reached — edit by hand or try tomorrow.'
                    : `Uses the details on the right · ${DAILY_CAP - used} draft${DAILY_CAP - used === 1 ? '' : 's'} left today.`}
                </span>
              </div>
            </>
          )}
        </div>

        <div className="ps-side">
          <Field label="Fun fact / hidden talent" value={form.funFact} onChange={(v) => setF('funFact', v)} placeholder="e.g. Once cooked for a head of state — and can juggle fire" readOnly={readOnly} />
          <Field label="Hometown" value={form.hometown} onChange={(v) => setF('hometown', v)} placeholder="e.g. Cornwall, UK" readOnly={readOnly} />
          <Field label="Languages" value={form.languages} onChange={(v) => setF('languages', v)} placeholder="e.g. English, French" readOnly={readOnly} />
          <Field label="Interests / hobbies" value={form.interests} onChange={(v) => setF('interests', v)} placeholder="e.g. Freediving, cooking, photography" readOnly={readOnly} />
          <Field label="Favourite destination" value={form.favouriteDestination} onChange={(v) => setF('favouriteDestination', v)} placeholder="e.g. The Cyclades at dawn" readOnly={readOnly} />
          <Field label="Years in yachting" value={form.yearsYachting} onChange={(v) => setF('yearsYachting', v)} placeholder="e.g. 8 years, or Since 2016" readOnly={readOnly} />
          <div className="ps-prompts">
            <div className="ps-prompts-h">Need a spark?</div>
            <ul>{PROMPTS.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        </div>
      </div>

      {canEdit && (
        <div style={{ marginTop: 24 }}>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save statement'}</Button>
        </div>
      )}
    </div>
  );
};

export default ProfileStatementTab;
