import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Header from '../../components/navigation/Header';
import { loadAllLaundryItems } from '../laundry-management-dashboard/utils/laundryStorage';
import { loadTrips } from '../trips-management-dashboard/utils/tripStorage';
import { enrichWithAvatars } from '../laundry-management-dashboard/utils/laundryAvatars';
import { buildLogbook, initials } from '../laundry-management-dashboard/utils/laundryLogbook';
import '../../styles/editorial.css';
import '../laundry-management-dashboard/laundry.css';

const AvatarChip = ({ p }) => (
  <span className={`lr-av ${p.kind === 'guest' ? 'guest' : p.kind === 'crew' ? 'crew' : 'unk'}`}>
    {p.avatarUrl ? <img src={p.avatarUrl} alt="" /> : (p.kind === 'unknown' ? '?' : initials(p.name))}
  </span>
);

const Chapter = ({ p, active, onClick }) => {
  const icon = p.type === 'voyage' ? 'Ship' : p.type === 'offcharter' ? 'Anchor' : 'Users';
  return (
    <button type="button" className={`lb-ch ${p.type}${active ? ' on' : ''}`} onClick={onClick}>
      <div className="lb-ch-nm"><Icon name={icon} size={14} />{p.name}</div>
      <div className="lb-ch-dt">{p.dates}</div>
      <div className="lb-ch-row">
        <span className="lb-ct tnum">{p.cleaned} cleaned</span>
        {p.live && <span className="lb-live">live</span>}
      </div>
    </button>
  );
};

const Detail = ({ p }) => {
  if (!p) return null;
  const tag = p.type === 'voyage' ? 'Voyage' : p.type === 'offcharter' ? 'Off-charter' : 'Crew ledger';
  const peopleLbl = p.type === 'crew' ? 'Crew — every period' : p.type === 'offcharter' ? 'Crew & vessel — this period' : 'Per guest & crew — this voyage';
  return (
    <div className="lb-trip">
      <div className={`lb-hero ${p.type}`}>
        <div className={`lb-tag ${p.type}`}>{tag}</div>
        <div className="lb-nm">{p.type === 'voyage' ? <>{p.name} <em>voyage</em></> : p.name}</div>
        <div className="lb-dt">{p.dates}{p.hero ? ` · ${p.hero}` : ''}</div>
        <div className="lb-kpis">
          <div className="lb-k"><b className="tnum">{p.cleaned}</b><span>Items cleaned</span></div>
          <div className="lb-k"><b className="tnum">{p.avg}</b><span>Avg turnaround</span></div>
          <div className="lb-k"><b className="tnum">{p.kpiA[0]}</b><span>{p.kpiA[1]}</span></div>
          <div className="lb-k"><b>{p.kpiB[0]}</b><span>{p.kpiB[1]}</span></div>
        </div>
      </div>

      <div className="lb-sec">
        <span className="lb-sl">{peopleLbl}</span>
        {p.people.map((per) => (
          <div className="lb-dos" key={per.key}>
            <AvatarChip p={per} />
            <div className="lb-dos-main">
              <div className="lb-dos-nm">{per.name}</div>
              <div className="lb-dos-sub">{per.sub || '—'}</div>
            </div>
            <div className="lb-dos-ct"><b className="tnum">{per.count}</b><span>pieces</span></div>
          </div>
        ))}
      </div>

      {p.type === 'crew' ? (
        <div className="lb-sec">
          <span className="lb-sl">Where it happened</span>
          {(p.byPeriod || []).length === 0 ? <div className="lb-dos-sub">No crew laundry recorded yet.</div>
            : p.byPeriod.map((b, i) => (
              <div className="lb-pm" key={i}><span>{b.label}</span><b className="tnum">{b.n} pieces</b></div>
            ))}
        </div>
      ) : (
        <div className="lb-sec">
          <span className="lb-sl">Returned — day by day</span>
          {p.days.length === 0 ? <div className="lb-dos-sub">Nothing delivered in this period yet.</div>
            : p.days.map((d) => (
              <div className="lb-rday" key={d.key}>
                <div className="lb-rh">{d.label}<span className="rule" />{d.items.length} returned</div>
                {d.items.map((it, i) => (
                  <div className="lb-ri" key={i}>
                    <span className="lb-th"><Icon name="Shirt" size={15} /></span>
                    <span className="lb-ri-nm">{it.desc}{it.sub ? <span className="lb-ri-sub"> · {it.sub}</span> : null}</span>
                    <span className="lb-ri-tag">Returned</span>
                    <span className="lb-ri-t">{it.time}</span>
                  </div>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
};

const LaundryHistoryView = () => {
  const navigate = useNavigate();
  const [book, setBook] = useState({ periods: [], crew: null, hasAny: false });
  const [loading, setLoading] = useState(true);
  const [selId, setSelId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [items, trips] = await Promise.all([loadAllLaundryItems(), loadTrips().catch(() => [])]);
        const enriched = await enrichWithAvatars(items);
        if (cancelled) return;
        const b = buildLogbook(trips, enriched, new Date());
        setBook(b);
        setSelId(b.periods[0]?.id || (b.crew ? 'crew' : null));
      } catch (e) {
        if (!cancelled) setBook({ periods: [], crew: null, hasAny: false });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const totalCleaned = useMemo(() => book.periods.reduce((s, p) => s + p.cleaned, 0), [book.periods]);
  const selected = selId === 'crew' ? book.crew : book.periods.find((p) => p.id === selId);
  const live = book.periods.filter((p) => p.live);
  const past = book.periods.filter((p) => !p.live);

  return (
    <>
      <Header />
      <div className="lm-page">
        <div className="lm-wrap">
          <button type="button" className="lm-back" onClick={() => navigate('/laundry-management-dashboard')}>
            <Icon name="ArrowLeft" size={16} /> Back to laundry
          </button>

          <div className="lm-header">
            <p className="editorial-meta">
              <span className="dot">●</span><span>Housekeeping</span>
              <span className="bar" /><span className="muted">Logbook</span>
              <span className="bar" /><span className="muted">{totalCleaned} cleaned</span>
            </p>
            <h1 className="editorial-greeting">
              LAUNDRY<span className="period">,</span> <em>logbook</em><span className="period">.</span>
            </h1>
          </div>

          {loading ? (
            <div className="lm-empty" role="status" style={{ paddingTop: 40 }}><div className="lm-empty-sub">Loading the logbook…</div></div>
          ) : !book.hasAny ? (
            <div className="lm-empty" role="status">
              <Icon name="BookOpen" size={44} className="lm-empty-ic" />
              <div className="lm-empty-title">Nothing logged yet</div>
              <div className="lm-empty-sub">As laundry is cleaned it’s filed here by voyage and off-charter period — who, what and when.</div>
            </div>
          ) : (
            <div className="lb-cols">
              <div className="lb-rail">
                {book.crew && <Chapter p={book.crew} active={selId === 'crew'} onClick={() => setSelId('crew')} />}
                {live.length > 0 && <div className="lb-lbl">Current voyage</div>}
                {live.map((p) => <Chapter key={p.id} p={p} active={selId === p.id} onClick={() => setSelId(p.id)} />)}
                {past.length > 0 && <div className="lb-lbl">Timeline</div>}
                {past.map((p) => <Chapter key={p.id} p={p} active={selId === p.id} onClick={() => setSelId(p.id)} />)}
              </div>
              <Detail p={selected} />
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default LaundryHistoryView;
