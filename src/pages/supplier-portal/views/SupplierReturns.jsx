// ─────────────────────────────────────────────────────────────────────────────
// Supplier portal — Returns page.
//
// TEMPORARY DEBUG SHAPE — Part 3, step 4 of the sprint plan. This page
// currently does the minimum work needed to verify that supplier-side
// RLS lets a logged-in portal account read supplier_return_tasks rows
// routed to them, and that the route_return_to_portal v2 wrote
// slip_metadata correctly. Once Lauren confirms (by logging in as the
// Source and Supply account and loading /supplier/returns) that the
// counts + metadata look right, this whole file gets replaced with the
// full editorial UI.
//
// No editorial styling here — clarity over polish — because if RLS
// isn't working we'd be styling an empty page.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import { useSupplier } from '../../../contexts/SupplierContext';
import { supabase } from '../../../lib/supabaseClient';

const SupplierReturns = () => {
  const { supplier } = useSupplier();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      // Deliberately NOT adding .eq('supplier_id', supplier?.id) — RLS
      // should scope the result on its own. If it doesn't, the debug
      // dump will show foreign rows and we know the policy is wrong.
      const { data, error: e } = await supabase
        ?.from('supplier_return_tasks')
        ?.select('id, supplier_id, status, slip_metadata, items, created_at, acknowledged_at, completed_at, supplier_note')
        ?.order('created_at', { ascending: false });
      if (e) setError(e.message || String(e));
      setRows(data || []);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="sp-page">
      <div className="sp-page-head">
        <div>
          <div className="sp-eyebrow">RLS verification — temporary</div>
          <h1 className="sp-page-title">Returns <em>debug</em></h1>
          <p className="sp-page-sub">
            Confirming supplier-side RLS lets this account read supplier_return_tasks
            and that the slip_metadata snapshot was written. Replaced with the editorial
            UI once Lauren confirms the data is visible.
          </p>
        </div>
      </div>

      <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: 18, marginBottom: 18, fontSize: 13, fontFamily: 'JetBrains Mono, monospace' }}>
        <div><strong>useSupplier().supplier.id:</strong> {supplier?.id || '<missing>'}</div>
        <div><strong>useSupplier().supplier.name:</strong> {supplier?.name || '<missing>'}</div>
        <div><strong>loading:</strong> {String(loading)}</div>
        <div><strong>error:</strong> {error ? <span style={{ color: 'var(--red)' }}>{error}</span> : '—'}</div>
        <div><strong>rows returned:</strong> {rows == null ? '—' : rows.length}</div>
      </div>

      {rows && rows.length === 0 && !error && (
        <div style={{ background: '#FFF8E1', border: '1px solid #FBBF24', borderRadius: 10, padding: '12px 16px', fontSize: 13, marginBottom: 18 }}>
          Zero rows returned. Either no tasks exist for this supplier yet, or supplier-side RLS isn&rsquo;t matching.
          Cross-reference with the superuser SQL count Lauren ran in Step 1.
        </div>
      )}

      {rows && rows.length > 0 && (
        <div style={{ display: 'grid', gap: 14 }}>
          {rows.map((r) => {
            const md = r.slip_metadata || {};
            const items = Array.isArray(r.items) ? r.items : [];
            return (
              <div key={r.id} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: 18, fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5, lineHeight: 1.6 }}>
                <div><strong>id:</strong> {r.id}</div>
                <div><strong>supplier_id:</strong> {r.supplier_id}{r.supplier_id !== supplier?.id ? <span style={{ color: 'var(--red)', marginLeft: 8 }}>⚠ foreign — RLS leak?</span> : null}</div>
                <div><strong>status:</strong> {r.status}</div>
                <div><strong>created_at:</strong> {r.created_at}</div>
                <div><strong>acknowledged_at:</strong> {r.acknowledged_at || '—'}</div>
                <div><strong>completed_at:</strong> {r.completed_at || '—'}</div>
                <div><strong>supplier_note:</strong> {r.supplier_note || '—'}</div>
                <div><strong>slip_metadata present:</strong> {r.slip_metadata == null ? <span style={{ color: 'var(--red)' }}>NULL ⚠</span> : 'yes'}</div>
                <div style={{ marginLeft: 14 }}>
                  <div>vessel_name: {md.vessel_name ?? '—'}</div>
                  <div>vessel_imo: {md.vessel_imo ?? '—'}</div>
                  <div>vessel_flag: {md.vessel_flag ?? '—'}</div>
                  <div>signer_name: {md.signer_name ?? '—'}</div>
                  <div>signer_job_title: {md.signer_job_title ?? '—'}</div>
                  <div>slip_date: {md.slip_date ?? '—'}</div>
                  <div>vessel_signature: {md.vessel_signature ? `present (${md.vessel_signature.length} chars)` : <span style={{ color: 'var(--red)' }}>NULL ⚠</span>}</div>
                </div>
                <div><strong>items[{items.length}]:</strong></div>
                <div style={{ marginLeft: 14 }}>
                  {items.map((it, idx) => (
                    <div key={idx}>· {it.raw_name} — qty {it.return_qty ?? it.quantity ?? '?'} · {it.return_reason ?? 'no reason'}{it.return_notes ? ` · ${it.return_notes}` : ''}</div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SupplierReturns;
