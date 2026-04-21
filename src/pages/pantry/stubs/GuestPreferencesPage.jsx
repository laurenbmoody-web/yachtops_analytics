import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Header from '../../../components/navigation/Header';
import StandbyLayoutHeader from '../widgets/StandbyLayoutHeader';
import { supabase } from '../../../lib/supabaseClient';
import '../pantry.css';

export default function GuestPreferencesPage() {
  const { id } = useParams();
  const [guest, setGuest]       = useState(null);
  const [value, setValue]       = useState('');
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [savedAt, setSavedAt]   = useState(null);
  const [error, setError]       = useState(null);

  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = '#F5F1EA';
    return () => { document.body.style.background = prev; };
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    supabase
      .from('guests')
      .select('id, first_name, last_name, preferences_summary')
      .eq('id', id)
      .single()
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        else {
          setGuest(data);
          setValue(data?.preferences_summary ?? '');
        }
        setLoading(false);
      });
  }, [id]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const { error: err } = await supabase
      .from('guests')
      .update({ preferences_summary: value })
      .eq('id', id);
    setSaving(false);
    if (err) setError(err.message);
    else setSavedAt(new Date());
  };

  const displayName = guest ? `${guest.first_name ?? ''} ${guest.last_name ?? ''}`.trim() : '';

  return (
    <>
      <Header />
      <div id="pantry-root" className="pantry-page">
        <StandbyLayoutHeader
          title="Preferences"
          subtitle={displayName ? `Full preferences for ${displayName}.` : 'Full preferences editor.'}
          backTo="/pantry/standby"
        />

        <div className="p-card top-navy">
          {loading && (
            <div style={{ color: 'var(--ink-tertiary)', fontSize: 13 }}>Loading…</div>
          )}
          {error && (
            <div style={{ color: 'var(--accent)', fontSize: 12, marginBottom: 8 }}>
              Failed: {error}
            </div>
          )}
          {!loading && guest && (
            <>
              <div className="p-caps" style={{ marginBottom: 8 }}>Preferences summary</div>
              <textarea
                value={value}
                onChange={e => setValue(e.target.value)}
                rows={10}
                placeholder="Capture what this guest likes, how they take coffee, service preferences…"
                style={{
                  width: '100%', padding: '10px 12px',
                  border: '0.5px solid var(--p-border)',
                  borderRadius: 8, resize: 'vertical',
                  fontFamily: 'var(--font-sans)', fontSize: 13,
                  color: 'var(--ink)', background: 'var(--bg-card)',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                <button className="p-btn primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                {savedAt && (
                  <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--confirm-deep)' }}>
                    Saved · {savedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
