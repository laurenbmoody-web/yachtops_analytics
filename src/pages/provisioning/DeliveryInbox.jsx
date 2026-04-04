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

const ClaimInline = ({ item, boards, userId, onClaimed }) => {
  const [expanded, setExpanded] = useState(false);
  const [claiming, setClaiming] = useState(false);

  const handleClaim = async (board) => {
    setClaiming(true);
    const result = await claimInboxItem(item.id, userId, board.id);
    if (result) {
      logActivity({
        module: 'provisioning',
        action: 'PROVISION_INBOX_CLAIMED',
        entityType: 'provisioning_list',
        entityId: board.id,
        summary: `claimed "${result.raw_name}" from Delivery Inbox`,
        meta: {
          inbox_item_id: item.id,
          raw_name: result.raw_name,
          quantity: result.quantity,
          board_id: board.id,
          original_scanned_by: result.scanned_by,
        },
      });
      showToast(`"${result.raw_name}" claimed to ${board.title}`, 'success');
      onClaimed(item.id);
    } else {
      showToast('Failed to claim item', 'error');
      setClaiming(false);
    }
  };

  if (claiming) return <span style={{ fontSize: 12, color: '#94A3B8' }}>Claiming…</span>;

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
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

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {boards.length === 0 ? (
        <span style={{ fontSize: 12, color: '#94A3B8' }}>No boards</span>
      ) : boards.map(b => (
        <button
          key={b.id}
          onClick={() => handleClaim(b)}
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
        onClick={() => setExpanded(false)}
        style={{ fontSize: 12, color: '#94A3B8', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px', flexShrink: 0 }}
      >
        Cancel
      </button>
    </div>
  );
};

// ── Item row ──────────────────────────────────────────────────────────────────

const ItemRow = ({ item, boards, userId, isLast, selected, onToggle, onClaimed, bulkFading, docUrl }) => {
  const [indivFading, setIndivFading] = useState(false);
  const opacity = (bulkFading || indivFading) ? 0 : 1;

  const handleClaimed = (id) => {
    setIndivFading(true);
    setTimeout(() => onClaimed(id), 320);
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '14px 20px',
      borderBottom: isLast ? 'none' : '1px solid #F1F5F9',
      opacity, transition: 'opacity 0.3s ease',
      background: selected ? '#F0F6FF' : 'transparent',
    }}>
      {/* Checkbox */}
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        style={{ width: 15, height: 15, accentColor: '#1E3A5F', cursor: 'pointer', flexShrink: 0 }}
      />

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

      {/* Expiry */}
      <ExpiryBadge expiresAt={item.expires_at} />

      {/* Individual claim */}
      <ClaimInline item={item} boards={boards} userId={userId} onClaimed={handleClaimed} />
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

// ── Main page ─────────────────────────────────────────────────────────────────

const DeliveryInbox = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeTenantId } = useTenant();

  const [items, setItems] = useState([]);
  const [boards, setBoards] = useState([]);
  const [scannerNames, setScannerNames] = useState({});
  const [batchDocUrls, setBatchDocUrls] = useState({}); // { delivery_batch_id: invoice_file_url }
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkFadingIds, setBulkFadingIds] = useState(new Set());
  const [bulkClaiming, setBulkClaiming] = useState(false);

  const load = useCallback(async () => {
    if (!activeTenantId) return;
    setLoading(true);
    const [inboxItems, userBoards] = await Promise.all([
      fetchDeliveryInbox(activeTenantId),
      fetchProvisioningLists(activeTenantId, user?.id).catch(() => []),
    ]);
    setItems(inboxItems || []);
    setBoards(userBoards || []);

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
  }, [activeTenantId, user?.id]);

  useEffect(() => { load(); }, [load]);

  const handleClaimed = (itemId) => {
    setItems(prev => prev.filter(i => i.id !== itemId));
    setSelectedIds(prev => { const next = new Set(prev); next.delete(itemId); return next; });
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
        <div style={{ background: 'white', borderBottom: '1px solid #F1F5F9', padding: '14px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <button
              onClick={() => navigate('/provisioning')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: 0, display: 'flex', alignItems: 'center', gap: 3, fontSize: 13 }}
            >
              <Icon name="ChevronLeft" style={{ width: 14, height: 14 }} />
              Provisioning
            </button>
            <span style={{ color: '#CBD5E1', fontSize: 13 }}>›</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>Delivery Inbox</span>
            {items.length > 0 && (
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#FEF3E2', color: '#B45309' }}>
                {items.length}
              </span>
            )}
          </div>
          <p style={{ margin: 0, fontSize: 12, color: '#94A3B8' }}>
            Items from scanned delivery notes that haven't been matched to any board
          </p>
        </div>

        {/* Content */}
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px', paddingBottom: selectedIds.size > 0 ? 96 : 24 }}>
          {loading ? (
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
                const groupSelectedCount = group.items.filter(i => selectedIds.has(i.id)).length;
                const allSelected = groupSelectedCount === group.items.length;

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
                        checked={allSelected && group.items.length > 0}
                        onChange={() => {
                          setSelectedIds(prev => {
                            const next = new Set(prev);
                            group.items.forEach(i => allSelected ? next.delete(i.id) : next.add(i.id));
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
                        bulkFading={bulkFadingIds.has(item.id)}
                        docUrl={item.delivery_batch_id ? batchDocUrls[item.delivery_batch_id] : null}
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
