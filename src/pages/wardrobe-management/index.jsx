import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Header from '../../components/navigation/Header';
import { loadAllLaundryItems, LaundryStatus } from '../laundry-management-dashboard/utils/laundryStorage';
import { loadWardrobes } from '../laundry-management-dashboard/utils/laundryWardrobes';
import { loadCases } from '../laundry-management-dashboard/utils/laundryCases';
import { money } from '../laundry-management-dashboard/utils/laundryBilling';
import { canViewCost } from '../../utils/costPermissions';
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
  const showValue = canViewCost(); // garment value is cost data — Command/Chief/HOD only
  const [items, setItems] = useState([]);
  const [wardrobes, setWardrobes] = useState([]);
  const [cases, setCases] = useState([]);
  const [mode, setMode] = useState('hub'); // hub | owner
  const [showCases, setShowCases] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [detailItem, setDetailItem] = useState(null);
  const [casesInitialId, setCasesInitialId] = useState(null);

  const reload = async () => {
    const [all, ws, cs] = await Promise.all([
      loadAllLaundryItems().catch(() => []),
      loadWardrobes('owner').catch(() => []),
      loadCases().catch(() => []),
    ]);
    setItems(all); setWardrobes(ws); setCases(cs);
  };
  useEffect(() => { reload(); }, []);

  const openScannedItem = (id) => {
    const it = items.find((i) => i.id === id);
    if (it) setDetailItem(it);
    else window.alert('That label doesn’t match a laundry item on this vessel.');
  };

  // Hub metrics — this page serves BOTH worlds, so the strip carries an Owner
  // cluster (resident garments in their wardrobes) and a Charter cluster (guests'
  // items travelling in cases). Value is a Command/Chief/HOD-only glance.
  const inWash = (i) => i.status === LaundryStatus.IN_PROGRESS || i.status === LaundryStatus.READY_TO_DELIVER;
  const resident = items.filter((i) => i.wardrobeId && !i.isArchivedFromToday);
  const ownerCount = resident.length;
  const charterCount = items.filter((i) => i.caseId).length;
  const inLaundryCount = items.filter((i) => !i.isArchivedFromToday && inWash(i)).length; // both worlds
  const valueOnBoard = resident.reduce((sum, i) => sum + (Number(i.garmentValue) || 0), 0);
  const valueCurrency = resident.find((i) => i.garmentValue != null)?.garmentValueCurrency || 'EUR';

  const stats = [
    { key: 'onboard', side: 'Owner', label: 'On board', value: ownerCount, icon: 'Shirt' },
    { key: 'wardrobes', side: 'Owner', label: 'Wardrobes', value: wardrobes.length, icon: 'FolderClosed' },
    ...(showValue ? [{ key: 'value', side: 'Owner', label: 'Value on board', value: money(valueOnBoard, valueCurrency), icon: 'Gem' }] : []),
    { key: 'incases', side: 'Charter', label: 'In cases', value: charterCount, icon: 'Plane' },
    { key: 'cases', side: 'Charter', label: 'Active cases', value: cases.length, icon: 'Package' },
    { key: 'laundry', side: 'Both', label: 'In laundry', value: inLaundryCount, icon: 'Waves' },
  ];

  return (
    <>
      <Header />
      <div className="wm-page">
        <div className="wm-wrap">
          <button type="button" className="lm-back" onClick={() => navigate('/laundry-management-dashboard')}>
            <Icon name="ArrowLeft" size={16} /> Back to laundry
          </button>
          <p className="editorial-meta">
            <span className="dot">●</span><span>Housekeeping</span>
            <span className="bar" /><span className="muted">Wardrobe management</span>
            <span className="bar" /><span className="muted">Owner &amp; charter</span>
          </p>
          {mode === 'hub' ? (
            <>
              <div className="wm-titlerow">
                <h1 className="editorial-greeting">WARDROBE<span className="period">,</span> <em>managed</em><span className="period">.</span></h1>
                <button type="button" className="lm-btn ghost" onClick={() => setShowScan(true)}><Icon name="QrCode" size={16} /> Scan</button>
              </div>

              <div className="wm-stats">
                {stats.map((s) => (
                  <div className={`wm-stat wm-stat-${s.side.toLowerCase()}`} key={s.key}>
                    <span className="wm-stat-ic"><Icon name={s.icon} size={16} /></span>
                    <span className="wm-stat-side">{s.side}</span>
                    <span className="wm-stat-v">{s.value}</span>
                    <span className="wm-stat-l">{s.label}</span>
                  </div>
                ))}
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
    </>
  );
};

export default WardrobeManagement;
