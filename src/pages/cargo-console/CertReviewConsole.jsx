import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, X, FileText, ExternalLink, ChevronLeft, ShieldCheck, RotateCcw } from 'lucide-react';
import Header from '../../components/navigation/Header';
import { amIPlatformAdmin, fetchCertReviewQueue, setCertStatus } from './utils';
import './cert-console.css';

const SCHEME_LABEL = {
  brcgs: 'BRCGS', brc: 'BRCGS', ifs: 'IFS', msc: 'MSC (seafood)', asc: 'ASC (aquaculture)',
  globalgap: 'GLOBALG.A.P.', eu_organic: 'EU Organic', soil_association: 'Soil Association',
  fssc: 'FSSC 22000', haccp: 'HACCP', organic: 'Organic', iso22000: 'ISO 22000', other: 'Other',
};

// What to actually check on each scheme's register — the links point to
// different kinds of search (BRCGS lists approved bodies, not certificates).
const CHECK_HINT = {
  brcgs: 'Search the issuing body on the directory — BRCGS says any body not listed is not authorised to issue a certificate, so if it isn\'t there the cert isn\'t valid.',
  brc:   'Search the issuing body on the directory — if it isn\'t a listed BRCGS-approved body, the cert isn\'t valid.',
  ifs:   'Search the certified company and confirm the certificate is current.',
  fssc:  'Search the organisation and confirm the certificate is active.',
  msc:   'Search the certificate number or company and confirm it\'s a valid MSC certificate.',
  asc:   'Search the farm / company and confirm the certificate is current.',
  globalgap: 'Search the GGN or certificate number and confirm it\'s valid.',
  eu_organic: 'Confirm the operator with its control body / the organic register.',
  soil_association: 'Search the licensee and confirm certification is current.',
  organic: 'Organic schemes vary — confirm the operator with the control body named on the certificate.',
  haccp: 'HACCP has no central register — check the scheme certificate behind it and the issuing body directly.',
};

const fmtDate = (d) => {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('en-GB'); // dd/mm/yyyy
};

const verdictPill = (v) => {
  if (v === 'good')    return { cls: 'good',    label: 'Looks good' };
  if (v === 'problem') return { cls: 'problem', label: 'Problem' };
  if (v === 'review')  return { cls: 'review',  label: 'Needs a look' };
  return { cls: 'pending', label: 'Not yet read' };
};

const TABS = [
  { key: 'review',   label: 'To review' },
  { key: 'verified', label: 'Verified' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all',      label: 'All' },
];

const inReview = (c) => c.status !== 'verified' && c.status !== 'rejected';

const CertReviewConsole = () => {
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState(null); // null = checking
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('review');
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    amIPlatformAdmin().then(ok => {
      setAllowed(ok);
      if (ok) load();
      else setLoading(false);
    });
  }, []);

  const load = async () => {
    setLoading(true); setError(null);
    try { setRows(await fetchCertReviewQueue()); }
    catch (e) { setError(e.message || 'Could not load the queue'); }
    finally { setLoading(false); }
  };

  const act = async (cert, status) => {
    setBusyId(cert.id);
    // optimistic
    setRows(rs => rs.map(r => r.id === cert.id ? { ...r, status, verified: status === 'verified' } : r));
    try { await setCertStatus(cert.id, status); }
    catch (e) { setError(e.message || 'Could not update'); await load(); }
    finally { setBusyId(null); }
  };

  const counts = useMemo(() => ({
    review:   rows.filter(inReview).length,
    verified: rows.filter(r => r.status === 'verified').length,
    rejected: rows.filter(r => r.status === 'rejected').length,
    all:      rows.length,
  }), [rows]);

  const shown = useMemo(() => {
    if (tab === 'review')   return rows.filter(inReview);
    if (tab === 'verified') return rows.filter(r => r.status === 'verified');
    if (tab === 'rejected') return rows.filter(r => r.status === 'rejected');
    return rows;
  }, [rows, tab]);

  if (allowed === false) {
    return (
      <>
        <Header />
        <div className="cc-page">
          <div className="cc-gate">
            <div className="big">Cargo staff only</div>
            <p>This console is for the Cargo team. Your account isn't on the reviewer list.</p>
            <button className="cc-btn undo" style={{ marginTop: 14 }} onClick={() => navigate('/dashboard')}>
              <ChevronLeft size={15} /> Back
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Header />
      <div className="cc-page">
        <div className="cc-wrap">
          <p className="cc-meta"><span className="dot">●</span> Cargo internal · Trust &amp; safety</p>
          <h1 className="cc-title">Certificate review</h1>
          <p className="cc-sub">
            Cargo reads each uploaded certificate automatically and screens it. Confirm it against the issuing
            body's register, then grant the <strong>Verified</strong> tick buyers rely on — or reject it.
          </p>

          <div className="cc-tabs">
            {TABS.map(t => (
              <button key={t.key} className={`cc-tab ${tab === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>
                {t.label} <span className="n">{counts[t.key]}</span>
              </button>
            ))}
          </div>

          {error && (
            <div style={{ background: '#FDECEC', border: '1px solid #F5C6C6', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#C0392B' }}>{error}</div>
          )}

          {loading ? (
            <div className="cc-empty">Loading…</div>
          ) : shown.length === 0 ? (
            <div className="cc-empty">
              <div className="big">Nothing here</div>
              <p>{tab === 'review' ? 'No certificates waiting for review. Nicely done.' : 'No certificates in this list yet.'}</p>
            </div>
          ) : (
            shown.map(c => {
              const vp = verdictPill(c.verdict);
              const busy = busyId === c.id;
              const expired = c.expiryDate && new Date(c.expiryDate) < new Date();
              return (
                <div key={c.id} className="cc-card">
                  <div className="cc-cardhead">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="cc-supp">{c.supplierName}</div>
                      <div className="cc-cert">uploaded <strong>{c.name}</strong></div>
                    </div>
                    {c.status === 'verified' ? (
                      <span className="cc-pill verified"><ShieldCheck size={12} /> Verified{c.verifiedAt ? ` · ${fmtDate(c.verifiedAt)}` : ''}</span>
                    ) : c.status === 'rejected' ? (
                      <span className="cc-pill rejected">Rejected</span>
                    ) : (
                      <span className={`cc-pill ${vp.cls}`}>{vp.label}{typeof c.confidence === 'number' ? ` · ${Math.round(c.confidence * 100)}%` : ''}</span>
                    )}
                  </div>

                  <div className="cc-grid">
                    <div className="cc-row"><span className="k">Scheme</span><span className="v">{SCHEME_LABEL[c.scheme] || c.scheme || <span className="mut">—</span>}</span></div>
                    <div className="cc-row"><span className="k">Certificate no.</span><span className={`v ${c.certNumber ? '' : 'mut'}`}>{c.certNumber || '—'}</span></div>
                    <div className="cc-row"><span className="k">Issued to</span><span className={`v ${c.issuedTo ? '' : 'mut'}`}>{c.issuedTo || '—'}</span></div>
                    <div className="cc-row"><span className="k">Issuing body</span><span className={`v ${c.issuingBody ? '' : 'mut'}`}>{c.issuingBody || '—'}</span></div>
                    <div className="cc-row"><span className="k">Issued</span><span className={`v ${c.issueDate ? '' : 'mut'}`}>{fmtDate(c.issueDate) || '—'}</span></div>
                    <div className="cc-row"><span className="k">Expires</span><span className="v" style={expired ? { color: '#C0392B' } : undefined}>{fmtDate(c.expiryDate) || <span className="mut">—</span>}{expired ? ' · expired' : ''}</span></div>
                    <div className="cc-row"><span className="k">Uploaded</span><span className="v mut" style={{ fontWeight: 400, color: '#8B8478' }}>{fmtDate(c.createdAt) || '—'}</span></div>
                  </div>

                  {c.flags.length > 0 ? (
                    <div className="cc-flags">
                      <div className="h">Flags</div>
                      <ul>{c.flags.map((f, i) => <li key={i}>{f}</li>)}</ul>
                    </div>
                  ) : (
                    <div className="cc-noflags">No automated flags.</div>
                  )}

                  {inReview(c) && CHECK_HINT[c.scheme] && (
                    <div className="cc-hint"><span className="h">How to check</span>{CHECK_HINT[c.scheme]}</div>
                  )}

                  <div className="cc-actions">
                    {c.docUrl && (
                      <a className="cc-link doc" href={c.docUrl} target="_blank" rel="noopener noreferrer"><FileText size={14} /> View document</a>
                    )}
                    {c.registryUrl && (
                      <a className="cc-link reg" href={c.registryUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Check on register</a>
                    )}
                    <div className="cc-spacer" />
                    {c.status === 'verified' || c.status === 'rejected' ? (
                      <button className="cc-btn undo" disabled={busy} onClick={() => act(c, 'ai_checked')}>
                        <RotateCcw size={13} /> Move back to review
                      </button>
                    ) : (
                      <>
                        <button className="cc-btn ghost" disabled={busy} onClick={() => act(c, 'rejected')}>
                          <X size={14} /> Reject
                        </button>
                        <button className="cc-btn verify" disabled={busy} onClick={() => act(c, 'verified')}>
                          <Check size={14} strokeWidth={3} /> Verify
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
};

export default CertReviewConsole;
