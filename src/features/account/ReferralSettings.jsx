import { useEffect, useState } from 'react';
import { Field } from '../../components/Ui.jsx';
import { readRows, requireBackend } from '../../services/experience.js';

export default function ReferralSettings({ notify }) {
  const [config, setConfig] = useState(null);
  const [busy, setBusy] = useState(false);
  const [eligibleText, setEligibleText] = useState('');
  useEffect(() => { readRows('referral_config').then(rows => { setConfig(rows[0] || null); setEligibleText(rows[0]?.eligible_services?.join(', ') || ''); }).catch(e => notify(e.message)); }, [notify]);
  async function save(event) {
    event.preventDefault(); setBusy(true);
    try {
      const { data, error } = await requireBackend().from('referral_config').update({ ...config, eligible_services: eligibleText.split(',').map(s => s.trim()).filter(Boolean) }).eq('id', true).select().single();
      if (error || !data) throw error || new Error('An authenticated admin account is required.');
      notify('Referral settings saved');
    } catch (e) { notify(e.message); } finally { setBusy(false); }
  }
  if (!config) return <section className="admin-panel"><h2>Refer & Earn settings</h2><p>Apply the experience database migration to configure referral rewards.</p></section>;
  return <form className="admin-panel" onSubmit={save}><h2>Refer & Earn settings</h2><p>Rewards qualify after the new customer's first eligible completed paid service. Changes require an authenticated admin role.</p><label className="consent"><input type="checkbox" checked={config.enabled} onChange={e => setConfig({ ...config, enabled: e.target.checked })} /> Enable programme</label><label className="consent"><input type="checkbox" checked={config.reverse_on_refund} onChange={e => setConfig({ ...config, reverse_on_refund: e.target.checked })} /> Reverse rewards on refund</label><Field label="Eligible service names (comma separated; blank = all vendor services)" value={eligibleText} onChange={e => setEligibleText(e.target.value)} />{[['reward_amount', 'Reward amount (₹)', 0], ['minimum_payment', 'Minimum eligible payment (₹)', 1], ['redemption_percent', 'Maximum checkout percentage', 0], ['expiry_days', 'Reward expiry in days (blank = no expiry)', 1]].map(([key, label, min]) => <Field key={key} label={label} type="number" min={min} max={key === 'redemption_percent' ? 100 : undefined} step={key.includes('amount') || key === 'minimum_payment' ? '0.01' : '1'} value={config[key] ?? ''} required={key !== 'expiry_days'} onChange={e => setConfig({ ...config, [key]: e.target.value === '' ? null : Number(e.target.value) })} />)}<button className="btn btn-primary" disabled={busy}>Save referral settings</button></form>;
}
