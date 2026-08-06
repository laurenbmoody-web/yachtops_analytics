import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import LogoSpinner from '../../../components/LogoSpinner';
import { useNavigate } from 'react-router-dom';
import { getInventoryHealthStats } from '../../inventory/utils/inventoryStorage';
import './inventory-health.css';

const EMPTY = { healthy: 0, lowStock: 0, outOfStock: 0, total: 0, expiringSoon: 0, expired: 0, attention: [] };

// Inventory health as two axes — is it in date (Expired), is it in stock
// (Stock) — each a soft-field panel, with the single worst culprit named
// beneath. Terracotta marks whichever axis needs attention; a settled axis
// sits in faint grey. The culprit deep-links to the needs-attention board.
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
  const outOfStock = stats?.outOfStock || 0;
  const belowPar = (stats?.lowStock || 0) + outOfStock;
  const attentionCount = expired + expiringSoon + belowPar;
  const worst = (stats?.attention || [])[0] || null;

  const openBoard = () => navigate('/inventory/attention');
  const openInventory = () => navigate('/inventory');

  return (
    <div className="ce-card ih rounded-xl p-5">
      <div className="ih-head">
        <h3 className="ce-title">Inventory health</h3>
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
          <div className="ih-axes">
            <div className="ih-axis">
              <div className="ih-al">Expired</div>
              <div className={`ih-an${expired ? '' : ' calm'}`}>{expired}</div>
              <div className="ih-as">past their date</div>
              <div className="ih-af"><b>{expiringSoon}</b> expiring within 30 days</div>
            </div>
            <div className="ih-axis">
              <div className="ih-al">Stock</div>
              <div className={`ih-an${belowPar ? '' : ' calm'}`}>{belowPar}</div>
              <div className="ih-as">below restock level</div>
              <div className="ih-af">
                {outOfStock > 0
                  ? <><b>{outOfStock}</b> out of stock entirely</>
                  : <><b>{stats.total}</b> at or above par</>}
              </div>
            </div>
          </div>

          {worst ? (
            <button type="button" className="ih-culprit" onClick={openBoard} title={worst.name}>
              <span className="ih-cul-tag">{worst.tag}</span>
              <span className="ih-cul-main">
                <span className="ih-cul-nm">{worst.name}</span>
                <span className="ih-cul-mt">{(worst.place || 'Location not set')} · {worst.detail}</span>
              </span>
            </button>
          ) : (
            <div className="ih-calm">All {stats.total} items in date and at par.</div>
          )}
        </>
      )}
    </div>
  );
};

export default InventoryHealthWidget;
