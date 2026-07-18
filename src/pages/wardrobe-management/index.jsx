import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Header from '../../components/navigation/Header';
import { loadAllLaundryItems } from '../laundry-management-dashboard/utils/laundryStorage';
import OwnerWardrobeView from '../laundry-management-dashboard/components/OwnerWardrobeView';
import LaundryCasesModal from '../laundry-management-dashboard/components/LaundryCasesModal';
import LaundryScanModal from '../laundry-management-dashboard/components/LaundryScanModal';
import LaundryDetailModal from '../laundry-management-dashboard/components/LaundryDetailModal';
import '../../styles/editorial.css';
import '../laundry-management-dashboard/laundry.css';
import './wardrobe.css';

// Wardrobe Management hub: one door into two worlds. Owner = the resident
// wardrobes garments live in on board; Charter = the cases guests' items travel
// in. Both let you pack/unpack and scan; an item opens its full record.
const WardrobeManagement = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [mode, setMode] = useState('hub'); // hub | owner
  const [showCases, setShowCases] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [detailItem, setDetailItem] = useState(null);
  const [casesInitialId, setCasesInitialId] = useState(null);

  const reload = async () => { setItems(await loadAllLaundryItems().catch(() => [])); };
  useEffect(() => { reload(); }, []);

  const openScannedItem = (id) => {
    const it = items.find((i) => i.id === id);
    if (it) setDetailItem(it);
    else window.alert('That label doesn’t match a laundry item on this vessel.');
  };

  const ownerCount = items.filter((i) => i.wardrobeId).length;
  const charterCount = items.filter((i) => i.caseId).length;

  return (
    <div className="wm-root">
      <Header />
      <div className="wm-page">
        <div className="wm-wrap">
          <button type="button" className="lm-back" onClick={() => navigate('/laundry-management-dashboard')}>
            <Icon name="ArrowLeft" size={16} /> Back to laundry
          </button>
          <p className="editorial-meta">
            <span className="dot">●</span><span>Housekeeping</span>
            <span className="bar" /><span className="muted">Wardrobe management</span>
          </p>
          {mode === 'hub' ? (
            <>
              <div className="wm-titlerow">
                <h1 className="editorial-greeting">WARDROBE<span className="period">,</span> <em>managed</em><span className="period">.</span></h1>
                <button type="button" className="lm-btn ghost" onClick={() => setShowScan(true)}><Icon name="QrCode" size={16} /> Scan</button>
              </div>

              <div className="wm-cards">
                <button type="button" className="wm-card" onClick={() => setMode('owner')}>
                  <span className="wm-card-ic"><Icon name="Shirt" size={26} /></span>
                  <span className="wm-card-body">
                    <span className="wm-card-t">Owner</span>
                    <span className="wm-card-d">Resident garments that live on board, in their wardrobes. Pack, unpack, scan and view.</span>
                  </span>
                  <span className="wm-card-n">{ownerCount}<small>on board</small></span>
                </button>

                <button type="button" className="wm-card" onClick={() => setShowCases(true)}>
                  <span className="wm-card-ic"><Icon name="Package" size={26} /></span>
                  <span className="wm-card-body">
                    <span className="wm-card-t">Charter</span>
                    <span className="wm-card-d">Guests’ cases for travel on and off the vessel. Pack, unpack, share a case with a guest.</span>
                  </span>
                  <span className="wm-card-n">{charterCount}<small>in cases</small></span>
                </button>
              </div>
            </>
          ) : (
            <OwnerWardrobeView onBack={() => { setMode('hub'); reload(); }} />
          )}
        </div>
      </div>

      {showCases && (
        <LaundryCasesModal
          items={items} initialCaseId={casesInitialId} onChanged={reload}
          onClose={() => { setShowCases(false); setCasesInitialId(null); }}
        />
      )}
      {showScan && (
        <LaundryScanModal
          onClose={() => setShowScan(false)}
          onDetect={(t) => { setShowScan(false); if (t?.kind === 'case') { setCasesInitialId(t.id); setShowCases(true); } else openScannedItem(t?.id); }}
        />
      )}
      {detailItem && (
        <LaundryDetailModal item={detailItem} onClose={() => setDetailItem(null)} onUpdated={reload} />
      )}
    </div>
  );
};

export default WardrobeManagement;
