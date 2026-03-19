import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import { getMyContext } from '../../utils/authHelpers';
import Header from '../../components/navigation/Header';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';

const Membership = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tenantId, setTenantId] = useState(null);
  const [noTenantAccess, setNoTenantAccess] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [error, setError] = useState(null);

  const plans = [
    {
      id: 'TRIAL',
      name: 'Trial',
      bullets: [
        'Basic vessel management',
        'Up to 5 crew members',
        '30-day trial period',
        'Core inventory features'
      ],
      price: 'Free for 30 days'
    },
    {
      id: 'STANDARD',
      name: 'Standard',
      bullets: [
        'Full vessel management',
        'Up to 20 crew members',
        'Advanced inventory',
        'Guest management',
        'Email support'
      ],
      price: '$99/month'
    },
    {
      id: 'PRO',
      name: 'Pro',
      bullets: [
        'Unlimited crew members',
        'Multi-vessel management',
        'Advanced analytics',
        'Priority support',
        'Custom integrations'
      ],
      price: '$299/month'
    }
  ];

  useEffect(() => {
    loadContext();
  }, []);

  const loadContext = async () => {
    try {
      setLoading(true);
      setError(null);

      const { tenantId: contextTenantId, error: contextError } = await getMyContext();

      if (contextError) {
        setError(contextError);
        setLoading(false);
        return;
      }

      if (!contextTenantId) {
        setNoTenantAccess(true);
        setLoading(false);
        return;
      }

      setTenantId(contextTenantId);
      setLoading(false);
    } catch (err) {
      console.error('Error loading context:', err);
      setError(`Unexpected error: ${err?.message || 'Unknown error'}`);
      setLoading(false);
    }
  };

  const handleContinue = async () => {
    if (!selectedPlan || !tenantId) return;

    try {
      setSaving(true);
      setError(null);

      const { error: updateError } = await supabase?.from('vessels')?.update({
          membership_plan: selectedPlan,
          membership_status: 'ACTIVE'
        })?.eq('tenant_id', tenantId);

      if (updateError) {
        console.error('Error updating membership:', updateError);
        setError(`Failed to update membership: ${updateError?.message}`);
        setSaving(false);
        return;
      }

      // Navigate to dashboard after successful save
      navigate('/dashboard');
    } catch (err) {
      console.error('Error saving membership:', err);
      setError(`Unexpected error: ${err?.message || 'Unknown error'}`);
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="flex items-center justify-center h-[calc(100vh-64px)]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  if (noTenantAccess) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="flex items-center justify-center h-[calc(100vh-64px)]">
          <div className="text-center max-w-md mx-auto p-8">
            <Icon name="AlertCircle" size={48} className="text-warning mx-auto mb-4" />
            <h2 className="text-2xl font-semibold text-foreground mb-2">No Active Vessel Access</h2>
            <p className="text-muted-foreground mb-6">
              You don't have access to any vessel. Please contact your administrator.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto px-4 py-12 max-w-6xl">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-foreground mb-4">Choose your plan</h1>
          <p className="text-lg text-muted-foreground">
            Select the membership plan that best fits your vessel management needs
          </p>
        </div>

        {error && (
          <div className="mb-8 p-4 bg-error/10 border border-error rounded-lg flex items-start gap-3">
            <Icon name="AlertCircle" size={20} className="text-error flex-shrink-0 mt-0.5" />
            <p className="text-error text-sm">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {plans?.map((plan) => (
            <div
              key={plan?.id}
              onClick={() => setSelectedPlan(plan?.id)}
              className={`
                relative rounded-xl border-2 p-6 cursor-pointer transition-all
                ${selectedPlan === plan?.id
                  ? 'border-primary bg-primary/5 shadow-lg'
                  : 'border-border bg-card hover:border-primary/50 hover:shadow-md'
                }
              `}
            >
              {selectedPlan === plan?.id && (
                <div className="absolute top-4 right-4">
                  <div className="bg-primary text-primary-foreground rounded-full p-1">
                    <Icon name="Check" size={16} />
                  </div>
                </div>
              )}

              <h3 className="text-2xl font-bold text-foreground mb-2">{plan?.name}</h3>
              <div className="text-3xl font-bold text-primary mb-6">{plan?.price}</div>

              <ul className="space-y-3 mb-6">
                {plan?.bullets?.map((bullet, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <Icon name="Check" size={16} className="text-success flex-shrink-0 mt-1" />
                    <span className="text-sm text-muted-foreground">{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex justify-center">
          <Button
            onClick={handleContinue}
            disabled={!selectedPlan || saving || noTenantAccess}
            loading={saving}
            size="lg"
            className="min-w-[200px]"
          >
            {saving ? 'Processing...' : 'Continue'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Membership;