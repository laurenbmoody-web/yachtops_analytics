import React, { useState, useEffect, useCallback, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import LogoSpinner from '../../../components/LogoSpinner';
import { showToast } from '../../../utils/toast';
import { fetchProfileStatement, saveProfileStatement, draftStatementWithAI } from '../utils/crewProfileStatement';

const Field = ({ label, value, onChange, placeholder, readOnly }) => (
  <label className="ps-field">
    <span>{label}</span>
    <input value={value} disabled={readOnly} onChange={(e) => onChange(e.target.value)} placeholder={readOnly ? '' : placeholder} />
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

// The detail boxes, in the order the crew member fills them. `key` matches the
// form state; the readout view shows the same order.
const DETAILS = [
  { key: 'yearsYachting', label: 'Years in yachting', placeholder: 'e.g. 8 years' },
  { key: 'hometown', label: 'Hometown', placeholder: 'e.g. Cornwall, UK' },
  { key: 'languages', label: 'Languages', placeholder: 'e.g. English, French' },
  { key: 'studies', label: 'Studies', placeholder: 'e.g. BSc Marine Biology' },
  { key: 'interests', label: 'Interests / hobbies', placeholder: 'e.g. Freediving, photography' },
  { key: 'favouriteDestination', label: 'Favourite destination', placeholder: 'e.g. The Cyclades' },
  { key: 'funFact', label: 'Fun fact / hidden talent', placeholder: 'e.g. I can juggle fire' },
];

// Light, client-side guard so nobody hammers the API: a per-user daily cap and a
// short cool-down between drafts. Not a security control (RLS/auth handle that) —
// just a courtesy throttle to keep AI cost sane.
const DAILY_CAP = 5; // one go by hand + one in each of the four voices
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

const EMPTY = { statement: '', funFact: '', hometown: '', languages: '', studies: '', interests: '', favouriteDestination: '', yearsYachting: '' };

const ProfileStatementTab = ({ userId, tenantId, currentUserId, crewName, role, nationality, vesselName, canEdit, isOwnProfile }) => {
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState(null); // 'draft' | 'polish' | null
  const [tone, setTone] = useState('warm');
  const [used, setUsed] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const cdTimer = useRef(null);
  const [form, setForm] = useState(EMPTY);

  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetchProfileStatement(userId);
    setForm(d ? {
      statement: d.statement || '', funFact: d.fun_fact || '', hometown: d.hometown || '',
      languages: d.languages || '', studies: d.studies || '', interests: d.interests || '',
      favouriteDestination: d.favourite_destination || '', yearsYachting: d.years_yachting || '',
    } : EMPTY);
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
    try {
      await saveProfileStatement({ userId, tenantId, actorId: currentUserId, ...form });
      showToast('Profile statement saved', 'success');
      setEditing(false);
    } catch (e) { showToast(e.message || 'Could not save', 'error'); }
    finally { setSaving(false); }
  };

  const cancel = () => { load(); setEditing(false); };

  const capped = used >= DAILY_CAP;
  // mode 'draft' = a fresh write in the chosen voice (overwrites); 'polish' =
  // keep the crew member's words, just tidy them.
  const runAI = async (mode) => {
    if (capped) { showToast('Daily AI limit reached — edit by hand or try again tomorrow', 'error'); return; }
    setAiBusy(mode);
    try {
      const statement = await draftStatementWithAI({
        mode, name: crewName, role, nationality, vessel: vesselName, tone,
        hometown: form.hometown, languages: form.languages, studies: form.studies, interests: form.interests,
        funFact: form.funFact, favouriteDestination: form.favouriteDestination, yearsYachting: form.yearsYachting,
        draft: form.statement,
      });
      if (statement) {
        setF('statement', statement);
        setUsed(bumpUsage(userId));
        setCooldown(COOLDOWN_SECONDS);
        showToast(mode === 'polish' ? 'Polished — review and tweak it' : 'Draft ready — review and tweak it', 'success');
      } else showToast('No draft returned — try adding a few details', 'error');
    } catch (e) { showToast(e.message || 'AI assist is unavailable right now', 'error'); }
    finally { setAiBusy(null); }
  };

  if (loading) return <div className="flex items-center justify-center py-16"><LogoSpinner size={32} /></div>;

  const words = form.statement.trim() ? form.statement.trim().split(/\s+/).length : 0;
  const hasText = !!form.statement.trim();
  const aiLocked = !!aiBusy || cooldown > 0 || capped;
  const filledDetails = DETAILS.filter((d) => (form[d.key] || '').trim());

  return (
    <div>
      <div className="cp-tab-head">
        <div className="cp-section-head">
          <span className="cp-section-num">02 /</span>
          <h3>Crew Profile</h3>
        </div>
        {canEdit && !editing && (
          <div className="cp-tab-actions">
            <Button variant="outline" iconName="Edit" onClick={() => setEditing(true)}>
              {hasText || filledDetails.length ? 'Edit statement' : 'Write statement'}
            </Button>
          </div>
        )}
      </div>
      <div className="cp-group-head"><span className="dia">◆</span><span className="t">Your introduction</span><span className="line" /></div>

      <div className={`ps-wrap${editing ? ' ps-wrap-edit' : ''}`}>
        <div className="ps-main">
          <textarea
            className="ps-area" rows={8} value={form.statement} disabled={!editing}
            onChange={(e) => setF('statement', e.target.value)}
            placeholder="e.g. I'm Lauren, a Yorkshire lass who somehow ended up spending a decade at sea. Off-duty you'll find me underwater, on the padel court, or behind a camera."
          />
          <div className="ps-meta">
            <span className={words > 90 ? 'ps-over' : ''}>{words} {words === 1 ? 'word' : 'words'}</span>
            <span className="ps-hint">· aim for ~60–80 to fit three crew to a page</span>
          </div>

          {editing && (
            <>
              <div className="ps-voice">
                <span className="ps-voice-lbl">Voice</span>
                {TONES.map((t) => (
                  <button key={t.key} type="button" className={`ps-tone${tone === t.key ? ' on' : ''}`} onClick={() => setTone(t.key)}>{t.label}</button>
                ))}
              </div>

              <div className="ps-aibar">
                <button type="button" className="ps-aibtn" onClick={() => runAI('draft')} disabled={aiLocked}>
                  <Icon name={aiBusy === 'draft' ? 'Loader2' : 'Sparkles'} size={15} className={aiBusy === 'draft' ? 'animate-spin' : ''} />
                  {aiBusy === 'draft' ? 'Writing…' : cooldown > 0 ? `Wait ${cooldown}s` : (hasText ? 'Rewrite with AI' : 'Write with AI')}
                </button>
                {hasText && (
                  <button type="button" className="ps-aibtn ghost" onClick={() => runAI('polish')} disabled={aiLocked}>
                    <Icon name={aiBusy === 'polish' ? 'Loader2' : 'Wand2'} size={15} className={aiBusy === 'polish' ? 'animate-spin' : ''} />
                    {aiBusy === 'polish' ? 'Polishing…' : 'Polish mine'}
                  </button>
                )}
              </div>
              <div className="ps-aihint">
                {capped
                  ? 'Daily AI limit reached — edit by hand or try tomorrow.'
                  : hasText
                    ? <>Pick a voice, then <b>Rewrite</b> for a fresh take — or <b>Polish</b> to keep your words. {DAILY_CAP - used} left today.</>
                    : <>Pick a voice and let AI draft from the details on the right. {DAILY_CAP - used} drafts left today.</>}
              </div>

              <div className="ps-actions">
                <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save statement'}</Button>
                <Button variant="outline" onClick={cancel} disabled={saving}>Cancel</Button>
              </div>
            </>
          )}
        </div>

        <div className="ps-side">
          {DETAILS.map((d) => (
            <Field key={d.key} label={d.label} value={form[d.key]} onChange={(v) => setF(d.key, v)} placeholder={d.placeholder} readOnly={!editing} />
          ))}
        </div>
        {editing && (
          <div className="ps-spark">
            <div className="ps-prompts">
              <div className="ps-prompts-h">Need a spark?</div>
              <ul>{PROMPTS.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProfileStatementTab;
