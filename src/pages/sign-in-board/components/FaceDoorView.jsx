// The gangway camera view — tap the standby screen and this is what you get.
//
// It replaces hunting for your name, or presenting a cargo-pass QR, with standing
// in front of the iPad for a second. The move it makes is the same one the tiles
// make: read your last status and invert it (crewPresence.flip). It does not work
// out which way you are walking, which is why it can afford to be this simple.
//
// FOUR THINGS THIS SCREEN WILL NOT DO
//   1. It will not act on a guess. Two crew who look alike produce two close
//      distances, and faceGate refuses rather than picking — you get sent to the
//      tiles instead of someone else being marked ashore.
//   2. It will not change anything without a tap. The name appears with the
//      direction it proposes, and you confirm. There is no liveness detection
//      here, so a photo held up to the camera would be recognised; the confirm
//      tap and the audit trail are what stop that mattering.
//   3. It will not leave you stuck. After a few seconds of not recognising
//      anyone it hands over to the tile list by itself.
//   4. It will not watch the passerelle. The camera opens on a deliberate tap
//      and closes when this view does.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, X, Check, Users, Loader2 } from 'lucide-react';
import Icon from '../../../components/AppIcon';
import { describeFace, describeFailure, loadModels, disposeEngine } from '../../../lib/face/faceEngine';
import { matchFace } from '../../../services/faceSignIn';
import {
  step, emptyTracker, noteActed, shouldGiveUp, confirmPrompt, LOOK_TIMEOUT_MS,
} from '../../../services/faceGate';
import './face-door.css';

// One model pass (and at most one matcher call) per tick. Fast enough to feel
// instant, slow enough not to hammer the RPC or an older iPad's GPU.
const TICK_MS = 450;

// How long a proposed flip waits for a tap before the board gives up on it, so
// an unattended screen doesn't sit on somebody's name.
const CONFIRM_TIMEOUT_MS = 12000;

export default function FaceDoorView({
  tenantId, crew = [], seen = {}, onActed, onConfirm, onFallback, vesselName,
}) {
  const [phase, setPhase] = useState('starting'); // starting → looking → found | error
  const [hint, setHint] = useState('Starting the camera…');
  const [found, setFound] = useState(null);       // { member, question, next }
  const [err, setErr] = useState('');

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const tickRef = useRef(null);
  const trackerRef = useRef(emptyTracker());
  const startedRef = useRef(0);
  const deadRef = useRef(false);
  const confirmTimer = useRef(null);

  const stop = useCallback(() => {
    if (tickRef.current) { clearTimeout(tickRef.current); tickRef.current = null; }
    if (confirmTimer.current) { clearTimeout(confirmTimer.current); confirmTimer.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => { deadRef.current = true; stop(); disposeEngine(); }, [stop]);

  const bail = useCallback((reason) => {
    deadRef.current = true;
    stop();
    onFallback?.(reason);
  }, [stop, onFallback]);

  // A confident, stable, not-cooling match. Stop sampling and ask.
  const propose = (userId, name) => {
    const member = crew.find((c) => c.userId === userId);
    if (!member) { setHint('Recognised, but not on this vessel’s crew list'); return; }
    if (tickRef.current) { clearTimeout(tickRef.current); tickRef.current = null; }
    const { question, next } = confirmPrompt(member.status);
    setFound({ member: { ...member, name: member.name || name }, question, next });
    setPhase('found');
    confirmTimer.current = setTimeout(() => bail('confirm-timeout'), CONFIRM_TIMEOUT_MS);
  };

  const tick = () => {
    if (deadRef.current) return;
    tickRef.current = setTimeout(async () => {
      if (deadRef.current) return;

      // Hand over to the tiles rather than leaving someone in front of a camera
      // that isn't getting there.
      if (shouldGiveUp(startedRef.current, Date.now())) { bail('timeout'); return; }

      try {
        const res = await describeFace(videoRef.current);
        if (deadRef.current) return;

        if (!res.ok) {
          setHint(describeFailure(res.reason));
          trackerRef.current = emptyTracker();
          tick();
          return;
        }

        // A face worth asking about — one matcher call, templates stay server-side.
        const { data: row, error } = await matchFace(tenantId, res.descriptor);
        if (deadRef.current) return;
        if (error) { setErr('Can’t reach the vessel’s records — tap your name instead.'); setPhase('error'); return; }

        const out = step({ row, tracker: trackerRef.current, seen, now: Date.now() });
        trackerRef.current = out.tracker;

        if (out.action === 'ambiguous') { bail('ambiguous'); return; }
        if (out.action === 'flip') {
          onActed?.(out.userId, Date.now());
          propose(out.userId, out.name);
          return;
        }
        setHint(out.cooling ? 'Just signed you — tap your name if that was wrong' : 'Hold still…');
      } catch {
        if (!deadRef.current) { setErr('The face model could not load on this device.'); setPhase('error'); }
        return;
      }
      tick();
    }, TICK_MS);
  };

  // Open the camera on mount — getting here was already a deliberate tap.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      loadModels().catch(() => {}); // the tick loop reports a failure to load
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled || deadRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        startedRef.current = Date.now();
        setPhase('looking');
        setHint('Look at the camera');
        tick();
      } catch (e) {
        if (cancelled) return;
        // A kiosk with no camera permission should not be a dead end — the tiles
        // are right there.
        setErr(e?.name === 'NotAllowedError'
          ? 'This iPad hasn’t been given camera permission.'
          : 'No camera available on this device.');
        setPhase('error');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirm = () => {
    if (!found) return;
    deadRef.current = true;
    stop();
    onConfirm?.(found.member);
  };

  return (
    <div className="fd-root">
      <div className="fd-stage">
        <video ref={videoRef} className="fd-video" playsInline muted autoPlay />
        <div className="fd-veil" />

        {phase !== 'found' && phase !== 'error' && (
          <span className="fd-oval" aria-hidden="true" />
        )}

        <div className="fd-top">
          <p className="editorial-meta fd-meta">
            <span className="dot">●</span>
            <span>Sign in</span>
            <span className="bar" />
            <span className="muted">{vesselName || 'On board'}</span>
          </p>
        </div>

        {/* ── looking ─────────────────────────────────────────────────────── */}
        {(phase === 'starting' || phase === 'looking') && (
          <div className="fd-centre">
            <div className="fd-badge">
              {phase === 'starting' ? <Loader2 size={18} className="fd-spin" /> : <Camera size={18} />}
            </div>
            <h1 className="fd-h">{hint}</h1>
            <p className="fd-sub">You’ll be asked to confirm before anything changes.</p>
          </div>
        )}

        {/* ── recognised: name + the direction it proposes ────────────────── */}
        {phase === 'found' && found && (
          <div className="fd-centre">
            <p className="fd-eyebrow">{found.member.status === 'aboard' ? 'Currently aboard' : 'Currently ashore'}</p>
            <h1 className="fd-name">{found.member.name}</h1>
            <h2 className="fd-q">{found.question}</h2>
            <div className="fd-actions">
              <button type="button" className="fd-btn fd-yes" onClick={confirm} autoFocus>
                <Check size={20} /> Yes{found.next === 'aboard' ? ', coming aboard' : ', going ashore'}
              </button>
              <button type="button" className="fd-btn fd-no" onClick={() => bail('not-me')}>
                <X size={18} /> Not me
              </button>
            </div>
          </div>
        )}

        {/* ── no camera / no model / no connection ────────────────────────── */}
        {phase === 'error' && (
          <div className="fd-centre">
            <div className="fd-badge fd-bad"><Icon name="AlertTriangle" size={18} /></div>
            <h1 className="fd-h">Can’t use the camera</h1>
            <p className="fd-sub">{err}</p>
            <div className="fd-actions">
              <button type="button" className="fd-btn fd-yes" onClick={() => bail('error')}>
                <Users size={18} /> Tap your name instead
              </button>
            </div>
          </div>
        )}

        {/* The way out is always on screen, never behind a menu. */}
        {phase !== 'error' && (
          <button type="button" className="fd-escape" onClick={() => bail('manual')}>
            <Users size={16} /> Tap your name instead
          </button>
        )}
      </div>
    </div>
  );
}
