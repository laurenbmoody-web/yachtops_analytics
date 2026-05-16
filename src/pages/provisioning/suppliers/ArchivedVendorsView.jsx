// ============================================================
// Archived Vendors — Sprint 9c.3
// ============================================================
//
// Soft-deleted vendors (archived_at IS NOT NULL). Phase 5 ships a
// working list + restore; Phase 7 refines copy / edge states.
// Restoring clears archived_at — the vendor reappears in the main
// directory on next load.

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../../components/navigation/Header';
import { fetchArchivedVendors, restoreVendor } from '../utils/provisioningStorage';
import { showToast } from '../../../utils/toast';
import '../../../styles/editorial.css';
import './suppliers-directory.css';

const locationLine = (v) => {
  const parts = [v.business_city, v.business_country].filter(Boolean);
  return parts.length ? parts.join(', ').toUpperCase() : null;
};

const formatArchivedAt = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const ArchivedVendorsView = () => {
  const navigate = useNavigate();

  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [restoringId, setRestoringId] = useState(null);

  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = '#F8FAFC';
    return () => { document.body.style.background = prev; };
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await fetchArchivedVendors();
    if (e) {
      setError(e.message || 'Could not load archived suppliers.');
      setVendors([]);
    } else {
      setVendors(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRestore = async (v) => {
    setRestoringId(v.id);
    const snapshot = vendors;
    setVendors((prev) => prev.filter((x) => x.id !== v.id));
    const { error: e } = await restoreVendor(v.id);
    setRestoringId(null);
    if (e) {
      setVendors(snapshot);
      showToast('Could not restore supplier', 'error');
    } else {
      showToast(`${v.name} restored`, 'success');
    }
  };

  return (
    <>
      <Header />
      <div className="sd-dir">
        <div className="sd-dir-inner">

          <button
            type="button"
            className="sd-dir-back"
            onClick={() => navigate('/provisioning/suppliers')}
          >‹  BACK TO DIRECTORY</button>

          <div className="sd-dir-headblock">
            <div className="editorial-meta">
              <span className="dot">●</span>
              <span>SUPPLIER DIRECTORY</span>
              <span className="bar" />
              <span>ARCHIVE</span>
            </div>
            <h1 className="editorial-greeting">
              Archived<span className="period">,</span>{' '}
              <em>suppliers</em><span className="period">.</span>
            </h1>
            <p className="editorial-subline">
              Soft-deleted suppliers. Restore one to bring it back into the directory.
            </p>
          </div>

          {loading ? (
            <div className="sd-dir-empty"><p>Loading archive…</p></div>
          ) : error ? (
            <div className="sd-dir-empty">
              <h3>Couldn’t load the archive</h3>
              <p>{error}</p>
              <button type="button" className="sd-dir-add" onClick={load}>RETRY</button>
            </div>
          ) : vendors.length === 0 ? (
            <div className="sd-dir-empty">
              <h3>Nothing archived</h3>
              <p>Archived suppliers will appear here.</p>
              <button
                type="button"
                className="sd-dir-clear"
                onClick={() => navigate('/provisioning/suppliers')}
              >
                Back to directory
              </button>
            </div>
          ) : (
            <div className="sd-dir-grid">
              {vendors.map((v) => {
                const loc = locationLine(v);
                const archivedOn = formatArchivedAt(v.archived_at);
                return (
                  <div key={v.id} className="sd-dir-card is-archived">
                    <div className="sd-dir-card-name">{v.name}</div>
                    {loc && (
                      <div className="sd-dir-card-loc">
                        <span className="dot">●</span>
                        <span>{loc}</span>
                      </div>
                    )}
                    <div className="sd-dir-card-type-row">
                      <span className="sd-dir-card-type">
                        {(v.vendor_type || 'Supplier').toUpperCase()}
                      </span>
                    </div>
                    {v.primary_category && (
                      <div className="sd-dir-card-roles">
                        <span className="sd-dir-role primary">{v.primary_category}</span>
                      </div>
                    )}
                    <div className="sd-dir-card-divider" />
                    <div className="sd-dir-card-meta">
                      <span>{archivedOn ? `Archived ${archivedOn}` : 'Archived'}</span>
                    </div>
                    <button
                      type="button"
                      className="sd-dir-restore"
                      disabled={restoringId === v.id}
                      onClick={() => handleRestore(v)}
                    >
                      {restoringId === v.id ? 'RESTORING…' : 'RESTORE'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default ArchivedVendorsView;
