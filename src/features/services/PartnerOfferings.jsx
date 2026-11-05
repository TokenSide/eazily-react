import { useCallback, useEffect, useRef, useState } from 'react';
import { Field, Sheet } from '../../components/Ui.jsx';
import { readRows, rpc } from '../../services/experience.js';
import { useAccount, requestSignIn } from '../../lib/account.js';
import { translate as t } from '../../lib/translate.js';
import OrderDetail from '../partners/OrderDetail.jsx';
import { UserBusyLabel, UserOfferingSkeleton } from '../user-motion/UserLoading.jsx';
import { useRealtime } from '../../lib/realtime.jsx';
import ChatWorkspace from '../chat/ChatWorkspace.jsx';
import { getServiceMatchCapabilities, requestProfessionalBooking } from '../../services/marketplace.js';
import WalletCheckout from '../account/WalletCheckout.jsx';
import { mergeCustomerBookings, partnerBookingStatus, serviceRequestStatus } from './customerBookings.js';
const money = n => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(n/100);
export default function PartnerOfferings({ notify, role, service, city, onMessage }) {
  const {revision}=useRealtime();
  const [posts,setPosts]=useState([]),[selected,setSelected]=useState(null),[slot,setSlot]=useState(''),[address,setAddress]=useState(''),[requirement,setRequirement]=useState(''),[backup,setBackup]=useState(false),[backupAvailable,setBackupAvailable]=useState(false),[busy,setBusy]=useState(false),[search,setSearch]=useState(''),[loading,setLoading]=useState(true);
  const key=useRef(crypto.randomUUID()),{user}=useAccount();
  useEffect(()=>{let active=true;setLoading(true);readRows('partner_directory',q=>{let query=q;if(role)query=query.eq('partner_role',role);if(city)query=query.eq('city',city);return query.limit(50);}).then(p=>{if(active)setPosts(p);}).catch(e=>notify(e.message)).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[role,city,notify,revision]);
  useEffect(()=>{if(role&&role!=='professional')return undefined;let active=true;getServiceMatchCapabilities().then(value=>{if(active)setBackupAvailable(Boolean(value?.backupAvailable));}).catch(()=>{});return()=>{active=false;};},[role]);
  async function book(){if(!user)return requestSignIn();if(busy)return;setBusy(true);try{const result=selected.partner_role==='professional'?await requestProfessionalBooking({partnerPostId:selected.id,slot:new Date(slot).toISOString(),idempotencyKey:key.current,backup:backup&&backupAvailable,city:selected.city,address:address.trim(),requirement:requirement.trim()}):await rpc('book_partner_offering',{p_post:selected.id,p_slot:new Date(slot).toISOString(),p_key:key.current});notify((selected.partner_role==='influencer'?'Collaboration enquiry saved; no payment made: ':selected.partner_role==='consultant'?'Consultation enquiry saved; no payment made: ':'Booking request saved: ')+'EAZ-'+result.id.slice(0,8).toUpperCase());key.current=crypto.randomUUID();setSelected(null);setBackup(false);}catch(e){notify(e.message);}finally{setBusy(false);}}
  const filtered=posts.filter(p=>(!service||p.service_names?.includes(service)||p.category_id===service)&&[p.display_name,p.details?.title,p.category_id].join(' ').toLowerCase().includes(search.toLowerCase()));
  return <section className="section"><h2>{t('Partner offerings')}</h2><Field label={t('Search offerings')} value={search} onChange={e=>setSearch(e.target.value)}/>{loading?<UserOfferingSkeleton count={2}/>:<>{filtered.map(p=><button className="choice" key={p.id} onClick={()=>{setSelected(p);setSlot('');setAddress('');setRequirement('');setBackup(false);key.current=crypto.randomUUID();}}><b>{p.details.title}</b><span>{p.display_name} · {p.city}</span><small>{p.details.totalPaise!=null?money(p.details.totalPaise):t('Price confirmed before payment')}</small></button>)}{!filtered.length&&<p>{t('No published offerings yet')}</p>}</>}
    {selected&&<Sheet onClose={()=>setSelected(null)}><h2>{selected.details.title}</h2><b>{selected.display_name}</b><p>{selected.details.description}</p><p>{selected.profile_details?.experience} · {selected.city}</p><button className="btn btn-outline full" onClick={()=>onMessage?.(selected.id)}>{t('Message Provider')}</button>{selected.details.totalPaise!=null&&<details><summary>{t('Estimated total')}: {money(selected.details.totalPaise)}</summary>{[['servicePaise','Service price'],['feePaise','Platform fee'],['taxPaise','Applicable GST']].map(([key,label])=><p key={key}>{t(label)}: {money(selected.details[key]||0)}</p>)}</details>}
      {(!selected.details.postType||selected.details.postType==='offering')?<><p>{t(selected.partner_role==='influencer'?'This sends an unpaid collaboration enquiry. Official payment and payout setup is pending.':selected.partner_role==='consultant'?'This sends an unpaid enquiry only to the selected consultant. A five-minute introduction or paid session is not confirmed.':'Final scope and quote require your approval before payment.')}</p>{selected.partner_role==='professional'&&<><Field label={t('Service address')} value={address} onChange={e=>setAddress(e.target.value)} required maxLength={500}/><Field label={t('What work do you need?')} as="textarea" value={requirement} onChange={e=>setRequirement(e.target.value)} required maxLength={1000}/></>}<Field label={t('Preferred time')} type="datetime-local" value={slot} onChange={e=>setSlot(e.target.value)} required/>{selected.partner_role==='professional'&&<><p>{t('This professional always receives the first offer. Your full address is shared only after acceptance.')}</p><label className="consent"><input type="checkbox" checked={backup} disabled={!backupAvailable} onChange={e=>setBackup(e.target.checked)}/>{t('Agar ye vendor jawab na de, similar professional dhoondhein')}</label>{!backupAvailable&&<p>{t('Backup matching needs an active response-time worker. Only this professional receives the request right now.')}</p>}<p>{t('A changed backup price needs your approval before the booking is confirmed.')}</p></>}<button className="btn btn-primary" disabled={!slot||busy||(selected.partner_role==='professional'&&(!address.trim()||!requirement.trim()))} onClick={book}>{busy?<UserBusyLabel>Booking…</UserBusyLabel>:t(selected.partner_role==='influencer'?'Send Collaboration Enquiry':selected.partner_role==='consultant'?'Send Consultation Enquiry':'Book Service')}</button></>:<p>{t('Professional content. View the linked offering for bookings.')}</p>}
    </Sheet>}
  </section>;
}
export function CustomerPartnerBookings({notify}) {
  const {revision}=useRealtime();
  const {user}=useAccount();const [orders,setOrders]=useState([]),[requests,setRequests]=useState([]),[postNames,setPostNames]=useState({}),[vendorNames,setVendorNames]=useState({}),[selected,setSelected]=useState(null),[selectedRequest,setSelectedRequest]=useState(null),[chatOpen,setChatOpen]=useState(false),[rating,setRating]=useState('5'),[review,setReview]=useState(''),[rebookSlot,setRebookSlot]=useState(''),[rebookAddress,setRebookAddress]=useState(''),[rebookRequirement,setRebookRequirement]=useState(''),[rebookAvailable,setRebookAvailable]=useState(false),[rebookBusy,setRebookBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const load=useCallback(async()=>{if(!user?.id){setOrders([]);setRequests([]);setLoading(false);return;}setLoading(true);setError('');try{const [partnerOrders,serviceRequests]=await Promise.all([readRows('partner_orders',q=>q.eq('customer_id',user.id).order('created_at',{ascending:false})),readRows('service_requests',q=>q.eq('customer_id',user.id).order('created_at',{ascending:false}))]);setOrders(partnerOrders);setRequests(serviceRequests);}catch(e){setError(e.message);}finally{setLoading(false);}},[user?.id]);
  useEffect(()=>{load();},[load,revision]);
  useEffect(()=>{let active=true;const ids=[...new Set(orders.map(o=>o.post_id).filter(Boolean))];if(ids.length)readRows('partner_directory',q=>q.in('id',ids)).then(rows=>{if(active)setPostNames(Object.fromEntries(rows.map(row=>[row.id,row.display_name])));}).catch(()=>{});return()=>{active=false;};},[orders]);
  useEffect(()=>{let active=true;const ids=[...new Set(requests.map(row=>row.assigned_vendor_id).filter(Boolean))];if(ids.length)readRows('vendor_directory',q=>q.in('id',ids)).then(rows=>{if(active)setVendorNames(Object.fromEntries(rows.map(row=>[row.id,row.display_name||row.business_name])));}).catch(()=>{});return()=>{active=false;};},[requests]);
  useEffect(()=>{let active=true;setRebookAvailable(false);setRebookSlot('');setRebookAddress('');setRebookRequirement('');if(selected?.role==='professional'&&selected.status==='completed'&&selected.post_id)readRows('partner_directory',q=>q.eq('id',selected.post_id).limit(1)).then(rows=>{if(active)setRebookAvailable(rows.length>0);}).catch(()=>{});return()=>{active=false;};},[selected]);
  async function rebook(){if(rebookBusy||!rebookSlot||!rebookAddress.trim()||!rebookRequirement.trim())return;setRebookBusy(true);try{const posts=await readRows('partner_directory',q=>q.eq('id',selected.post_id).limit(1));if(!posts.length)throw new Error('This service is no longer available.');await requestProfessionalBooking({partnerPostId:selected.post_id,slot:new Date(rebookSlot).toISOString(),idempotencyKey:crypto.randomUUID(),backup:false,city:selected.match_city||posts[0].city,address:rebookAddress.trim(),requirement:rebookRequirement.trim()});notify('New request sent. The professional must accept it before confirmation.');setSelected(null);await load();}catch(error){notify(error.message);}finally{setRebookBusy(false);}}
  const merged=mergeCustomerBookings(requests,orders);
  const currentOrder=orders.find(row=>row.id===selected?.id)||selected;
  const currentRequest=requests.find(row=>row.id===selectedRequest?.id)||selectedRequest;
  if(!user) return <p>{t('Sign in to view your bookings.')}</p>;
  return <section>
    {loading&&<p role="status">{t('Loading bookings…')}</p>}
    {error&&<p role="alert">{t('Could not load bookings: ')}{error} <button className="btn btn-outline" onClick={load}>{t('Retry')}</button></p>}
    {!loading&&!error&&merged.map(({type,record,status})=>{
      const name=type==='partner'?postNames[record.post_id]:vendorNames[record.assigned_vendor_id];
      return <button className="choice" key={type+'-'+record.id} onClick={()=>{setChatOpen(false);if(type==='partner'){setSelected(record);setSelectedRequest(null);}else{setSelectedRequest(record);setSelected(null);}}}>
        <b>{type==='partner'?record.title:record.service_name}</b>
        {(name||type==='partner'&&['professional','consultant'].includes(record.role)||type==='request'&&record.assigned_vendor_id)&&<span>{name||t(record.role==='consultant'?'Consultant name unavailable':'Assigned professional name unavailable')}</span>}
        <small>{t(status)} · {new Date(record.created_at).toLocaleString('en-IN')}{type==='partner'&&record.deadline&&' · '+t('Preferred')+' '+new Date(record.deadline).toLocaleString('en-IN')}</small>
      </button>;
    })}
    {!loading&&!error&&!merged.length&&<p>{t('No bookings yet')}</p>}
    {currentRequest&&<Sheet onClose={()=>setSelectedRequest(null)}>
      <GeneralRequestDetail key={currentRequest.id} request={currentRequest} vendorName={vendorNames[currentRequest.assigned_vendor_id]} notify={notify} onChange={load}/>
    </Sheet>}
    {currentOrder&&<Sheet onClose={()=>setSelected(null)}>
      <OrderDetail customer order={currentOrder} notify={notify} onChange={load}/>
      {['professional','consultant'].includes(currentOrder.role)&&<p role="status">{postNames[currentOrder.post_id]||t(currentOrder.role==='consultant'?'Consultant name unavailable':'Professional name unavailable')} · {t(partnerBookingStatus(currentOrder))}</p>}
      <button className="btn btn-outline full" onClick={()=>setChatOpen(value=>!value)}>{chatOpen?t('Hide secure messages'):t('Open secure messages')}</button>
      {chatOpen&&<ChatWorkspace initialOrderId={currentOrder.id} notify={notify} embedded/>}
      {currentOrder.status==='completed'&&<>
        <form onSubmit={async event=>{event.preventDefault();try{await rpc('review_seller_order',{p_order:currentOrder.id,p_rating:Number(rating),p_body:review});notify('Review submitted for moderation');}catch(error){notify(error.message);}}}>
          <Field label={t('Rating')} as="select" options={['1','2','3','4','5']} value={rating} onChange={event=>setRating(event.target.value)}/>
          <Field label={t('Review')} as="textarea" value={review} onChange={event=>setReview(event.target.value)} required/>
          <button className="btn btn-primary">{t('Submit review')}</button>
        </form>
        {rebookAvailable&&<div>
          <Field label={t('Service address')} value={rebookAddress} onChange={event=>setRebookAddress(event.target.value)} required maxLength={500}/>
          <Field label={t('What work do you need?')} as="textarea" value={rebookRequirement} onChange={event=>setRebookRequirement(event.target.value)} required maxLength={1000}/>
          <Field label={t('Preferred time for a new request')} type="datetime-local" value={rebookSlot} onChange={event=>setRebookSlot(event.target.value)}/>
          <button className="btn btn-outline full" disabled={!rebookSlot||!rebookAddress.trim()||!rebookRequirement.trim()||rebookBusy} onClick={rebook}>{t('Rebook this service')}</button>
        </div>}
      </>}
    </Sheet>}
  </section>;
}

function GeneralRequestDetail({request,vendorName,notify,onChange}) {
  const [busy,setBusy]=useState(false);
  async function cancel(){
    const reason=window.prompt('Cancellation reason');
    if(!reason?.trim()||busy)return;
    setBusy(true);
    try{
      await rpc('request_booking_cancellation',{p_booking_id:request.id,p_reason:reason.trim(),p_idempotency_key:crypto.randomUUID()});
      await onChange();
      notify('Cancellation recorded. Refund processing remains a separate status.');
    }catch(error){notify(error.message);}
    finally{setBusy(false);}
  }
  return <section className="seller-panel">
    <h2>{request.service_name}</h2>
    <p>EAZ-{request.id.slice(0,8).toUpperCase()} · {t(serviceRequestStatus(request))}</p>
    <p>{t('Requested')}: {new Date(request.created_at).toLocaleString('en-IN')}</p>
    {(request.details?.date||request.details?.preferredDate)&&<p><b>{t('Preferred date')}:</b> {request.details.date||request.details.preferredDate}</p>}
    {request.request_type==='service'&&<p>{request.assigned_vendor_id?(vendorName||t('Professional assigned; name unavailable')):t('No professional assigned yet.')}</p>}
    {(request.details?.location||request.details?.city)&&<p><b>{t('Service location')}:</b> {request.details.location||request.details.city}</p>}
    {(request.details?.description||request.details?.requirement)&&<p><b>{t('Work requirement')}:</b> {request.details.description||request.details.requirement}</p>}
    {request.quoted_total!=null&&<p><b>{t('Quoted total')}:</b> ₹{Number(request.quoted_total).toLocaleString('en-IN')}</p>}
    {request.quoted_total!=null&&request.payment_status==='unpaid'&&request.status!=='cancelled'&&<WalletCheckout booking={request} notify={notify}/>}
    {['pending','accepted'].includes(request.status)&&<button className="btn btn-outline" disabled={busy} onClick={cancel}>{t('Cancel request')}</button>}
  </section>;
}
