import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../components/AppIcon';
import { TYPE_META } from './engine';
import './captain-signoff.css';

const fmtDate = (iso) => { if (!iso) return '—'; const [y, m, d] = String(iso).split('-'); return d ? `${d}/${m}/${y}` : iso; };
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// UK date entry. A native <input type="date"> renders in the browser's OS
// locale (mm/dd/yyyy on US machines), which breaks the dd/mm/yyyy house style.
// This is a plain text field that always shows and accepts dd/mm/yyyy while
// keeping the form value in ISO (yyyy-mm-dd) — the command-date comparisons
// downstream (cmdFrom <= cmdTo, partial-command span) all assume ISO.
const isoToUk = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).split('-'); return d ? `${d}/${m}/${y}` : ''; };
const ukToIso = (uk) => {
  const s = String(uk).replace(/\D/g, '');
  if (s.length !== 8) return '';
  const d = +s.slice(0, 2), m = +s.slice(2, 4), y = +s.slice(4);
  const dt = new Date(y, m - 1, d);
  return (dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d)
    ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '';
};
function UkDateInput({ value, onChange }) {
  const [text, setText] = useState(isoToUk(value));
  // Sync from an external value (e.g. the async particulars prefill) without
  // clobbering mid-edit typing: only overwrite when the incoming ISO differs
  // from what's already typed. While typing an incomplete date the parent
  // value is '' and ukToIso(text) is '' too, so this never wipes the input.
  useEffect(() => { if ((value || '') !== ukToIso(text)) setText(isoToUk(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const onType = (e) => {
    const s = e.target.value.replace(/\D/g, '').slice(0, 8);
    const out = s.length > 4 ? `${s.slice(0, 2)}/${s.slice(2, 4)}/${s.slice(4)}`
      : s.length > 2 ? `${s.slice(0, 2)}/${s.slice(2)}` : s;
    setText(out);
    onChange(ukToIso(out));
  };
  return <input className="cso-input" value={text} onChange={onType} placeholder="dd/mm/yyyy" inputMode="numeric" maxLength={10} />;
}

// CaptainSignoff — the MSN 1858 sign-off ceremony for one COMMAND SPELL.
// Shared by the crew profile (variant="modal", portaled & dismissable) and the
// reviews inbox (variant="pane", fills the right column). The parent owns the
// outcome: onSign(record) persists the testimonial, onDecline(reason) hands it
// back to the seafarer. The form (signatory particulars) lives here.
//
// `unit` is a command-spell row: vessel particulars + { periods, mode,
// captainName, captainCoc, captainCocGrade, captainEmail, cmdFrom, cmdTo,
// multi, cmdLabel }.
export default function CaptainSignoff({ unit, seafarer, isEng = false, signerName, signerEmail, signerPhone, signerCoc, signerCocGrade, onSign, onDecline, onClose, variant = 'modal' }) {
  const v = unit;
  const ps = v.periods || [];
  const froms = ps.map(e => e.from).filter(Boolean).sort();
  const tos = ps.map(e => e.to).filter(Boolean).sort();
  const [form, setForm] = useState(() => ({
    name: signerName || (v.captainName || '').replace('Capt. ', ''),
    cocNo: v.captainCoc || signerCoc || '',
    cocGrade: v.captainCocGrade || signerCocGrade || '',
    email: v.captainEmail || signerEmail || '',
    phone: signerPhone || '',
    place: '',
    cmdFrom: v.cmdFrom || froms[0] || '',
    cmdTo: v.cmdTo || tos[tos.length - 1] || ''
  }));
  // The signer's particulars (CoC, grade, email, phone) load async from the
  // crew record. Backfill any field the master hasn't touched once they arrive,
  // so the form pre-fills from data on file without ever clobbering typing.
  useEffect(() => {
    setForm(f => ({
      ...f,
      cocNo: f.cocNo || signerCoc || '',
      cocGrade: f.cocGrade || signerCocGrade || '',
      email: f.email || signerEmail || '',
      phone: f.phone || signerPhone || ''
    }));
  }, [signerCoc, signerCocGrade, signerEmail, signerPhone]);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const setSF = (patch) => setForm(f => ({ ...f, ...patch }));

  // Signature — draw it (canvas) or type it (rendered in script). Drawing is the
  // default so it reads as an actual signature, not just a printed name.
  const [sigMode, setSigMode] = useState('draw');
  const padRef = useRef(null);
  const ctxRef = useRef(null);
  const drawingRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  const setupPad = () => {
    const c = padRef.current; if (!c) return;
    const rect = c.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(rect.width * dpr);
    c.height = Math.round(rect.height * dpr);
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1C1B3A';
    ctxRef.current = ctx;
    setHasInk(false); // setting canvas.width clears it
  };
  useEffect(() => {
    if (sigMode !== 'draw') return undefined;
    setupPad();
    const onResize = () => setupPad(); // note: clears the pad on resize
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [sigMode]);

  const padPos = (e) => { const r = padRef.current.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const padDown = (e) => { const ctx = ctxRef.current; if (!ctx) return; drawingRef.current = true; const { x, y } = padPos(e); ctx.beginPath(); ctx.moveTo(x, y); padRef.current.setPointerCapture(e.pointerId); };
  const padMove = (e) => { if (!drawingRef.current) return; const ctx = ctxRef.current; const { x, y } = padPos(e); ctx.lineTo(x, y); ctx.stroke(); if (!hasInk) setHasInk(true); };
  const padUp = () => { drawingRef.current = false; };
  const clearPad = () => { const c = padRef.current, ctx = ctxRef.current; if (c && ctx) ctx.clearRect(0, 0, c.width, c.height); setHasInk(false); };
  const signed = sigMode === 'draw' ? hasInk : form.name.trim().length > 1;

  const totDays = ps.reduce((s, e) => s + (e.days || 0), 0);
  const caps = [...new Set(ps.map(e => e.capacity).filter(Boolean))].join(', ') || '—';
  const isStamp = v.mode === 'stamp';
  const spanFrom = froms[0];
  const spanTo = tos[tos.length - 1];
  // A master may have commanded only part of the logged span (change of
  // command); flag the dates that then need a separate master's testimonial.
  const partialCmd = !!(form.cmdFrom && form.cmdTo && (form.cmdFrom > spanFrom || form.cmdTo < spanTo));
  const canSign = signed && form.name.trim().length > 1 && form.cocNo.trim().length > 1 && EMAIL_RE.test(form.email.trim()) && !!form.cmdFrom && !!form.cmdTo && form.cmdFrom <= form.cmdTo;

  const submit = () => onSign({
    name: form.name.trim(), cocNo: form.cocNo.trim(), cocGrade: form.cocGrade.trim(),
    email: form.email.trim(), phone: form.phone.trim(), place: form.place.trim(),
    cmdFrom: form.cmdFrom, cmdTo: form.cmdTo,
    signature: sigMode === 'draw'
      ? { kind: 'drawn', image: padRef.current ? padRef.current.toDataURL('image/png') : null }
      : { kind: 'typed', text: form.name.trim() }
  });

  const content = (
    <>
      {variant === 'modal' && <button className="cso-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>}
      <div className="cso-head">
        <div className="cso-eyebrow">Captain sign-off · MSN 1858</div>
        <h3 className="cso-title">{isStamp ? 'Verify service in Cargo' : 'Sign sea-service testimonial'}</h3>
        <div className="cso-sub">You’re confirming service performed under your command aboard <b>{v.name}</b>{v.multi && v.cmdLabel ? <> · <b>{v.cmdLabel.toLowerCase()}</b></> : null}.</div>
      </div>
      <div className="cso-body">
        <div className="cso-meta">
          <div className="cso-metacol">
            <span className="cso-lbl">Seafarer</span>
            <span className="cso-val">{seafarer.fullName}</span>
            <span className="cso-vs">{caps}</span>
          </div>
          <div className="cso-metacol">
            <span className="cso-lbl">Vessel</span>
            <span className="cso-val">{v.name}</span>
            <span className="cso-vs">{v.flag} · {v.gt}GT · {v.lengthM}m · IMO {v.imo}{isEng && v.kw ? ` · ${v.kw} kW` : ''}</span>
          </div>
        </div>
        <div className="cso-sec">
          <div className="cso-lbl">Service you’re confirming <span className="cso-cnt">{ps.length} {ps.length === 1 ? 'period' : 'periods'} · {totDays} {totDays === 1 ? 'day' : 'days'}</span></div>
          <div className="cso-plist">
            {ps.map(e => {
              const tm = TYPE_META[e.type];
              const det = e.type === 'watchkeeping' ? `${e.watchHours}h watch · ${e.capacity}` : (e.detailOverride || `${tm.hint} · ${e.capacity}`);
              return (
                <div className="cso-prow" key={e.id}>
                  <span className="cso-prail" style={{ background: tm.color }} />
                  <div className="cso-pdate">{e.dateMain}<span>{e.days} {e.days === 1 ? 'day' : 'days'}</span></div>
                  <div className="cso-pdet"><span className="cso-ptype" style={{ color: tm.color }}>{tm.label}</span><span className="cso-vs">{det}</span></div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="cso-decl">
          <Icon name="ShieldCheck" size={16} />
          <span>I certify that the above is a true record of sea service performed aboard <b>{v.name}</b> under my command, and that I am authorised to make this testimonial. I am not the seafarer named.</span>
        </div>
        {isStamp ? (
          <div className="cso-stamp">
            <Icon name="BadgeCheck" size={20} />
            <div>
              <div className="cso-stamp-t">Ship’s stamp applied from {v.name}’s Cargo identity</div>
              <div className="cso-vs">The official stamp is carried automatically from the vessel’s Cargo record — no paper stamp needed.</div>
            </div>
          </div>
        ) : (
          <div className="cso-stamp ink">
            <Icon name="PenLine" size={20} />
            <div>
              <div className="cso-stamp-t">Digital signature — stands in for the ship’s stamp</div>
              <div className="cso-vs">Your signed-off CoC details below authenticate this testimonial.</div>
            </div>
          </div>
        )}
        <div className="cso-fields">
          <div className="cso-grid">
            <div className="cso-fld">
              <label className="cso-lbl">Master’s CoC number <span className="req">required</span></label>
              <input className="cso-input" value={form.cocNo} onChange={e => setSF({ cocNo: e.target.value })} placeholder="e.g. GBR-CoC-447120" />
            </div>
            <div className="cso-fld">
              <label className="cso-lbl">CoC grade <span className="opt">optional</span></label>
              <input className="cso-input" value={form.cocGrade} onChange={e => setSF({ cocGrade: e.target.value })} placeholder="e.g. Master (Yachts) <3000GT" />
            </div>
          </div>
          <div className="cso-grid">
            <div className="cso-fld">
              <label className="cso-lbl">Contact email <span className="req">required</span></label>
              <input className="cso-input" type="email" value={form.email} onChange={e => setSF({ email: e.target.value })} placeholder="so the assessor can verify with you" />
            </div>
            <div className="cso-fld">
              <label className="cso-lbl">Contact phone <span className="opt">optional</span></label>
              <input className="cso-input" value={form.phone} onChange={e => setSF({ phone: e.target.value })} placeholder="+…" />
            </div>
          </div>
          <div className="cso-grid">
            <div className="cso-fld">
              <label className="cso-lbl">In command from <span className="req">required</span></label>
              <UkDateInput value={form.cmdFrom} onChange={iso => setSF({ cmdFrom: iso })} />
            </div>
            <div className="cso-fld">
              <label className="cso-lbl">In command to <span className="req">required</span></label>
              <UkDateInput value={form.cmdTo} onChange={iso => setSF({ cmdTo: iso })} />
            </div>
          </div>
          {partialCmd && (
            <div className="cso-warn"><Icon name="TriangleAlert" size={15} /><span>Your command dates don’t cover the whole logged period ({fmtDate(spanFrom)} – {fmtDate(spanTo)}). You’ll only certify the dates you were in command — the rest needs a separate testimonial from the master in command then.</span></div>
          )}
          <div className="cso-fld">
            <label className="cso-lbl">Place of signing <span className="opt">optional</span></label>
            <input className="cso-input" value={form.place} onChange={e => setSF({ place: e.target.value })} placeholder="e.g. Antibes, France" />
          </div>
        </div>
        <div className="cso-sig">
          <div className="cso-flexrow">
            <label className="cso-lbl">Sign here <span className="req">required</span></label>
            <div className="cso-sigtabs">
              <button type="button" className={`cso-sigtab${sigMode === 'draw' ? ' on' : ''}`} onClick={() => setSigMode('draw')}>Draw</button>
              <button type="button" className={`cso-sigtab${sigMode === 'type' ? ' on' : ''}`} onClick={() => setSigMode('type')}>Type</button>
            </div>
          </div>
          {sigMode === 'draw' ? (
            <div className="cso-pad">
              <canvas ref={padRef} onPointerDown={padDown} onPointerMove={padMove} onPointerUp={padUp} onPointerLeave={padUp} />
              {!hasInk && <span className="cso-pad-hint">Draw your signature here</span>}
              <button type="button" className="cso-pad-clear" onClick={clearPad}>Clear</button>
            </div>
          ) : (
            <div className="cso-sigprev" style={{ opacity: form.name.trim() ? 1 : 0.35 }}>{form.name.trim() || 'Your signature'}</div>
          )}
          <label className="cso-lbl" style={{ marginTop: 4 }}>Full name (printed) <span className="req">required</span></label>
          <input className="cso-input" value={form.name} onChange={e => setSF({ name: e.target.value })} placeholder="e.g. Henrik Sörensen" />
        </div>
        {declineOpen ? (
          <div className="cso-sig">
            <label className="cso-lbl">Reason for declining <span className="opt">optional</span></label>
            <textarea className="cso-input" rows={2} value={declineReason} onChange={e => setDeclineReason(e.target.value)} placeholder="Let them know what needs correcting…" />
          </div>
        ) : (
          <button className="cso-declinelink" onClick={() => setDeclineOpen(true)}>Something’s not right? Decline this request</button>
        )}
      </div>
      <div className="cso-foot">
        {declineOpen ? (
          <>
            <button className="cso-btn ghost" onClick={() => setDeclineOpen(false)}>Back</button>
            <button className="cso-btn danger" onClick={() => onDecline(declineReason.trim())}>Send decline</button>
          </>
        ) : (
          <>
            {variant === 'modal' && <button className="cso-btn ghost" onClick={onClose}>Cancel</button>}
            <button className="cso-btn rust" disabled={!canSign} onClick={submit}>
              <Icon name={isStamp ? 'BadgeCheck' : 'PenLine'} size={15} /> {isStamp ? 'Verify in Cargo' : 'Sign & confirm'}
            </button>
          </>
        )}
      </div>
    </>
  );

  if (variant === 'pane') return <div className="cso cso-pane" role="region" aria-label="Captain sign-off">{content}</div>;
  return createPortal(
    <div className="cso-overlay" onClick={onClose}>
      <div className="cso" role="dialog" aria-modal="true" aria-label="Captain sign-off" onClick={e => e.stopPropagation()}>{content}</div>
    </div>,
    document.body
  );
}
