import { readRows, requireBackend, rpc } from './experience.js';
import { influencerTerms } from '../features/partners/legal/influencerLegal.js';

export async function getWorkspaceAccount() {
  const db = requireBackend();
  const { data: { user }, error } = await db.auth.getUser();
  if (error && error.name !== 'AuthSessionMissingError') throw error;
  if (!user) return { user: null, profile: null, applications: [], roles: [] };
  const [profiles, applications, staff] = await Promise.all([
    readRows('profiles', q => q.eq('id', user.id)),
    readRows('partner_applications', q => q.eq('customer_id', user.id)),
    readRows('staff_access', q => q.eq('account_id', user.id).eq('active', true).is('revoked_at', null)),
  ]);
  let profile=profiles[0]??null;
  if (!profile) { const repaired=await db.rpc('ensure_my_profile'); if(repaired.error)throw repaired.error;profile=repaired.data; }
  const assessments={};
  if(profile?.account_status==='active')for(const app of applications.filter(a=>a.role==='consultant'&&a.status==='approved')){
    const result=await db.rpc('get_consultant_assessment_eligibility',{p_application_id:app.id});
    if(result.error)throw result.error;assessments[app.id]=result.data?.eligible===true;
  }
  return { user, profile, applications, assessments, roles: applications.filter(a => a.status === 'approved').map(a => a.role), staff: staff[0] ?? null, isAdmin: profiles[0]?.role === 'admin' || Boolean(staff[0]?.permissions?.length || staff[0]?.staff_role==='super_admin') };
}

export async function saveApplication(role, details, submit = false) {
  return rpc('save_partner_application', { p_role: role, p_details: details, p_submit: submit });
}
export async function submitServicePartnerApplication(details) {
  return rpc('submit_service_partner_application', { p_details: details });
}
export async function getServicePartnerLegalDocuments() {
  return readRows('legal_documents', query => query
    .in('document_key', ['eazily-service-partner-terms', 'eazily-service-partner-privacy-policy'])
    .eq('language', 'English')
    .eq('published', true)
    .order('effective_at', { ascending: false }));
}
export async function getInfluencerTermsAcceptance(applicationId) {
  const rows = await readRows('consent_events', query => query
    .eq('partner_application_id', applicationId)
    .eq('consent_type', influencerTerms.documentId)
    .eq('version', influencerTerms.version)
    .eq('accepted', true)
    .order('recorded_at', { ascending: false })
    .limit(1));
  return rows[0] ?? null;
}
export async function acceptInfluencerTerms(applicationId) {
  return rpc('accept_influencer_terms', {
    p_application_id: applicationId,
    p_document_id: influencerTerms.documentId,
    p_version: influencerTerms.version,
  });
}
export async function startConsultantAssessment(applicationId, category, specialisation, language = 'English') {
  return rpc('start_or_resume_consultant_assessment', {
    p_application_id: applicationId,
    p_category: category,
    p_specialisation: specialisation,
    p_language: language,
  });
}
export async function saveConsultantAssessmentAnswer(attemptId, questionId, optionId) {
  return rpc('save_consultant_assessment_answer', {
    p_attempt_id: attemptId,
    p_question_id: questionId,
    p_option_id: optionId,
  });
}
export async function submitConsultantAssessment(attemptId) {
  return rpc('submit_consultant_assessment', { p_attempt_id: attemptId });
}
export async function getConsultantAssessmentEligibility(applicationId) {
  return rpc('get_consultant_assessment_eligibility', { p_application_id: applicationId });
}
export async function savePartnerPost(role, details, action = 'draft', postId = null) {
  return rpc('save_partner_post', { p_role: role, p_details: details, p_action: action, p_post_id: postId });
}
export async function saveServicePartnerPost(details, action = 'draft', postId = null, operationKey = null) {
  return rpc('save_service_partner_post', { p_details: details, p_action: action, p_post_id: postId, p_operation_key: operationKey });
}
export async function setAvailability(online) {
  return rpc('set_partner_availability', { p_online: online });
}
