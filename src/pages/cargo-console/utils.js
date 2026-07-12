import { supabase } from '../../lib/supabaseClient';

// Is the signed-in user a Cargo platform admin (on the platform_admins
// allowlist)? Gates the internal console. Returns false on any error.
export const amIPlatformAdmin = async () => {
  const { data, error } = await supabase.rpc('is_platform_admin');
  if (error) return false;
  return !!data;
};

// The certificate review queue — flagged first, newest first. Each row carries
// the AI parse (scheme, cert number, holder, dates, verdict, flags) plus the
// register link to check it on. Admin-gated in the RPC.
export const fetchCertReviewQueue = async () => {
  const { data, error } = await supabase.rpc('list_certs_for_review');
  if (error) throw error;
  return (data ?? []).map(c => ({
    id:           c.id,
    supplierId:   c.supplier_id,
    supplierName: c.supplier_name,
    name:         c.name,
    docUrl:       c.doc_url,
    status:       c.status,
    scheme:       c.scheme,
    certNumber:   c.cert_number,
    issuedTo:     c.issued_to,
    issuingBody:  c.issuing_body,
    issueDate:    c.issue_date,
    expiryDate:   c.expiry_date,
    verdict:      c.ai_verdict,
    flags:        Array.isArray(c.ai_flags) ? c.ai_flags : [],
    confidence:   c.ai_confidence,
    registryUrl:  c.registry_url,
    verified:     c.verified,
    verifiedAt:   c.verified_at,
    parsedAt:     c.parsed_at,
    createdAt:    c.created_at,
  }));
};

// Grant or revoke the buyer-facing tick. status: 'verified' | 'rejected' |
// 'ai_checked' | 'flagged' | 'pending'. The DB trigger keeps verified in sync.
export const setCertStatus = async (certId, status) => {
  const { error } = await supabase.rpc('set_certification_status', { p_cert_id: certId, p_status: status });
  if (error) throw error;
};
