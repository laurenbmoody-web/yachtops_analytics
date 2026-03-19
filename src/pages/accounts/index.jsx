import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';

const Accounts = () => {
  const navigate = useNavigate();
  const [currency, setCurrency] = useState('USD');
  const [period, setPeriod] = useState('Monthly');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');

  // Mock financial data
  const financialKPIs = [
    {
      id: 1,
      label: 'Total Operational Costs',
      value: { USD: 42760, EUR: 38484 },
      trend: '+3.2%',
      trendDirection: 'up',
      icon: 'DollarSign',
      description: 'Charter + Owner APA combined'
    },
    {
      id: 2,
      label: 'Budget Variance',
      value: '-8.4%',
      trend: 'Favorable',
      trendDirection: 'down',
      icon: 'TrendingDown',
      description: 'Under budget this period'
    },
    {
      id: 3,
      label: 'Revenue Per Vessel',
      value: { USD: 125000, EUR: 112500 },
      trend: '+12.5%',
      trendDirection: 'up',
      icon: 'Ship',
      description: 'Average charter revenue'
    },
    {
      id: 4,
      label: 'Profit Margin',
      value: '34.2%',
      trend: '+2.1%',
      trendDirection: 'up',
      icon: 'TrendingUp',
      description: 'Net profit after expenses'
    }
  ];

  const accountsData = {
    charter: {
      totalSpent: { USD: 24560, EUR: 22100 },
      remaining: 68,
      remainingAmount: { USD: 11440, EUR: 10300 },
      vsLastMonth: -12,
      vsLastYear: 8,
      status: 'On track'
    },
    owner: {
      totalSpent: { USD: 18200, EUR: 16400 },
      remaining: 47,
      remainingAmount: { USD: 6740, EUR: 6070 },
      vsLastMonth: 18,
      vsLastYear: -5,
      status: 'Watch this month'
    }
  };

  const transactions = [
    { id: 1, date: '2026-01-05', vendor: 'Marina Services Ltd', category: 'Docking', amount: { USD: 2400, EUR: 2160 }, status: 'approved', type: 'charter' },
    { id: 2, date: '2026-01-04', vendor: 'Premium Provisions', category: 'Provisions', amount: { USD: 3850, EUR: 3465 }, status: 'pending', type: 'charter' },
    { id: 3, date: '2026-01-04', vendor: 'Fuel Direct', category: 'Fuel', amount: { USD: 8200, EUR: 7380 }, status: 'approved', type: 'owner' },
    { id: 4, date: '2026-01-03', vendor: 'Tech Marine Systems', category: 'Maintenance', amount: { USD: 1560, EUR: 1404 }, status: 'pending', type: 'owner' },
    { id: 5, date: '2026-01-03', vendor: 'Luxury Linens Co', category: 'Supplies', amount: { USD: 890, EUR: 801 }, status: 'approved', type: 'charter' },
    { id: 6, date: '2026-01-02', vendor: 'Safety Equipment Pro', category: 'Safety', amount: { USD: 1240, EUR: 1116 }, status: 'approved', type: 'owner' },
    { id: 7, date: '2026-01-02', vendor: 'Gourmet Seafood Supply', category: 'Provisions', amount: { USD: 2100, EUR: 1890 }, status: 'pending', type: 'charter' },
    { id: 8, date: '2026-01-01', vendor: 'Port Authority', category: 'Fees', amount: { USD: 650, EUR: 585 }, status: 'approved', type: 'charter' }
  ];

  const budgetAlerts = [
    { id: 1, type: 'warning', message: 'Owner APA at 47% - trending higher than last month', priority: 'medium' },
    { id: 2, type: 'info', message: 'Charter APA on track - 68% remaining', priority: 'low' },
    { id: 3, type: 'critical', message: '3 invoices pending approval for over 48 hours', priority: 'high' }
  ];

  const pendingApprovals = [
    { id: 1, vendor: 'Premium Provisions', amount: { USD: 3850, EUR: 3465 }, category: 'Provisions', dueDate: 'Today' },
    { id: 2, vendor: 'Tech Marine Systems', amount: { USD: 1560, EUR: 1404 }, category: 'Maintenance', dueDate: 'Today' },
    { id: 3, vendor: 'Gourmet Seafood Supply', amount: { USD: 2100, EUR: 1890 }, category: 'Provisions', dueDate: 'Tomorrow' }
  ];

  const currencySymbol = currency === 'USD' ? '$' : '€';
  const formatCurrency = (value) => {
    const amount = typeof value === 'object' ? value?.[currency] : value;
    return `${currencySymbol}${amount?.toLocaleString()}`;
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'approved':
        return 'text-success';
      case 'pending':
        return 'text-warning';
      case 'rejected':
        return 'text-error';
      default:
        return 'text-muted-foreground';
    }
  };

  const getStatusBg = (status) => {
    switch (status) {
      case 'approved':
        return 'bg-success/10';
      case 'pending':
        return 'bg-warning/10';
      case 'rejected':
        return 'bg-error/10';
      default:
        return 'bg-muted/10';
    }
  };

  const getAlertColor = (type) => {
    switch (type) {
      case 'critical':
        return 'border-error bg-error/5';
      case 'warning':
        return 'border-warning bg-warning/5';
      case 'info':
        return 'border-accent bg-accent/5';
      default:
        return 'border-border bg-muted/5';
    }
  };

  const filteredTransactions = transactions?.filter(transaction => {
    const statusMatch = filterStatus === 'all' || transaction?.status === filterStatus;
    const categoryMatch = filterCategory === 'all' || transaction?.category === filterCategory;
    return statusMatch && categoryMatch;
  });

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[1800px] mx-auto pt-24">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-semibold text-foreground mb-2">Accounts & Financial Overview</h1>
            <p className="text-sm text-muted-foreground">Comprehensive financial visibility and budget management</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Period Selector */}
            <div className="flex bg-muted/30 rounded-lg p-0.5">
              {['Monthly', 'Quarterly', 'Annual']?.map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-4 py-2 text-sm font-medium rounded transition-smooth ${
                    period === p ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            {/* Currency Toggle */}
            <div className="flex bg-muted/30 rounded-lg p-0.5">
              <button
                onClick={() => setCurrency('USD')}
                className={`px-4 py-2 text-sm font-medium rounded transition-smooth ${
                  currency === 'USD' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                USD
              </button>
              <button
                onClick={() => setCurrency('EUR')}
                className={`px-4 py-2 text-sm font-medium rounded transition-smooth ${
                  currency === 'EUR' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                EUR
              </button>
            </div>
          </div>
        </div>

        {/* Financial KPI Cards */}
        <div className="grid grid-cols-4 gap-5 mb-6">
          {financialKPIs?.map((kpi) => (
            <div key={kpi?.id} className="bg-card rounded-xl border border-border shadow-sm p-5">
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                  <Icon name={kpi?.icon} size={24} className="text-primary" />
                </div>
                <div className={`flex items-center gap-1 text-sm ${
                  kpi?.trendDirection === 'up' ? 'text-success' : 'text-error'
                }`}>
                  <Icon name={kpi?.trendDirection === 'up' ? 'TrendingUp' : 'TrendingDown'} size={16} />
                  <span className="font-medium">{kpi?.trend}</span>
                </div>
              </div>
              <div className="text-sm text-muted-foreground mb-1">{kpi?.label}</div>
              <div className="text-2xl font-bold text-foreground mb-1">
                {typeof kpi?.value === 'object' ? formatCurrency(kpi?.value) : kpi?.value}
              </div>
              <p className="text-xs text-muted-foreground">{kpi?.description}</p>
            </div>
          ))}
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-3 gap-5">
          {/* Left Column - APA Details */}
          <div className="space-y-5">
            {/* Charter APA Card */}
            <div className="bg-card rounded-xl border border-border shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-foreground">Charter APA</h3>
                <span className="text-xs px-2 py-1 rounded-full bg-success/10 text-success">On track</span>
              </div>
              <div className="mb-4">
                <div className="text-sm text-muted-foreground mb-1">Total Spent</div>
                <div className="text-3xl font-bold text-foreground mb-2">{formatCurrency(accountsData?.charter?.totalSpent)}</div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="text-xl font-semibold text-foreground">{accountsData?.charter?.remaining}%</div>
                  <div className="text-xs text-muted-foreground">remaining</div>
                </div>
                <div className="text-sm text-muted-foreground">({formatCurrency(accountsData?.charter?.remainingAmount)})</div>
              </div>
              <div className="space-y-2 pt-4 border-t border-border">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">vs Last Month:</span>
                  <span className={accountsData?.charter?.vsLastMonth >= 0 ? 'text-success' : 'text-error'}>
                    {accountsData?.charter?.vsLastMonth >= 0 ? '+' : ''}{accountsData?.charter?.vsLastMonth}%
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">vs Last Year:</span>
                  <span className={accountsData?.charter?.vsLastYear >= 0 ? 'text-success' : 'text-error'}>
                    {accountsData?.charter?.vsLastYear >= 0 ? '+' : ''}{accountsData?.charter?.vsLastYear}%
                  </span>
                </div>
              </div>
            </div>

            {/* Owner APA Card */}
            <div className="bg-card rounded-xl border border-border shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-foreground">Owner APA</h3>
                <span className="text-xs px-2 py-1 rounded-full bg-warning/10 text-warning">Watch this month</span>
              </div>
              <div className="mb-4">
                <div className="text-sm text-muted-foreground mb-1">Total Spent</div>
                <div className="text-3xl font-bold text-foreground mb-2">{formatCurrency(accountsData?.owner?.totalSpent)}</div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="text-xl font-semibold text-foreground">{accountsData?.owner?.remaining}%</div>
                  <div className="text-xs text-muted-foreground">remaining</div>
                </div>
                <div className="text-sm text-muted-foreground">({formatCurrency(accountsData?.owner?.remainingAmount)})</div>
              </div>
              <div className="space-y-2 pt-4 border-t border-border">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">vs Last Month:</span>
                  <span className={accountsData?.owner?.vsLastMonth >= 0 ? 'text-success' : 'text-error'}>
                    {accountsData?.owner?.vsLastMonth >= 0 ? '+' : ''}{accountsData?.owner?.vsLastMonth}%
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">vs Last Year:</span>
                  <span className={accountsData?.owner?.vsLastYear >= 0 ? 'text-success' : 'text-error'}>
                    {accountsData?.owner?.vsLastYear >= 0 ? '+' : ''}{accountsData?.owner?.vsLastYear}%
                  </span>
                </div>
              </div>
            </div>

            {/* Budget Alerts */}
            <div className="bg-card rounded-xl border border-border shadow-sm p-5">
              <h3 className="text-base font-semibold text-foreground mb-4">Budget Alerts</h3>
              <div className="space-y-3">
                {budgetAlerts?.map((alert) => (
                  <div key={alert?.id} className={`p-3 rounded-lg border-l-4 ${getAlertColor(alert?.type)}`}>
                    <div className="flex items-start gap-2">
                      <Icon 
                        name={alert?.type === 'critical' ? 'AlertTriangle' : alert?.type === 'warning' ? 'AlertCircle' : 'Info'} 
                        size={16} 
                        className={alert?.type === 'critical' ? 'text-error' : alert?.type === 'warning' ? 'text-warning' : 'text-accent'}
                      />
                      <p className="text-sm text-foreground flex-1">{alert?.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Center Column - Transactions */}
          <div className="col-span-2 space-y-5">
            {/* Transaction Filters */}
            <div className="bg-card rounded-xl border border-border shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-foreground">Transaction Log</h3>
                <div className="flex items-center gap-3">
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e?.target?.value)}
                    className="px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground"
                  >
                    <option value="all">All Status</option>
                    <option value="approved">Approved</option>
                    <option value="pending">Pending</option>
                    <option value="rejected">Rejected</option>
                  </select>
                  <select
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e?.target?.value)}
                    className="px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground"
                  >
                    <option value="all">All Categories</option>
                    <option value="Provisions">Provisions</option>
                    <option value="Fuel">Fuel</option>
                    <option value="Maintenance">Maintenance</option>
                    <option value="Docking">Docking</option>
                    <option value="Supplies">Supplies</option>
                    <option value="Safety">Safety</option>
                    <option value="Fees">Fees</option>
                  </select>
                  <Button variant="outline" size="sm" iconName="Download">
                    Export
                  </Button>
                </div>
              </div>

              {/* Transactions Table */}
              <div className="space-y-2">
                {filteredTransactions?.map((transaction) => (
                  <div key={transaction?.id} className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 items-center p-3 hover:bg-muted/30 rounded-lg transition-smooth">
                    <div className="text-xs text-muted-foreground data-text">{transaction?.date}</div>
                    <div>
                      <div className="text-sm font-medium text-foreground">{transaction?.vendor}</div>
                      <div className="text-xs text-muted-foreground">{transaction?.category}</div>
                    </div>
                    <div className="text-sm font-semibold text-foreground">{formatCurrency(transaction?.amount)}</div>
                    <div className={`px-2 py-1 rounded text-xs font-medium ${getStatusBg(transaction?.status)} ${getStatusColor(transaction?.status)}`}>
                      {transaction?.status}
                    </div>
                    <div className="text-xs text-muted-foreground capitalize">{transaction?.type}</div>
                  </div>
                ))}
              </div>

              {filteredTransactions?.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <Icon name="FileText" size={48} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No transactions match your filters</p>
                </div>
              )}
            </div>

            {/* Pending Approvals */}
            <div className="bg-card rounded-xl border border-border shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-foreground">Pending Approvals</h3>
                <span className="text-xs px-2 py-1 rounded-full bg-warning/10 text-warning">{pendingApprovals?.length} pending</span>
              </div>
              <div className="space-y-3">
                {pendingApprovals?.map((approval) => (
                  <div key={approval?.id} className="flex items-center justify-between p-3 bg-muted/20 rounded-lg">
                    <div className="flex-1">
                      <div className="text-sm font-medium text-foreground">{approval?.vendor}</div>
                      <div className="text-xs text-muted-foreground">{approval?.category} • Due {approval?.dueDate}</div>
                    </div>
                    <div className="text-sm font-semibold text-foreground mr-4">{formatCurrency(approval?.amount)}</div>
                    <div className="flex items-center gap-2">
                      <Button variant="success" size="sm" iconName="Check">
                        Approve
                      </Button>
                      <Button variant="outline" size="sm" iconName="X">
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Accounts;