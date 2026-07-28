// Cargo Accounts — the persistent workspace nav. Rendered on every Accounts
// section so the module reads as ONE place, not scattered pages. Plain-voice
// labels (no "ledger"/"reconcile"); role-aware — Command/Purser see the whole
// vessel, an owner/viewer sees only the report.
import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import { useAuth } from '../../../contexts/AuthContext';
import './accounts-nav.css';

// key, plain label, path, icon. `command` = needs full Accounts access.
const SECTIONS = [
  { key: 'overview', label: 'Overview', path: '/accounts', icon: 'LayoutDashboard', command: true },
  { key: 'cards', label: 'Cards & cash', path: '/accounts/cards', icon: 'CreditCard', command: true },
  { key: 'checkoff', label: 'Check-off', path: '/accounts/checkoff', icon: 'CheckCircle', command: true },
  { key: 'spending', label: 'Spending', path: '/accounts/ledger', icon: 'List', command: true },
  { key: 'plan', label: 'The plan', path: '/accounts/budgets', icon: 'Target', command: true },
  { key: 'owner', label: 'Owner report', path: '/accounts/owner', icon: 'FileText', command: false },
];

export default function AccountsNav({ active }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasAccountsAccess, hasOwnerReporting } = useAuth();
  const canAccounts = typeof hasAccountsAccess === 'function' ? hasAccountsAccess() : false;
  const canOwner = typeof hasOwnerReporting === 'function' ? hasOwnerReporting() : false;

  const items = SECTIONS.filter((s) => (s.command ? canAccounts : (canAccounts || canOwner)));
  if (items.length <= 1) return null; // a lone owner/viewer needs no tab bar

  const isActive = (s) => (active ? active === s.key
    : (s.path === '/accounts' ? location.pathname === '/accounts' : location.pathname.startsWith(s.path)));

  return (
    <nav className="anav" aria-label="Accounts sections">
      {items.map((s) => (
        <button key={s.key} type="button" className={`anav-item ${isActive(s) ? 'on' : ''}`}
          onClick={() => navigate(s.path)}>
          <Icon name={s.icon} size={15} />
          <span>{s.label}</span>
        </button>
      ))}
    </nav>
  );
}
