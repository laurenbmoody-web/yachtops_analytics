import React from 'react';
import Icon from '../../../components/AppIcon';
import { useNavigate } from 'react-router-dom';

const AccountsWidget = ({ title, account }) => {
  const navigate = useNavigate();

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    })?.format(amount);
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <button
          onClick={() => navigate('/accounts')}
          className="text-xs text-primary hover:underline"
        >
          View all
        </button>
      </div>

      <div className="space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Total spent</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-foreground">{formatCurrency(account?.spent)}</p>
          </div>
        </div>

        <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
          <div
            className={`h-full ${account?.color} transition-all duration-500`}
            style={{ width: `${account?.percentage}%` }}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-foreground">{account?.percentage}%</span>
            <span className="text-xs text-muted-foreground">On track</span>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-foreground">{formatCurrency(account?.remaining)}</p>
            <p className="text-xs text-muted-foreground">Remaining</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">vs last month:</span>
          <span className={account?.trend > 0 ? 'text-error' : 'text-success'}>
            {account?.trend > 0 ? '+' : ''}{account?.trend}%
          </span>
          <Icon
            name={account?.trend > 0 ? 'TrendingUp' : 'TrendingDown'}
            className={`w-3 h-3 ${account?.trend > 0 ? 'text-error' : 'text-success'}`}
          />
        </div>
      </div>
    </div>
  );
};

export default AccountsWidget;
