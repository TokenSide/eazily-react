// Browser-only contract fixture, excluded from the application build.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AccountContext } from '../src/lib/account.js';
import ConsumerLegalCenter, { ConsumerConsentHost } from '../src/features/legal/ConsumerLegal.jsx';
import { rpc } from '../src/services/experience.js';
import '../src/styles.css';
import '../src/partner.css';

const documents = ['terms', 'privacy-policy'].map(key => ({ id: `fixture-${key}-v1`, document_key: `eazily-consumer-${key}`, version: 'fixture-v1', title: key === 'terms' ? 'Consumer Terms & Conditions' : 'Consumer Privacy Policy', kind: key === 'terms' ? 'terms' : 'privacy_policy', content: '1. TEST DOCUMENT\n\nComplete synthetic text for browser checks only.', published: true }));
window.consumerFixture = {
  documents, acceptances: [], calls: [], fail: false, stale: false,
  async rpc(name, args) {
    this.calls.push({ name, args });
    if (this.fail) return { data: null, error: { message: 'Fixture connection unavailable' } };
    if (name === 'accept_consumer_policies') {
      if (this.stale) return { data: null, error: { message: 'Consumer policies changed; review both current versions' } };
      if (!args.p_terms_accepted || !args.p_privacy_acknowledged) throw new Error('Fixture requires both explicit choices');
      for (const doc of this.documents) {
        if (!args.p_documents.some(item => item.id === doc.id && item.version === doc.version)) throw new Error('Fixture version mismatch');
        if (!this.acceptances.some(row => row.legal_document_id === doc.id)) this.acceptances.push({ id: doc.id, account_id: 'fixture-account', legal_document_id: doc.id, consent_type: doc.document_key, version: doc.version, accepted: true, recorded_at: new Date().toISOString() });
      }
    }
    return { data: name === 'submit_request' ? { id: 'fixture-booking' } : structuredClone({ documents: this.documents, acceptances: this.acceptances, required: true, accepted: this.documents.every(doc => this.acceptances.some(row => row.legal_document_id === doc.id)) }), error: null };
  },
};

export default function Fixture() {
  const [result, setResult] = useState('');
  return <AccountContext.Provider value={{ user: { id: 'fixture-account' } }}><div className="phone-shell">
    <ConsumerConsentHost />
    <main className="screen" style={{ padding: 16 }}><ConsumerLegalCenter /><button type="button" className="btn btn-outline" onClick={async () => { try { const booking = await rpc('submit_request', {}); setResult(booking.id); } catch (error) { setResult(error.message); } }}>Fixture book service</button><p id="fixture-result">{result}</p></main>
  </div></AccountContext.Provider>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
