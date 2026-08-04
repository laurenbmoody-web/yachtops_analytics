import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import LogoSpinner from '../../../components/LogoSpinner';
import { useNavigate } from 'react-router-dom';
import { getInventoryHealthStats } from '../../inventory/utils/inventoryStorage';
import './inventory-health.css';

const EMPTY = { healthy: 0, lowStock: 0, outOfStock: 0, total: 0, expiringSoon: 0, expired: 0, attention: [] };

// A compact slice of the stores' health: a three-up severity summary and the
// most-pressing items that need attention. Each attention row deep-links to the
// needs-attention board. Mirrors the Document renewals widget's editorial shape.
const InventoryHealthWidget = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const data = await getInventoryHealthStats();
      setStats(data || EMPTY);
    } catch (err) {
      console.error('[InventoryHealthWidget] error:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  const hasItems = stats?.total > 0;
  const expired = stats?.expired || 0;
  const expiringSoon = stats?.expiringSoon || 0;
  const belowPar = (stats?.lowStock || 0) + (stats?.outOfStock || 0);
  const attention = stats?.attention || [];
  const attentionCount = expired + expiringSoon + belowPar;

  const openBoard = () => navigate('/inventory/attention');
  const openInventory = () => navigate('/inventory');

  let statusText = 'All healthy';
  let statusTone = 'ok';
  if (loading) { statusText = 'Loading…'; statusTone = ''; }
  else if (error) { statusText = 'Couldn’t load'; statusTone = ''; }
  else if (!hasItems) { statusText = 'Nothing tracked yet'; statusTone = ''; }
  else if (attentionCount > 0) { statusText = `${attentionCount} need attention`; statusTone = 'att'; }
  else { statusText = 'All healthy'; statusTone = 'ok'; }

  return (
    <div className="ce-card ih rounded-xl p-5">
      <div className="ih-head">
        <div>
          <h3 className="ce-title">Inventory health</h3>
          <p className={`ih-status${statusTone ? ` ${statusTone}` : ''}`}>{statusText}</p>
        </div>
        <button type="button" className="ce-link" onClick={attentionCount > 0 ? openBoard : openInventory}>
          {attentionCount > 0 ? 'Review' : 'View all'}
        </button>
      </div>

      {loading ? (
        <div className="ih-load"><LogoSpinner size={32} /></div>
      ) : error ? (
        <div className="ih-err">
          <Icon name="AlertTriangle" size={16} />
          Couldn’t load inventory.
          <button type="button" className="ih-retry" onClick={load}>Retry</button>
        </div>
      ) : !hasItems ? (
        <div className="ih-calm">Nothing tracked yet — begin the inventory to see its health here.</div>
      ) : (
        <>
          <div className="ih-stats">
            <div className="ih-stat">
              <div className={`ih-num${expired ? '' : ' zero'}`} data-sev={expired ? 'expired' : ''}>{expired}</div>
              <div className="ih-lbl">Expired</div>
            </div>
            <div className="ih-stat">
              <div className={`ih-num${expiringSoon ? '' : ' zero'}`} data-sev={expiringSoon ? 'amber' : ''}>{expiringSoon}</div>
              <div className="ih-lbl">≤ 30 days</div>
            </div>
            <div className="ih-stat">
              <div className={`ih-num${belowPar ? '' : ' zero'}`} data-sev={belowPar ? 'expired' : ''}>{belowPar}</div>
              <div className="ih-lbl">Below par</div>
            </div>
          </div>

          {attention.length > 0 ? (
            <div className="ih-list">
              {attention.slice(0, 4).map((a) => (
                <button type="button" key={a.id} className="ih-row" onClick={openBoard} title={a.name}>
                  <span className="ih-dot" data-sev={a.sev} />
                  <span className="ih-main">
                    <span className="ih-name">{a.name}</span>
                    <span className="ih-place">{a.place || 'Location not set'}</span>
                  </span>
                  <span className="ih-when" data-sev={a.sev}>{a.label}</span>
                </button>
              ))}
              {attentionCount > 4 && (
                <button type="button" className="ih-more" onClick={openBoard}>+{attentionCount - 4} more need attention</button>
              )}
            </div>
          ) : (
            <div className="ih-calm">{stats.total} items tracked · nothing expired, expiring or below par.</div>
          )}
        </>
      )}
    </div>
  );
};

export default InventoryHealthWidget;
