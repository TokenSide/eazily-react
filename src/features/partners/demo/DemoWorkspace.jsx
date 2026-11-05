import { useReducer, useRef, useState } from 'react';
import PartnerDashboard, { DashboardTopBar } from '../PartnerDashboard.jsx';
import Icon from '../../../components/Icon.jsx';
import { displayConsultantCategory } from '../../../data/consultantCategories.js';
import { createDemoState, profiles, roles } from './fixtures.js';
import { demoReducer, demoTotal, leadStatus } from './model.js';
import CustomerDemo from './CustomerDemo.jsx';
import './demo.css';

const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value || 0);
const labels = { professional: 'Service Partner', influencer: 'Influencer Partner', consultant: 'Consultation Partner' };
const workTitles = { professional: 'Service jobs', influencer: 'Collaborations', consultant: 'Appointments' };
const nav = [['home', 'home', 'Home'], ['messages', 'message', 'Messages'], ['post', 'plus', 'Post'], ['orders', 'clipboard', 'My Orders'], ['profile', 'person', 'Profile']];
const limits = {
  professional: 'Service jobs support accept/reject, arrival verification, a final quote, and customer approval, payment and completion. Payout release is not automatic; a simulated service payment stays pending.',
  influencer: 'Enquiries support accept/reject. The seller app has no connected start-campaign or submit-deliverable control. Try the separate Dessert launch story prepaid sample for existing payment, trusted scope confirmation, customer completion and hold-release behavior. These trusted events are simulations, not seller permissions.',
  consultant: 'Requests support accept/reject. The seller app has no connected start-session or finish-session control. A separately seeded five-minute introduction is ready for customer completion. Paid consultation checkout is not connected here; no consultation charge or payout is simulated.',
};

export default function DemoWorkspace({ initialRole, onExit }) {
  const [customer, setCustomer] = useState(initialRole === 'customer');
  return customer
    ? <CustomerDemo onPartner={() => setCustomer(false)} onExit={onExit} />
    : <PartnerDemoWorkspace initialRole={initialRole === 'customer' ? 'professional' : initialRole} onCustomer={() => setCustomer(true)} onExit={onExit} />;
}

function PartnerDemoWorkspace({ initialRole, onCustomer, onExit }) {
  const [state, dispatch] = useReducer(demoReducer, undefined, createDemoState);
  const [role, setRole] = useState(initialRole), [view, setView] = useState(initialRole === 'consultant' ? 'assessment' : 'home'), [orderId, setOrderId] = useState(''), [filter, setFilter] = useState('all');
  const selector = useRef(null), main = useRef(null);
  const ws = state.workspaces[role], profile = profiles[role];
  const send = (type, payload = {}) => dispatch({ type, role, ...payload });
  const go = destination => { setView(destination); setOrderId(''); dispatch({ type: 'dismiss' }); window.scrollTo(0, 0); main.current?.focus(); };
  const open = id => { setView('detail'); setOrderId(id); dispatch({ type: 'dismiss' }); window.scrollTo(0, 0); main.current?.focus(); };
  const sheet = value => {
    if (value?.order) return open(value.order.id);
    if (value === 'workspace') { selector.current?.scrollIntoView({ block: 'center' }); selector.current?.focus(); return; }
    go(value === 'My Leads' ? 'orders' : value);
  };
  const selected = ws.orders.find(order => order.id === orderId);
  const name = profile.businessName || profile.creatorName || profile.name;
  return <div className={`partner-workspace partner-dashboard-home-view demo-workspace role-${role}`} style={{ '--pd-accent': '#7C3AED' }}>
    <main className="screen partner-screen">
      <DashboardTopBar role={role} name={name} greeting="Welcome" notifications={ws.notifications.filter(n => !n.read_at).length} setRoute={go} setSheet={sheet} />
      <div className="seller-content">
        <details className="demo-controls">
          <summary><Icon name="shield" size={16} /><span>Demo Mode · sample data, no real bookings or payments</span><Icon name="chevronDown" size={16} className="demo-chev" /></summary>
          <div className="demo-controls-body">
          <p>Fictional profiles, local actions. Exit any time to return to your actual account.</p>
          <label>Demo partner type<select ref={selector} value={role} onChange={e => { setRole(e.target.value); setView(e.target.value === 'consultant' ? 'assessment' : 'home'); setOrderId(''); setFilter('all'); dispatch({ type: 'dismiss' }); }}>{roles.map(r => <option key={r} value={r}>{labels[r]}</option>)}</select></label>
          <div className="demo-control-grid"><button className="demo-primary" onClick={() => send('lead')}><Icon name="plus" size={18} />Simulate New Lead</button><button onClick={() => { send('reset'); setView('home'); setOrderId(''); setFilter('all'); }}>Reset Demo Data</button><button onClick={onCustomer}>Customer preview</button><button onClick={onExit}>Exit Demo Mode</button><button onClick={() => go('guide')}>Demo guide & limits</button></div>
          </div>
        </details>
        {(state.notice || state.error) && <div className={`demo-feedback ${state.error ? 'demo-error' : ''}`} role={state.error ? 'alert' : 'status'}><p>{state.error || state.notice}</p><button aria-label="Dismiss demo notification" onClick={() => send('dismiss')}><Icon name="close" size={18} /></button></div>}
        <div ref={main} tabIndex={-1} className="demo-content">
          {view !== 'home' && view !== 'assessment' && <button className="demo-back" onClick={() => go('home')}>← Demo dashboard</button>}
          {view === 'home' ? <PartnerDashboard demo role={role} profile={profile} approved application={{ status: 'approved' }} data={ws} online={ws.online} busy={false} trial={null} setRoute={go} setSheet={sheet} act={fn => fn()} setAvailability={async online => ({ online })} setOnline={value => send('online', { value })} total={status => demoTotal(ws, status)} money={money} onEditRegistration={() => go('profile')} />
            : view === 'assessment' && role === 'consultant' ? <section className="demo-stack"><span className="demo-badge">Demo assessment · no real pass or approval</span><DemoConsultantAssessment onSkip={() => go('home')} /></section>
            : view === 'detail' && selected ? <DemoOrder key={selected.id} order={selected} send={(type, payload) => send(type, { orderId: selected.id, ...payload })} onMessage={() => setView('conversation')} />
            : view === 'orders' ? <section className="demo-stack"><h2>{workTitles[role]} · {ws.orders.length} samples</h2><label>Sample status<select value={filter} onChange={e => setFilter(e.target.value)}>{['all', 'requested', 'accepted', 'active', 'awaiting_acceptance', 'completed', 'cancelled'].map(status => <option key={status}>{status}</option>)}</select></label>{ws.orders.filter(o => filter === 'all' || o.status === filter).map(order => <WorkCard key={order.id} order={order} open={open} />)}</section>
            : view === 'messages' || view === 'conversation' ? <section className="demo-stack"><h2>Local mock conversations</h2><p>Messages are saved only in this demo session. No customer is contacted.</p><label>Sample conversation<select value={orderId} onChange={e => setOrderId(e.target.value)}><option value="">Choose sample work</option>{ws.orders.map(o => <option value={o.id} key={o.id}>{o.title} · {o.customer_name}</option>)}</select></label>{selected && <Conversation key={selected.id} order={selected} send={body => send('message', { orderId: selected.id, body })} />}</section>
            : view === 'profile' ? <section className="partner-profile-page" aria-label="Profile screen (demo)">
              <section className="partner-profile-hero"><div className="partner-profile-avatar">{name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'D'}</div><div className="partner-profile-copy"><h2>{name}</h2><p>{[profile.category, profile.city].filter(Boolean).join(' • ')}</p><div className="partner-profile-status"><span className="application-state approved"><Icon name="check" size={13} />Verified in demo only</span></div></div></section>
              <p className="profile-private-note">Fictional {labels[role].toLowerCase()} profile. Registration complete • Documents fictional • No bank account or real contact details.</p>
              <section className="profile-menu-group"><h3>My Work</h3><div className="profile-menu-card">
                <button className="profile-menu-row" onClick={() => go('post')}><span className="profile-menu-icon"><Icon name="megaphone" size={19} /></span><span>Sample services & posts</span><Icon name="chevronRight" size={18} /></button>
                <button className="profile-menu-row" onClick={() => go('orders')}><span className="profile-menu-icon"><Icon name="clipboard" size={19} /></span><span>{workTitles[role]} (samples)</span><Icon name="chevronRight" size={18} /></button>
                <button className="profile-menu-row" onClick={() => go('messages')}><span className="profile-menu-icon"><Icon name="message" size={19} /></span><span>Mock conversations</span><Icon name="chevronRight" size={18} /></button>
              </div></section>
              <section className="profile-menu-group"><h3>Money & Membership</h3><div className="profile-menu-card">
                <button className="profile-menu-row" onClick={() => go('Earnings')}><span className="profile-menu-icon"><Icon name="rupee" size={19} /></span><span>Demo earnings</span><Icon name="chevronRight" size={18} /></button>
              </div></section>
              <section className="profile-menu-group"><h3>Account & Support</h3><div className="profile-menu-card">
                <button className="profile-menu-row" onClick={() => go('Notifications')}><span className="profile-menu-icon"><Icon name="bell" size={19} /></span><span>Demo notifications</span><Icon name="chevronRight" size={18} /></button>
                <button className="profile-menu-row" onClick={() => go('guide')}><span className="profile-menu-icon"><Icon name="shield" size={19} /></span><span>Demo guide & limits</span><Icon name="chevronRight" size={18} /></button>
              </div></section>
              <section className="profile-account-actions"><button className="profile-menu-row" onClick={onCustomer}><span className="profile-menu-icon"><Icon name="home" size={19} /></span><span>Customer preview</span><Icon name="chevronRight" size={18} /></button></section>
              <section className="profile-account-actions"><button className="profile-menu-row profile-logout-row" onClick={onExit}><span className="profile-menu-icon logout"><Icon name="logout" size={19} /></span><span>Exit Demo Mode</span><Icon name="chevronRight" size={18} /></button></section>
              <p className="profile-private-note">Editing registration, verification documents, or account settings is unavailable inside the demo. Exit to use your original screens.</p>
            </section>
            : view === 'post' ? <section className="demo-stack"><h2>Sample services & posts</h2><p>Read-only examples. Creating, editing, uploading and publishing use your original posting flow after you exit Demo Mode.</p>{ws.posts.map(post => <article className="pd-card" key={post.id}><span className="demo-badge">Sample published post</span><h3>{post.details.title}</h3><p>{profile.category} · Bhopal</p></article>)}</section>
            : view === 'Earnings' || view === 'Payment History' ? <section className="demo-stack"><h2>Demo earnings</h2><p>Sample balances only. No withdrawal or real wallet access.</p>{['available', 'pending', 'security_hold', 'paid', 'reversed'].map(status => <div className="demo-money" key={status}><span>{status.replaceAll('_', ' ')}</span><b>{money(demoTotal(ws, status))}</b></div>)}{ws.earnings.map(e => <button key={e.id} onClick={() => open(e.order_id)}>{ws.orders.find(o => o.id === e.order_id)?.title}<br />{money(e.amount)} · {e.state.replaceAll('_', ' ')}</button>)}{!ws.earnings.length && <p>No simulated payments yet.</p>}</section>
            : view === 'Notifications' ? <section className="demo-stack"><h2>Demo notifications</h2><button onClick={() => send('read')}>Mark demo notifications read</button>{ws.notifications.map(n => <button key={n.id} onClick={() => { send('read', { id: n.id }); if (n.order_id) { setOrderId(n.order_id); setView('detail'); } }}>{n.title}<br /><small>{n.read_at ? 'Read' : 'Unread'}</small></button>)}</section>
            : view === 'guide' ? <section className="demo-stack"><h2>Try your partner journey</h2><p>{limits[role]}</p><ol><li>Open a request under My Orders. Accept it or reject it with a reason.</li><li>Open its mock conversation and send a demo message.</li><li>For a service job, use arrival code <b>246810</b>, send the sample final quote, then simulate customer approval, payment and completion.</li><li>For an influencer, open the <b>Dessert launch story</b> prepaid sample. Simulate payment, trusted scope confirmation, customer completion and trusted hold release.</li><li>For a consultant, open the <b>Five-minute career introduction</b> sample and simulate customer completion.</li><li>Check Earnings and Notifications. Reset affects all three demo roles only.</li></ol><h3>Sample pricing</h3><p>Service calculations use the existing database test configuration: ₹100–₹1,000 has 25% markup; above ₹1,000 has 12%; tax and separate fees are zero in this test fixture. Real pricing is not enabled or changed.</p><p>Influencer samples use repository defaults: 10% platform fee, then 70% of partner payout pending and 30% held after simulated scope confirmation. Only the held amount becomes available after simulated trusted release. No automatic 72-hour release is fabricated.</p><p>Consultation sample amounts are illustrative enquiries. No admin rate or paid checkout is invented. The free introduction sample is five minutes.</p></section>
            : <section className="demo-stack"><h2>{view}</h2><p>This feature is unavailable in the isolated demo. Exit Demo Mode to use its existing real-account screen. No support ticket, reward, subscription or external action has been created.</p></section>}
        </div>
      </div>
      <DemoBottomNav route={['detail', 'conversation'].includes(view) ? view === 'detail' ? 'orders' : 'messages' : view} onChange={go} />
    </main>
  </div>;
}

function DemoConsultantAssessment({ onSkip }) {
  return <section className="consultant-assessment">
    <h3>{displayConsultantCategory('Career')} · Career Guidance</h3>
    <p className="testing-notice" role="status">Assessment unavailable: Demo assessment uses sample data only. Skip for now opens the sample consultant dashboard without recording a pass.</p>
    <p>Your registration progress is preserved. Unrelated questions will not be substituted.</p>
    <div className="assessment-test-skip"><small>Testing only</small><button type="button" className="btn btn-outline" onClick={onSkip}>Skip for now</button></div>
  </section>;
}

function DemoBottomNav({ route, onChange }) {
  return <nav className="bottom-nav" aria-label="Demo navigation">{nav.map(([id, icon, label]) => <button type="button" key={id} className={`nav-item ${route === id ? 'active' : ''} ${id === 'post' ? 'post-nav' : ''}`} onClick={() => onChange(id)}><span className="nav-icon"><Icon name={icon} size={id === 'post' ? 26 : 19} /></span>{label}</button>)}</nav>;
}

function WorkCard({ order, open }) {
  return <article className="pd-card demo-stack"><span className="demo-badge">Sample · {order.status.replaceAll('_', ' ')}</span><h3>{order.title}</h3><p>{order.customer_name} · {order.location}</p><p>{new Date(order.deadline).toLocaleString('en-IN')}</p><p>{money(order.amount)} {order.role === 'professional' ? 'sample service price, before final quote' : order.role === 'influencer' ? 'sample package amount' : order.freeIntro ? 'free introduction' : 'illustrative enquiry amount'}</p><button onClick={() => open(order.id)}>Open sample details</button></article>;
}

function Conversation({ order, send }) {
  const [body, setBody] = useState('');
  return <><article className="pd-card"><b>{order.customer_name} (fictional)</b><p>Sample conversation about {order.title.toLowerCase()}. There is no live recipient or automatic reply.</p></article>{order.messages.map(message => <article className="pd-card" key={message.id}><b>{message.sender}</b><p>{message.body}</p><small>{new Date(message.at).toLocaleString('en-IN')}</small></article>)}<form className="demo-stack" onSubmit={e => { e.preventDefault(); if (body.trim()) { send(body); setBody(''); } }}><label>Demo message<textarea required maxLength={4000} value={body} onChange={e => setBody(e.target.value)} /></label><button className="demo-primary">Send demo message</button></form></>;
}

function DemoOrder({ order, send, onMessage }) {
  const [reason, setReason] = useState(''), [code, setCode] = useState('');
  const q = order.quote;
  return <section className="demo-stack">
    <span className="demo-badge">Sample · {order.status.replaceAll('_', ' ')}</span><h2>{order.title}</h2><p>{order.customer_name} · {order.location}</p><p>{new Date(order.deadline).toLocaleString('en-IN')}</p><p>{order.details.description}</p>{order.details.deliverables && <p>Deliverables: {order.details.deliverables}</p>}<p>Lead status: {leadStatus(order)} · {money(order.amount)} sample amount</p>
    <button onClick={onMessage}><Icon name="message" size={18} />Open mock conversation</button>
    {order.status === 'requested' && <div className="pd-card demo-stack"><h3>Respond to sample request</h3><button className="demo-primary" onClick={() => send('accept')}>Accept sample request</button><label>Rejection reason<textarea value={reason} onChange={e => setReason(e.target.value)} /></label><button onClick={() => send('reject', { reason })}>Reject sample request</button></div>}
    {order.role === 'professional' && order.status === 'accepted' && <div className="pd-card demo-stack"><h3>Verify arrival</h3><p>Fictional customer code: <b>246810</b>. This is local to this sample booking and cannot verify a real job.</p><label>Sample arrival code<input inputMode="numeric" maxLength={6} value={code} onChange={e => setCode(e.target.value)} /></label><button onClick={() => send('arrival', { code })}>Verify demo arrival</button></div>}
    {order.role === 'professional' && ['active', 'awaiting_acceptance'].includes(order.status) && q?.status !== 'paid' && <div className="pd-card demo-stack"><h3>Work completed — sample final quote</h3><p>Completed scope: {order.title}. Service price {money(order.amount)}, quantity 1, visiting and additional charges ₹0. This uses the existing zero-tax/zero-fee database test fixture.</p><button onClick={() => send('quote')}>Send sample final quote</button></div>}
    {q && <div className="pd-card demo-stack"><h3>Sample quote · {q.status}</h3>{[['sellerBasePaise', 'Your price'], ['sellerPayablePaise', 'Your payable amount'], ['totalPaise', 'Customer total']].map(([key, label]) => <div className="demo-money" key={key}><span>{label}</span><b>{money(q[key] / 100)}</b></div>)}{q.status === 'proposed' && <button onClick={() => send('approve')}>Simulate customer quote approval</button>}{q.status === 'approved' && <button className="demo-primary" onClick={() => send('pay')}>Simulate successful payment</button>}</div>}
    {order.prepaid && <div className="pd-card demo-stack"><h3>Separate prepaid collaboration sample</h3><p>This sample starts at the booking-time checkout stage. Accepting an enquiry does not open this checkout in the current seller app.</p>{Object.entries(order.collaboration).map(([key, value]) => <div className="demo-money" key={key}><span>{{ customerTotal: 'Customer total', platformFee: 'Platform fee (10%)', partnerPayout: 'Partner payout', initialRelease: '70% pending after scope', securityHold: '30% security hold' }[key]}</span><b>{money(value)}</b></div>)}{!order.payment && <button onClick={() => send('prepay')}>Simulate prepaid payment</button>}{order.payment && !order.scopeConfirmed && <button onClick={() => send('scope')}>Simulate trusted scope confirmation</button>}{order.status === 'completed' && order.scopeConfirmed && !order.holdReleased && <button onClick={() => send('release')}>Simulate trusted hold release</button>}</div>}
    {order.payment && <p className="demo-success">Simulated payment successful. No money moved.</p>}
    {order.status === 'awaiting_acceptance' && <div className="pd-card demo-stack"><h3>Simulated customer action</h3><p>The existing completion action belongs to the customer. This button only changes this sample.</p><button onClick={() => send('complete')}>Simulate customer completion</button></div>}
    {order.role !== 'professional' && <p className="demo-limitation">{limits[order.role]}</p>}
    <h3>Sample activity</h3><ol className="demo-activity">{order.events.map((event, i) => <li key={i}>{event.kind}<small>{new Date(event.at).toLocaleString('en-IN')}</small></li>)}</ol>
  </section>;
}
