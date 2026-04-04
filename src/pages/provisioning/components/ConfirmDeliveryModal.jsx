import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import { showToast } from '../../../utils/toast';
import {
  fetchPendingCrossMatches,
  confirmCrossMatch,
  dismissCrossMatch,
  receiveItems,
} from '../utils/provisioningStorage';

// ── Confidence badge ──────────────────────────────────────────────────────────

const CONF_STYLE = {
  high:   { bg: '#DCFCE7', color: '#15803D', label: 'High match' },
  medium: { bg: '#FEF3E2', color: '#B45309', label: 'Possible match' },
  low:    { bg: '#FEF2F2', color: '#DC2626', label: 'Weak match' },
};

const ConfBadge = ({ confidence }) => {
  const cfg = CONF_STYLE[confidence] || CONF_STYLE.low;
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  );
};

// ── Main modal ────────────────────────────────────────────────────────────────

const ConfirmDeliveryModal = ({ userId, onClose, onConfirmed }) => {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // qty overrides keyed by match id
  const [qtyMap, setQtyMap] = useState({});

  useEffect(() => {
    if (!userId) return;
    fetchPendingCrossMatches(userId).then(data => {
      setMatches(data);
      const initial = {};
      data.forEach(m => { initial[m.id] = m.quantity ?? 1; });
      setQtyMap(initial);
      setLoading(false);
    });
  }, [userId]);

  // Group by board title
  const grouped = matches.reduce((acc, m) => {
    const boardTitle = m.matched_board?.title || 'Unknown board';
    if (!acc[boardTitle]) acc[boardTitle] = [];
    acc[boardTitle].push(m);
    return acc;
  }, {});

  const handleDismiss = async (matchId) => {
    setMatches(prev => prev.filter(m => m.id !== matchId));
    await dismissCrossMatch(matchId);
    showToast('Item moved to Delivery Inbox', 'info');
  };

  const handleConfirmAll = async () => {
    if (matches.length === 0) { onClose(); return; }
    setSaving(true);
    try {
      for (const match of matches) {
        const qty = qtyMap[match.id] ?? match.quantity ?? 1;
        console.log('[ConfirmModal] confirming match:', match.id, 'item:', match.matched_item?.id, 'qty:', qty);

        const confirmResult = await confirmCrossMatch(match.id, qty);
        console.log('[ConfirmModal] confirmCrossMatch result:', confirmResult);

        if (match.matched_item?.id) {
          console.log('[ConfirmModal] calling receiveItems for:', match.matched_item.id, 'qty:', qty);
          try {
            const receiveResult = await receiveItems([{
              id: match.matched_item.id,
              quantity_received: qty,
              status: qty > 0 ? 'received' : 'not_received',
            }]);
            console.log('[ConfirmModal] receiveItems result:', receiveResult);
          } catch (receiveErr) {
            console.error('[ConfirmModal] receiveItems ERROR:', receiveErr);
          }
        } else {
          console.log('[ConfirmModal] NO matched_item.id — skipping receiveItems');
        }
      }
      showToast(`${matches.length} item${matches.length > 1 ? 's' : ''} confirmed`, 'success');
      onConfirmed?.();
      onClose();
    } catch (err) {
      console.error('[ConfirmDeliveryModal]', err);
      showToast('Failed to confirm items', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000,
      background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
    }}>
      <div style={{
        background: 'white', borderRadius: 16, width: '100%', maxWidth: 600,
        boxShadow: '0 24px 64px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column',
        maxHeight: '85vh', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name="PackageCheck" size={18} color="#1E3A5F" />
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0F172A' }}>Delivery items for your boards</p>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748B' }}>
              {loading ? 'Loading…' : `${matches.length} item${matches.length !== 1 ? 's' : ''} matched from another department's delivery`}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 4 }}>
            <Icon name="X" size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#94A3B8', fontSize: 13 }}>Loading…</div>
          ) : matches.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <Icon name="CheckCircle" size={32} color="#86EFAC" />
              <p style={{ margin: '10px 0 0', fontSize: 14, color: '#64748B' }}>No pending cross-department matches</p>
            </div>
          ) : (
            Object.entries(grouped).map(([boardTitle, boardMatches]) => (
              <div key={boardTitle} style={{ marginBottom: 20 }}>
                <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {boardTitle}
                </p>
                {boardMatches.map(match => (
                  <div key={match.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', borderRadius: 8, border: '1px solid #F1F5F9',
                    marginBottom: 6, background: '#FAFAFA',
                  }}>
                    {/* Dismiss */}
                    <button
                      onClick={() => handleDismiss(match.id)}
                      title="Move to Delivery Inbox"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#CBD5E1', padding: 2, flexShrink: 0 }}
                    >
                      <Icon name="X" size={14} />
                    </button>

                    {/* Names */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {match.raw_name}
                      </p>
                      {match.matched_item && (
                        <p style={{ margin: '1px 0 0', fontSize: 11, color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          → {match.matched_item.name}
                          {match.matched_item.brand ? ` · ${match.matched_item.brand}` : ''}
                          {match.matched_item.size ? ` · ${match.matched_item.size}` : ''}
                        </p>
                      )}
                    </div>

                    {/* Confidence */}
                    <ConfBadge confidence={match.match_confidence} />

                    {/* Qty input */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <span style={{ fontSize: 11, color: '#94A3B8' }}>Qty</span>
                      <input
                        type="number"
                        min="0"
                        value={qtyMap[match.id] ?? match.quantity ?? 1}
                        onChange={e => setQtyMap(prev => ({ ...prev, [match.id]: parseInt(e.target.value, 10) || 0 }))}
                        style={{
                          width: 52, padding: '4px 6px', border: '1px solid #E2E8F0',
                          borderRadius: 6, fontSize: 13, textAlign: 'center', outline: 'none',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid #F1F5F9', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #E2E8F0', background: 'white', color: '#64748B', fontSize: 13, cursor: 'pointer' }}
          >
            Later
          </button>
          <button
            onClick={handleConfirmAll}
            disabled={saving || loading || matches.length === 0}
            style={{
              padding: '8px 20px', borderRadius: 8, border: 'none',
              background: matches.length === 0 ? '#94A3B8' : '#1E3A5F',
              color: 'white', fontSize: 13, fontWeight: 600, cursor: saving ? 'default' : 'pointer',
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Confirming…' : `Confirm All (${matches.length})`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDeliveryModal;
