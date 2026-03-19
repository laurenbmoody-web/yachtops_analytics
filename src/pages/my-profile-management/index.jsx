import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Icon from '../../components/AppIcon';
import { supabase } from '../../lib/supabaseClient';
import { useTenant } from '../../contexts/TenantContext';

import { showToast } from '../../utils/toast';
import { logActivity } from '../../utils/activityStorage';

const MyProfileManagement = () => {
  const navigate = useNavigate();
  const { activeTenantId } = useTenant();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState(null);
  const [tenantInfo, setTenantInfo] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    fullName: '',
    firstName: '',
    surname: '',
    email: ''
  });
  const [originalFormData, setOriginalFormData] = useState({});
  const [loadTimeout, setLoadTimeout] = useState(false);
  const timeoutRef = useRef(null);
  const [error, setError] = useState(null);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    console.log('[PAGE] Mounted /my-profile');
    if (activeTenantId) {
      loadProfileData();
    } else {
      setError('No tenant context (currentTenantId missing)');
      setLoading(false);
    }
    
    // Set 8-second timeout
    timeoutRef.current = setTimeout(() => {
      if (loading) {
        console.log('[PAGE] /my-profile loading timeout reached');
        setLoadTimeout(true);
      }
    }, 8000);
    
    return () => {
      if (timeoutRef?.current) {
        clearTimeout(timeoutRef?.current);
      }
    };
  }, [activeTenantId]);

  const loadProfileData = async () => {
    console.log('[PROFILE] start fetch');
    setLoading(true);
    setTimedOut(false);
    setError(null);
    
    // Start 8-second timeout
    if (timeoutRef?.current) {
      clearTimeout(timeoutRef?.current);
    }
    timeoutRef.current = setTimeout(() => {
      console.log('[PROFILE] 8s timeout reached');
      setTimedOut(true);
    }, 8000);
    
    try {
      if (!activeTenantId) {
        setError('No tenant context (currentTenantId missing)');
        return;
      }
      
      // Get current auth session
      const { data: { session }, error: sessionError } = await supabase?.auth?.getSession();
      
      if (sessionError || !session) {
        console.error('[PROFILE] No session', sessionError);
        
        // Surface specific error types
        if (sessionError?.code === '401' || sessionError?.code === 'PGRST301') {
          setError('Authentication error: ' + (sessionError?.message || 'Unauthorized'));
        } else {
          setError('No active session');
        }
        return;
      }

      const userId = session?.user?.id;
      const userEmail = session?.user?.email;

      // Fetch profile
      const { data: profileData, error: profileError } = await supabase?.from('profiles')?.select('id, full_name, email, last_active_tenant_id')?.eq('id', userId)?.single();

      // If profile doesn't exist, create it silently
      if (profileError && profileError?.code === 'PGRST116') {
        console.log('[PROFILE] Profile not found, creating new profile...');
        const { data: newProfile, error: insertError } = await supabase?.from('profiles')?.insert({
            id: userId,
            email: userEmail,
            full_name: null
          })?.select()?.single();

        if (insertError) {
          console.error('[PROFILE] Error creating profile:', insertError);
          
          // Surface specific error types
          if (insertError?.code === '401' || insertError?.code === 'PGRST301') {
            setError('Authentication error: ' + (insertError?.message || 'Unauthorized'));
          } else if (insertError?.code === '403' || insertError?.code === 'PGRST302') {
            setError('Permission denied: ' + (insertError?.message || 'Forbidden'));
          } else if (insertError?.code === '406' || insertError?.code === 'PGRST106') {
            setError('Query error: ' + (insertError?.message || 'Not Acceptable'));
          } else if (insertError?.code === '400' || insertError?.code === 'PGRST100') {
            setError('Bad request: ' + (insertError?.message || 'Invalid query'));
          } else {
            setError(insertError?.message || 'Failed to create profile');
          }
          
          console.log(`[PROFILE] Error: ${insertError?.code} - ${insertError?.message}`);
          return;
        }

        console.log('[PROFILE] fetch success (new profile created)');
        setProfile(newProfile);
        setFormData({
          fullName: '',
          firstName: '',
          surname: '',
          phone: ''
        });
        setOriginalFormData({
          fullName: '',
          firstName: '',
          surname: '',
          phone: ''
        });
      } else if (profileError) {
        console.error('[PROFILE] Error fetching profile:', profileError);
        
        // Surface specific error types
        if (profileError?.code === '401' || profileError?.code === 'PGRST301') {
          setError('Authentication error: ' + (profileError?.message || 'Unauthorized'));
        } else if (profileError?.code === '403' || profileError?.code === 'PGRST302') {
          setError('Permission denied: ' + (profileError?.message || 'Forbidden'));
        } else if (profileError?.code === '406' || profileError?.code === 'PGRST106') {
          setError('Query error: ' + (profileError?.message || 'Not Acceptable'));
        } else if (profileError?.code === '400' || profileError?.code === 'PGRST100') {
          setError('Bad request: ' + (profileError?.message || 'Invalid query'));
        } else {
          setError(profileError?.message || 'Failed to fetch profile');
        }
        
        console.log(`[PROFILE] Error: ${profileError?.code} - ${profileError?.message}`);
        return;
      } else {
        console.log('[PROFILE] fetch success');
        setProfile(profileData);
        
        // Parse full_name into firstName and surname if available
        const nameParts = profileData?.full_name ? profileData?.full_name?.split(' ') : ['', ''];
        const firstName = nameParts?.[0] || '';
        const surname = nameParts?.slice(1)?.join(' ') || '';

        const initialFormData = {
          fullName: profileData?.full_name || '',
          firstName: firstName,
          surname: surname,
          phone: '' // Phone field not in current schema
        };
        setFormData(initialFormData);
        setOriginalFormData(initialFormData);
      }

      // Fetch tenant info if activeTenantId exists
      if (activeTenantId) {
        const { data: memberData, error: memberError } = await supabase?.from('tenant_members')?.select(`
            role,
            tenants:tenant_id (
              name
            )
          `)?.eq('user_id', userId)?.eq('tenant_id', activeTenantId)?.eq('active', true)?.single();

        if (!memberError && memberData) {
          setTenantInfo({
            vesselName: memberData?.tenants?.name || 'N/A',
            role: memberData?.role || 'N/A'
          });
        }
      }
    } catch (err) {
      console.error('[PROFILE] fetch error:', err);
      
      // Surface specific error types
      if (err?.code === '401' || err?.code === 'PGRST301') {
        setError('Authentication error: ' + (err?.message || 'Unauthorized'));
      } else if (err?.code === '403' || err?.code === 'PGRST302') {
        setError('Permission denied: ' + (err?.message || 'Forbidden'));
      } else if (err?.code === '406' || err?.code === 'PGRST106') {
        setError('Query error: ' + (err?.message || 'Not Acceptable'));
      } else if (err?.code === '400' || err?.code === 'PGRST100') {
        setError('Bad request: ' + (err?.message || 'Invalid query'));
      } else {
        setError(err?.message || 'Failed to load profile data');
      }
      
      console.log(`[PROFILE] Error: ${err?.code} - ${err?.message}`);
    } finally {
      if (timeoutRef?.current) {
        clearTimeout(timeoutRef?.current);
      }
      setLoading(false);
      console.log('[PROFILE] end fetch');
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const hasUnsavedChanges = () => {
    return JSON.stringify(formData) !== JSON.stringify(originalFormData);
  };

  const handleSave = async () => {
    if (!profile) return;

    setSaving(true);
    try {
      // Construct full_name from firstName and surname
      const fullName = `${formData?.firstName} ${formData?.surname}`?.trim();

      const { error: updateError } = await supabase?.from('profiles')?.update({
          full_name: fullName || formData?.fullName
        })?.eq('id', profile?.id);

      if (updateError) {
        console.error('Error updating profile:', updateError);
        showToast('Failed to update profile', 'error');
        return;
      }

      // Log to activity feed
      logActivity({
        module: 'profile',
        action: 'PROFILE_UPDATED',
        entityType: 'profile',
        entityId: profile?.id,
        summary: `Profile updated: ${fullName || formData?.fullName}`,
        meta: { fullName: fullName || formData?.fullName }
      });

      showToast('Profile updated successfully', 'success');
      setIsEditing(false);
      
      // Reload profile data
      await loadProfileData();
    } catch (err) {
      console.error('Error saving profile:', err);
      showToast('Failed to save changes', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setFormData(originalFormData);
    setIsEditing(false);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Page Header - Always visible */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">My Profile</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage your personal information and account details
            </p>
          </div>
          
          {!loading && !error && !isEditing && (
            <Button
              onClick={() => setIsEditing(true)}
              iconName="Edit"
              variant="outline"
            >
              Edit Profile
            </Button>
          )}
          {!loading && !error && isEditing && (
            <div className="flex gap-2">
              <Button
                onClick={handleCancel}
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !hasUnsavedChanges()}
                iconName="Save"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          )}
        </div>

        {/* Loading State - Small inline loader */}
        {loading && !loadTimeout && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        )}

        {/* Timeout State - Still loading with retry */}
        {loadTimeout && loading && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center">
              <Icon name="AlertTriangle" size={32} className="text-yellow-600" />
            </div>
            <div className="text-center max-w-md">
              <h2 className="text-xl font-semibold text-foreground mb-2">Still Loading</h2>
              <p className="text-muted-foreground mb-6">
                The profile is taking longer than expected to load.
              </p>
              <Button onClick={loadProfileData}>
                Retry
              </Button>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
              <Icon name="AlertCircle" size={32} className="text-red-600" />
            </div>
            <div className="text-center max-w-md">
              <h2 className="text-xl font-semibold text-foreground mb-2">Access / Data Unavailable</h2>
              <p className="text-muted-foreground mb-6">
                {error}
              </p>
              <Button onClick={loadProfileData}>
                Retry
              </Button>
            </div>
          </div>
        )}

        {/* Content - Show when not loading or when data exists */}
        {!loading && !error && profile && (
          <>
            {/* Read-Only Information Card */}
            <div className="bg-card border border-border rounded-lg p-6 space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <Icon name="Info" size={20} className="text-primary" />
                <h2 className="text-lg font-semibold text-foreground">Account Information</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Email - Read Only */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Email Address
                  </label>
                  <div className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm text-foreground">
                    {profile?.email || 'N/A'}
                  </div>
                </div>

                {/* Current Vessel - Read Only */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Current Vessel
                  </label>
                  <div className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm text-foreground">
                    {tenantInfo?.vesselName || 'Not assigned'}
                  </div>
                </div>

                {/* Permission Tier - Read Only */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Permission Tier / Role
                  </label>
                  <div className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm">
                    {tenantInfo?.role ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">
                        {tenantInfo?.role}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Not assigned</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Editable Profile Information Card */}
            <div className="bg-card border border-border rounded-lg p-6 space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <Icon name="User" size={20} className="text-primary" />
                <h2 className="text-lg font-semibold text-foreground">Personal Information</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Full Name */}
                <div className="md:col-span-2">
                  <Input
                    label="Full Name"
                    value={formData?.fullName}
                    onChange={(e) => handleInputChange('fullName', e?.target?.value)}
                    disabled={!isEditing}
                    placeholder="Enter your full name"
                  />
                </div>

                {/* First Name */}
                <div>
                  <Input
                    label="First Name"
                    value={formData?.firstName}
                    onChange={(e) => handleInputChange('firstName', e?.target?.value)}
                    disabled={!isEditing}
                    placeholder="Enter your first name"
                  />
                </div>

                {/* Surname */}
                <div>
                  <Input
                    label="Surname"
                    value={formData?.surname}
                    onChange={(e) => handleInputChange('surname', e?.target?.value)}
                    disabled={!isEditing}
                    placeholder="Enter your surname"
                  />
                </div>

                {/* Phone (Optional) */}
                <div className="md:col-span-2">
                  <Input
                    label="Phone Number (Optional)"
                    value={formData?.phone}
                    onChange={(e) => handleInputChange('phone', e?.target?.value)}
                    disabled={!isEditing}
                    placeholder="Enter your phone number"
                    description="Phone field is optional and not yet stored in the database"
                  />
                </div>
              </div>
            </div>

            {/* Unsaved Changes Warning */}
            {isEditing && hasUnsavedChanges() && (
              <div className="bg-warning/10 border border-warning/20 rounded-lg p-4 flex items-start gap-3">
                <Icon name="AlertTriangle" size={20} className="text-warning mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-foreground">Unsaved Changes</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    You have unsaved changes. Click "Save Changes" to update your profile.
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default MyProfileManagement;