// FeedbackWidget — beta "tap and send a note" affordance on every page.
//
// A small terracotta tab pinned bottom-right opens a composer where a crew
// member can type a note and/or record a voice note. Submission goes to the
// submit-feedback edge function, which stores it (in-app inbox) and emails the
// product owner. The current route + a little device context ride along so the
// owner knows exactly where the friction was.
//
// Rendering is gated: signed-in users only, and only when the active vessel has
// feedback_widget_enabled (vessel settings, default ON). Mounted once in the
// app shell, so it rides every route automatically.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import './feedback-widget.css';

const MAX_AUDIO_MS = 120000; // 2 minutes — keep voice notes short.

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function FeedbackWidget() {
  const { user, activeTenantId } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  // An explicit "Report a bug" (from Settings) force-opens the composer even
  // when the passive bottom-right tab is toggled off for the vessel.
  const [forced, setForced] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  // Voice recording state
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState('');
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const startRef = useRef(0);
  const timerRef = useRef(null);

  // ── Gate: is the widget on for this vessel? ──
  useEffect(() => {
    let alive = true;
    if (!user || !activeTenantId) { setEnabled(false); return; }
    (async () => {
      const { data } = await supabase
        ?.from('vessels')
        ?.select('feedback_widget_enabled')
        ?.eq('tenant_id', activeTenantId)
        ?.maybeSingle() || {};
      // Default ON when no row / column is null, matching the DB default.
      if (alive) setEnabled(data ? data.feedback_widget_enabled !== false : true);
    })();
    return () => { alive = false; };
  }, [user, activeTenantId]);

  const stopTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };

  const resetAudio = useCallback(() => {
    stopTimer();
    setRecording(false);
    setElapsed(0);
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl('');
    chunksRef.current = [];
  }, [audioUrl]);

  const stopRecording = useCallback(() => {
    const mr = mediaRef.current;
    if (mr && mr.state !== 'inactive') mr.stop();
    stopTimer();
  }, []);

  const startRecording = useCallback(async () => {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Voice notes are not supported on this device.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        setRecording(false);
        stopTimer();
      };
      startRef.current = performance.now();
      setElapsed(0);
      mr.start();
      setRecording(true);
      timerRef.current = setInterval(() => {
        const ms = performance.now() - startRef.current;
        setElapsed(ms);
        if (ms >= MAX_AUDIO_MS) stopRecording();
      }, 200);
    } catch (_e) {
      setError('Microphone access was blocked. Check your browser permissions.');
    }
  }, [stopRecording]);

  // Cleanup on unmount
  useEffect(() => () => { stopTimer(); if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  const close = () => {
    if (recording) stopRecording();
    setOpen(false);
    setForced(false);
    setError('');
  };

  // Open on an explicit request from elsewhere (Settings › Report a bug).
  useEffect(() => {
    const onOpen = () => { setMessage(''); resetAudio(); setSent(false); setError(''); setForced(true); setOpen(true); };
    window.addEventListener('cargo:open-feedback', onOpen);
    return () => window.removeEventListener('cargo:open-feedback', onOpen);
  }, [resetAudio]);

  const reset = () => {
    setMessage('');
    resetAudio();
    setSent(false);
    setError('');
  };

  const submit = async () => {
    if (sending) return;
    const text = message.trim();
    if (!text && !audioBlob) { setError('Add a note or record a voice note first.'); return; }
    setSending(true);
    setError('');
    try {
      let audioBase64 = null;
      let audioMime = null;
      if (audioBlob) {
        audioBase64 = await blobToBase64(audioBlob);
        audioMime = audioBlob.type || 'audio/webm';
      }
      const { data, error: fnErr } = await supabase.functions.invoke('submit-feedback', {
        body: {
          tenantId: activeTenantId || null,
          message: text,
          audioBase64,
          audioMime,
          audioMs: audioBlob ? Math.round(elapsed) : null,
          pagePath: window.location.pathname + window.location.search,
          pageTitle: document.title || '',
          userAgent: navigator.userAgent,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          appVersion: '0.1.0',
        },
      });
      if (fnErr || data?.error) throw new Error(fnErr?.message || data?.error || 'Send failed');
      setSent(true);
      setMessage('');
      resetAudio();
    } catch (e) {
      setError(e?.message || 'Could not send — please try again.');
    } finally {
      setSending(false);
    }
  };

  if (!enabled && !forced) return null;

  return (
    <div className="fbw-root">
      {!open && (
        <button type="button" className="fbw-tab" onClick={() => { reset(); setOpen(true); }} aria-label="Send feedback">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
          <span>Feedback</span>
        </button>
      )}

      {open && (
        <div className="fbw-panel" role="dialog" aria-label="Send feedback">
          <div className="fbw-head">
            <div>
              <span className="fbw-kicker">Beta</span>
              <h3 className="fbw-title">Send <em>feedback</em></h3>
            </div>
            <button type="button" className="fbw-x" onClick={close} aria-label="Close">×</button>
          </div>

          {sent ? (
            <div className="fbw-done">
              <div className="fbw-done-mark">✓</div>
              <p>Thank you — that's gone straight to the team.</p>
              <div className="fbw-done-actions">
                <button type="button" className="fbw-btn-ghost" onClick={reset}>Send another</button>
                <button type="button" className="fbw-btn" onClick={close}>Done</button>
              </div>
            </div>
          ) : (
            <>
              <p className="fbw-lead">Spotted something, or have an idea? Type a note or record a quick voice memo — we read every one.</p>

              <textarea
                className="fbw-textarea"
                placeholder="What's on your mind?"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                maxLength={8000}
              />

              <div className="fbw-voice">
                {!audioBlob ? (
                  <button
                    type="button"
                    className={`fbw-rec${recording ? ' is-rec' : ''}`}
                    onClick={recording ? stopRecording : startRecording}
                  >
                    <span className="fbw-rec-dot" />
                    {recording ? `Stop · ${fmtTime(elapsed)}` : 'Record a voice note'}
                  </button>
                ) : (
                  <div className="fbw-clip">
                    <audio src={audioUrl} controls className="fbw-audio" />
                    <button type="button" className="fbw-clip-x" onClick={resetAudio} aria-label="Discard voice note">Discard</button>
                  </div>
                )}
              </div>

              {error && <p className="fbw-err">{error}</p>}

              <div className="fbw-actions">
                <span className="fbw-context">From this page</span>
                <button type="button" className="fbw-btn" onClick={submit} disabled={sending}>
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
