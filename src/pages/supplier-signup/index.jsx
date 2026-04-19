import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';

const CATEGORY_OPTIONS = [
  'Food & Produce', 'Beverages & Wine', 'Technical & Marine',
  'Linen & Uniforms', 'Flowers & Décor', 'Cleaning & Supplies', 'Other',
];

const SupplierSignup = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [ports, setPorts] = useState('');
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // Pre-fill from claim flow query params
  useEffect(() => {
    const emailParam = searchParams.get('email');
    const nameParam = searchParams.get('name');
    if (emailParam) setEmail(decodeURIComponent(emailParam));
    if (nameParam) setCompanyName(decodeURIComponent(nameParam));
  }, [searchParams]);

  const toggleCategory = (cat) => {
    setSelectedCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!companyName.trim()) { setError('Company name is required.'); return; }
    if (!contactName.trim()) { setError('Your name is required.'); return; }
    if (!email.trim()) { setError('Email is required.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }

    setLoading(true);

    try {
      // 1. Create auth user with supplier metadata
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: contactName.trim(),
            user_type: 'supplier',
          },
        },
      });

      if (authError) {
        setError(authError.message || 'Failed to create account. Please try again.');
        setLoading(false);
        return;
      }

      if (!authData?.user) {
        setError('Account creation failed. Please try again.');
        setLoading(false);
        return;
      }

      const portList = ports.split(',').map(p => p.trim()).filter(Boolean);

      // 2. Create supplier_profiles row
      const { data: supplier, error: supplierError } = await supabase
        .from('supplier_profiles')
        .insert({
          name: companyName.trim(),
          contact_email: email.trim(),
          contact_phone: phone.trim() || null,
          coverage_ports: portList,
          categories: selectedCategories,
        })
        .select()
        .single();

      if (supplierError) {
        console.error('[SUPPLIER_SIGNUP] Profile creation error:', supplierError);
        setError('Account created but profile setup failed. Please contact support.');
        setLoading(false);
        return;
      }

      // 3. Create supplier_contacts row
      const { error: contactError } = await supabase.from('supplier_contacts').insert({
        supplier_id: supplier.id,
        user_id: authData.user.id,
        role: 'owner',
        name: contactName.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
      });

      if (contactError) {
        console.error('[SUPPLIER_SIGNUP] Contact creation error:', contactError);
      }

      // 4. Update user metadata with supplier_id
      await supabase.auth.updateUser({
        data: { supplier_id: supplier.id },
      });

      setSuccess(true);

      // If email confirmation is off, navigate directly
      const session = authData.session;
      if (session) {
        setTimeout(() => navigate('/supplier/dashboard', { replace: true }), 1500);
      }

    } catch (err) {
      console.error('[SUPPLIER_SIGNUP] Error:', err);
      setError(err?.message || 'Signup failed. Please try again.');
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', padding: 16 }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#D1FAE5', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 24 }}>✓</div>
          <h2 style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 800, fontSize: 22, color: '#0C0E14', margin: '0 0 8px' }}>Account created!</h2>
          <p style={{ fontSize: 14, color: '#64748B', margin: '0 0 20px' }}>
            Check your email to confirm your account, then log in to access your supplier portal.
          </p>
          <Link
            to="/supplier/login"
            style={{ display: 'inline-block', background: '#1E3A5F', color: '#fff', borderRadius: 8, padding: '10px 24px', fontSize: 14, fontWeight: 700, fontFamily: 'Outfit, sans-serif', textDecoration: 'none' }}
          >
            Go to login
          </Link>
        </div>
      </div>
    );
  }

  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    border: '1px solid #D1D5DB', borderRadius: 8,
    padding: '10px 12px', fontSize: 14, color: '#111827',
    outline: 'none', fontFamily: 'inherit',
    background: loading ? '#F9FAFB' : '#fff',
  };

  const labelStyle = {
    display: 'block', fontSize: 13, fontWeight: 500,
    color: '#374151', marginBottom: 6,
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', padding: '24px 16px' }}>
      <div style={{ width: '100%', maxWidth: 480 }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <img src="/assets/images/cargo_merged_originalmark_syne800_true.png" alt="Cargo" style={{ height: 28, width: 'auto', marginBottom: 18 }} />
          <div style={{
            display: 'inline-block',
            background: '#EEF2F7', border: '1px solid #CBD5E1',
            borderRadius: 20, padding: '4px 12px',
            fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: '#1E3A5F',
            marginBottom: 12, fontFamily: 'Outfit, sans-serif',
          }}>
            Supplier Portal
          </div>
          <h1 style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 800, fontSize: 24, color: '#0C0E14', margin: '0 0 6px' }}>
            Create your supplier account
          </h1>
          <p style={{ fontSize: 14, color: '#64748B', margin: 0 }}>
            Join Cargo to receive and manage orders from superyachts.
          </p>
        </div>

        {/* Card */}
        <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 16, padding: 32, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          {error && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 13.5, color: '#991B1B' }}>
              ⚠ {error}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <label style={labelStyle}>Company name *</label>
                <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Maison Provence" disabled={loading} required style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Your name *</label>
                <input type="text" value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Luca Moreau" disabled={loading} required style={inputStyle} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <label style={labelStyle}>Email *</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@supplier.com" disabled={loading} required style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Phone</label>
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+33 4 93 …" disabled={loading} style={inputStyle} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <label style={labelStyle}>Password *</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min. 6 characters" disabled={loading} required style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Confirm password *</label>
                <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Repeat password" disabled={loading} required style={inputStyle} />
              </div>
            </div>

            <div>
              <label style={labelStyle}>Base port(s) <span style={{ color: '#94A3B8', fontWeight: 400 }}>(optional, comma-separated)</span></label>
              <input type="text" value={ports} onChange={e => setPorts(e.target.value)} placeholder="Antibes, Cannes, Monaco" disabled={loading} style={inputStyle} />
            </div>

            <div>
              <label style={{ ...labelStyle, marginBottom: 10 }}>
                What do you supply? <span style={{ color: '#94A3B8', fontWeight: 400 }}>(optional)</span>
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {CATEGORY_OPTIONS.map(cat => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    disabled={loading}
                    style={{
                      padding: '5px 12px',
                      borderRadius: 20,
                      fontSize: 12.5,
                      fontWeight: 600,
                      fontFamily: 'Outfit, sans-serif',
                      cursor: 'pointer',
                      border: selectedCategories.includes(cat) ? '1.5px solid #1E3A5F' : '1px solid #D1D5DB',
                      background: selectedCategories.includes(cat) ? '#EEF2F7' : '#fff',
                      color: selectedCategories.includes(cat) ? '#1E3A5F' : '#64748B',
                      transition: 'all 0.1s',
                    }}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                background: loading ? '#94A3B8' : '#1E3A5F',
                color: '#fff', border: 'none', borderRadius: 8,
                padding: '11px 0', fontSize: 14, fontWeight: 700,
                fontFamily: 'Outfit, sans-serif',
                cursor: loading ? 'not-allowed' : 'pointer',
                letterSpacing: '0.02em',
                transition: 'background 0.15s',
                marginTop: 4,
              }}
            >
              {loading ? 'Creating account…' : 'Create supplier account'}
            </button>
          </form>

          <p style={{ fontSize: 11.5, color: '#94A3B8', textAlign: 'center', marginTop: 16, margin: '16px 0 0' }}>
            By signing up you agree to Cargo's Terms of Service and Privacy Policy.
          </p>
        </div>

        <div style={{ marginTop: 20, textAlign: 'center' }}>
          <p style={{ fontSize: 13.5, color: '#64748B', margin: 0 }}>
            Already have an account?{' '}
            <Link to="/supplier/login" style={{ color: '#1E3A5F', fontWeight: 600, textDecoration: 'none' }}>
              Log in →
            </Link>
          </p>
        </div>

      </div>
    </div>
  );
};

export default SupplierSignup;
