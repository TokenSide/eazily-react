import { useAccount } from '../lib/account.js';
import { useCallback, useEffect, useState } from 'react';
import { BottomNav, EmptyState, Sheet, Field } from '../components/Ui.jsx';
import Icon from '../components/Icon.jsx';
import { partnerRoles } from '../data/partners.js';
import { displayInfluencerCategory } from '../data/influencerCategories.js';
import { displayConsultantCategory } from '../data/consultantCategories.js';
import { readRows, requireBackend, rpc } from '../services/experience.js';
import { getConsultantAssessmentEligibility, savePartnerPost, saveServicePartnerPost, setAvailability } from '../services/partners.js';
import { supabase } from '../lib/supabase.js';
import { sellerMemberships } from '../lib/workspace.js';
import { setLanguage, translate as t } from '../lib/translate.js';
import PartnerPostForm from '../features/partners/PartnerPostForm.jsx';
import ServicePostList from '../features/partners/ServicePostList.jsx';
import SubscriptionPanel from '../features/partners/SubscriptionPanel.jsx';
import PartnerBannerCarousel from '../features/partners/PartnerBannerCarousel.jsx';
import DashboardHome, { DashboardTopBar } from '../features/partners/PartnerDashboard.jsx';
import RewardsPanel from '../features/partners/RewardsPanel.jsx';
import OrderDetail from '../features/partners/OrderDetail.jsx';
import SupportForm from '../features/account/SupportForm.jsx';
import ConsultantLegal from '../features/partners/legal/ConsultantLegal.jsx';
import DemoGate from '../features/partners/demo/DemoGate.jsx';
import { InfluencerLegalCenter, InfluencerTermsGate } from '../features/partners/legal/InfluencerLegal.jsx';
import { CONSULTANT_ASSESSMENT_TEST_SKIP_ENABLED } from '../features/partners/consultantAssessmentConfig.js';
import { useRealtime } from '../lib/realtime.jsx';
import ChatWorkspace from '../features/chat/ChatWorkspace.jsx';
import { IN_APP_BACK_EVENT, pushNavigationState, replaceNavigationState } from '../lib/nativeShell.js';
const nav = [['home','home','Home'],['messages','message','Messages'],['post','plus','Post'],['orders','clipboard','My Orders'],['profile','person','Profile']];
const money = n => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(Number(n || 0));
const displayPartnerCategory = (role, category) => role === 'influencer' ? displayInfluencerCategory(category) : role === 'consultant' ? displayConsultantCategory(category) : category;
export default function PartnerApp(props) {
  const application = props.account.applications.find(item => item.role === props.role);
  return <DemoGate role={props.role}>{onEnterDemo => props.role === 'influencer'
    ? <InfluencerTermsGate application={application} notify={props.notify}><ActualPartnerApp {...props} onEnterDemo={onEnterDemo} /></InfluencerTermsGate>
    : <ActualPartnerApp {...props} onEnterDemo={onEnterDemo} />}</DemoGate>;
}
function ActualPartnerApp({ role, account, notify, onWorkspace, onAddRole, onEditRegistration, onEnterDemo }) {
  const {logout}=useAccount();
  const {revision: realtimeRevision}=useRealtime();
  const application = account.applications.find(a=>a.role===role), profile=application?.details||{}, info=partnerRoles[role];
  const cache = 'eazily-posts:'+account.user.id+':'+role;
  const [route,updateRoute]=useState(()=>history.state?.eazilyPartnerRole===role?history.state?.eazilyPartnerRoute||'home':'home'), [sheet,setSheet]=useState(null), [data,setData]=useState({posts:[],orders:[],earnings:[],leads:[],notifications:[],reviews:[],training:[],progress:[]});
  const [online,setOnline]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[search,setSearch]=useState(''),[filter,setFilter]=useState('all'),[language,changeLanguage]=useState(localStorage.getItem('eazily-language')||'English'),[trial,setTrial]=useState(null),[banners,setBanners]=useState([]);
  const [assessmentEligibility,setAssessmentEligibility]=useState(role==='consultant'?null:{eligible:true,fields:[]});
  const [consultantLegalReady, setConsultantLegalReady] = useState(false);
  const approved=application?.status==='approved'&&(role!=='consultant'||(assessmentEligibility?.eligible===true && consultantLegalReady));
  const visibleNav=approved?nav:[['home','home','Home'],['profile','person','Profile']];
  const testPreview=role==='consultant'&&CONSULTANT_ASSESSMENT_TEST_SKIP_ENABLED&&!supabase&&profile.assessmentStatus==='skipped_for_testing';
  const serviceTestPreview=role==='professional'&&!supabase&&profile.registrationStatus==='skipped_for_testing';
  const setRoute=useCallback((next, options={})=>{
    if (next === route) return;
    const state={eazilyPartnerRole:role,eazilyPartnerRoute:next};
    if(options.replace)replaceNavigationState(state);
    else pushNavigationState(state);
    updateRoute(next);
    window.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  },[role,route]);
  useEffect(()=>{
    replaceNavigationState({eazilyDepth:Number(history.state?.eazilyDepth||0),eazilyPartnerRole:role,eazilyPartnerRoute:route});
    const pop=event=>{if(event.state?.eazilyPartnerRole===role){updateRoute(event.state.eazilyPartnerRoute||'home');setSheet(null);}};
    const nativeBack=event=>{
      if(Number(history.state?.eazilyDepth||0)>0){event.detail.handled=true;history.back();}
      else if(route!=='home'){event.detail.handled=true;replaceNavigationState({eazilyPartnerRole:role,eazilyPartnerRoute:'home'});updateRoute('home');}
    };
    window.addEventListener('popstate',pop);window.addEventListener(IN_APP_BACK_EVENT,nativeBack);
    return()=>{window.removeEventListener('popstate',pop);window.removeEventListener(IN_APP_BACK_EVENT,nativeBack);};
  },[role,route]);
  const load=useCallback(async()=>{
    setError('');
    try{
      if(!supabase){setData(d=>({...d,posts:JSON.parse(sessionStorage.getItem(cache)||'[]')}));return;}
      const own=q=>q.eq('partner_id',application.id);
      const [posts,orders,earnings,availability,leads,notifications,reviews,training,progress]=await Promise.all([
        readRows('partner_posts',q=>own(q).eq('role',role).order('updated_at',{ascending:false}).limit(50)),readRows('partner_orders',q=>own(q).eq('role',role).order('created_at',{ascending:false}).limit(100)),readRows('partner_earnings',q=>own(q).limit(100)),readRows('partner_availability',q=>own(q).limit(1)),readRows('seller_leads',q=>own(q).limit(100)),readRows('seller_notifications',q=>q.eq('account_id',account.user.id).eq('role',role).limit(100)),readRows('seller_reviews',q=>own(q).limit(100)),readRows('seller_training',q=>q.limit(100)),readRows('seller_training_progress',q=>own(q).limit(100))
      ]);
      setData({posts,orders,earnings,leads,notifications,reviews,training,progress});
      setOnline(!!(availability[0]?.online&&Date.parse(availability[0].available_until)>Date.now()));
    }catch(e){setError(e.message);}finally{setLoading(false);}
  },[application?.id,account.user.id,role,cache]);
  useEffect(()=>{load();},[load,realtimeRevision]);
  useEffect(()=>{
    if (!supabase) return;
    let active = true;
    readRows('seller_subscriptions',q=>q.eq('partner_id',application.id)).then(rows=>{ if(active) setTrial(rows[0] || null); }).catch(e=>notify(e.message));
    return()=>{active=false;};
  },[application.id,notify,realtimeRevision]);
  useEffect(()=>{
    if (!supabase) return;
    let active = true;
    const now = new Date().toISOString();
    readRows('partner_dashboard_banners', q => q.eq('active', true).eq('role', role).lte('starts_at', now).order('sort_order', { ascending: true }).limit(4))
      .then(rows => { if (active) setBanners(rows.filter(row => !row.ends_at || Date.parse(row.ends_at) > Date.now())); })
      .catch(() => { if (active) setBanners([]); });
    return () => { active = false; };
  }, [role,realtimeRevision]);
  useEffect(()=>{
    if(role!=='consultant'||!supabase){if(role==='consultant')setAssessmentEligibility({eligible:false,fields:[]});return;}
    let active=true;
    getConsultantAssessmentEligibility(application.id).then(result=>{if(active)setAssessmentEligibility(result);}).catch(e=>{if(active){setAssessmentEligibility({eligible:false,fields:[]});setError(e.message);}});
    return()=>{active=false;};
  },[role,application.id,realtimeRevision]);
  useEffect(()=>{if(!approved&&!['home','profile'].includes(route)){setRoute('home',{replace:true});setSheet(null);}},[approved,route,setRoute]);
  async function act(fn){if(busy)return;setBusy(true);try{await fn();await load();}catch(e){notify(e.message);}finally{setBusy(false);}}
  async function postAction(post,action){
    if(role==='professional'&&(post.details?.postType||'offering')==='offering'){
      let result;
      if(!supabase){
        const rows=JSON.parse(sessionStorage.getItem(cache)||'[]');
        if(action==='duplicate'){
          result={...post,id:crypto.randomUUID(),status:'draft',review_notes:null,updated_at:new Date().toISOString(),details:{...post.details,title:`Copy of ${post.details.title||post.details.service}`}};
          sessionStorage.setItem(cache,JSON.stringify([result,...rows]));
        }else{
          const status=action==='archive'?'archived':action==='resume'?'published':'paused';
          const posts=rows.map(item=>item.id===post.id?{...item,status,updated_at:new Date().toISOString()}:item);
          sessionStorage.setItem(cache,JSON.stringify(posts));result=posts.find(item=>item.id===post.id);
        }
      }else result=await saveServicePartnerPost(post.details,action,post.id,action==='duplicate'?crypto.randomUUID():null);
      if(action==='duplicate')setSheet(result);
      return result;
    }
    if(!supabase){const posts=data.posts.map(p=>p.id===post.id?{...p,status:action==='archive'?'archived':'paused'}:p);sessionStorage.setItem(cache,JSON.stringify(posts));}
    else await savePartnerPost(role,post.details,action,post.id);
  }
  const rawEarningsTotal=state=>data.earnings.filter(e=>e.state===state).reduce((s,e)=>s+Number(e.amount),0);
  const total=state=>{
    if(role!=='professional')return rawEarningsTotal(state);
    const reversed=rawEarningsTotal('reversed');
    if(state==='pending')return Math.max(0,rawEarningsTotal('pending')-reversed);
    if(state==='available')return Math.max(0,rawEarningsTotal('available')-Math.max(0,reversed-rawEarningsTotal('pending')));
    return rawEarningsTotal(state);
  };
  const name=profile.businessName||profile.creatorName||profile.name||'';
  const hour=Number(new Intl.DateTimeFormat('en-IN',{hour:'numeric',hour12:false,timeZone:'Asia/Kolkata'}).format(new Date()));
  const greeting=hour<12?'Good Morning':hour<17?'Good Afternoon':'Good Evening';
  const filteredOrders=data.orders.filter(o=>(filter==='all'||o.status===filter)&&[o.title,o.id,o.details?.service].join(' ').toLowerCase().includes(search.toLowerCase()));
  const genericPosts=<><div className="section-head"><h2>{t('My Posts')}</h2><button className="btn btn-primary" onClick={()=>setSheet('post')}>{t('Create Post')}</button></div>{!data.posts.length&&<EmptyState title="No posts yet" text="Create an offering or share useful content."/>}{data.posts.map(p=><article className="partner-list-card post-list-item" key={p.id}>{p.details.media?.[0]&&<img src={p.details.media[0].path} alt="" /> }<h3>{role==='influencer' ? (p.details.caption || p.details.title || info.post).slice(0, 90) : (p.details.title||info.post)}</h3><p>{role==='influencer' && p.details.packageSnapshot ? `${p.details.packageSnapshot.deliverableCount || 1} ${p.details.packageSnapshot.deliverables} · ₹${p.details.packageSnapshot.packagePrice || '—'} · ${p.details.packageSnapshot.timeline || '—'} days` : t(p.details.postType||'offering')} · {t(p.status)} · {p.updated_at&&new Date(p.updated_at).toLocaleDateString('en-IN')}</p>{p.review_notes&&<p>{p.review_notes}</p>}<div className="post-actions"><button className="btn btn-outline" onClick={()=>setSheet(p)}>{t('Edit')}</button><button className="btn btn-outline" onClick={()=>setSheet({...p,id:undefined,details:{...p.details,caption:p.details.caption || '',title:'',description:''}})}>{t('Duplicate')}</button>{p.status==='published'&&<button className="btn btn-outline" disabled={busy} onClick={()=>act(()=>postAction(p,'pause'))}>{t('Pause')}</button>}{p.status!=='archived'&&<button className="btn btn-outline" disabled={busy} onClick={()=>act(()=>postAction(p,'archive'))}>{t('Archive')}</button>}</div></article>)}</>;
  const listPosts=role==='professional'?<ServicePostList posts={data.posts} busy={busy} onAdd={()=>setSheet('post')} onEdit={setSheet} onAction={(post,action)=>act(()=>postAction(post,action))}/>:genericPosts;
  return <div className={'partner-workspace role-'+role+(route==='home' ? ' partner-dashboard-home-view' : '')}><main className="screen partner-screen">
    {route === 'home' ? <DashboardTopBar role={role} name={name} greeting={greeting} notifications={data.notifications.filter(item => !item.read_at).length} setRoute={setRoute} setSheet={setSheet} /> : <header className="topbar partner-header dashboard-header"><div className="dashboard-header-top"><div className="dashboard-role"><span className="dashboard-avatar">{(name || info.label).charAt(0).toUpperCase()}</span><small>{t(info.label)}</small></div><div className="dashboard-header-actions"><button className="icon-btn notification-button" aria-label={t('Notifications')} onClick={()=>setSheet('Notifications')}><Icon name="bell" size={19} />{data.notifications.filter(item=>!item.read_at).length>0&&<b>{data.notifications.filter(item=>!item.read_at).length}</b>}</button><button className="workspace-button" onClick={()=>setSheet('workspace')}>{t('Switch')}</button></div></div><div className="dashboard-header-greeting"><h1>{route==='home' ? `${t(greeting)}${name ? `, ${name}` : ''}` : t(route==='orders'?info.orders:route==='profile'?'My Profile':route==='post'?(role==='professional'?'My Services':'My Posts'):'Messages')}</h1></div></header>}
    {route === 'home' && approved && <PartnerBannerCarousel role={role} banners={banners} trial={trial} application={application} setRoute={setRoute} setSheet={setSheet} />}
    <div className="seller-content">
      {role === 'consultant' && route === 'home' && <ConsultantLegal onEligibilityChange={setConsultantLegalReady} application={application} />}
      {testPreview&&<section className="testing-notice consultant-test-preview" role="status"><b>Test preview</b><p>The assessment was skipped locally. No assessment pass, professional approval, live booking, or payout access has been granted.</p><button type="button" className="btn btn-outline" onClick={onEditRegistration}>Take assessment</button></section>}
      {serviceTestPreview&&<section className="testing-notice service-test-preview" role="status"><b>Test registration preview</b><p>Registration pages were skipped locally. No verification, approval, live booking, or payout access has been granted.</p><button type="button" className="btn btn-outline" onClick={onEditRegistration}>Complete registration</button></section>}
      {role==='consultant'&&supabase&&assessmentEligibility&&!assessmentEligibility.eligible&&<section className="testing-notice consultant-test-preview" role="status"><b>Assessment required</b><p>Consultant work remains locked until every selected field has a valid six-question pass. Document review, human approval and assigned rates remain separate.</p><button type="button" className="btn btn-outline" onClick={onEditRegistration}>Take assessment</button></section>}
      {!supabase&&route!=='home'&&<p className="testing-notice">{t('Testing workspace. Drafts are local; approval, bookings and payments are not simulated.')}</p>}
      {loading&&<p role="status">{t('Loading…')}</p>}{error&&<div role="alert"><p>{error}</p><button className="btn btn-outline" onClick={load}>{t('Retry')}</button></div>}
      {route==='home'&&<DashboardHome role={role} profile={profile} approved={approved} application={application} data={data} online={online} busy={busy} trial={trial} onEditRegistration={onEditRegistration} setRoute={setRoute} setSheet={setSheet} act={act} setAvailability={setAvailability} setOnline={setOnline} total={total} money={money} onEnterDemo={onEnterDemo} />}
      {route==='post'&&listPosts}
      {route==='orders'&&<><Field label={t('Search orders')} value={search} onChange={e=>setSearch(e.target.value)}/><Field label={t('Status')} as="select" value={filter} onChange={e=>setFilter(e.target.value)} options={['all','requested','accepted','active','awaiting_acceptance','completed','cancelled','disputed']}/>{filteredOrders.map(o=><button className="choice" key={o.id} onClick={()=>setSheet({order:o})}><b>{o.title}</b><small>{t(o.status)} · EAZ-{o.id.slice(0,8).toUpperCase()}</small></button>)}{!filteredOrders.length&&<EmptyState title="No matching orders" text="Your workspace orders will appear here."/>}</>}
      {route==='messages'&&<ChatWorkspace role={role} notify={notify} />}
      {route==='profile'&&<PartnerProfile role={role} profile={profile} application={application} approved={approved} data={data} onEditRegistration={onEditRegistration} setRoute={setRoute} setSheet={setSheet} onWorkspace={onWorkspace} onAddRole={onAddRole} logout={logout} />}
    </div><BottomNav route={route} onChange={setRoute} items={visibleNav} chatRole={approved?role:null} onPost={()=>{if(approved){setRoute('post');setSheet('post');}}} />
    </main>{sheet&&<Sheet className="partner-post-sheet" onClose={()=>setSheet(null)}>
      {sheet==='workspace'?<Workspace account={account} current={role} onWorkspace={w=>{setSheet(null);onWorkspace(w);}}/>
      :(typeof sheet==='string'&&sheet.startsWith('post'))||sheet.id?<PartnerPostForm key={sheet.id||sheet} role={role} application={application} accountId={account.user.id} post={sheet.id?sheet:null} offerings={data.posts.filter(p=>p.details.postType==='offering'&&(supabase ? p.status==='published' : p.status!=='archived'))} notify={notify} onDone={(result,options)=>{if(options?.editProfile){setSheet(null);onEditRegistration();return;}setRoute('post');load();setSheet(options?.addAnother?`post-${crypto.randomUUID()}`:null);}}/>
      :sheet.order?<OrderDetail order={data.orders.find(o=>o.id===sheet.order.id)||sheet.order} notify={notify} onChange={load}/>
      :sheet==='Subscription'?<SubscriptionPanel application={application} notify={notify} onSupport={()=>setSheet('Help & Support')}/>
      :sheet==='Trial expired'?<section><h2>{t('Your 60-day trial has ended')}</h2><p>{t('Compare available plans and review their renewal prices.')}</p><button className="btn btn-primary" onClick={()=>setSheet('Subscription')}>{t('Compare Plans')}</button><button className="btn btn-outline" onClick={()=>setSheet(null)}>{t('Remind Me Later')}</button></section>
      :sheet==='Help & Support'?<SupportForm notify={notify}/>
      :sheet==='Settings'?<section><h2>{t('Settings')}</h2><Field label={t('Language')} as="select" options={['English','हिन्दी']} value={language} onChange={e=>{changeLanguage(e.target.value);setLanguage(e.target.value);}}/><button className="btn btn-outline" onClick={logout}>{t('Logout')}</button></section>
      :sheet==='My Business'?<section><h2>{name}</h2><p>{profile.city} · {displayPartnerCategory(role, profile.category)}</p><p>{(profile.services||[]).join(', ')}</p>{role==='influencer' && Boolean(profile.relatedNiches?.length) && <p>{[...new Set(profile.relatedNiches.map(displayInfluencerCategory))].join(', ')}</p>}{role==='consultant' && Boolean(profile.consultationFields?.length>1) && <p>{profile.consultationFields.filter(item=>item.category!==profile.category).map(item=>displayConsultantCategory(item.category)).join(', ')}</p>}<p>{profile.specialisation} · {profile.experience}</p><button className="btn btn-outline" onClick={onEditRegistration}>{t('Review registration')}</button></section>
      :sheet==='Documents'?<section><h2>{t('Documents')}</h2><p>{t(application.status)}</p><p>{application.review_notes||t('Documents remain private. Review or correct them in your registration.')}</p><button className="btn btn-outline" onClick={onEditRegistration}>{t('Review registration')}</button></section>
      :sheet==='Legal'&&role==='consultant'?<ConsultantLegal onEligibilityChange={setConsultantLegalReady} application={application}/>:sheet==='Legal'&&role==='influencer'?<InfluencerLegalCenter application={application} notify={notify}/>
      :sheet==='My Leads'?<section><h2>{t('My Leads')}</h2>{data.leads.map(l=><article className="partner-list-card" key={l.id}><b>{data.orders.find(o=>o.id===l.order_id)?.title||t('Enquiry')}</b><Field label={t('Status')} as="select" options={['new','active','follow_up','won','lost']} value={l.status} onChange={e=>act(async()=>{const r=await requireBackend().from('seller_leads').update({status:e.target.value}).eq('id',l.id);if(r.error)throw r.error;})}/><Field label={t('Private notes')} as="textarea" defaultValue={l.notes} onBlur={e=>act(async()=>{const r=await requireBackend().from('seller_leads').update({notes:e.target.value}).eq('id',l.id);if(r.error)throw r.error;})}/><Field label={t('Follow-up')} type="datetime-local" onChange={e=>{if(e.target.value)act(async()=>{const r=await requireBackend().from('seller_leads').update({follow_up_at:new Date(e.target.value).toISOString(),status:'follow_up'}).eq('id',l.id);if(r.error)throw r.error;});}}/></article>)}{!data.leads.length&&<p>{t('No leads yet')}</p>}</section>
      :sheet==='Earnings'||sheet==='Payment History'?<section><h2>{t(sheet)}</h2>{['available','pending','security_hold','paid','reversed'].map(s=><p key={s}>{t(s)}: <b>{money(total(s))}</b></p>)}{data.earnings.map(e=><article className="partner-list-card" key={e.id}>{money(e.amount)} · {t(e.state)}<p>{e.provider_reference}</p><small>{new Date(e.created_at).toLocaleString('en-IN')}</small></article>)}{!data.earnings.length&&<p>{t('No earnings or payments yet')}</p>}</section>
      :sheet==='Notifications'?<section><h2>{t('Notifications')}</h2>{role==='professional'&&<p>{t('In-app updates only. Android background push is not configured; the response deadline still applies.')}</p>}{data.notifications.map(n=><button className="choice" key={n.id} onClick={()=>act(async()=>{await rpc('mark_seller_notifications_read',{p_id:n.id});const orders=await readRows('partner_orders',q=>q.eq('id',n.order_id).eq('partner_id',application.id).limit(1));const order=orders[0];if(!order){notify('This booking is no longer assigned to your workspace.');return;}if(role==='professional'&&order.status==='requested'){const offers=await readRows('service_booking_offers',q=>q.eq('order_id',order.id).eq('partner_id',application.id).eq('status','offered').limit(1));if(!offers[0]||Date.parse(offers[0].expires_at)<=Date.now()){notify('This offer has expired or moved to another professional.');return;}}setSheet({order});})}>{t(n.title)} · {t(n.read_at?'Read':'Unread')}</button>)}{!data.notifications.length&&<p>{t('No notifications yet')}</p>}</section>
      :sheet==='Training'?<section><h2>{t('Training')}</h2>{data.training.map(m=><article className="partner-list-card" key={m.id}><h3>{t(m.title)}</h3><p>{language==='हिन्दी'?m.content_hi:m.content}</p><button className="btn btn-outline" disabled={busy||data.progress.some(p=>p.module_id===m.id)} onClick={()=>act(async()=>{const r=await requireBackend().from('seller_training_progress').insert({partner_id:application.id,module_id:m.id});if(r.error)throw r.error;})}>{t(data.progress.some(p=>p.module_id===m.id)?'Completed':'Mark completed')}</button></article>)}{!data.training.length&&<p>{t('Training content will appear when the live service is connected.')}</p>}</section>
      :sheet==='Reviews'?<section><h2>{t('Reviews')}</h2>{data.reviews.map(r=><article className="partner-list-card" key={r.id}><b>{r.rating}/5</b><p>{r.body}</p><Field label={t('Your reply')} defaultValue={r.reply||''} onBlur={e=>act(()=>rpc('reply_seller_review',{p_review:r.id,p_reply:e.target.value}))}/></article>)}{!data.reviews.length&&<p>{t('No reviews yet')}</p>}</section>
      :<RewardsPanel application={application} notify={notify}/>}
    </Sheet>}</div>;
}

function PartnerProfile({ role, profile, application, approved, data, onEditRegistration, setRoute, setSheet, onWorkspace, onAddRole, logout }) {
  const name = profile.businessName || profile.creatorName || profile.name || 'Partner profile';
  const accent = role === 'professional' ? '#059669' : role === 'influencer' ? '#7C3AED' : '#2563EB';
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'E';
  const reviewItem = data.reviews.length ? [['Reviews', 'star', () => setSheet('Reviews')]] : [];
  const workItems = !approved ? [['Registration details', 'shield', onEditRegistration]] : role === 'professional'
    ? [['My Business', 'briefcase', () => setSheet('My Business')], ['My Services', 'grid', () => setRoute('post')], ['My Posts', 'megaphone', () => setRoute('post')], ['My Leads', 'clipboard', () => setSheet('My Leads')], ['My Orders', 'clipboard', () => setRoute('orders')], ...reviewItem]
    : role === 'influencer'
      ? [['Creator Profile', 'person', () => setSheet('My Business')], ['My Posts', 'megaphone', () => setRoute('post')], ['My Packages', 'briefcase', () => setRoute('post')], ['Collaboration Enquiries', 'clipboard', () => setRoute('orders')], ['Active Collaborations', 'calendar', () => setRoute('orders')], ...reviewItem]
      : [['Professional Profile', 'person', () => setSheet('My Business')], ['My Consultations', 'briefcase', () => setRoute('post')], ['Availability', 'calendar', () => setRoute('orders')], ['Appointments', 'clipboard', () => setRoute('orders')], ...reviewItem];
  const groups = [['My Work', workItems]];
  if (approved) groups.push(['Money & Membership', [['Earnings', 'rupee', () => setSheet('Earnings')], ['Payment History', 'history', () => setSheet('Payment History')], ['Rewards', 'sparkles', () => setSheet('Rewards')], ['Subscription', 'sparkles', () => setSheet('Subscription')]]]);
  const accountItems = [['Private Documents', 'shield', () => setSheet('Documents')], ['Training', 'briefcase', () => setSheet('Training')], ['Notifications', 'bell', () => setSheet('Notifications')], ['Settings', 'settings', () => setSheet('Settings')], ['Help & Support', 'message', () => setSheet('Help & Support')]];
  if (role === 'influencer' || role === 'consultant') accountItems.splice(1, 0, ['Terms & Conditions', 'clipboard', () => setSheet('Legal')]);
  groups.push(['Account & Support', accountItems]);
  return <div className="partner-profile-page" style={{ '--profile-accent': accent }}>
    <section className="partner-profile-hero"><div className="partner-profile-avatar">{profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : initials}</div><div className="partner-profile-copy"><h2>{name}</h2><p>{[displayPartnerCategory(role, profile.category) || profile.specialisation, profile.city].filter(Boolean).join(' • ') || t('Profile details not provided')}</p><div className="partner-profile-status"><span className={`application-state ${approved ? 'approved' : 'pending'}`}>{approved && <Icon name="check" size={13} />}{t(approved ? 'Verified' : application.status)}</span></div></div><button className="partner-profile-edit" onClick={onEditRegistration} aria-label={t('Edit Profile')} title={t('Edit Profile')}><Icon name="pencil" size={18} /></button></section>
    {role === 'influencer' && <p className="profile-private-note">{(profile.platforms || []).filter(item => item.url).map(item => `${item.name} · ${item.band || t('Audience not provided')} · ${item.verified ? t('Verified') : t('Self-reported')}`).join(' | ') || t('Social accounts not provided')}</p>}
    {groups.map(([title, items]) => <section className="profile-menu-group" key={title}><h3>{t(title)}</h3><div className="profile-menu-card">{items.map(([label, icon, action]) => <button className="profile-menu-row" key={label} onClick={action}><span className="profile-menu-icon"><Icon name={icon} size={19} /></span><span>{t(label)}</span><Icon name="chevronRight" size={18} /></button>)}</div></section>)}
    <section className="profile-account-actions"><button className="profile-menu-row" onClick={() => onWorkspace('customer')}><span className="profile-menu-icon"><Icon name="home" size={19} /></span><span>{t('Switch to Customer')}</span><Icon name="chevronRight" size={18} /></button><button className="profile-menu-row" onClick={onAddRole}><span className="profile-menu-icon"><Icon name="plus" size={19} /></span><span>{t('Add another partner role')}</span><Icon name="chevronRight" size={18} /></button></section>
    <section className="profile-account-actions"><button className="profile-menu-row profile-logout-row" onClick={logout}><span className="profile-menu-icon logout"><Icon name="logout" size={19} /></span><span>{t('Log out')}</span><Icon name="chevronRight" size={18} /></button></section>
  </div>;
}

export function Workspace({account,current,onWorkspace}) {
  return <><h2>{t('Choose workspace')}</h2><button className="choice" onClick={()=>onWorkspace('customer')}>{t('Customer')}</button>{sellerMemberships(account).map(role=><button className={'choice '+(current===role?'active':'')} key={role} onClick={()=>onWorkspace(role)}>{partnerRoles[role].label}</button>)}</>;
}
