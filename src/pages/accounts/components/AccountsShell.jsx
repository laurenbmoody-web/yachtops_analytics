// Cargo Accounts — the one workspace shell. A persistent navy left-sidebar that
// wraps every Accounts section, so the module reads as ONE place rather than
// scattered pages (built to money-workspace-map.html). Plain-voice labels;
// role-aware — Command sees the whole vessel, an owner/viewer only the report.
// Month-end carries a badge for cards waiting on Command's sign-off.
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Header from '../../../components/navigation/Header';
import Icon from '../../../components/AppIcon';
import { useAuth } from '../../../contexts/AuthContext';
import { useTenant } from '../../../contexts/TenantContext';
import { listReconciliationsForMonth } from '../../../services/reconcileService';
import { periodMonthISO } from '../../../services/reconcileState';
import './accounts-shell.css';

// group: 'main' | 'report'. `command` = needs full Accounts access.
const SECTIONS = [
  { key: 'overview', label: 'Overview', path: '/accounts', icon: 'LayoutDashboard', command: true, group: 'main' },
  { key: 'cards', label: 'Cards & cash', path: '/accounts/cards', icon: 'CreditCard', command: true, group: 'main' },
  { key: 'spending', label: 'Spending', path: '/accounts/ledger', icon: 'List', command: true, group: 'main' },
  { key: 'plan', label: 'The plan', path: '/accounts/budgets', icon: 'Target', command: true, group: 'main' },
  { key: 'checkoff', label: 'Check-off', path: '/accounts/checkoff', icon: 'CheckCircle', command: true, group: 'main' },
  { key: 'owner', label: 'Owner report', path: '/accounts/owner', icon: 'FileText', command: false, group: 'report' },
];

export default function AccountsShell({ active, children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasAccountsAccess, hasOwnerReporting, tenantRole } = useAuth();
  const { activeTenantId, currentTenantMember } = useTenant();
  const canAccounts = typeof hasAccountsAccess === 'function' ? hasAccountsAccess() : false;
  const canOwner = typeof hasOwnerReporting === 'function' ? hasOwnerReporting() : false;

  const [waiting, setWaiting] = useState(0);
  useEffect(() => {
    if (!activeTenantId || !canAccounts) return;
    const now = new Date();
    listReconciliationsForMonth(activeTenantId, periodMonthISO(now.getFullYear(), now.getMonth() + 1))
      .then(({ data }) => setWaiting((data || []).filter((r) => r.status === 'submitted').length))
      .catch(() => {});
  }, [activeTenantId, canAccounts]);

  const items = useMemo(
    () => SECTIONS.filter((s) => (s.command ? canAccounts : (canAccounts || canOwner))),
    [canAccounts, canOwner],
  );

  const vessel = currentTenantMember?.tenants?.name || '';
  const roleLabel = (tenantRole || '').toString().toUpperCase() || 'CREW';

  const isActive = (s) => (active ? active === s.key
    : (s.path === '/accounts' ? location.pathname === '/accounts' : location.pathname.startsWith(s.path)));

  // A lone owner/viewer needs no sidebar — render the content plainly.
  if (items.length <= 1) {
    return (<><Header /><div className="aws-solo">{children}</div></>);
  }

  const mainItems = items.filter((s) => s.group === 'main');
  const reportItems = items.filter((s) => s.group === 'report');

  const NavButton = (s) => (
    <button key={s.key} type="button" className={`aws-item ${isActive(s) ? 'on' : ''}`} onClick={() => navigate(s.path)}>
      <Icon name={s.icon} size={16} />
      <span>{s.label}</span>
      {s.key === 'checkoff' && waiting > 0 && <span className="aws-badge">{waiting}</span>}
    </button>
  );

  return (
    <>
      <Header />
      <div className="aws">
        <aside className="aws-side" aria-label="Accounts sections">
          <div className="aws-brand"><Icon name="Wallet" size={19} /> Accounts</div>
          <div className="aws-who">{vessel ? `${vessel} · ${roleLabel}` : roleLabel}</div>
          <nav className="aws-nav">
            {mainItems.map(NavButton)}
            {reportItems.length > 0 && <div className="aws-sep" />}
            {reportItems.map(NavButton)}
          </nav>
          <button type="button" className="aws-exit" onClick={() => navigate('/dashboard')}>
            <Icon name="ChevronLeft" size={15} /> Dashboard
          </button>
        </aside>
        <main className="aws-main">{children}</main>
      </div>
    </>
  );
}
