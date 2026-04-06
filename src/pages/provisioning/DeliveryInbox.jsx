import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { showToast } from '../../utils/toast';
import {
  fetchDeliveryInbox,
  claimInboxItem,
  dismissInboxItem,
  returnInboxItem,
  fetchPendingReturns,
  confirmReturned,
  cancelReturns,
  fetchProvisioningLists,
} from './utils/provisioningStorage';
import { logActivity } from '../../utils/activityStorage';
import { supabase } from '../../lib/supabaseClient';

// ── Expiry badge ──────────────────────────────────────────────────────────────

const ExpiryBadge = ({ expiresAt }) => {
  if (!expiresAt) return null;
  const diffMs = new Date(expiresAt) - Date.now();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 12, background: '#FEF2F2', color: '#DC2626' }}>Expired</span>
  );
  if (diffDays <= 2) return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 12, background: '#FEF3E2', color: '#B45309' }}>
      Expires in {diffDays} day{diffDays !== 1 ? 's' : ''}
    </span>
  );
  return (
    <span style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 12, background: '#F1F5F9', color: '#94A3B8' }}>
      Expires in {diffDays} days
    </span>
  );
};

// ── Inline board pill claim ───────────────────────────────────────────────────

const ClaimInline = ({ item, boards, userId, onClaimed, onPartialClaim, onExpandChange }) => {
  // step: 'idle' | 'boards' | 'qty'
  const [step, setStep] = useState('idle');
  const [selectedBoard, setSelectedBoard] = useState(null);
  const [claimQty, setClaimQty] = useState(item.quantity ?? 1);
  const [claiming, setClaiming] = useState(false);

  const goToStep = (s) => {
    setStep(s);
    onExpandChange?.(s !== 'idle');
  };

  const handleBoardSelect = (board) => {
    setSelectedBoard(board);
    setClaimQty(item.quantity ?? 1);
    goToStep('qty');
  };

  const handleConfirm = async () => {
    setClaiming(true);
    const result = await claimInboxItem(item.id, userId, selectedBoard.id, claimQty);
    if (result) {
      logActivity({
        module: 'provisioning',
        action: 'PROVISION_INBOX_CLAIMED',
        entityType: 'provisioning_list',
        entityId: selectedBoard.id,
        summary: `claimed ${claimQty} × "${result.raw_name}" from Delivery Inbox`,
        meta: {
          inbox_item_id: item.id,
          raw_name: result.raw_name,
          quantity_claimed: claimQty,
          remainder: result._remainder,
          board_id: selectedBoard.id,
          original_scanned_by: result.scanned_by,
        },
      });
      if (result._partial) {
        showToast(`${claimQty} × "${result.raw_name}" claimed to ${selectedBoard.title} · ${result._remainder} remaining`, 'success');
        onPartialClaim?.();
      } else {
        showToast(`"${result.raw_name}" claimed to ${selectedBoard.title}`, 'success');
        onClaimed(item.id);
      }
    } else {
      showToast('Failed to claim item', 'error');
      setClaiming(false);
    }
  };

  if (claiming) return <span style={{ fontSize: 12, color: '#94A3B8' }}>Claiming…</span>;

  if (step === 'idle') {
    return (
      <button
        onClick={() => goToStep('boards')}
        style={{
          padding: '5px 14px', borderRadius: 7,
          border: '1.5px solid #1E3A5F', background: 'transparent',
          color: '#1E3A5F', fontSize: 12, fontWeight: 600,
          cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
        }}
        onMouseEnter={e => { e.currentTarget.style.background = '#F0F4FF'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        Claim
      </button>
    );
  }

  if (step === 'boards') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {boards.length === 0 ? (
          <span style={{ fontSize: 12, color: '#94A3B8' }}>No boards</span>
        ) : boards.map(b => (
          <button
            key={b.id}
            onClick={() => handleBoardSelect(b)}
            style={{
              padding: '4px 12px', borderRadius: 20,
              background: '#F1F5F9', border: '1px solid #E2E8F0',
              color: '#334155', fontSize: 12, fontWeight: 500,
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#E2E8F0'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#F1F5F9'; }}
          >
            {b.title}
          </button>
        ))}
        <button
          onClick={() => goToStep('idle')}
          style={{ fontSize: 12, color: '#94A3B8', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px', flexShrink: 0 }}
        >
          Cancel
        </button>
      </div>
    );
  }

  // step === 'qty'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      <span style={{ fontSize: 11, color: '#64748B', whiteSpace: 'nowrap', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        → {selectedBoard?.title}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: '#94A3B8' }}>Qty</span>
        <input
          type="number"
          min={1}
          max={item.quantity ?? undefined}
          value={claimQty}
          onChange={e => setClaimQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
          style={{
            width: 52, padding: '3px 6px', border: '1px solid #CBD5E1',
            borderRadius: 6, fontSize: 13, textAlign: 'center', outline: 'none',
          }}
        />
        {(item.quantity ?? 1) > 1 && (
          <span style={{ fontSize: 11, color: '#94A3B8', whiteSpace: 'nowrap' }}>of {item.quantity}</span>
        )}
      </div>
      <button
        onClick={handleConfirm}
        style={{
          padding: '4px 12px', borderRadius: 7, border: 'none',
          background: '#1E3A5F', color: 'white',
          fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
        }}
      >
        Confirm
      </button>
      <button
        onClick={() => goToStep('boards')}
        style={{ fontSize: 12, color: '#94A3B8', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px', flexShrink: 0 }}
      >
        Back
      </button>
    </div>
  );
};

// ── Item row ──────────────────────────────────────────────────────────────────

const ItemRow = ({ item, boards, userId, isLast, selected, onToggle, onClaimed, onPartialClaim, onDismiss, onReturn, bulkFading, docUrl, archived }) => {
  const [indivFading, setIndivFading] = useState(false);
  const [claimExpanded, setClaimExpanded] = useState(false);
  const [returning, setReturning] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const opacity = (bulkFading || indivFading) ? 0 : 1;

  const handleClaimed = (id) => {
    setIndivFading(true);
    setTimeout(() => onClaimed(id), 320);
  };

  const handleReturn = async () => {
    setReturning(true);
    const ok = await onReturn(item.id);
    if (!ok) setReturning(false);
    // on success, parent removes item from list
  };

  const handleDismiss = async () => {
    setDismissing(true);
    const ok = await onDismiss(item.id);
    if (!ok) setDismissing(false);
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '14px 20px',
      borderBottom: isLast ? 'none' : '1px solid #F1F5F9',
      opacity, transition: 'opacity 0.3s ease',
      background: archived ? '#FAFAFA' : selected ? '#F0F6FF' : 'transparent',
    }}>
      {/* Checkbox — hidden for archived items */}
      {archived ? (
        <div style={{ width: 15, flexShrink: 0, marginTop: 2 }} />
      ) : (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          style={{ width: 15, height: 15, accentColor: '#1E3A5F', cursor: 'pointer', flexShrink: 0, marginTop: 2 }}
        />
      )}

      {/* Name + qty */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.raw_name}
          </p>
          {docUrl && (
            <a
              href={docUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 500, color: '#2563EB', textDecoration: 'none', flexShrink: 0 }}
              onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline'; }}
              onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none'; }}
            >
              <Icon name="FileText" style={{ width: 11, height: 11 }} />
              View doc
            </a>
          )}
        </div>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: '#64748B' }}>
          Qty: {item.quantity ?? '—'}{item.unit ? ` ${item.unit}` : ''}
          {item.unit_price ? ` · £${item.unit_price}` : ''}
        </p>
      </div>

      {/* Right-side: badge + actions */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
        {/* Expiry / Archived / Returning badge */}
        {archived ? (
          <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 12, background: '#F1F5F9', color: '#94A3B8', whiteSpace: 'nowrap' }}>
            {item.archive_reason === 'returned' ? 'Return to supplier' : 'Archived'}
          </span>
        ) : (
          <ExpiryBadge expiresAt={item.expires_at} />
        )}

        {/* Action row — hidden for archived */}
        {!archived && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {/* Claim flow */}
            <ClaimInline
              item={item}
              boards={boards}
              userId={userId}
              onClaimed={handleClaimed}
              onPartialClaim={onPartialClaim}
              onExpandChange={setClaimExpanded}
            />

            {/* Secondary actions — hidden while claim flow is open */}
            {!claimExpanded && (
              <>
                <div style={{ width: 1, height: 16, background: '#E2E8F0', flexShrink: 0 }} />
                <button
                  onClick={handleReturn}
                  disabled={returning}
                  title="Flag for return to supplier"
                  style={{
                    padding: '4px 10px', borderRadius: 7,
                    border: '1px solid #E2E8F0', background: 'white',
                    color: '#64748B', fontSize: 11, fontWeight: 500,
                    cursor: returning ? 'default' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                    opacity: returning ? 0.5 : 1,
                  }}
                  onMouseEnter={e => { if (!returning) e.currentTarget.style.borderColor = '#CBD5E1'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#E2E8F0'; }}
                >
                  {returning ? 'Returning…' : 'Return to supplier'}
                </button>
                <button
                  onClick={handleDismiss}
                  disabled={dismissing}
                  title="Not relevant to me — stays visible for others"
                  style={{
                    padding: '4px 8px', borderRadius: 7, border: 'none',
                    background: 'none', color: '#94A3B8', fontSize: 11, fontWeight: 500,
                    cursor: dismissing ? 'default' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                    opacity: dismissing ? 0.5 : 1,
                  }}
                  onMouseEnter={e => { if (!dismissing) e.currentTarget.style.color = '#64748B'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#94A3B8'; }}
                >
                  {dismissing ? 'Dismissing…' : 'Not my order'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Bulk action bar ───────────────────────────────────────────────────────────

const BulkBar = ({ count, boards, onClaimAll, onClear, claiming }) => {
  const [boardsOpen, setBoardsOpen] = useState(false);

  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: '#1E3A5F', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
      zIndex: 100, minWidth: 360, maxWidth: 560,
    }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'white', whiteSpace: 'nowrap', flexShrink: 0 }}>
        {count} item{count !== 1 ? 's' : ''} selected
      </span>
      <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.2)', flexShrink: 0 }} />

      {/* Board selector */}
      <div style={{ position: 'relative', flex: 1 }}>
        <button
          onClick={() => setBoardsOpen(v => !v)}
          disabled={claiming}
          style={{
            width: '100%', padding: '6px 12px', borderRadius: 7,
            background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)',
            color: 'white', fontSize: 12, fontWeight: 500, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          }}
        >
          <span>{claiming ? 'Claiming…' : 'Claim to board…'}</span>
          <Icon name="ChevronDown" style={{ width: 12, height: 12, color: 'rgba(255,255,255,0.6)' }} />
        </button>
        {boardsOpen && !claiming && (
          <div style={{
            position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 6,
            background: 'white', borderRadius: 10, border: '1px solid #E2E8F0',
            boxShadow: '0 -8px 24px rgba(0,0,0,0.15)', maxHeight: 200, overflowY: 'auto', zIndex: 10,
          }}>
            <p style={{ margin: 0, padding: '8px 12px 6px', fontSize: 10, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid #F1F5F9' }}>
              Select board
            </p>
            {boards.length === 0 ? (
              <p style={{ padding: '10px 12px', fontSize: 12, color: '#94A3B8' }}>No boards available</p>
            ) : boards.map(b => (
              <button
                key={b.id}
                onClick={() => { setBoardsOpen(false); onClaimAll(b); }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', background: 'none', fontSize: 13, color: '#0F172A', cursor: 'pointer' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#F8FAFC'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
              >
                {b.title}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={onClear}
        style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px', flexShrink: 0, whiteSpace: 'nowrap' }}
        onMouseEnter={e => { e.currentTarget.style.color = 'white'; }}
        onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}
      >
        Clear
      </button>
    </div>
  );
};

// ── Returns view ─────────────────────────────────────────────────────────────

const fmtCurrency = (val) => {
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
};

const generateReturnSlipHTML = (bySupplier, tenantName, generatedBy, vessel = null) => {
  const rows = Object.entries(bySupplier).map(([supplier, items]) => {
    // Collect unique supplier contact / order metadata from items
    const first = items[0] || {};
    const supplierAddress = first.supplier_address || null;
    const supplierPhone   = first.supplier_phone   || null;
    const supplierEmail   = first.supplier_email   || null;
    const orderRefs  = [...new Set(items.map(i => i.order_ref).filter(Boolean))];
    const orderDates = [...new Set(items.map(i => i.order_date).filter(Boolean))];
    const noteRefs   = [...new Set(items.map(i => i.delivery_note_ref).filter(Boolean))];
    const noteUrls   = [...new Set(items.map(i => i.delivery_note_url).filter(Boolean))];

    const supplierTotal = items.reduce((sum, i) => {
      const n = parseFloat(i.line_total);
      return sum + (isNaN(n) ? 0 : n);
    }, 0);
    const showPricing = items.some(i => i.unit_price || i.line_total);
    const showRef     = items.some(i => i.item_reference);
    const showOrdered = items.some(i => i.ordered_qty != null);
    // col span for subtotal row: ref? + item + ordered? + delivered + pricing(2)? + reason
    const colCount = (showRef ? 1 : 0) + 1 + (showOrdered ? 1 : 0) + 1 + (showPricing ? 2 : 0) + 1;

    return `
    <div style="margin-bottom:32px">
      <div style="border-bottom:2px solid #1E3A5F;padding-bottom:8px;margin-bottom:10px">
        <h3 style="margin:0 0 2px;font-size:14px;font-weight:700;color:#1E3A5F">${supplier}</h3>
        ${supplierAddress ? `<p style="margin:2px 0;font-size:11px;color:#475569">${supplierAddress}</p>` : ''}
        <div style="display:flex;gap:20px;margin-top:4px;font-size:11px;color:#475569">
          ${supplierPhone ? `<span>Tel: ${supplierPhone}</span>` : ''}
          ${supplierEmail ? `<span>Email: ${supplierEmail}</span>` : ''}
        </div>
      </div>
      ${orderRefs.length > 0 || orderDates.length > 0 || noteRefs.length > 0 || noteUrls.length > 0 ? `
      <div style="display:flex;gap:24px;margin-bottom:10px;font-size:11px;color:#475569;flex-wrap:wrap">
        ${orderRefs.length  > 0 ? `<span><strong>Order ref:</strong> ${orderRefs.join(', ')}</span>`           : ''}
        ${orderDates.length > 0 ? `<span><strong>Order date:</strong> ${orderDates.join(', ')}</span>`         : ''}
        ${noteRefs.length   > 0 ? `<span><strong>Delivery note ref:</strong> ${noteRefs.join(', ')}</span>`    : ''}
        ${noteUrls.length   > 0 ? noteUrls.map(u => `<a href="${u}" style="color:#1E3A5F">View delivery note ↗</a>`).join(' ') : ''}
      </div>` : ''}
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:#F8FAFC">
            ${showRef     ? `<th style="text-align:left;padding:6px 8px;font-weight:600;width:80px;color:#64748B">Ref</th>` : ''}
            <th style="text-align:left;padding:6px 8px;font-weight:600">Description</th>
            ${showOrdered ? `<th style="text-align:center;padding:6px 8px;font-weight:600;width:65px">Ordered</th>` : ''}
            <th style="text-align:center;padding:6px 8px;font-weight:600;width:70px">Delivered</th>
            ${showPricing ? `<th style="text-align:right;padding:6px 8px;font-weight:600;width:80px">Unit price</th>
            <th style="text-align:right;padding:6px 8px;font-weight:600;width:80px">Total</th>` : ''}
            <th style="text-align:left;padding:6px 8px;font-weight:600">Reason</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(i => `
            <tr style="border-top:1px solid #F1F5F9">
              ${showRef     ? `<td style="padding:7px 8px;color:#94A3B8;font-size:11px">${i.item_reference || '—'}</td>` : ''}
              <td style="padding:7px 8px">${i.raw_name}</td>
              ${showOrdered ? `<td style="padding:7px 8px;text-align:center;color:#64748B">${i.ordered_qty ?? '—'}</td>` : ''}
              <td style="padding:7px 8px;text-align:center">${i.quantity ?? '—'}${i.unit ? ' ' + i.unit : ''}</td>
              ${showPricing ? `<td style="padding:7px 8px;text-align:right;color:#475569">${fmtCurrency(i.unit_price)}</td>
              <td style="padding:7px 8px;text-align:right;font-weight:500">${fmtCurrency(i.line_total)}</td>` : ''}
              <td style="padding:7px 8px;color:#64748B">Not ordered / Overage</td>
            </tr>
          `).join('')}
          ${showPricing && supplierTotal > 0 ? `
          <tr style="border-top:2px solid #E2E8F0;background:#F8FAFC">
            <td colspan="${colCount - 2}" style="padding:7px 8px;font-weight:600;text-align:right">Supplier subtotal</td>
            <td style="padding:7px 8px;text-align:right;font-weight:700">${fmtCurrency(supplierTotal)}</td>
            <td></td>
          </tr>` : ''}
        </tbody>
      </table>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Return Slip</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 40px; color: #0F172A; max-width: 740px; margin: 0 auto; }
    @media print { body { padding: 20px; } button { display: none; } }
  </style>
</head>
<body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px">
    <div>
      <h1 style="margin:0;font-size:22px;font-weight:700;color:#1E3A5F">Return Slip</h1>
      <p style="margin:4px 0 0;font-size:13px;color:#64748B">${vessel?.vessel_type_label || tenantName || 'Vessel'}${vessel?.imo_number ? ` &nbsp;·&nbsp; IMO: ${vessel.imo_number}` : ''}</p>
    </div>
    <div style="text-align:right;font-size:12px;color:#64748B">
      <p style="margin:0">Date: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      <p style="margin:4px 0 0">Prepared by: ${generatedBy || 'Unknown'}</p>
    </div>
  </div>
  ${vessel ? `
  <div style="margin-bottom:24px;padding:14px 16px;background:#F8FAFC;border-radius:8px;font-size:12px;color:#334155">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 24px">
      <div><span style="color:#94A3B8">Flag:</span> ${vessel.flag || '—'}</div>
      <div><span style="color:#94A3B8">Official Number:</span> ${vessel.official_number || '—'}</div>
      <div><span style="color:#94A3B8">Port of Registry:</span> ${vessel.port_of_registry || '—'}</div>
      <div><span style="color:#94A3B8">LOA:</span> ${vessel.loa_m ? vessel.loa_m + 'm' : '—'}</div>
      <div><span style="color:#94A3B8">IMO Number:</span> ${vessel.imo_number || '—'}</div>
      <div><span style="color:#94A3B8">Gross Tonnage:</span> ${vessel.gt || '—'}</div>
    </div>
  </div>` : ''}
  ${rows}
  <div style="margin-top:40px;padding-top:16px;border-top:1px solid #E2E8F0;display:flex;gap:60px;font-size:12px;color:#64748B">
    <div>
      <div style="margin-bottom:28px;border-bottom:1px solid #CBD5E1;width:200px"></div>
      <p style="margin:0 0 2px">Vessel authorisation signature</p>
      <p style="margin:0;color:#94A3B8">Name &amp; date</p>
    </div>
    <div>
      <div style="margin-bottom:28px;border-bottom:1px solid #CBD5E1;width:200px"></div>
      <p style="margin:0 0 2px">Supplier acknowledgement</p>
      <p style="margin:0;color:#94A3B8">Name &amp; date</p>
    </div>
  </div>
  <div style="text-align:center;margin-top:20px">
    <button onclick="window.print()" style="padding:10px 24px;background:#1E3A5F;color:white;border:none;border-radius:8px;font-size:14px;cursor:pointer">
      Print / Save PDF
    </button>
  </div>
</body>
</html>`;
};

const ReturnsView = ({ tenantId, userId, tenantName, userFullName }) => {
  const [returnItems, setReturnItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [acting, setActing] = useState(false);
  const [requesterNames, setRequesterNames] = useState({});

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const items = await fetchPendingReturns(tenantId);
    setReturnItems(items);

    // Resolve return_requested_by UUIDs → names
    const reqIds = [...new Set(items.map(i => i.return_requested_by).filter(Boolean))];
    if (reqIds.length > 0) {
      const { data: profiles } = await supabase
        ?.from('profiles')?.select('id, full_name')?.in('id', reqIds);
      const map = {};
      (profiles || []).forEach(p => { map[p.id] = p.full_name; });
      setRequesterNames(map);
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const bySupplier = returnItems.reduce((acc, item) => {
    const s = item.supplier_name || 'Unknown supplier';
    if (!acc[s]) acc[s] = [];
    acc[s].push(item);
    return acc;
  }, {});

  const toggleItem = (id) => setSelectedIds(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });

  const toggleSupplier = (items) => {
    const allIds = items.map(i => i.id);
    const allSel = allIds.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      allIds.forEach(id => allSel ? next.delete(id) : next.add(id));
      return next;
    });
  };

  const handleGenerateSlip = () => {
    const selected = returnItems.filter(i => selectedIds.has(i.id));
    // Group by supplier — open one tab per supplier
    const bySupplier = selected.reduce((acc, item) => {
      const s = item.supplier_name || 'Unknown supplier';
      if (!acc[s]) acc[s] = [];
      acc[s].push(item);
      return acc;
    }, {});
    for (const items of Object.values(bySupplier)) {
      const params = new URLSearchParams({ items: items.map(i => i.id).join(',') });
      window.open(`/provisioning/return-slip?${params.toString()}`, '_blank');
    }
  };

  const handleConfirmReturned = async () => {
    setActing(true);
    const ok = await confirmReturned([...selectedIds], userId);
    if (ok) {
      showToast(`${selectedIds.size} item${selectedIds.size !== 1 ? 's' : ''} marked as returned`, 'success');
      setSelectedIds(new Set());
      await load();
    } else {
      showToast('Failed to confirm returns', 'error');
    }
    setActing(false);
  };

  const handleCancelReturns = async () => {
    setActing(true);
    const ok = await cancelReturns([...selectedIds]);
    if (ok) {
      showToast('Items moved back to inbox', 'info');
      setSelectedIds(new Set());
      await load();
    } else {
      showToast('Failed to cancel returns', 'error');
    }
    setActing(false);
  };

  const formatDate = (iso) => {
    try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
    catch { return '—'; }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '60px 0', color: '#94A3B8', fontSize: 14 }}>Loading…</div>;

  if (returnItems.length === 0) return (
    <div style={{ textAlign: 'center', padding: '80px 0' }}>
      <Icon name="PackageX" style={{ width: 40, height: 40, color: '#CBD5E1', display: 'block', margin: '0 auto 16px' }} />
      <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#0F172A' }}>No pending returns</p>
      <p style={{ margin: '6px 0 0', fontSize: 13, color: '#94A3B8' }}>Items flagged for return will appear here</p>
    </div>
  );

  return (
    <div style={{ paddingBottom: selectedIds.size > 0 ? 100 : 24 }}>
      {Object.entries(bySupplier).map(([supplier, items]) => {
        const allSel = items.every(i => selectedIds.has(i.id));
        return (
          <div key={supplier} style={{
            background: 'white', borderRadius: 12, border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden', marginBottom: 16,
          }}>
            {/* Supplier header */}
            <div style={{ padding: '10px 20px', background: '#F8FAFC', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="checkbox"
                checked={allSel}
                onChange={() => toggleSupplier(items)}
                style={{ width: 13, height: 13, accentColor: '#1E3A5F', cursor: 'pointer', flexShrink: 0 }}
              />
              <Icon name="Truck" style={{ width: 13, height: 13, color: '#94A3B8', flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#0F172A', flex: 1 }}>{supplier}</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: '#FEF2F2', color: '#DC2626', flexShrink: 0 }}>
                {items.length} item{items.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Items */}
            {items.map((item, idx) => {
              const requesterName = requesterNames[item.return_requested_by] || null;
              return (
                <div key={item.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 20px',
                  borderBottom: idx < items.length - 1 ? '1px solid #F1F5F9' : 'none',
                  background: selectedIds.has(item.id) ? '#FFF5F5' : 'transparent',
                }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(item.id)}
                    onChange={() => toggleItem(item.id)}
                    style={{ width: 13, height: 13, accentColor: '#DC2626', cursor: 'pointer', flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{item.raw_name}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94A3B8' }}>
                      Qty: {item.quantity ?? '—'}{item.unit ? ` ${item.unit}` : ''}
                      {requesterName ? ` · Requested by ${requesterName}` : ''}
                      {item.return_requested_at ? ` · ${formatDate(item.return_requested_at)}` : ''}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Sticky action bar */}
      {selectedIds.size > 0 && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: 'white', borderTop: '1px solid #E2E8F0',
          padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 10,
          zIndex: 100, boxShadow: '0 -4px 16px rgba(0,0,0,0.06)',
        }}>
          <span style={{ fontSize: 12, color: '#64748B', fontWeight: 500, flexShrink: 0 }}>
            {selectedIds.size} item{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={handleGenerateSlip}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none',
              background: '#1E3A5F', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
            }}
          >
            Return slip ({selectedIds.size})
          </button>
          <button
            onClick={handleConfirmReturned}
            disabled={acting}
            style={{
              padding: '8px 14px', borderRadius: 8, border: '1px solid #E2E8F0',
              background: 'white', color: '#0F172A', fontSize: 12, fontWeight: 500,
              cursor: acting ? 'default' : 'pointer', flexShrink: 0, opacity: acting ? 0.6 : 1,
            }}
          >
            Mark as returned
          </button>
          <button
            onClick={handleCancelReturns}
            disabled={acting}
            style={{
              padding: '8px 14px', borderRadius: 8, border: 'none',
              background: 'none', color: '#94A3B8', fontSize: 12, fontWeight: 500,
              cursor: acting ? 'default' : 'pointer', flexShrink: 0, opacity: acting ? 0.6 : 1,
            }}
          >
            Cancel returns
          </button>
        </div>
      )}
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────

const DeliveryInbox = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeTenantId } = useTenant();

  const [activeTab, setActiveTab] = useState('inbox'); // 'inbox' | 'returns'
  const [items, setItems] = useState([]);
  const [returnsCount, setReturnsCount] = useState(0);
  const [boards, setBoards] = useState([]);
  const [scannerNames, setScannerNames] = useState({});
  const [batchDocUrls, setBatchDocUrls] = useState({}); // { delivery_batch_id: invoice_file_url }
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkFadingIds, setBulkFadingIds] = useState(new Set());
  const [bulkClaiming, setBulkClaiming] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [userFullName, setUserFullName] = useState('');

  const load = useCallback(async () => {
    if (!activeTenantId) return;
    setLoading(true);
    const [inboxItems, userBoards, pendingReturns] = await Promise.all([
      fetchDeliveryInbox(activeTenantId, showArchived, user?.id),
      fetchProvisioningLists(activeTenantId, user?.id).catch(() => []),
      fetchPendingReturns(activeTenantId),
    ]);
    setItems(inboxItems || []);
    setBoards(userBoards || []);
    setReturnsCount((pendingReturns || []).length);

    // Resolve current user's full name for return slips
    if (user?.id && !userFullName) {
      const { data: profile } = await supabase?.from('profiles')?.select('full_name')?.eq('id', user.id)?.maybeSingle();
      if (profile?.full_name) setUserFullName(profile.full_name);
    }

    // Resolve scanner UUIDs → full names
    const scannerIds = [...new Set((inboxItems || []).map(i => i.scanned_by).filter(Boolean))];
    if (scannerIds.length > 0) {
      const { data: profiles } = await supabase
        ?.from('profiles')?.select('id, full_name')?.in('id', scannerIds);
      const nameMap = {};
      (profiles || []).forEach(p => { nameMap[p.id] = p.full_name; });
      setScannerNames(nameMap);
    }

    // Resolve delivery_batch_id → invoice_file_url for document links
    const batchIds = [...new Set((inboxItems || []).map(i => i.delivery_batch_id).filter(Boolean))];
    if (batchIds.length > 0) {
      const { data: batches } = await supabase
        ?.from('provisioning_deliveries')?.select('id, invoice_file_url')?.in('id', batchIds);
      const urlMap = {};
      (batches || []).forEach(b => { if (b.invoice_file_url) urlMap[b.id] = b.invoice_file_url; });
      setBatchDocUrls(urlMap);
    }

    setLoading(false);
  }, [activeTenantId, user?.id, showArchived]);

  useEffect(() => { load(); }, [load]);

  const handleClaimed = (itemId) => {
    setItems(prev => prev.filter(i => i.id !== itemId));
    setSelectedIds(prev => { const next = new Set(prev); next.delete(itemId); return next; });
  };

  const handleDismiss = async (itemId) => {
    const ok = await dismissInboxItem(itemId, user?.id);
    if (ok) {
      setItems(prev => prev.filter(i => i.id !== itemId));
      setSelectedIds(prev => { const next = new Set(prev); next.delete(itemId); return next; });
      showToast('Item hidden from your inbox', 'info');
    } else {
      showToast('Failed to dismiss item', 'error');
    }
    return ok;
  };

  const handleReturn = async (itemId) => {
    const ok = await returnInboxItem(itemId, user?.id);
    if (ok) {
      setItems(prev => prev.filter(i => i.id !== itemId));
      setSelectedIds(prev => { const next = new Set(prev); next.delete(itemId); return next; });
      setReturnsCount(c => c + 1);
      showToast('Marked for return — see Returns tab', 'info');
    } else {
      showToast('Failed to mark for return', 'error');
    }
    return ok;
  };

  const handleToggleSelect = (itemId) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(itemId) ? next.delete(itemId) : next.add(itemId);
      return next;
    });
  };

  const handleBulkClaim = async (board) => {
    setBulkClaiming(true);
    const ids = [...selectedIds];
    const results = await Promise.allSettled(ids.map(id => claimInboxItem(id, user?.id, board.id)));
    const succeededIds = ids.filter((_, i) => results[i].status === 'fulfilled' && results[i].value);

    succeededIds.forEach(id => {
      const item = items.find(i => i.id === id);
      if (!item) return;
      logActivity({
        module: 'provisioning',
        action: 'PROVISION_INBOX_CLAIMED',
        entityType: 'provisioning_list',
        entityId: board.id,
        summary: `claimed "${item.raw_name}" from Delivery Inbox`,
        meta: { inbox_item_id: id, raw_name: item.raw_name, quantity: item.quantity, board_id: board.id, original_scanned_by: item.scanned_by },
      });
    });

    if (succeededIds.length > 0) {
      showToast(`${succeededIds.length} item${succeededIds.length !== 1 ? 's' : ''} claimed to ${board.title}`, 'success');
      setBulkFadingIds(new Set(succeededIds));
      setTimeout(() => {
        setItems(prev => prev.filter(i => !succeededIds.includes(i.id)));
        setSelectedIds(prev => { const next = new Set(prev); succeededIds.forEach(id => next.delete(id)); return next; });
        setBulkFadingIds(new Set());
      }, 340);
    }
    if (succeededIds.length < ids.length) {
      showToast(`${ids.length - succeededIds.length} item${ids.length - succeededIds.length !== 1 ? 's' : ''} failed`, 'error');
    }
    setBulkClaiming(false);
  };

  // Group by scanned_by + date
  const groups = items.reduce((acc, item) => {
    const date = item.scanned_at ? new Date(item.scanned_at).toISOString().split('T')[0] : '1970-01-01';
    const key = `${item.scanned_by || 'unknown'}__${date}`;
    if (!acc[key]) acc[key] = { date, scannedBy: item.scanned_by, supplierName: item.supplier_name, items: [] };
    acc[key].items.push(item);
    return acc;
  }, {});

  const sortedGroups = Object.values(groups).sort((a, b) => b.date.localeCompare(a.date));

  const formatDate = (iso) => {
    try {
      return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return iso; }
  };

  const scannerLabel = (scannedBy, supplierName) => {
    if (scannedBy && scannerNames[scannedBy]) return `Scanned by ${scannerNames[scannedBy]}`;
    if (supplierName && supplierName !== 'Manual receive') return supplierName;
    return 'Unknown source';
  };

  return (
    <>
      <Header />
      <div style={{ minHeight: '100vh', background: '#F8FAFC' }}>

        {/* Page header */}
        <div style={{ background: 'white', borderBottom: '1px solid #F1F5F9', padding: '14px 24px 0' }}>
          {/* Breadcrumb row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <button
              onClick={() => navigate('/provisioning')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: 0, display: 'flex', alignItems: 'center', gap: 3, fontSize: 13 }}
            >
              <Icon name="ChevronLeft" style={{ width: 14, height: 14 }} />
              Provisioning
            </button>
            <span style={{ color: '#CBD5E1', fontSize: 13 }}>›</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>Delivery Inbox</span>
            <div style={{ flex: 1 }} />
            {activeTab === 'inbox' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748B', cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={e => setShowArchived(e.target.checked)}
                  style={{ width: 13, height: 13, accentColor: '#64748B', cursor: 'pointer' }}
                />
                Show archived
              </label>
            )}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0 }}>
            {[
              { key: 'inbox', label: 'Inbox', count: items.filter(i => i.status === 'pending').length, countStyle: { background: '#FEF3E2', color: '#B45309' } },
              { key: 'returns', label: 'Returns', count: returnsCount, countStyle: { background: '#FEF2F2', color: '#DC2626' } },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: activeTab === tab.key ? 600 : 400,
                  color: activeTab === tab.key ? '#0F172A' : '#64748B',
                  borderBottom: activeTab === tab.key ? '2px solid #1E3A5F' : '2px solid transparent',
                  display: 'flex', alignItems: 'center', gap: 6,
                  transition: 'color 0.15s',
                }}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 20, ...tab.countStyle }}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px', paddingBottom: selectedIds.size > 0 ? 96 : 24 }}>
          {activeTab === 'returns' ? (
            <ReturnsView
              tenantId={activeTenantId}
              userId={user?.id}
              tenantName={null}
              userFullName={userFullName}
            />
          ) : loading ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#94A3B8', fontSize: 14 }}>Loading…</div>
          ) : items.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '80px 0' }}>
              <Icon name="Inbox" style={{ width: 40, height: 40, color: '#CBD5E1', display: 'block', margin: '0 auto 16px' }} />
              <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#0F172A' }}>All clear</p>
              <p style={{ margin: '6px 0 0', fontSize: 13, color: '#94A3B8' }}>No unclaimed delivery items</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {sortedGroups.map(group => {
                const groupKey = `${group.scannedBy || 'unknown'}__${group.date}`;
                const claimableItems = group.items.filter(i => i.status !== 'archived');
                const groupSelectedCount = claimableItems.filter(i => selectedIds.has(i.id)).length;
                const allSelected = claimableItems.length > 0 && groupSelectedCount === claimableItems.length;

                return (
                  <div key={groupKey} style={{
                    background: 'white', borderRadius: 12,
                    border: '1px solid #E2E8F0',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                    overflow: 'hidden',
                  }}>
                    {/* Group header */}
                    <div style={{ padding: '10px 20px', background: '#F8FAFC', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', gap: 8 }}>
                      {/* Select-all for this group */}
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={() => {
                          setSelectedIds(prev => {
                            const next = new Set(prev);
                            claimableItems.forEach(i => allSelected ? next.delete(i.id) : next.add(i.id));
                            return next;
                          });
                        }}
                        style={{ width: 13, height: 13, accentColor: '#1E3A5F', cursor: 'pointer', flexShrink: 0 }}
                      />
                      <Icon name="Package" style={{ width: 13, height: 13, color: '#94A3B8', flexShrink: 0 }} />
                      <span style={{ fontSize: 12, fontWeight: 500, color: '#64748B', letterSpacing: '0.01em', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {scannerLabel(group.scannedBy, group.supplierName)}
                      </span>
                      <span style={{ fontSize: 11, color: '#94A3B8', whiteSpace: 'nowrap', flexShrink: 0 }}>{formatDate(group.date)}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: '#F1F5F9', color: '#64748B', flexShrink: 0 }}>
                        {group.items.length} item{group.items.length !== 1 ? 's' : ''}
                      </span>
                    </div>

                    {/* Items */}
                    {group.items.map((item, idx) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        boards={boards}
                        userId={user?.id}
                        isLast={idx === group.items.length - 1}
                        selected={selectedIds.has(item.id)}
                        onToggle={() => handleToggleSelect(item.id)}
                        onClaimed={handleClaimed}
                        onPartialClaim={load}
                        onDismiss={handleDismiss}
                        onReturn={handleReturn}
                        bulkFading={bulkFadingIds.has(item.id)}
                        docUrl={item.delivery_batch_id ? batchDocUrls[item.delivery_batch_id] : null}
                        archived={item.status === 'archived'}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <BulkBar
          count={selectedIds.size}
          boards={boards}
          onClaimAll={handleBulkClaim}
          onClear={() => setSelectedIds(new Set())}
          claiming={bulkClaiming}
        />
      )}
    </>
  );
};

export default DeliveryInbox;
