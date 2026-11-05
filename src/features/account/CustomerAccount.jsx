import { translate } from "../../lib/translate.js";
import { useEffect, useState } from 'react';
import { BottomNav, EmptyState, Field, Sheet } from '../../components/Ui.jsx';
import Icon from '../../components/Icon.jsx';
import { getCurrentProfile } from '../../services/marketplace.js';
import { readRows, requireBackend, rpc, shareLink } from '../../services/experience.js';
import { VendorCard } from '../services/ServiceExperience.jsx';
import SupportForm from "./SupportForm.jsx";
import { setLanguage } from "../../lib/translate.js";
import { partnerRoles } from '../../data/partners.js';
import { requestSignIn, useAccount } from '../../lib/account.js';
import ProfileDetails from './ProfileDetails.jsx';
import { CustomerPartnerBookings } from '../services/PartnerOfferings.jsx';
import { sellerMemberships } from '../../lib/workspace.js';
import { UserPanelSkeleton } from '../user-motion/UserLoading.jsx';
import { useRealtime } from '../../lib/realtime.jsx';
import BulkOrders from '../bulk-orders/BulkOrders.jsx';
const profileSections = [['person', 'Account & Profile', 'Identity, photo and verified contact details'], ['location', 'Location & Addresses', 'Saved places and location permission'], ['bell', 'Notifications', 'Booking, payment and reminder preferences'], ['rupee', 'Payments', 'History, refunds and saved methods'], ['clipboard', 'Service Management', 'Upcoming, completed and cancelled'], ['settings', 'App Preferences', 'Language and appearance'], ['shield', 'Legal', 'Terms, privacy and disclosure'], ['info', 'About Eazily', 'Company, version and app sharing']];
export function ReferralCard({
  onOpen
}) {
  const [config, setConfig] = useState(null);
  useEffect(() => {
    let active = true;
    readRows('referral_config').then(rows => {
      if (active) setConfig(rows[0]);
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return <section className="refer-card"><h2>{translate("Refer & Earn")}</h2><p>{translate(config?.enabled ? `Earn ₹${config.reward_amount} after a new customer completes their first eligible paid service.` : 'Referral rewards will be available when the programme is enabled.')}</p><button className="btn btn-white" onClick={onOpen}>{translate("Refer Now")}</button></section>;
}
function ProfileAvatar({ profile }) {
  const [url, setUrl] = useState(profile?.avatar_url?.startsWith('http') ? profile.avatar_url : '');
  useEffect(() => {
    if (!profile?.avatar_url || profile.avatar_url.startsWith('http')) return;
    requireBackend().storage.from('profile-media').createSignedUrl(profile.avatar_url, 900).then(({ data }) => setUrl(data?.signedUrl || '')).catch(() => {});
  }, [profile?.avatar_url]);
  return url ? <img className="avatar" src={url} alt="" /> : <span className="profile-initial">{(profile?.full_name || 'U')[0]}</span>;
}
export default function CustomerAccount({
  notify,
  onVendor,
  onNavigate,
  initialPanel = null,
  onInitialHandled,
  account,
  onWorkspace,
  onAddRole
}) {
  const {logout}=useAccount();
  const { revision } = useRealtime();
  const [profile, setProfile] = useState(account?.profile ?? null);
  const [panel, setPanel] = useState(initialPanel);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState(null);
  const [balance, setBalance] = useState(0);
  const [code, setCode] = useState('');
  const [draft, setDraft] = useState({});
  const [address, setAddress] = useState({ label: '', address: '' });
  useEffect(() => { if (initialPanel) onInitialHandled?.(null); }, [initialPanel, onInitialHandled]);
  useEffect(() => {
    getCurrentProfile().then(current => { if (current) setProfile(current); }).catch(e => notify(e.message));
  }, [notify, revision]);
  useEffect(() => {
    let active = true;
    const tables = {
      Wallet: 'wallet_ledger',
      'My Ratings': 'my_reviews',
      'Manage Address': 'customer_addresses',
      'Manage Payment': 'customer_payment_methods',
      'Passes & Membership': 'customer_memberships',
      'Refer & Earn': 'referrals'
    };
    if (panel === 'Wallet') rpc('wallet_balance').then(value => {
      if (active) setBalance(Number(value));
    }).catch(e => {
      if (active) setError(e.message);
    });
    if (panel === 'Saved Vendors') Promise.all([readRows('saved_vendor_directory'), readRows('saved_partner_directory')]).then(([vendors, partners]) => {
      if (active) { setRows([...vendors, ...partners]); setLoading(false); }
    }).catch(e => { if (active) { setError(e.message); setLoading(false); } });
    if (tables[panel]) readRows(tables[panel]).then(data => {
      if (active) {
        setRows(data);
        setLoading(false);
      }
    }).catch(e => {
      if (active) {
        setError(e.message);
        setLoading(false);
      }
    });
    if (panel === 'Refer & Earn') readRows('referral_config').then(data => {
      if (active) setConfig(data[0]);
    }).catch(e => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [panel, revision]);
  function open(name) {
    if (!account?.user && !['App Preferences', 'Legal', 'About Eazily'].includes(name)) { requestSignIn(); return; }
    setRows([]);
    setError('');
    setLoading(true);
    setPanel(name);
  }
  async function edit(event) {
    event.preventDefault();
    try {
      const {
        error
      } = await requireBackend().from('profiles').update({
        full_name: draft.full_name,
        city: draft.city
      }).eq('id', profile.id);
      if (error) throw error;
      setProfile({
        ...profile,
        ...draft
      });
      setPanel(null);
      notify('Profile updated');
    } catch (e) {
      notify(e.message);
    }
  }
  async function referralLink() {
    try {
      setCode(await rpc('get_referral_code'));
    } catch (e) {
      notify(e.message);
    }
  }
  async function saveAddress(event) {
    event.preventDefault();
    try {
      if (!profile) throw new Error('Sign in to manage your addresses.');
      const { data, error } = await requireBackend().from('customer_addresses').insert({ ...address, customer_id: profile.id }).select().single();
      if (error) throw error;
      setRows(current => [...current, data]); setAddress({ label: '', address: '' });
      notify('Address saved');
    } catch (e) { notify(e.message); }
  }
  async function removeAddress(id) {
    try {
      const { error } = await requireBackend().from('customer_addresses').delete().eq('id', id);
      if (error) throw error;
      setRows(current => current.filter(row => row.id !== id));
    } catch (e) { notify(e.message); }
  }
  const link = code ? `${window.location.origin}${window.location.pathname}?ref=${encodeURIComponent(code)}` : '';
  function content() {
    if (panel === 'My Bookings') return <CustomerPartnerBookings notify={notify} />;
    if (profileSections.some(([, name]) => name === panel) || panel === 'Help & Support') return <ProfileDetails section={panel} profile={profile} accountId={account?.user?.id} notify={notify} onProfile={setProfile} onOpenBookings={() => open('My Bookings')} />;
    if (panel === 'Logout') return <><p>{translate("Log out of your Eazily account?")}</p><button className="btn btn-primary full" onClick={logout}>{translate("Confirm Logout")}</button><button className="btn btn-outline full" onClick={() => setPanel(null)}>{translate("Cancel")}</button></>;
    if (panel === 'Edit Profile') return profile ? <form onSubmit={edit}><Field label="Full name" value={draft.full_name || ''} onChange={e => setDraft({
        ...draft,
        full_name: e.target.value
      })} required /><Field label="Phone number" value={profile.phone || ''} readOnly /><Field label="City" value={draft.city || ''} onChange={e => setDraft({
        ...draft,
        city: e.target.value
      })} required /><button className="btn btn-primary full">{translate("Save Profile")}</button></form> : <p>{translate("Sign in with a verified phone number to edit your profile.")}</p>;
    if (panel === 'Help & Support') return <><p>{translate("Open a booking to review its status and request help.")}</p><button className="btn btn-outline full" onClick={() => open('My Bookings')}>{translate("My Bookings")}</button><SupportForm notify={notify} /></>;
    if (panel === 'About Eazily') return <p>{translate("Eazily connects customers with local service providers. Compare professionals and confirm the scope and charges before booking.")}</p>;
    if (panel === 'Settings') return <Field label="Language / भाषा" as="select" options={['English', 'हिन्दी']} value={localStorage.getItem('eazily-language') || 'English'} onChange={e => {
      setLanguage(e.target.value);
      notify('Language preference saved');
    }} />;
    if (panel === 'Refer & Earn') return <><p>{translate(config?.enabled ? `Reward: ₹${config.reward_amount}. Credited after the referred new customer completes their first eligible paid service.` : 'The referral programme is not enabled yet.')}</p>{translate(config?.enabled && <><p>{translate("Minimum eligible payment: \u20B9 ")}{translate(config.minimum_payment)}{translate(" . ")}{translate(config.expiry_days ? `Rewards expire after ${config.expiry_days} days.` : 'No reward expiry.')}{translate(" Up to ")}{translate(config.redemption_percent)}{translate(" % of an eligible checkout can be paid with wallet credit. Wallet rewards cannot be withdrawn as cash.")}</p><p>{config.reverse_on_refund ? 'Rewards reverse when the qualifying service is refunded.' : 'Credited rewards are retained if the qualifying service is refunded.'} Eligible services: {config.eligible_services?.join(', ') || 'All vendor services'}. Cancelled booking wallet credits are returned with the current programme expiry.</p><button className="btn btn-primary" onClick={referralLink}>{translate("Get my referral link")}</button>{translate(code && <><h3>{translate(code)}</h3><input className="field" readOnly value={link} aria-label="Referral link" /><div className="review-actions"><button className="btn btn-primary" onClick={() => shareLink(link, notify)}>{translate("Share")}</button><button className="btn btn-outline" onClick={() => shareLink(link, notify, true)}>{translate("Copy Link")}</button></div></>)}</>)}<h3>{translate("Referral status & earned rewards")}</h3>{translate(rows.map(r => <article className="review-item" key={r.id}><b>{translate(r.status)}</b><p>{translate("\u20B9 ")}{translate(r.reward_amount)}{translate(" \xB7 ")}{translate(new Date(r.created_at).toLocaleDateString())}</p></article>))}{translate(!rows.length && <p>{translate("No referrals yet.")}</p>)}</>;
    if (loading) return <UserPanelSkeleton />;
    if (error) return <p role="alert">{translate("Unable to load this information: ")}{translate(error)}</p>;
    if (panel === 'Manage Address') return <><form onSubmit={saveAddress}><Field label="Address label" value={address.label} onChange={e => setAddress({ ...address, label: e.target.value })} required /><Field label="Address" as="textarea" value={address.address} onChange={e => setAddress({ ...address, address: e.target.value })} required /><button className="btn btn-primary full">{translate('Save address')}</button></form>{rows.map(row => <article className="review-item" key={row.id}><b>{row.label}</b><p>{row.address}</p><button className="btn btn-outline" onClick={() => removeAddress(row.id)}>{translate('Remove')}</button></article>)}</>;
    if (panel === 'Wallet') return <><h3>{translate("Available balance: \u20B9 ")}{translate(balance.toFixed(2))}</h3><p>{translate("Eligible credit can be used at your next checkout. Rewards are not cash withdrawals.")}</p><h3>{translate("Transaction history")}</h3>{translate(rows.map(r => <article className="review-item" key={r.id}><b>{translate("\u20B9 ")}{translate(r.amount)}{translate(" \xB7 ")}{translate(r.kind)}</b><small>{translate(new Date(r.created_at).toLocaleDateString())}</small>{translate(r.expires_at && <p>{translate("Expires ")}{translate(new Date(r.expires_at).toLocaleDateString())}</p>)}</article>))}{translate(!rows.length && <p>{translate("No wallet transactions yet.")}</p>)}</>;
    if (!rows.length) return <EmptyState title="No records yet" text="Your account information will appear here when available." />;
    if (panel === 'Saved Vendors') return rows.map(v => <VendorCard key={v.id} vendor={v} onOpen={() => onVendor(v)} />);
    return rows.map(r => <article className="review-item" key={r.id}><b>{translate(r.service_name || r.label || r.name || r.brand)}</b><p>{translate(r.review_text || r.address || r.status || (r.last_four ? `•••• ${r.last_four}` : ''))}</p>{translate(r.rating && <p>{translate(r.rating)}{translate(" / 5")}</p>)}{translate(r.created_at && <small>{translate(new Date(r.created_at).toLocaleDateString())}</small>)}</article>);
  }
  if (panel === 'Bulk Orders') return <BulkOrders profile={profile} accountId={account?.user?.id} onBack={() => setPanel(null)} />;
  return <main className="screen customer-account"><header className="topbar"><h1>{translate("My Profile")}</h1></header><section className="account-header"><ProfileAvatar profile={profile} /><div><h2>{translate(profile?.full_name || 'Your account')}</h2><p>{translate(profile?.phone || 'Sign in to see your phone number')}</p></div><button className="link" onClick={() => {
        setDraft(profile || {});
        open('Account & Profile');
    }}>{translate(profile ? "Edit Profile" : 'Sign In')}</button></section>{sellerMemberships(account || {}).length || account?.isAdmin ? <section className="workspace-switch"><h3>Workspaces</h3>{sellerMemberships(account).map(role=><button key={role} onClick={()=>onWorkspace(role)}>Switch to {partnerRoles[role].label}</button>)}{account.isAdmin&&<button onClick={()=>onWorkspace('admin')}>Admin workspace</button>}<button onClick={onAddRole}>Add another partner role</button></section> : <section className="workspace-switch"><button onClick={onAddRole}>Join as an Eazily Partner</button></section>}{translate(profile && (!profile.full_name || !profile.phone || !profile.city) && <button className="complete-profile" onClick={() => {
      setDraft(profile);
      open('Account & Profile');
    }}>{translate("Complete Profile \u2192")}</button>)}<section className="account-shortcuts">{translate([['clipboard', 'My Bookings'], ['person', 'Saved Vendors'], ['message', 'Help & Support']].map(([icon, name]) => <button key={name} onClick={() => open(name)}><Icon name={icon} /><b>{translate(name)}</b></button>))}</section><section className="profile-list profile-sections">{translate(profileSections.map(([icon, name]) => <button className="choice" key={name} onClick={() => open(name)}><span><Icon name={icon} />{translate(name)}</span><Icon name="chevronRight" /></button>))}</section><ReferralCard onOpen={() => open('Refer & Earn')} /><button className="btn btn-outline profile-logout" onClick={() => open('Logout')}>Logout</button><BottomNav route="profile" onChange={onNavigate} />{translate(panel && <Sheet onClose={() => setPanel(null)}><h2 className="sheet-title">{translate(panel)}</h2>{translate(content())}</Sheet>)}</main>;
}









