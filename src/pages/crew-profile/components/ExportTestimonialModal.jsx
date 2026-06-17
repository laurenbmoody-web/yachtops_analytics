import React, { useState, useEffect, useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Select from '../../../components/ui/Select';
import Input from '../../../components/ui/Input';
import { Checkbox } from '../../../components/ui/Checkbox';
import ModalShell from '../../../components/ui/ModalShell';
import { showToast } from '../../../utils/toast';
import { supabase } from '../../../lib/supabase';
import { fetchEntriesForUser } from '../utils/seaTimeService';
import {
  getVerifierProfiles, assembleTestimonialDataset, validateTestimonial,
  renderTestimonialPack, SUPPORTING_DOC_LABELS, SERVICE_TYPES, SERVICE_TYPE_LABELS
} from '../../../seatime/testimonial';

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
