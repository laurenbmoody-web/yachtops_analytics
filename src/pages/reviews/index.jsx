import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { supabase } from '../../lib/supabaseClient';
import { useReviewItems } from './useReviewItems';
import { fetchInboxPending } from '../../hooks/inboxScope';
import CompactReviewItemCard from './CompactReviewItemCard';
import ReviewRightPane from './ReviewRightPane';
import ResolvedDetail from './ResolvedDetail';
import InboxSidebar from './InboxSidebar';
import OrdersReviewPanel from './OrdersReviewPanel';
import OrderApprovalRightPane from './OrderApprovalRightPane';
import { useProvisioningApprovals } from './useProvisioningApprovals';
import SeaTimeReviewPanel from './SeaTimeReviewPanel';
import CaptainSignoff from '../../seatime/CaptainSignoff';
import { buildSpellTestimonialPdf, bytesToBase64 } from '../../seatime/packExport';
import { SEATIME_REVIEW_QUEUE } from '../../seatime/reviewQueue';
import { useSeaTimeSignoffs } from './useSeaTimeSignoffs';
import { signEntries, rejectEntries } from '../crew-profile/utils/seaTimeService';
import './reviews.css';

// Map pathname → active category. /reviews and /reviews/rotas both
// resolve to the rotas queue (the historical default), keeping deep
// links to the existing surface working.
const categoryFromPath = (pathname) => {
  if (pathname.startsWith('/reviews/orders')) return 'orders';
  if (pathname.startsWith('/reviews/seatime')) return 'seatime';
  return 'rotas';
};

// ReviewsPage — the split-view inbox. Three columns: sidebar (categories) ·
// list strip (compact cards) · right pane (the selected submission's rota +
// decision footer). The ?selected= URL param drives which item the right
// pane shows; resolving/rejecting auto-advances to the next item.

export default function ReviewsPage() {
  const { user } = useAuth();
  const { currentTenantMember, activeTenantId } = useTenant();
  const location = useLocation();
  const activeCategory = categoryFromPath(location.pathname);

  const tier = (currentTenantMember?.permission_tier || '').toUpperCase();
  const userDeptId = currentTenantMember?.department_id || null;

  // Pending count for the "Order approvals" sidebar badge. Lives at
  // the page level (not inside OrdersReviewPanel) so the badge stays
  // accurate while the user is sitting on the rotas queue.
  const provisioningApprovals = useProvisioningApprovals();

  // Eyebrow: "<TIER>" / "<TIER> · <DEPT>" for the list-strip title.
  const [deptName, setDeptName] = useState(null);
  useEffect(() => {
    if (!activeTenantId || !userDeptId) { setDeptName(null); return undefined; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('departments').select('name').eq('id', userDeptId).maybeSingle();
      if (cancelled) return;
      if (error) { console.error('[ReviewsPage] dept fetch failed:', error); return; }
      setDeptName(data?.name || null);
    })();
    return () => { cancelled = true; };
  }, [activeTenantId, userDeptId]);

  const eyebrow = useMemo(() => {
    if (tier === 'CHIEF') return deptName ? `CHIEF · ${deptName}` : 'CHIEF';
    if (tier === 'COMMAND') return 'COMMAND';
    return tier || '';
  }, [tier, deptName]);

  // Subtitle count — inbox-scoped pending count, polled while mounted.
  const [pendingCount, setPendingCount] = useState(null);
  useEffect(() => {
    if (!user) { setPendingCount(0); return undefined; }
    let cancelled = false;
    const fetchCount = async () => {
      const rows = await fetchInboxPending(supabase, {
        tier, departmentId: userDeptId, tenantId: activeTenantId,
      });
      if (cancelled) return;
      setPendingCount(rows.length);
    };
    fetchCount();
    const id = setInterval(fetchCount, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [user, tier, userDeptId, activeTenantId]);

  // Sea-time sign-off queue. Live: pending entries across the tenant the master
  // can sign (RLS-scoped); the sample is a fallback when there's no tenant.
  const signerName = currentTenantMember?.full_name || user?.user_metadata?.full_name || null;
  // Load unconditionally (not gated on the active category) so the sidebar badge
  // stays accurate from any inbox tab — the rota/order count badges work the same
  // way. Without this the Sea-time row showed no number unless you were already
  // sitting on its tab.
  const seatimeLive = useSeaTimeSignoffs(activeTenantId, signerName);
  const [seatimeQueue, setSeatimeQueue] = useState(SEATIME_REVIEW_QUEUE);
  // Live pending count when there's a tenant; the sample queue as the fallback.
  const seatimeCount = (activeTenantId ? seatimeLive.items : seatimeQueue).length;

  // The signing master's own signatory particulars on file — CoC number/grade
  // (personal_documents), contact phone (crew_personal_details) and login email
  // — so the sign-off form pre-fills instead of making them retype each time.
  const [signerParticulars, setSignerParticulars] = useState({});
  useEffect(() => {
    if (activeCategory !== 'seatime' || !user?.id) { setSignerParticulars({}); return undefined; }
    let cancelled = false;
    (async () => {
      const [cocRes, cpdRes] = await Promise.all([
        supabase.from('personal_documents')
          .select('document_number, details, expiry_date')
          .eq('user_id', user.id).eq('doc_type', 'coc')
          .order('expiry_date', { ascending: false, nullsFirst: false }).limit(1),
        supabase.from('crew_personal_details').select('phones').eq('user_id', user.id).maybeSingle(),
      ]);
      if (cancelled) return;
      const coc = cocRes.data?.[0];
      const phones = Array.isArray(cpdRes.data?.phones) ? cpdRes.data.phones : [];
      setSignerParticulars({
        cocNo: coc?.document_number || '',
        cocGrade: coc?.details?.grade || '',
        email: user.email || '',
        phone: phones[0]?.value || '',
      });
    })();
    return () => { cancelled = true; };
  }, [activeCategory, user?.id, user?.email]);

  // Pending inbox vs History (resolved) tab.
  const [tab, setTab] = useState('pending');
  const { items, loading, refetch } = useReviewItems(tab === 'history' ? 'resolved' : 'pending');

  const [toast, setToast] = useState(null);
  const showToast = (msg, opts) => {
    setToast({ msg, error: !!opts?.error });
    setTimeout(() => setToast(null), 4200);
  };

  const subtitleCount = loading ? (tab === 'pending' ? (pendingCount ?? 0) : 0) : items.length;
  const subtitle = tab === 'history'
    ? `${subtitleCount} resolved submission${subtitleCount === 1 ? '' : 's'}`
    : tier === 'COMMAND'
      ? `${subtitleCount} submission${subtitleCount === 1 ? '' : 's'} across the vessel`
      : `${subtitleCount} submission${subtitleCount === 1 ? '' : 's'} awaiting your decision`;

  // ── Selection + URL state ──────────────────────────────────────────────
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('selected');
  // Track whether this session ever had items, to tell the two empty states
  // apart ("Nothing to review" vs the cleared-inbox "All clear").
  const everHadItems = useRef(false);
  if (items.length > 0) everHadItems.current = true;

  // Keep ?selected valid: default to the first item, fall back when the
  // current selection disappears (auto-advance after accept/reject), clear
  // when the inbox empties.
  useEffect(() => {
    if (loading) return;
    if (items.length === 0) {
      if (selectedId) setSearchParams({}, { replace: true });
      return;
    }
    const exists = items.some((i) => i.id === selectedId);
    if (!exists) {
      setSearchParams({ selected: items[0].id }, { replace: true });
    }
  }, [items, loading, selectedId, setSearchParams]);

  const selectedItem = useMemo(
    () => items.find((i) => i.id === selectedId) || null,
    [items, selectedId],
  );

  const handleSelect = (id) => setSearchParams({ selected: id });

  // After a decision: refetch the list. The selection effect above advances
  // ?selected to the next item (or clears it when the inbox empties).
  const handleResolved = () => { refetch(); };

  if (activeCategory === 'seatime') {
    // Live queue when there's a tenant; sample as a fallback. The signing master
    // reviews one command spell at a time; ?selected= deep-links the right pane.
    const stLive = !!activeTenantId;
    const stItems = stLive ? seatimeLive.items : seatimeQueue;
    const stLoading = stLive ? seatimeLive.loading : false;
    const stSelectedId = searchParams.get('selected');
    const stSelected = stItems.find(i => i.id === stSelectedId) || stItems[0] || null;
    const stSelect = (id) => setSearchParams({ selected: id });

    const stSign = async (record) => {
      if (!stSelected) return;
      const rowIds = (stSelected.unit.periods || []).flatMap(p => p.rowIds || []);
      if (stLive) {
        try { await signEntries(activeTenantId, rowIds, { signedName: record?.name }); }
        catch (e) { console.error(e); showToast('Could not sign — check your permissions', { error: true }); return; }
        await seatimeLive.refetch();
        // Generate + store the per-ship testimonial PDF (best-effort).
        try {
          const u = stSelected.unit;
          const bytes = await buildSpellTestimonialPdf({
            seafarer: stSelected.seafarer,
            vessel: { name: u.name, flag: u.flag, imo: u.imo, gt: u.gt, lengthM: u.lengthM },
            periods: u.periods || [],
            signatory: { name: record?.name, rank: 'Master', cocNumber: record?.cocNo, signedAt: new Date().toISOString().slice(0, 10) },
          });
          await supabase.functions.invoke('store-seatime-testimonial', { body: { entryIds: rowIds, pdfBase64: bytesToBase64(bytes) } });
        } catch (e2) { console.error('[reviews] testimonial', e2); }
        supabase.functions.invoke('notify-seatime-signoff', { body: { action: 'signed', entryIds: rowIds } }).catch(() => {});
      } else {
        setSeatimeQueue(q => q.filter(i => i.id !== stSelected.id));
      }
      setSearchParams({}, { replace: true });
      showToast(`${stSelected.unit.name} signed for ${stSelected.seafarer.fullName}`);
    };
    const stDecline = async (reason) => {
      if (!stSelected) return;
      const rowIds = (stSelected.unit.periods || []).flatMap(p => p.rowIds || []);
      if (stLive) {
        try { await rejectEntries(activeTenantId, rowIds, reason || 'Declined by the master'); }
        catch (e) { console.error(e); showToast('Could not decline', { error: true }); return; }
        await seatimeLive.refetch();
        supabase.functions.invoke('notify-seatime-signoff', { body: { action: 'declined', entryIds: rowIds } }).catch(() => {});
      } else {
        setSeatimeQueue(q => q.filter(i => i.id !== stSelected.id));
      }
      setSearchParams({}, { replace: true });
      showToast(`Declined — ${stSelected.seafarer.fullName} has been notified`);
    };

    return (
      <>
        <Header />
        <div className="rv-page">
          <InboxSidebar activeCategory="seatime" counts={{ rotas: subtitleCount, orders: provisioningApprovals.items.length, seatime: seatimeCount }} />
          <SeaTimeReviewPanel items={stItems} loading={stLoading} selectedId={stSelected?.id} onSelect={stSelect} eyebrow={eyebrow} />
          <section className="rv-rightpane-col" aria-label="Sign-off detail">
            {stSelected ? (
              <CaptainSignoff
                variant="pane"
                key={stSelected.id}
                unit={stSelected.unit}
                seafarer={stSelected.seafarer}
                signerName={signerName}
                signerEmail={signerParticulars.email}
                signerPhone={signerParticulars.phone}
                signerCoc={signerParticulars.cocNo}
                signerCocGrade={signerParticulars.cocGrade}
                onSign={stSign}
                onDecline={stDecline}
              />
            ) : (
              <div className="rv-rp-blank" role="status">
                <Icon name="Check" size={36} color="#8B8478" className="rv-rp-blank-icon" />
                <div className="rv-rp-blank-title">{stLoading ? 'Loading…' : 'All clear'}</div>
                <div className="rv-rp-blank-sub">Sea-service sign-off requests will appear here.</div>
              </div>
            )}
          </section>
          {toast && (
            <div className={`rv-toast${toast.error ? ' error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.msg}</div>
          )}
        </div>
      </>
    );
  }

  if (activeCategory === 'orders') {
    // Selection state for the orders queue lives on the URL so deep
    // links from the bell notification (?selected=<request_id>) drop
    // the approver straight onto the right pane.
    const ordersSelectedId = searchParams.get('selected');
    const ordersItems = provisioningApprovals.items;
    const ordersSelected = ordersItems.find(i => i.id === ordersSelectedId) || ordersItems[0] || null;
    const handleOrdersSelect = (id) => setSearchParams({ selected: id });
    const handleOrdersResolved = async () => {
      // Refetch + clear the selection if the resolved item disappears.
      await provisioningApprovals.refetch();
      setSearchParams({}, { replace: true });
    };
    const ordersToast = (msg, opts) => showToast(msg, opts);
    return (
      <>
        <Header />
        <div className="rv-page">
          <InboxSidebar activeCategory="orders" counts={{ rotas: subtitleCount, orders: ordersItems.length, seatime: seatimeCount }} />
          <OrdersReviewPanel
            items={ordersItems}
            loading={provisioningApprovals.loading}
            selectedId={ordersSelected?.id}
            onSelect={handleOrdersSelect}
          />
          <section className="rv-rightpane-col" aria-label="Approval detail">
            {ordersSelected ? (
              <OrderApprovalRightPane
                key={ordersSelected.id}
                request={ordersSelected}
                onResolved={handleOrdersResolved}
                onToast={ordersToast}
              />
            ) : (
              <div className="rv-rp-blank" role="status">
                <Icon name="Check" size={36} color="#8B8478" className="rv-rp-blank-icon" />
                <div className="rv-rp-blank-title">
                  {provisioningApprovals.loading ? 'Loading…' : 'Nothing to review'}
                </div>
                <div className="rv-rp-blank-sub">
                  When boards are submitted for your approval they'll appear here.
                </div>
              </div>
            )}
          </section>
          {toast && (
            <div
              className={`rv-toast${toast.error ? ' error' : ''}`}
              role={toast.error ? 'alert' : 'status'}
            >{toast.msg}</div>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <Header />
      <div className="rv-page">
        <InboxSidebar activeCategory="rotas" counts={{ rotas: subtitleCount, orders: provisioningApprovals.items.length, seatime: seatimeCount }} />

        {/* Middle — list strip */}
        <section className="rv-liststrip" aria-label="Rota submissions">
          <div className="rv-eyebrow">{eyebrow}</div>
          <h1 className="rv-title">
            ROTAS<span className="rv-title-comma">,</span>
            <em className="rv-title-verb"> to review</em>
            <span className="rv-title-period">.</span>
          </h1>
          <div className="rv-subtitle">{subtitle}</div>

          <div className="rv-tabs" role="tablist" aria-label="Review queue">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'pending'}
              className={`rv-tab${tab === 'pending' ? ' active' : ''}`}
              onClick={() => setTab('pending')}
            >Pending</button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'history'}
              className={`rv-tab${tab === 'history' ? ' active' : ''}`}
              onClick={() => setTab('history')}
            >History</button>
          </div>

          <div className="rv-cc-list">
            {!loading && items.length === 0 ? (
              <div className="rv-cc-empty" role="status">
                {tab === 'history'
                  ? 'No resolved submissions yet.'
                  : (everHadItems.current ? 'All clear.' : 'Nothing to review.')}
              </div>
            ) : (
              items.map((item) => (
                <CompactReviewItemCard
                  key={item.id}
                  item={item}
                  selected={item.id === selectedId}
                  onSelect={handleSelect}
                />
              ))
            )}
          </div>
        </section>

        {/* Right — selected submission */}
        <section className="rv-rightpane-col" aria-label="Submission detail">
          {selectedItem ? (
            tab === 'history' ? (
              <ResolvedDetail key={selectedItem.id} item={selectedItem} />
            ) : (
              <ReviewRightPane
                key={selectedItem.id}
                item={selectedItem}
                onToast={showToast}
                onResolved={handleResolved}
              />
            )
          ) : (
            <div className="rv-rp-blank" role="status">
              <Icon name="Check" size={36} color="#8B8478" className="rv-rp-blank-icon" />
              <div className="rv-rp-blank-title">
                {tab === 'history'
                  ? 'No history yet'
                  : (everHadItems.current ? 'All clear' : 'Nothing to review')}
              </div>
              <div className="rv-rp-blank-sub">
                {tab === 'history'
                  ? 'Accepted and rejected submissions will be listed here.'
                  : (everHadItems.current
                    ? 'You’ve actioned every pending submission.'
                    : 'When HODs submit rota changes, they’ll appear here for your decision.')}
              </div>
            </div>
          )}
        </section>

        {toast && (
          <div
            className={`rv-toast${toast.error ? ' error' : ''}`}
            role={toast.error ? 'alert' : 'status'}
          >{toast.msg}</div>
        )}
      </div>
    </>
  );
}
