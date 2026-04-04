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

// ── Expiry countdown ──────────────────────────────────────────────────────────

const ExpiryBadge = ({ expiresAt }) => {
  if (!expiresAt) return null;
  const diffMs = new Date(expiresAt) - Date.now();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 20, background: '#FEF2F2', color: '#DC2626' }}>Expired</span>;
  if (diffDays <= 2) return <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 20, background: '#FEF3E2', color: '#B45309' }}>{diffDays}d left</span>;
  return <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 20, background: '#F1F5F9', color: '#64748B' }}>{diffDays}d</span>;
};

// ── Claim dropdown ────────────────────────────────────────────────────────────

const ClaimDropdown = ({ itemId, inboxItem, boards, userId, user, onClaimed }) => {
  const [open, setOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);

  const handleClaim = async (boardId) => {
    setClaiming(true);
    setOpen(false);
    const result = await claimInboxItem(itemId, userId, boardId);
    if (result) {
      logActivity({
        module: 'provisioning',
        action: 'PROVISION_INBOX_CLAIMED',
        entityType: 'provisioning_list',
        entityId: boardId,
        summary: `claimed "${result.raw_name}" from Delivery Inbox`,
        meta: {
          inbox_item_id: itemId,
          raw_name: result.raw_name,
          quantity: result.quantity,
          board_id: boardId,
          original_scanned_by: result.scanned_by,
        },
      });
      showToast('Item claimed', 'success');
      onClaimed(itemId);
    } else {
      showToast('Failed to claim item', 'error');
    }
    setClaiming(false);
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        disabled={claiming}
        style={{
          padding: '5px 12px', borderRadius: 7, border: '1px solid #BFDBFE',
          background: '#EFF6FF', color: '#1E3A5F', fontSize: 12, fontWeight: 600,
          cursor: claiming ? 'default' : 'pointer', whiteSpace: 'nowrap',
        }}
      >
        {claiming ? 'Claiming…' : 'Claim'}
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 200,
          background: 'white', border: '1px solid #E2E8F0', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: 200, maxHeight: 240, overflowY: 'auto',
        }}>
          <p style={{ margin: 0, padding: '8px 12px 6px', fontSize: 10, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid #F1F5F9' }}>
            Add to board
          </p>
          {boards.length === 0 ? (
            <p style={{ padding: '10px 12px', fontSize: 12, color: '#94A3B8' }}>No boards available</p>
          ) : boards.map(b => (
            <button
              key={b.id}
              onClick={() => handleClaim(b.id)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '8px 12px', border: 'none', background: 'none',
                fontSize: 13, color: '#0F172A', cursor: 'pointer',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              {b.title}
              {b.department ? <span style={{ fontSize: 10, color: '#94A3B8', marginLeft: 6 }}>{b.department}</span> : null}
            </button>
          ))}
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

  const [items, setItems] = useState([]);
  const [boards, setBoards] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeTenantId) return;
    setLoading(true);
    const [inboxItems, userBoards] = await Promise.all([
      fetchDeliveryInbox(activeTenantId),
      fetchProvisioningLists(activeTenantId, user?.id).catch(() => []),
    ]);
    setItems(inboxItems);
    setBoards(userBoards);
    setLoading(false);
  }, [activeTenantId, user?.id]);

  useEffect(() => { load(); }, [load]);

  const handleClaimed = (itemId) => setItems(prev => prev.filter(i => i.id !== itemId));

  // Group by date + supplier
  const groups = items.reduce((acc, item) => {
    const date = item.scanned_at ? new Date(item.scanned_at).toISOString().split('T')[0] : '1970-01-01';
    const supplier = item.supplier_name || 'Unknown supplier';
    const key = `${date}__${supplier}`;
    if (!acc[key]) acc[key] = { date, supplier, items: [] };
    acc[key].items.push(item);
    return acc;
  }, {});

  const sortedGroups = Object.values(groups).sort((a, b) => b.date.localeCompare(a.date));

  const formatDate = (iso) => {
    try {
      return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return iso; }
  };

  return (
    <>
      <Header />
      <div style={{ minHeight: '100vh', background: '#F8FAFC' }}>
        {/* Page header */}
        <div style={{ background: 'white', borderBottom: '1px solid #F1F5F9', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => navigate('/provisioning')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: '4px 8px 4px 0', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <Icon name="ChevronLeft" size={16} />
            <span style={{ fontSize: 13 }}>Provisioning</span>
          </button>
          <span style={{ color: '#CBD5E1' }}>›</span>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 8 }}>
            Delivery Inbox
            {items.length > 0 && (
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#1E3A5F', color: 'white' }}>
                {items.length}
              </span>
            )}
          </h1>
        </div>

        <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#94A3B8', fontSize: 14 }}>Loading…</div>
          ) : items.length === 0 ? (
            /* Empty state */
            <div style={{ textAlign: 'center', padding: '80px 0' }}>
              <div style={{ width: 56, height: 56, borderRadius: 16, background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <Icon name="Package" size={24} color="#94A3B8" />
              </div>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#0F172A' }}>No unclaimed deliveries</p>
              <p style={{ margin: '6px 0 0', fontSize: 13, color: '#64748B' }}>Items from scanned delivery notes that didn't match any board will appear here.</p>
            </div>
          ) : (
            sortedGroups.map(group => (
              <div key={`${group.date}__${group.supplier}`} style={{
                background: 'white', borderRadius: 12, border: '1px solid #F1F5F9',
                boxShadow: '0 1px 4px rgba(0,0,0,0.04)', marginBottom: 16, overflow: 'hidden',
              }}>
                {/* Group header */}
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #F8FAFC', background: '#FAFAFA', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon name="Truck" size={13} color="#64748B" />
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#0F172A' }}>{group.supplier}</span>
                  <span style={{ fontSize: 11, color: '#94A3B8' }}>{formatDate(group.date)}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94A3B8' }}>{group.items.length} item{group.items.length !== 1 ? 's' : ''}</span>
                </div>

                {/* Items */}
                {group.items.map(item => (
                  <div key={item.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 16px', borderBottom: '1px solid #F8FAFC',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.raw_name}
                      </p>
                      <p style={{ margin: '2px 0 0', fontSize: 11, color: '#64748B' }}>
                        Qty: {item.quantity ?? '—'}
                        {item.unit ? ` ${item.unit}` : ''}
                        {item.unit_price ? ` · £${item.unit_price}` : ''}
                      </p>
                    </div>
                    <ExpiryBadge expiresAt={item.expires_at} />
                    <ClaimDropdown
                      itemId={item.id}
                      inboxItem={item}
                      boards={boards}
                      userId={user?.id}
                      user={user}
                      onClaimed={handleClaimed}
                    />
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
};

export default DeliveryInbox;
