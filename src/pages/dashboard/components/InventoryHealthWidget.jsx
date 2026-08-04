import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import LogoSpinner from '../../../components/LogoSpinner';
import { useNavigate } from 'react-router-dom';
import { getInventoryHealthStats } from '../../inventory/utils/inventoryStorage';
import './inventory-health.css';

const EMPTY = { healthy: 0, lowStock: 0, outOfStock: 0, total: 0, expiringSoon: 0, expired: 0, mostUrgent: null };

// Hero-row copy for whichever item is most pressing (picked in the data layer).
const heroContent = (u) => {
  if (!u) return null;
  const place = u.place || 'location not set';
  switch (u.kind) {
    case 'out':
      return { severe: true, eyebrow: 'Most urgent · out of stock', sub: `Below par · ${place}`, num: '0', lbl: 'in stock' };
    case 'expired':
      return { severe: true, eyebrow: 'Most urgent · expired', sub: `Past its date · ${place}`, num: `${u.days}d`, lbl: 'over' };
    case 'low':
      return { severe: false, eyebrow: 'Most urgent · below par', sub: `Running low · ${place}`, num: `${u.qty}/${u.par}`, lbl: 'in stock' };
    case 'expiring':
      return { severe: false, eyebrow: 'Most urgent · expiring', sub: `Use soon · ${place}`, num: `${u.days}d`, lbl: 'left' };
    default:
      return null;
  }
};

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
  const lowStock = stats?.lowStock || 0;
  const outOfStock = stats?.outOfStock || 0;
  const stockIssues = lowStock + outOfStock;
  const attentionCount = expired + expiringSoon + stockIssues;
  const isHealthy = hasItems && attentionCount === 0;

  const goBoard = () => navigate('/inventory/attention');
  const goInventory = () => navigate('/inventory');

  const hero = heroContent(stats?.mostUrgent);

  let statusText = 'All healthy';
  let statusTone = 'ok';
  if (loading) { statusText = 'Loading…'; statusTone = ''; }
  else if (error) { statusText = 'Couldn’t load'; statusTone = ''; }
  else if (!hasItems) { statusText = 'Nothing tracked yet'; statusTone = ''; }
  else if (attentionCount > 0) { statusText = `${attentionCount} of ${stats.total} need attention`; statusTone = 'att'; }
  else { statusText = `${stats.total} items · all healthy`; statusTone = 'ok'; }

  return (
    <div className="ce-card ih rounded-xl p-5">
      <div className="ih-head">
        <div>
          <h3 className="ce-title">Inventory health</h3>
          <p className={`ih-status${statusTone ? ` ${statusTone}` : ''}`}>{statusText}</p>
        </div>
        <button type="button" className="ce-link" onClick={attentionCount > 0 ? goBoard : goInventory}>
          {attentionCount > 0 ? 'Review' : 'View all'}
        </button>
      </div>

      {loading ? (
        <div className="ih-load"><LogoSpinner size={32} /></div>
      ) : error ? (
        <div className="ih-err">
          <Icon name="AlertTriangle" size={16} /> Couldn’t load inventory.
          <button type="button" className="ih-retry" onClick={load}>Retry</button>
        </div>
      ) : !hasItems ? (
        <div className="ih-calm">
          <div className="ih-calm-num" style={{ color: '#1C1B3A' }}>Empty</div>
          <div className="ih-calm-sub">Nothing tracked yet — begin the inventory →</div>
        </div>
      ) : isHealthy ? (
        <>
          <div className="ih-calm">
            <div className="ih-calm-num">All good</div>
            <div className="ih-calm-sub">{stats.total} items tracked · nothing expired, expiring or below par.</div>
          </div>
          <div className="ih-foot">
            <button type="button" className="ih-action" onClick={goInventory}>
              Browse inventory <Icon name="ArrowRight" size={14} />
            </button>
          </div>
        </>
      ) : (
        <>
          {hero && (
            <button type="button" className={`ih-hero${hero.severe ? ' sev-red' : ''}`} onClick={goBoard} title={stats.mostUrgent?.name}>
              <div className="ih-hero-main">
                <div className="ih-eyebrow">{hero.eyebrow}</div>
                <div className="ih-hero-name">{stats.mostUrgent?.name || 'Untitled item'}</div>
                <div className="ih-hero-sub">{hero.sub}</div>
              </div>
              <div className="ih-hero-metric">
                <div className="m-num">{hero.num}</div>
                <div className="m-lbl">{hero.lbl}</div>
              </div>
            </button>
          )}

          <div className="ih-rows">
            <button type="button" className="ih-row" onClick={goBoard}>
              <span className={`ih-rnum ${expired ? 'red' : 'zero'}`}>{expired}</span>
              <span className="ih-rmain">
                <span className="ih-rlabel">Expired</span>
                <span className="ih-rsub">past their date</span>
              </span>
              <Icon name="ChevronRight" size={16} className="ih-chev" />
            </button>

            <button type="button" className="ih-row" onClick={goBoard}>
              <span className={`ih-rnum ${expiringSoon ? 'amber' : 'zero'}`}>{expiringSoon}</span>
              <span className="ih-rmain">
                <span className="ih-rlabel">Expiring soon</span>
                <span className="ih-rsub">within 30 days</span>
              </span>
              <Icon name="ChevronRight" size={16} className="ih-chev" />
            </button>

            {stockIssues > 0 ? (
              <button type="button" className="ih-row" onClick={goBoard}>
                <span className="ih-rnum red">{stockIssues}</span>
                <span className="ih-rmain">
                  <span className="ih-rlabel">Below par</span>
                  <span className="ih-rsub">{outOfStock > 0 ? `${outOfStock} out of stock` : 'running low'}</span>
                </span>
                <Icon name="ChevronRight" size={16} className="ih-chev" />
              </button>
            ) : (
              <div className="ih-row is-quiet">
                <span className="ih-rnum zero">0</span>
                <span className="ih-rmain">
                  <span className="ih-rlabel">Stock levels</span>
                  <span className="ih-rsub">all at par</span>
                </span>
                <Icon name="Check" size={16} className="ih-tick" />
              </div>
            )}
          </div>

          <div className="ih-foot">
            <button type="button" className="ih-action" onClick={goBoard}>
              Open needs-attention board <Icon name="ArrowRight" size={14} />
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default InventoryHealthWidget;
