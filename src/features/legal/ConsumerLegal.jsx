import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sheet } from '../../components/Ui.jsx';
import { useAccount } from '../../lib/account.js';
import { isSupabaseConfigured } from '../../lib/supabase.js';
import { acceptConsumerPolicies } from '../../services/consumerConsent.js';
import { LegalDocument } from '../partners/legal/InfluencerLegal.jsx';
import { consumerDraftNotice, consumerDrafts } from './consumerDocuments.js';
import { useConsumerLegal } from './useConsumerLegal.js';
import './consumer-legal.css';

function PolicySheet({ document, onClose }) {
  return <Sheet className="influencer-legal-sheet consumer-policy-sheet" onClose={onClose}>
    <h1 id={`legal-title-${document.document_key}`}>{document.title}</h1>
    {!document.published && <p className="testing-notice">{consumerDraftNotice}</p>}
    <LegalDocument document={{ ...document, key: document.document_key, documentId: document.document_key }} />
    <button type="button" className="btn btn-outline legal-close-button" onClick={onClose}>Close policy</button>
  </Sheet>;
}

export function ConsumerLegalLinks() {
  const state = useConsumerLegal();
  const [open, setOpen] = useState(null);
  const documents = state.documents.length === 2 ? state.documents : consumerDrafts;
  return <div className="consumer-legal-links">
    {documents.map(doc => <button className="link" type="button" key={doc.document_key} onClick={() => setOpen(doc)}>{doc.title}{!doc.published && ' (draft)'}</button>)}
    {state.error && <small>Approved policies could not be loaded. Draft previews remain available.</small>}
    {open && <PolicySheet document={open} onClose={() => setOpen(null)} />}
  </div>;
}

export function ConsumerPolicyPage({ kind }) {
  const state = useConsumerLegal();
  const document = state.documents.find(doc => doc.kind === kind) || consumerDrafts.find(doc => doc.kind === kind);
  return <main className="screen consumer-policy-page">
    <a className="btn btn-outline" href="/">Back to Eazily</a>
    <h1 id={`legal-title-${document.document_key}`}>{document.title}</h1>
    {!document.published && <p className="testing-notice">{consumerDraftNotice}</p>}
    {state.error && <p role="alert">Approved policies could not be loaded. This is a source draft preview.</p>}
    <LegalDocument document={{ ...document, key: document.document_key, documentId: document.document_key }} />
    <a href={kind === 'terms' ? '/privacy' : '/terms'}>{kind === 'terms' ? 'Consumer Privacy Policy' : 'Consumer Terms & Conditions'}</a>
  </main>;
}

export default function ConsumerLegalCenter({ reviewOnly = false, onDone }) {
  const { user } = useAccount();
  const state = useConsumerLegal();
  const [open, setOpen] = useState(null);
  const [checks, setChecks] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const documents = reviewOnly || state.documents.length !== 2 ? consumerDrafts : state.documents;
  const versions = documents.map(doc => `${doc.id}:${doc.version}`).join('|');
  const ready = !reviewOnly && Boolean(user) && isSupabaseConfigured && state.required && !state.loading && !state.error;
  useEffect(() => { setChecks({}); setError(''); }, [versions, user?.id]);
  async function accept() {
    if (!ready || !checks.terms || !checks.privacy || busy) return;
    setBusy(true); setError('');
    try {
      await acceptConsumerPolicies(documents, checks.terms, checks.privacy);
      setChecks({}); await state.refresh(); onDone?.();
    } catch (failure) {
      setChecks({}); await state.refresh(); setError(failure.message);
    } finally { setBusy(false); }
  }
  return <section className="consumer-legal-center">
    <h2>Consumer policies</h2>
    {(!state.required || reviewOnly) && <p className="testing-notice">{consumerDraftNotice} Viewing these drafts does not record consent.</p>}
    <div className="legal-actions">{documents.map(doc => <button type="button" className="btn btn-outline" key={doc.document_key} onClick={() => setOpen(doc)}>{doc.title}{!doc.published && ' (draft)'}</button>)}</div>
    {!reviewOnly && <>
      {state.loading && <p role="status">Checking policy versions…</p>}
      {state.accepted && ready ? <p role="status">Your current Terms acceptance and Privacy Policy acknowledgment are recorded.</p> : <>
        <p>You can sign in, browse and read the policies without accepting them. Once approved policies are available, acknowledge both to complete customer onboarding before booking or starting a transaction.</p>
        <label className="consent"><input name="consumerTermsAccepted" type="checkbox" disabled={!ready || busy} checked={checks.terms === true} onChange={event => setChecks(current => ({ ...current, terms: event.target.checked }))} /> I have read and agree to the Consumer Terms &amp; Conditions.</label>
        <label className="consent"><input name="consumerPrivacyAcknowledged" type="checkbox" disabled={!ready || busy} checked={checks.privacy === true} onChange={event => setChecks(current => ({ ...current, privacy: event.target.checked }))} /> I have read and acknowledge the Consumer Privacy Policy.</label>
        <button type="button" className="btn btn-primary" disabled={!ready || !checks.terms || !checks.privacy || busy} onClick={accept}>{busy ? 'Recording acknowledgment…' : 'Save acknowledgment'}</button>
      </>}
      {(state.error || error) && <div role="alert"><p>{state.error || error}</p><button type="button" className="btn btn-outline" onClick={() => { setError(''); state.refresh(); }}>Retry policies</button></div>}
      {state.acceptances.length > 0 && <details><summary>Your policy acknowledgment history</summary>{state.acceptances.map(record => <p className="consumer-consent-record" key={record.id}>{record.consent_type} · Version {record.version}<br />Server-recorded: {new Date(record.recorded_at).toLocaleString('en-IN')}</p>)}</details>}
    </>}
    {open && <PolicySheet document={open} onClose={() => setOpen(null)} />}
  </section>;
}

export function ConsumerConsentHost() {
  const { user } = useAccount();
  const state = useConsumerLegal();
  const refresh = state.refresh;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const request = () => { setOpen(true); refresh(); };
    window.addEventListener('eazily-consumer-consent-required', request);
    return () => window.removeEventListener('eazily-consumer-consent-required', request);
  }, [refresh]);
  if (!user) return null;
  return <>
    {state.required && !state.accepted && <aside className="consumer-consent-banner"><b>Complete your customer policy acknowledgment</b><p>Review both policies before your next booking or transaction.</p><button type="button" className="btn btn-outline" onClick={() => setOpen(true)}>Review Consumer policies</button></aside>}
    {open && createPortal(<Sheet className="consumer-policy-sheet" onClose={() => setOpen(false)}><ConsumerLegalCenter onDone={() => setOpen(false)} /><button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>Continue browsing</button></Sheet>, document.body)}
  </>;
}
