import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Icon from '../../components/AppIcon';
import { supabase } from '../../lib/supabaseClient';
import { showToast } from '../../utils/toast';
import { useAuth } from '../../contexts/AuthContext';

const MyProfile = () => {
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState(null);
  
  // Profile data
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [nationality, setNationality] = useState('');
  const [dob, setDob] = useState('');
  const [nextOfKinName, setNextOfKinName] = useState('');
  const [nextOfKinPhone, setNextOfKinPhone] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  
  // Progress tracking
  const [profileCompletion, setProfileCompletion] = useState(0);
  const [missingFields, setMissingFields] = useState([]);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      setLoading(true);
      
      const { data: { user }, error: authError } = await supabase?.auth?.getUser();
      if (authError || !user) {
        console.error('MyProfile: Auth error:', authError);
        // DO NOT redirect here - ProtectedRoute handles this
        setLoading(false);
        return;
      }
      
      setUserId(user?.id);
      
      // Fetch profile from profiles table
      const { data: profileData, error: profileError } = await supabase
        ?.from('profiles')
        ?.select('full_name, email')
        ?.eq('id', user?.id)
        ?.single();
      
      if (profileError) {
        console.error('MyProfile: Profile fetch error:', profileError);
      } else {
        setFullName(profileData?.full_name || '');
        setEmail(profileData?.email || '');
      }
      
      // Fetch personal_profile data
      const { data: personalProfileData, error: personalProfileError } = await supabase
        ?.from('personal_profile')
        ?.select('*')
        ?.eq('user_id', user?.id)
        ?.single();
      
      if (personalProfileError && personalProfileError?.code !== 'PGRST116') {
        console.error('MyProfile: Personal profile fetch error:', personalProfileError);
      } else if (personalProfileData) {
        setPhone(personalProfileData?.phone || '');
        setAvatarUrl(personalProfileData?.avatar_url || '');
      }
      
      calculateCompletion({
        full_name: profileData?.full_name,
        email: profileData?.email,
        phone: personalProfileData?.phone,
        nationality: personalProfileData?.nationality,
        dob: personalProfileData?.dob,
        next_of_kin_name: personalProfileData?.next_of_kin_name,
        next_of_kin_phone: personalProfileData?.next_of_kin_phone,
        avatar_url: personalProfileData?.avatar_url
      });
      
      setLoading(false);
    } catch (err) {
      console.error('MyProfile: Error loading profile:', err);
      setLoading(false);
    }
  };

  const calculateCompletion = (data) => {
    const fields = [
      { name: 'Full Name', value: data?.full_name },
      { name: 'Email', value: data?.email },
      { name: 'Phone', value: data?.phone },
      { name: 'Nationality', value: data?.nationality },
      { name: 'Date of Birth', value: data?.dob },
      { name: 'Next of Kin', value: data?.next_of_kin_name },
      { name: 'Emergency Contact', value: data?.next_of_kin_phone },
      { name: 'Avatar', value: data?.avatar_url }
    ];
    
    const filledFields = fields?.filter(f => f?.value)?.length;
    const totalFields = fields?.length;
    const percentage = Math.round((filledFields / totalFields) * 100);
    
    setProfileCompletion(percentage);
    setMissingFields(fields?.filter(f => !f?.value)?.map(f => f?.name));
  };

  const handleSave = async (e) => {
    e?.preventDefault();
    setSaving(true);
    
    try {
      // Update profiles table
      const { error: profileError } = await supabase
        ?.from('profiles')
        ?.update({ full_name: fullName?.trim() })
        ?.eq('id', userId);
      
      if (profileError) throw profileError;
      
      // Upsert personal_profile table
      const { error: personalProfileError } = await supabase
        ?.from('personal_profile')
        ?.upsert({
          user_id: userId,
          phone: phone?.trim() || null,
          avatar_url: avatarUrl?.trim() || null
        }, { onConflict: 'user_id' });
      
      if (personalProfileError) throw personalProfileError;
      
      showToast('Profile updated successfully', 'success');
      loadProfile();
    } catch (err) {
      console.error('MyProfile: Save error:', err);
      showToast(err?.message || 'Failed to update profile', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Show loading state while auth or page data is loading
  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-foreground mb-2">My Profile</h1>
            <p className="text-sm text-muted-foreground">Manage your personal information</p>
          </div>
          <Button
            onClick={() => navigate('/dashboard-personal')}
            variant="outline"
            iconName="ArrowLeft"
            iconPosition="left"
          >
            Back to Dashboard
          </Button>
        </div>

        {/* Progress Card */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Profile Completion</h2>
              <p className="text-sm text-muted-foreground">Complete your profile to unlock all features</p>
            </div>
            <div className="text-3xl font-bold text-primary">{profileCompletion}%</div>
          </div>
          
          {/* Progress Bar */}
          <div className="h-3 bg-muted rounded-full overflow-hidden mb-4">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${profileCompletion}%` }}
            />
          </div>
          
          {/* Missing Fields */}
          {missingFields?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {missingFields?.map((field, index) => (
                <span
                  key={index}
                  className="px-3 py-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 text-xs font-medium rounded-full"
                >
                  {field} missing
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Profile Form */}
        <form onSubmit={handleSave} className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-5">
          <h2 className="text-lg font-semibold text-foreground mb-4">Personal Information</h2>
          
          {/* Full Name */}
          <Input
            label="Full Name"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e?.target?.value)}
            placeholder="John Smith"
            required
          />
          
          {/* Email (Read-only) */}
          <Input
            label="Email"
            type="email"
            value={email}
            disabled
            placeholder="john@example.com"
          />
          
          {/* Phone */}
          <Input
            label="Phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e?.target?.value)}
            placeholder="+44 7700 900000"
          />
          
          {/* Avatar URL */}
          <Input
            label="Avatar URL"
            type="url"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e?.target?.value)}
            placeholder="https://example.com/avatar.jpg"
          />
          
          {/* Info Banner */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <Icon name="Info" size={16} className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-blue-800 dark:text-blue-200">
                Additional fields like nationality, date of birth, and emergency contacts will be available in future updates.
              </p>
            </div>
          </div>
          
          {/* Save Button */}
          <Button
            type="submit"
            disabled={saving}
            iconName={saving ? 'Loader2' : 'Save'}
            iconPosition="left"
            className="w-full"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default MyProfile;