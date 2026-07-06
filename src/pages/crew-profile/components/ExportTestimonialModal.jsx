import React, { useState, useEffect, useMemo, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Select from '../../../components/ui/Select';
import Input from '../../../components/ui/Input';
import { Checkbox } from '../../../components/ui/Checkbox';
import ModalShell from '../../../components/ui/ModalShell';
import { showToast } from '../../../utils/toast';
import { supabase } from '../../../lib/supabase';
import { fetchEntriesForUser, fetchGuestOnDays, fetchLeaveDaysInRange } from '../utils/seaTimeService';
import {
  getVerifierProfiles, assembleTestimonialDataset, validateTestimonial,
  renderTestimonialPack, SUPPORTING_DOC_LABELS, SERVICE_TYPES, SERVICE_TYPE_LABELS
} from '../../../seatime/testimonial';
import { buildPyaPayload } from '../../../seatime/pya/pyaPayload';
import { PYA_BOOKMARKLET_HREF, buildPyaClipboard } from '../../../seatime/pya/pyaBookmarklet';

// Sea Service Testimonial Pack generator. ONE dataset (built from the existing
// Supabase sea-time store) -> verifier adapter -> validated PDF + checklist.
// Switching the verifier re-renders the checklist/validation from the SAME
// dataset — no data re-entry, no refetch.
const ExportTestimonialModal = ({ isOpen, onClose, userId, tenantId, currentUser }) => {
  const verifiers = useMemo(() => getVerifierProfiles(), []);
  const [verifierId, setVerifierId] = useState('pya');
  const [entries, setEntries] = useState(null);
  const [seafarer, setSeafarer] = useState({ fullName: '' });
  const [signatory, setSignatory] = useState({ name: '', rank: 'Master', cocNumber: '', userId: null });
  const [suppliedDocs, setSuppliedDocs] = useState({});
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  // Extra facts the PYA form wants that aren't in the core dataset.
  const [extras, setExtras] = useState({ guestDays: null, leaveDays: null });
  const bookmarkletRef = useRef(null);

  const verifier = verifiers.find(v => v.id === verifierId);

  useEffect(() => {
    if (!isOpen || !tenantId || !userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Seafarer identity (canonical Annex A fields).
        const [{ data: prof }, { data: pd }, list] = await Promise.all([
          supabase?.from('profiles')?.select('full_name, first_name, surname')?.eq('id', userId)?.maybeSingle(),
          supabase?.from('crew_personal_details')?.select('date_of_birth, nationality')?.eq('user_id', userId)?.maybeSingle(),
          fetchEntriesForUser(tenantId, userId, 'mca-oow-yachts')
        ]);
        if (cancelled) return;
        const fullName = prof?.full_name || [prof?.first_name, prof?.surname].filter(Boolean).join(' ') || 'Seafarer';
        setSeafarer({ fullName, dob: pd?.date_of_birth || undefined, nationality: pd?.nationality || undefined, userId });
        setEntries(list || []);
        // Default signatory = the person operating this screen (the captain/command).
        setSignatory(s => ({
          ...s,
          name: s.name || currentUser?.fullName || '',
          userId: currentUser?.id || null
        }));
      } catch (e) {
        console.error('testimonial load failed', e);
        showToast('Could not load sea time for the testimonial', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, tenantId, userId]);

  // Re-assemble the dataset client-side whenever its inputs change (cheap — no
  // refetch). Switching verifier does NOT touch this.
  const dataset = useMemo(() => {
    if (!entries) return null;
    const docs = Object.keys(suppliedDocs).filter(k => suppliedDocs[k]);
    return assembleTestimonialDataset({ seafarer, entries, signatory, supportingDocs: docs, period: {} });
  }, [entries, seafarer, signatory, suppliedDocs]);

  const validation = useMemo(
    () => (dataset && verifier ? validateTestimonial(dataset, verifier) : null),
    [dataset, verifier]
  );

  // PYA autofill — pull the extra facts (guest-on + leave days) once the period
  // is known, then build the payload the bookmarklet reads from the clipboard.
  useEffect(() => {
    const from = dataset?.service?.periodFrom, to = dataset?.service?.periodTo;
    if (verifierId !== 'pya' || !tenantId || !userId || !from || !to) return;
    let cancelled = false;
    (async () => {
      const [guest, leave] = await Promise.all([
        fetchGuestOnDays(tenantId, userId).catch(() => null),
        fetchLeaveDaysInRange(userId, from, to).catch(() => null),
      ]);
      if (!cancelled) setExtras({ guestDays: guest?.days ?? null, leaveDays: leave });
    })();
    return () => { cancelled = true; };
  }, [verifierId, tenantId, userId, dataset?.service?.periodFrom, dataset?.service?.periodTo]);

  const pyaPayload = useMemo(() => {
    if (!dataset) return null;
    return buildPyaPayload({
      dataset,
      leaveDays: extras.leaveDays,
      guestDays: extras.guestDays,
      signatoryEmail: currentUser?.email || '',
    });
  }, [dataset, extras.leaveDays, extras.guestDays, currentUser?.email]);

  // React refuses to render a `javascript:` href from JSX (sanitised to about:blank),
  // so set it via the DOM after mount — the anchor stays draggable to the bookmarks bar.
  useEffect(() => {
    if (bookmarkletRef.current) bookmarkletRef.current.setAttribute('href', PYA_BOOKMARKLET_HREF);
  }, [verifierId, loading]);

  const copyForPya = async () => {
    if (!pyaPayload) return;
    try {
      await navigator.clipboard.writeText(buildPyaClipboard(pyaPayload));
      showToast('Details copied — now click the “Fill PYA form” bookmark on the PYA page', 'success');
    } catch {
      showToast('Could not copy — check clipboard permissions', 'error');
    }
  };

  const handleGenerate = async () => {
    if (!dataset || !verifier) return;
    setGenerating(true);
    try {
      const { pdfBytes } = await renderTestimonialPack(dataset, verifier);
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sea-service-testimonial-${verifier.id}-${dataset.assurance.verificationRef}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('Testimonial pack generated', 'success');
    } catch (e) {
      // Blocked by validation, or a render error.
      showToast(e?.code === 'VALIDATION_BLOCKED' ? 'Fix the flagged issues first' : 'Generation failed', 'error');
    } finally {
      setGenerating(false);
    }
  };

  if (!isOpen) return null;
  const totals = dataset?.service?.totals;

  return (
    <ModalShell onClose={onClose} panelClassName="bg-background border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 bg-background border-b border-border p-6 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <Icon name="FileCheck" size={22} className="text-primary" />
          <div>
            <h2 className="text-xl font-semibold text-foreground">Sea Service Testimonial Pack</h2>
            <p className="text-sm text-muted-foreground mt-0.5">MCA MIN 642 Annex A · captain-signed</p>
          </div>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-accent rounded-lg transition-smooth">
          <Icon name="X" size={20} className="text-muted-foreground" />
        </button>
      </div>

      <div className="p-6 space-y-5">
        {loading ? (
          <div className="text-center py-10 text-muted-foreground">Loading sea time…</div>
        ) : (
          <>
            {/* Verifier select — switching re-renders from the same dataset */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Approved verifying organisation</label>
              <Select value={verifierId} onChange={(e) => setVerifierId(e?.target?.value)}>
                {verifiers.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
              </Select>
              <p className="text-xs text-muted-foreground mt-1.5">{verifier?.submissionInstructions}</p>
            </div>

            {/* Service totals — four types, separately */}
            <div className="bg-muted/20 border border-border rounded-xl p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                {seafarer.fullName} · {dataset?.service?.capacity || '—'} · {totals ? Object.values(totals).reduce((a, b) => a + b, 0) : 0} days
              </div>
              <div className="grid grid-cols-4 gap-3">
                {SERVICE_TYPES.map(t => (
                  <div key={t}>
                    <div className="text-2xl font-bold text-foreground">{totals?.[t] ?? 0}</div>
                    <div className="text-xs text-muted-foreground">{SERVICE_TYPE_LABELS[t]}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Signatory */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Signatory (Master / Responsible Official)</label>
                <Input value={signatory.name} onChange={(e) => setSignatory(s => ({ ...s, name: e?.target?.value, userId: null }))} placeholder="Captain's full name" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Rank</label>
                <Input value={signatory.rank} onChange={(e) => setSignatory(s => ({ ...s, rank: e?.target?.value }))} placeholder="Master" />
              </div>
            </div>

            {/* Required supporting docs for this verifier */}
            {verifier?.requiredSupportingDocs?.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Supporting documents required by {verifier.label}</label>
                <div className="space-y-2">
                  {verifier.requiredSupportingDocs.map(doc => (
                    <label key={doc} className="flex items-center gap-2 text-sm text-foreground">
                      <Checkbox checked={!!suppliedDocs[doc]} onChange={(e) => setSuppliedDocs(d => ({ ...d, [doc]: e?.target?.checked }))} />
                      {SUPPORTING_DOC_LABELS[doc] || doc}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Validation — generation is blocked unless clean */}
            {validation && !validation.ok && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon name="AlertTriangle" size={16} className="text-red-600 dark:text-red-400" />
                  <span className="text-sm font-semibold text-red-600 dark:text-red-400">
                    {validation.errors.length} issue{validation.errors.length > 1 ? 's' : ''} to resolve before generating
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {validation.errors.map((err, i) => (
                    <li key={i} className="text-xs text-red-600 dark:text-red-400 flex gap-1.5">
                      <span>•</span><span>{err.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {validation?.ok && (
              <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 flex items-center gap-2">
                <Icon name="CheckCircle" size={16} className="text-green-600 dark:text-green-400" />
                <span className="text-sm text-green-700 dark:text-green-400">Ready to generate — passes first-pass checks for {verifier.label}.</span>
              </div>
            )}

            {/* PYA online form autofill — a saved bookmarklet types Cargo's data
                into member.pya.org's SST form. PYA-only. */}
            {verifierId === 'pya' && (
              <div className="border border-border rounded-xl p-4 bg-muted/10">
                <div className="flex items-center gap-2 mb-1">
                  <Icon name="Wand2" size={16} className="text-primary" />
                  <span className="text-sm font-semibold text-foreground">Autofill the PYA online form</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-primary bg-primary/10 rounded-full px-2 py-0.5">Beta</span>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  Fills the vessel details, dates and the sea-service day boxes on PYA’s
                  “Verify Sea Service Testimonial” page. Flag, areas cruised and engine fields stay for you.
                </p>
                <ol className="text-xs text-foreground space-y-2.5">
                  <li className="flex gap-2">
                    <span className="font-semibold text-muted-foreground">1.</span>
                    <span className="flex-1">
                      Once, drag this button to your bookmarks bar:{' '}
                      {/* href set imperatively (see effect) — React blocks javascript: hrefs */}
                      <a
                        ref={bookmarkletRef}
                        onClick={(e) => { e.preventDefault(); showToast('Drag me to your bookmarks bar — don’t click here', 'info'); }}
                        className="inline-flex items-center gap-1 align-middle px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-xs font-semibold cursor-grab no-underline"
                        title="Drag to your bookmarks bar"
                      >
                        <Icon name="Anchor" size={12} /> Fill PYA form
                      </a>
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-muted-foreground">2.</span>
                    <span className="flex-1">
                      Copy this crew member’s details:{' '}
                      <button
                        type="button"
                        onClick={copyForPya}
                        disabled={!pyaPayload}
                        className="inline-flex items-center gap-1 align-middle px-2.5 py-1 rounded-md border border-border bg-background text-xs font-semibold hover:bg-accent disabled:opacity-50"
                      >
                        <Icon name="Copy" size={12} /> Copy details for PYA
                      </button>
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-muted-foreground">3.</span>
                    <span className="flex-1">On the PYA <span className="font-mono">sst-request/create</span> page, click the <strong>Fill PYA form</strong> bookmark. It reports what filled and what to do by hand.</span>
                  </li>
                </ol>
                <p className="text-[11px] text-muted-foreground mt-3">
                  Always check every field against your own records before submitting — PYA queries service that doesn’t reconcile.
                </p>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Cargo prepares and assures the pack; verification is the approved body's human review.
              You submit via their own route — there is no automated submission.
            </p>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="sticky bottom-0 bg-background border-t border-border p-6 flex items-center justify-end gap-3">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleGenerate} disabled={loading || generating || !validation?.ok} iconName="Download">
          {generating ? 'Generating…' : 'Generate signed pack'}
        </Button>
      </div>
    </ModalShell>
  );
};

export default ExportTestimonialModal;
