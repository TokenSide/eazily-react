import { useEffect, useState } from 'react';
import { readRows, requireBackend, rpc } from '../../services/experience.js';
import { Field } from '../../components/Ui.jsx';

const documentFields = [['aadhaar', 'Identity document'], ['pan', 'PAN'], ['gumasta', 'Shop registration'], ['udyam', 'MSME / Udyam'], ['ownerShopMedia', 'Owner and shop photo']];

function DocumentRow({ file, label }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true;
    requireBackend().storage.from('partner-media').createSignedUrl(file.path, 300)
      .then(({ data }) => { if (active) setUrl(data?.signedUrl || ''); }).catch(() => {});
    return () => { active = false; };
  }, [file.path]);
  return <p>{label}: {url ? <a href={url} target="_blank" rel="noreferrer">Open private document</a> : 'Private preview unavailable'}</p>;
}

export default function ServiceDocumentReviewAdmin({ applications, notify }) {
  const [verified, setVerified] = useState({});
  const [references, setReferences] = useState({});
  const [confirmed, setConfirmed] = useState({});
  const [busy, setBusy] = useState(null);
  useEffect(() => { let active = true; readRows('service_document_verifications').then(rows => {
    if (active) setVerified(Object.fromEntries(rows.map(row => [row.partner_id, row.verified_at])));
  }).catch(() => {}); return () => { active = false; }; }, [applications]);
  async function verify(application) {
    if (busy || !confirmed[application.id]) return;
    setBusy(application.id);
    try {
      await rpc('admin_verify_service_documents', { p_partner: application.id, p_review_reference: references[application.id] || '' });
      const rows = await readRows('service_document_verifications', query => query.eq('partner_id', application.id));
      setVerified(current => ({ ...current, [application.id]: rows[0]?.verified_at }));
      notify('Service Partner document verification recorded.');
    } catch (error) { notify(error.message); } finally { setBusy(null); }
  }
  const partners = applications.filter(application => application.role === 'professional' && application.status === 'approved');
  return <section className="admin-panel"><h2>Service Partner document review</h2><p>Approval alone does not create a document-verified badge. Open and check the private documents before recording verification.</p>{partners.map(application => {
    const documents = documentFields.flatMap(([key, label]) => (Array.isArray(application.details?.[key]) ? application.details[key] : []).filter(file => file?.path).map(file => ({ file, label })));
    return <article className="admin-record" key={application.id}><b>{application.details?.businessName || application.details?.name || application.id}</b><p>{verified[application.id] ? `Documents verified ${new Date(verified[application.id]).toLocaleString('en-IN')}` : 'Document verification pending'}</p>{documents.map(({ file, label }) => <DocumentRow key={file.path} file={file} label={label} />)}{!documents.length && <p>No submitted documents available for review.</p>}<Field label="Document review reference" value={references[application.id] || ''} onChange={event => setReferences(current => ({ ...current, [application.id]: event.target.value }))}/><label><input type="checkbox" checked={Boolean(confirmed[application.id])} onChange={event => setConfirmed(current => ({ ...current, [application.id]: event.target.checked }))}/> I reviewed the submitted documents</label><button type="button" disabled={!documents.length || !confirmed[application.id] || (references[application.id] || '').trim().length < 8 || Boolean(busy)} onClick={() => verify(application)}>Record document verification</button></article>;
  })}{!partners.length && <p>No approved Service Partner applications to review.</p>}</section>;
}
