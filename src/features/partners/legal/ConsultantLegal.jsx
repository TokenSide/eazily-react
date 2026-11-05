import { useEffect, useState } from 'react';
import { Sheet } from '../../../components/Ui.jsx';
import { isSupabaseConfigured } from '../../../lib/supabase.js';
import { rpc } from '../../../services/experience.js';
import { LegalDocument } from './InfluencerLegal.jsx';
import { consultantDrafts, consultantDraftNotice } from './consultantLegal.js';
import './influencer-legal.css';

export default function ConsultantLegal({ application, onAccepted, onEligibilityChange, reviewOnly = false }) {
  const [state, setState] = useState({ documents: [], acceptances: [], loading: isSupabaseConfigured, error: '' });
  const [checks, setChecks] = useState({});
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  async function refresh() {
    if (!isSupabaseConfigured || reviewOnly) return;
    const result = await rpc('get_consultant_legal_status', { p_application_id: application?.id || null });
    setState({ ...result, loading: false, error: '' });
    setChecks({});
  }
  useEffect(() => {
    let active = true;
    if (!isSupabaseConfigured || reviewOnly) return undefined;
    const load = () => rpc('get_consultant_legal_status', { p_application_id: application?.id || null })
      .then(result => { if (active) { setState({ ...result, loading: false, error: '' }); setChecks({}); } })
      .catch(error => { if (active) setState({ documents: [], acceptances: [], loading: false, error: error.message }); });
    load();
    window.addEventListener('focus', load);
    return () => { active = false; window.removeEventListener('focus', load); };
  }, [application?.id, reviewOnly]);
  const documents = state.documents.length === 2 ? state.documents : consultantDrafts;
  const ready = !reviewOnly && isSupabaseConfigured && state.documents.length === 2 && !state.loading && !state.error;
  const accepted = ready && documents.every(doc => state.acceptances.some(record => record.consent_type === doc.document_key && record.version === doc.version && record.accepted));
  useEffect(() => { onEligibilityChange?.(accepted); }, [accepted, onEligibilityChange]);
  async function accept() {
    if (!ready || !application?.id || !checks.terms || !checks.privacy) return;
    setBusy(true);
    try {
      await rpc('accept_consultant_policies', { p_application_id: application.id, p_documents: documents.map(doc => ({ id: doc.id, version: doc.version })), p_terms_accepted: checks.terms === true, p_privacy_acknowledged: checks.privacy === true });
      await refresh();
      onAccepted?.();
    } catch (error) {
      setChecks({});
      setState(current => ({ ...current, error: error.message }));
    } finally { setBusy(false); }
  }
  return <section className="consultant-legal-center">
    <h2>Consultant policies</h2>
    {!ready && <p className="testing-notice" role="status">{reviewOnly || !state.documents.length ? consultantDraftNotice : 'Policies are unavailable. Retry before continuing.'} {reviewOnly ? 'Publication is blocked pending complete, approved text.' : 'You can save your draft. New onboarding and service offers require approved policies.'}</p>}
    {state.loading && !reviewOnly && <p role="status">Checking approved policies…</p>}
    <div className="legal-actions">{documents.map(doc => <button type="button" className="btn btn-outline" key={doc.document_key} onClick={() => setOpen(doc)}>{doc.title}{!doc.published ? ' — Draft preview' : ''}</button>)}</div>
    {accepted ? <p role="status">Current Consultant Terms accepted and Privacy Policy acknowledged.</p> : !reviewOnly && <>
      <label className="consent"><input name="consultantTermsAccepted" type="checkbox" disabled={!ready || busy} checked={checks.terms === true} onChange={event => setChecks(current => ({ ...current, terms: event.target.checked }))} /> I have read and agree to the Consultant Terms &amp; Conditions.</label>
      <label className="consent"><input name="consultantPrivacyAcknowledged" type="checkbox" disabled={!ready || busy} checked={checks.privacy === true} onChange={event => setChecks(current => ({ ...current, privacy: event.target.checked }))} /> I have read and acknowledge the Consultant Privacy Policy.</label>
      <button type="button" className="btn btn-primary" disabled={!ready || !application?.id || !checks.terms || !checks.privacy || busy} onClick={accept}>{busy ? 'Saving…' : 'Save policy acknowledgment'}</button>
    </>}
    {state.acceptances.map(record => <p className="legal-record" key={record.id}>{record.consent_type} · Version {record.version} · Server-recorded date: {new Date(record.recorded_at).toLocaleString('en-IN')}</p>)}
    {state.error && <div role="alert"><p>{state.error}</p><button type="button" className="btn btn-outline" onClick={() => refresh().catch(error => setState(current => ({ ...current, error: error.message })))}>Retry policies</button></div>}
    {open && <Sheet className="influencer-legal-sheet consultant-legal-sheet" onClose={() => setOpen(null)}>
      <h1 id={`legal-title-${open.document_key}`}>{open.title}</h1>{!open.published && <p className="testing-notice">{consultantDraftNotice}</p>}
      <LegalDocument document={{ ...open, key: open.document_key, documentId: open.document_key }} />
      <button type="button" className="btn btn-outline legal-close-button" onClick={() => setOpen(null)}>Close</button>
    </Sheet>}
  </section>;
}
