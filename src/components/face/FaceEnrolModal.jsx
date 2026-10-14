// Face enrolment — consent, then a handful of captures, then numbers in a table.
//
// Three things about this screen are deliberate:
//
//   1. CONSENT IS A GATE, NOT A FOOTNOTE. You cannot reach the camera without
//      reading what is stored and ticking the box. The wording and its version
//      string live together in services/faceSignIn.js and the version is written
//      onto every row, so it stays possible to say who agreed to what.
//   2. IT ENROLS YOU, AND ONLY YOU. There is no "choose a crew member" field,
//      because the insert policy would refuse it anyway — a captain cannot enrol
//      their crew. That is what makes the consent meaningful rather than a
//      formality someone else clicked through on your behalf.
//   3. NO IMAGE IS KEPT. Frames go from the camera into the model and are gone.
//      What leaves this component is five arrays of 128 numbers.
//
// Several captures, not one: a single template taken in flattering light stops
// matching at the passerelle door at night. The matcher takes the nearest.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Camera, Check, ShieldCheck, Loader2 } from 'lucide-react';
import { describeFace, describeFailure, loadModels, disposeEngine } from '../../lib/face/faceEngine';
import { CONSENT_COPY, CAPTURES_WANTED, enrolMyFace } from '../../services/faceSignIn';
import './face-enrol.css';

// Gap between accepted captures, so five frames of the same instant don't count
// as five angles. Long enough to shift your head between them.
const CAPTURE_GAP_MS = 900;
const SAMPLE_EVERY_MS = 350;

const NUDGES = [
  'Look straight at the camera',
  'Turn your head slightly left',
  'Turn your head slightly right',
  'Lift your chin a little',
  'Back to straight on',
];

export default function FaceEnrolModal({ tenantId, onClose, onEnrolled }) {
  const [phase, setPhase] = useState('consent'); // consent → capture → saving → done
  const [agreed, setAgreed] = useState(false);
  const [hint, setHint] = useState('Starting the camera…');
  const [shots, setShots] = useState([]);
  const [err, setErr] = useState('');

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const lastShotRef = useRef(0);
  const deadRef = useRef(false);
  const shotsRef = useRef([]);

  const stopCamera = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => { deadRef.current = true; stopCamera(); disposeEngine(); }, [stopCamera]);

  const save = async (list) => {
    stopCamera();
    setPhase('saving');
    const { error } = await enrolMyFace(tenantId, list);
    if (deadRef.current) return;
    if (error) {
      setErr(error.message || 'Could not save your enrolment.');
      setPhase('capture');
      return;
    }
    setPhase('done');
    onEnrolled?.(list.length);
  };

  // Poll the model rather than running flat out: enrolment is not a race, and a
  // slower loop keeps an older device responsive. Recurses via setTimeout, so the
  // captures accumulate on a ref — a state read here would be a render behind.
  const sample = () => {
    if (deadRef.current) return;
    timerRef.current = setTimeout(async () => {
      if (deadRef.current) return;
      try {
        const res = await describeFace(videoRef.current);
        if (deadRef.current) return;

        if (!res.ok) {
          setHint(describeFailure(res.reason));
        } else if (Date.now() - lastShotRef.current >= CAPTURE_GAP_MS) {
          lastShotRef.current = Date.now();
          const next = [...shotsRef.current, res.descriptor];
          shotsRef.current = next;
          setShots(next);
          if (next.length >= CAPTURES_WANTED) { save(next); return; }
          setHint(NUDGES[next.length % NUDGES.length]);
        }
      } catch {
        if (!deadRef.current) setErr('Face model could not load. Check the connection and try again.');
        return;
      }
      sample();
    }, SAMPLE_EVERY_MS);
  };

  // Start the model download as soon as consent is given — it is the slow part,
  // and it can happen while the camera permission prompt is still up.
  const begin = async () => {
    setPhase('capture');
    setErr('');
    loadModels().catch(() => {}); // surfaced by the sampling loop below

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      if (deadRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      sample();
    } catch (e) {
      setErr(e?.name === 'NotAllowedError'
        ? 'Camera permission was declined. Allow it in your browser settings to enrol.'
        : 'Could not open the camera on this device.');
    }
  };

  const close = () => { deadRef.current = true; stopCamera(); onClose?.(); };

  return createPortal(
    <div className="fe-wrap" role="dialog" aria-modal="true" aria-label="Set up face sign-in">
      <div className="fe-panel">
        <button type="button" className="fe-x" onClick={close} aria-label="Close"><X size={16} /></button>

        {phase === 'consent' && (
          <>
            <div className="fe-ic"><ShieldCheck size={20} /></div>
            <h3 className="fe-h">{CONSENT_COPY.heading}</h3>
            <ul className="fe-points">
              {CONSENT_COPY.points.map((p) => <li key={p}>{p}</li>)}
            </ul>
            <label className="fe-agree">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              <span>{CONSENT_COPY.agree}</span>
            </label>
            <div className="fe-actions">
              <button type="button" className="fe-btn fe-ghost" onClick={close}>Not now</button>
              <button type="button" className="fe-btn fe-primary" disabled={!agreed} onClick={begin}>
                <Camera size={14} /> Continue
              </button>
            </div>
          </>
        )}

        {phase === 'capture' && (
          <>
            <h3 className="fe-h">{hint}</h3>
            <p className="fe-sub">{shots.length} of {CAPTURES_WANTED} captured</p>
            <div className="fe-stage">
              {/* Mirrored so moving left feels like moving left. The frame the
                  model reads is the un-mirrored one, so this is cosmetic. */}
              <video ref={videoRef} className="fe-video" playsInline muted autoPlay />
              <span className="fe-oval" aria-hidden="true" />
            </div>
            <div className="fe-dots" aria-hidden="true">
              {Array.from({ length: CAPTURES_WANTED }).map((_, i) => (
                <span key={i} className={i < shots.length ? 'on' : ''} />
              ))}
            </div>
            {err && <p className="fe-err">{err}</p>}
            <div className="fe-actions">
              <button type="button" className="fe-btn fe-ghost" onClick={close}>Cancel</button>
            </div>
          </>
        )}

        {phase === 'saving' && (
          <div className="fe-centre">
            <Loader2 size={22} className="fe-spin" />
            <h3 className="fe-h">Saving…</h3>
          </div>
        )}

        {phase === 'done' && (
          <div className="fe-centre">
            <div className="fe-ic fe-ok"><Check size={20} /></div>
            <h3 className="fe-h">You’re enrolled</h3>
            <p className="fe-sub">
              The gangway board will recognise you. It always asks you to confirm before
              changing your status, and tapping your name still works.
            </p>
            <div className="fe-actions">
              <button type="button" className="fe-btn fe-primary" onClick={close}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
