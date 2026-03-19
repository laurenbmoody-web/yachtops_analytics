import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { getCurrentUser, hasCommandAccess, hasChiefAccess } from '../../utils/authStorage';
import { getAllItems } from '../inventory/utils/inventoryStorage';
import { canViewCost, formatCurrency, calculateReplenishmentValue, calculateTotalInventoryValue, calculatePercentageBelowRestock, getInventoryValueChange, saveInventoryValueSnapshot } from '../../utils/costPermissions';

const InventoryAnalyticsDashboard = () => {
  const navigate = useNavigate();
  const currentUser = getCurrentUser();
  const [items, setItems] = useState([]);

  // Permission check - Command and Chiefs only
  const hasAccess = hasCommandAccess(currentUser) || hasChiefAccess(currentUser);
  const canSeeCost = canViewCost();

  useEffect(() => {
    if (!hasAccess) {
      navigate('/dashboard');
      return;
    }
    loadData();
  }, [hasAccess, navigate]);

  const loadData = () => {
    setItems(getAllItems());
  };

  // Calculate total quantity for an item
  const getTotalQty = (item) => {
    return item?.totalQty || item?.stockLocations?.reduce((sum, loc) => sum + (loc?.qty || 0), 0) || 0;
  };

  // Categorize items by health status
  const categorizeByHealth = () => {
    const healthy = [];
    const lowStock = [];
    const critical = [];

    items?.forEach(item => {
      const totalQty = getTotalQty(item);
      
      if (!item?.restockEnabled || item?.restockLevel === null) {
        healthy?.push(item);
      } else if (totalQty === 0) {
        critical?.push(item);
      } else if (totalQty <= item?.restockLevel) {
        lowStock?.push(item);
      } else {
        healthy?.push(item);
      }
    });

    return { healthy, lowStock, critical };
  };

  // Get items by department
  const getItemsByDepartment = (department) => {
    return items?.filter(item => item?.usageDepartment === department);
  };

  // Calculate department health
  const getDepartmentHealth = (department) => {
    const deptItems = getItemsByDepartment(department);
    if (deptItems?.length === 0) return { healthy: 0, lowStock: 0, critical: 0, total: 0 };

    const healthy = [];
    const lowStock = [];
    const critical = [];

    deptItems?.forEach(item => {
      const totalQty = getTotalQty(item);
      
      if (!item?.restockEnabled || item?.restockLevel === null) {
        healthy?.push(item);
      } else if (totalQty === 0) {
        critical?.push(item);
      } else if (totalQty <= item?.restockLevel) {
        lowStock?.push(item);
      } else {
        healthy?.push(item);
      }
    });

    return {
      healthy: healthy?.length,
      lowStock: lowStock?.length,
      critical: critical?.length,
      total: deptItems?.length
    };
  };

  // Get overstocked items
  const getOverstockedItems = () => {
    return items?.filter(item => {
      if (!item?.restockEnabled || item?.restockLevel === null || item?.restockLevel === 0) return false;
      const totalQty = getTotalQty(item);
      return totalQty > (item?.restockLevel * 3);
    });
  };

  const { healthy, lowStock, critical } = categorizeByHealth();
  const overstocked = getOverstockedItems();

  // Calculate replenishment value
  const replenishmentData = canSeeCost ? calculateReplenishmentValue(items) : null;

  // Calculate total inventory value
  const totalInventoryData = canSeeCost ? calculateTotalInventoryValue(items) : null;

  // Calculate percentage below restock
  const percentageBelowRestock = canSeeCost && totalInventoryData && replenishmentData 
    ? calculatePercentageBelowRestock(replenishmentData?.totalValue, totalInventoryData?.totalValue)
    : null;

  // Get inventory value change
  const valueChange = canSeeCost ? getInventoryValueChange() : null;

  // Save current inventory value snapshot (on data load)
  useEffect(() => {
    if (canSeeCost && totalInventoryData && totalInventoryData?.totalValue > 0) {
      saveInventoryValueSnapshot(totalInventoryData?.totalValue, totalInventoryData?.currency);
    }
  }, [items?.length, canSeeCost]);

  // Prepare pie chart data
  const pieData = [
    { name: 'Healthy', value: healthy?.length, color: '#10b981' },
    { name: 'Low Stock', value: lowStock?.length, color: '#f59e0b' },
    { name: 'Critical', value: critical?.length, color: '#ef4444' }
  ];

  // Department configurations
  const departments = [
    { id: 'INTERIOR', name: 'Interior', icon: 'Home', color: 'blue' },
    { id: 'GALLEY', name: 'Galley', icon: 'UtensilsCrossed', color: 'green' },
    { id: 'DECK', name: 'Deck', icon: 'Anchor', color: 'cyan' },
    { id: 'ENGINEERING', name: 'Engineering', icon: 'Wrench', color: 'orange' }
  ];

  // Get department color classes
  const getDeptColorClasses = (color, health) => {
    const colorMap = {
      blue: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-600', ring: 'ring-blue-500' },
      green: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-600', ring: 'ring-green-500' },
      cyan: { bg: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-600', ring: 'ring-cyan-500' },
      orange: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-600', ring: 'ring-orange-500' }
    };

    const base = colorMap?.[color];
    
    if (health?.critical > 0) {
      return { ...base, border: 'border-red-400', ring: 'ring-red-500' };
    } else if (health?.lowStock > 0) {
      return { ...base, border: 'border-yellow-400', ring: 'ring-yellow-500' };
    }
    
    return base;
  };

  // Handle navigation to filtered inventory
  const handleFilterClick = (filterType, department = null) => {
    navigate('/inventory', { state: { analyticsFilter: filterType, department } });
  };

  // Handle item detail view
  const handleItemClick = (itemId) => {
    navigate(`/inventory/item/${itemId}`);
  };

  // Custom tooltip for pie chart
  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload?.length) {
      const data = payload?.[0];
      return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
          <p className="font-semibold text-gray-900">{data?.name}</p>
          <p className="text-sm text-gray-600">{data?.value} items</p>
          <p className="text-xs text-gray-500">{((data?.value / items?.length) * 100)?.toFixed(1)}%</p>
        </div>
      );
    }
    return null;
  };

  if (!hasAccess) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="p-6 max-w-[1600px] mx-auto pt-24">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Inventory Health</h1>
          <p className="text-gray-600 mt-1">Visual decision dashboard for operational inventory management</p>
        </div>

        {/* TOP LAYER: Overall Health Summary */}
        <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm mb-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
            {/* Pie Chart */}
            <div className="flex flex-col items-center">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Overall Inventory Health</h2>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent, value }) => value > 0 ? `${name} ${(percent * 100)?.toFixed(0)}%` : ''}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {pieData?.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry?.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Summary Stats */}
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
                <div className="text-sm text-gray-600 mb-1">Total SKUs Onboard</div>
                <div className="text-4xl font-bold text-gray-900">{items?.length}</div>
              </div>
              
              {/* Total Inventory Value - Only visible to Command/Chief/HOD */}
              {canSeeCost && totalInventoryData && totalInventoryData?.itemCount > 0 && (
                <div className="bg-emerald-50 rounded-xl p-6 border-2 border-emerald-200">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-600 mb-1">Total Inventory Value</div>
                      <div className="text-3xl font-bold text-emerald-700 break-words">
                        {formatCurrency(totalInventoryData?.totalValue, totalInventoryData?.currency)}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Based on {totalInventoryData?.itemCount} items with cost assigned
                      </div>
                    </div>
                    <Icon name="DollarSign" size={36} className="text-emerald-400 flex-shrink-0" />
                  </div>
                  {/* Value change indicator */}
                  {valueChange && valueChange?.direction !== 'stable' && (
                    <div className="mt-3 pt-3 border-t border-emerald-300">
                      <div className="flex items-center gap-2 text-xs">
                        {valueChange?.direction === 'up' && (
                          <>
                            <Icon name="TrendingUp" size={14} className="text-green-600" />
                            <span className="text-green-600 font-semibold">Increased since last check</span>
                          </>
                        )}
                        {valueChange?.direction === 'down' && (
                          <>
                            <Icon name="TrendingDown" size={14} className="text-red-600" />
                            <span className="text-red-600 font-semibold">Decreased since last check</span>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-green-50 rounded-xl p-4 border-2 border-green-200">
                  <div className="text-xs text-gray-600 mb-1">Healthy</div>
                  <div className="text-2xl font-bold text-green-600">{healthy?.length}</div>
                  <div className="text-xs text-gray-500 mt-1">{((healthy?.length / items?.length) * 100)?.toFixed(0)}%</div>
                </div>
                
                <div className="bg-yellow-50 rounded-xl p-4 border-2 border-yellow-200">
                  <div className="text-xs text-gray-600 mb-1">Low Stock</div>
                  <div className="text-2xl font-bold text-yellow-600">{lowStock?.length}</div>
                  <div className="text-xs text-gray-500 mt-1">{((lowStock?.length / items?.length) * 100)?.toFixed(0)}%</div>
                </div>
                
                <div className="bg-red-50 rounded-xl p-4 border-2 border-red-200">
                  <div className="text-xs text-gray-600 mb-1">Critical</div>
                  <div className="text-2xl font-bold text-red-600">{critical?.length}</div>
                  <div className="text-xs text-gray-500 mt-1">{((critical?.length / items?.length) * 100)?.toFixed(0)}%</div>
                </div>
              </div>

              <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-gray-600">Overstocked Items</div>
                    <div className="text-2xl font-bold text-blue-600">{overstocked?.length}</div>
                  </div>
                  <Icon name="Package" size={32} className="text-blue-400" />
                </div>
              </div>

              {/* Replenishment Value - Only visible to Command/Chief/HOD */}
              {canSeeCost && replenishmentData && replenishmentData?.itemCount > 0 && (
                <div className="bg-amber-50 rounded-xl p-4 border-2 border-amber-200">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="text-sm text-gray-600">Cost to Replenish</div>
                      <div className="text-2xl font-bold text-amber-600">
                        {formatCurrency(replenishmentData?.totalValue, replenishmentData?.currency)}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Based on restock level shortfall
                      </div>
                      {/* Percentage below restock */}
                      {percentageBelowRestock && (
                        <div className="mt-2 pt-2 border-t border-amber-300">
                          <div className="text-xs text-gray-600">
                            <span className="font-semibold text-amber-700">{percentageBelowRestock}%</span> of inventory value below restock
                          </div>
                        </div>
                      )}
                    </div>
                    <Icon name="TrendingUp" size={32} className="text-amber-400" />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Health Explanation */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="flex items-start gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500 mt-1 flex-shrink-0"></div>
                <div>
                  <span className="font-semibold text-gray-900">Healthy:</span>
                  <span className="text-gray-600 ml-1">Items with stock above restock level or no restock tracking enabled</span>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="w-3 h-3 rounded-full bg-yellow-500 mt-1 flex-shrink-0"></div>
                <div>
                  <span className="font-semibold text-gray-900">Low Stock:</span>
                  <span className="text-gray-600 ml-1">Items at or below restock level but still in stock</span>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500 mt-1 flex-shrink-0"></div>
                <div>
                  <span className="font-semibold text-gray-900">Critical:</span>
                  <span className="text-gray-600 ml-1">Items completely out of stock with restock tracking enabled</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* MIDDLE LAYER: Department-Level Health Cards */}
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Department Health Status</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {departments?.map(dept => {
              const health = getDepartmentHealth(dept?.id);
              const colorClasses = getDeptColorClasses(dept?.color, health);
              const healthPercentage = health?.total > 0 ? ((health?.healthy / health?.total) * 100)?.toFixed(0) : 0;

              return (
                <div
                  key={dept?.id}
                  onClick={() => handleFilterClick('department', dept?.id)}
                  className={`${colorClasses?.bg} border-2 ${colorClasses?.border} rounded-xl p-5 cursor-pointer hover:shadow-lg transition-all hover:scale-105`}
                >
                  {/* Department Header */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className={`${colorClasses?.bg} p-2 rounded-lg border ${colorClasses?.border}`}>
                        <Icon name={dept?.icon} size={20} className={colorClasses?.text} />
                      </div>
                      <h3 className="font-bold text-gray-900">{dept?.name}</h3>
                    </div>
                    <div className="text-2xl font-bold text-gray-900">{health?.total}</div>
                  </div>

                  {/* Visual Health Bar */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                      <span>Health Status</span>
                      <span className="font-semibold">{healthPercentage}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all duration-500"
                        style={{ width: `${healthPercentage}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* Status Breakdown */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-white rounded-lg p-2 border border-green-200">
                      <div className="text-xs text-gray-600">Healthy</div>
                      <div className="text-lg font-bold text-green-600">{health?.healthy}</div>
                    </div>
                    <div className="bg-white rounded-lg p-2 border border-yellow-200">
                      <div className="text-xs text-gray-600">Low</div>
                      <div className="text-lg font-bold text-yellow-600">{health?.lowStock}</div>
                    </div>
                    <div className="bg-white rounded-lg p-2 border border-red-200">
                      <div className="text-xs text-gray-600">Critical</div>
                      <div className="text-lg font-bold text-red-600">{health?.critical}</div>
                    </div>
                  </div>

                  {/* Alert Indicator */}
                  {health?.critical > 0 && (
                    <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-red-600">
                      <Icon name="AlertCircle" size={14} />
                      <span>Immediate attention required</span>
                    </div>
                  )}
                  {health?.critical === 0 && health?.lowStock > 0 && (
                    <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-yellow-600">
                      <Icon name="AlertTriangle" size={14} />
                      <span>Review recommended</span>
                    </div>
                  )}
                  {health?.critical === 0 && health?.lowStock === 0 && (
                    <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-green-600">
                      <Icon name="CheckCircle2" size={14} />
                      <span>All systems operational</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* BOTTOM LAYER: Items Requiring Action */}
        <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Items Requiring Action</h2>
              <p className="text-sm text-gray-600 mt-1">Focus on items that need immediate attention</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 px-3 py-1 bg-red-50 border border-red-200 rounded-lg">
                <div className="w-2 h-2 rounded-full bg-red-500"></div>
                <span className="text-sm font-medium text-gray-700">Critical: {critical?.length}</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
                <span className="text-sm font-medium text-gray-700">Low Stock: {lowStock?.length}</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                <span className="text-sm font-medium text-gray-700">Overstocked: {overstocked?.length}</span>
              </div>
            </div>
          </div>

          {/* Action Tabs */}
          <div className="space-y-6">
            {/* Critical Items */}
            {critical?.length > 0 && (
              <div className="border-l-4 border-red-500 pl-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-gray-900 flex items-center gap-2">
                    <Icon name="AlertCircle" size={20} className="text-red-600" />
                    Critical - Out of Stock ({critical?.length})
                  </h3>
                  <button
                    onClick={() => handleFilterClick('critical')}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors flex items-center gap-2"
                  >
                    View All Critical Items
                    <Icon name="ArrowRight" size={16} />
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {critical?.slice(0, 6)?.map(item => (
                    <div
                      key={item?.id}
                      onClick={() => handleItemClick(item?.id)}
                      className="bg-red-50 border border-red-200 rounded-lg p-4 cursor-pointer hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="font-semibold text-gray-900 text-sm">{item?.name}</div>
                          <div className="text-xs text-gray-600 mt-1">{item?.usageDepartment || 'INTERIOR'}</div>
                        </div>
                        <div className="bg-red-600 text-white text-xs font-bold px-2 py-1 rounded">OUT</div>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-600">Restock at: {item?.restockLevel}</span>
                        <Icon name="ChevronRight" size={14} className="text-gray-400" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Low Stock Items */}
            {lowStock?.length > 0 && (
              <div className="border-l-4 border-yellow-500 pl-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-gray-900 flex items-center gap-2">
                    <Icon name="AlertTriangle" size={20} className="text-yellow-600" />
                    Low Stock - Below Restock Level ({lowStock?.length})
                  </h3>
                  <button
                    onClick={() => handleFilterClick('lowStock')}
                    className="px-4 py-2 bg-yellow-600 text-white rounded-lg text-sm font-medium hover:bg-yellow-700 transition-colors flex items-center gap-2"
                  >
                    View All Low Stock Items
                    <Icon name="ArrowRight" size={16} />
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {lowStock?.slice(0, 6)?.map(item => {
                    const qty = getTotalQty(item);
                    return (
                      <div
                        key={item?.id}
                        onClick={() => handleItemClick(item?.id)}
                        className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 cursor-pointer hover:shadow-md transition-shadow"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <div className="font-semibold text-gray-900 text-sm">{item?.name}</div>
                            <div className="text-xs text-gray-600 mt-1">{item?.usageDepartment || 'INTERIOR'}</div>
                          </div>
                          <div className="bg-yellow-600 text-white text-xs font-bold px-2 py-1 rounded">LOW</div>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-600">Current: {qty} / Restock: {item?.restockLevel}</span>
                          <Icon name="ChevronRight" size={14} className="text-gray-400" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Overstocked Items */}
            {overstocked?.length > 0 && (
              <div className="border-l-4 border-blue-500 pl-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-gray-900 flex items-center gap-2">
                    <Icon name="Package" size={20} className="text-blue-600" />
                    Overstocked - Review for Redistribution ({overstocked?.length})
                  </h3>
                  <button
                    onClick={() => handleFilterClick('overstocked')}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
                  >
                    View All Overstocked Items
                    <Icon name="ArrowRight" size={16} />
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {overstocked?.slice(0, 6)?.map(item => {
                    const qty = getTotalQty(item);
                    const excess = qty - (item?.restockLevel * 3);
                    return (
                      <div
                        key={item?.id}
                        onClick={() => handleItemClick(item?.id)}
                        className="bg-blue-50 border border-blue-200 rounded-lg p-4 cursor-pointer hover:shadow-md transition-shadow"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <div className="font-semibold text-gray-900 text-sm">{item?.name}</div>
                            <div className="text-xs text-gray-600 mt-1">{item?.usageDepartment || 'INTERIOR'}</div>
                          </div>
                          <div className="bg-blue-600 text-white text-xs font-bold px-2 py-1 rounded">OVER</div>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-600">Current: {qty} / Target: {item?.restockLevel * 3}</span>
                          <Icon name="ChevronRight" size={14} className="text-gray-400" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* No Action Required */}
            {critical?.length === 0 && lowStock?.length === 0 && overstocked?.length === 0 && (
              <div className="text-center py-12">
                <Icon name="CheckCircle2" size={64} className="text-green-500 mx-auto mb-4" />
                <h3 className="text-xl font-bold text-gray-900 mb-2">All Systems Operational</h3>
                <p className="text-gray-600">No items require immediate action at this time</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default InventoryAnalyticsDashboard;