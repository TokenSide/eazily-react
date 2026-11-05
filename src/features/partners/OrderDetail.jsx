import { useEffect, useRef, useState } from 'react';
import { Field } from '../../components/Ui.jsx';
import { readRows, rpc } from '../../services/experience.js';
import { translate as t } from '../../lib/translate.js';
import { openOfficialCheckout } from '../../services/paymentCheckout.js';
import { useRealtime } from '../../lib/realtime.jsx';
import { getServiceBookingEstimate } from '../../services/marketplace.js';
import SupportForm from '../account/SupportForm.jsx';
const money = n => new Intl.NumberFormat('en-IN',{ style:'currency',currency:'INR' }).format(Number(n || 0)/100);
const paise = value => { if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('Enter a valid amount with at most two decimal places'); const [whole, decimal=''] = value.split('.'); return Number(whole)*100+Number(decimal.padEnd(2,'0')); };
function BookingAlternatives({ order, notify, onChange }) {
  const [options,setOptions] = useState([]), [loading,setLoading] = useState(true);
  const [chosen,setChosen] = useState(null), [slot,setSlot] = useState(''), [approved,setApproved] = useState(false), [busy,setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  useEffect(() => {
    if (!order.match_service || !order.match_city) return undefined;
    let active = true;
    readRows('partner_directory',query=>query.eq('partner_role','professional').eq('city',order.match_city)
      .eq('available_now',true).overlaps('service_names',[order.match_service]).limit(20))
      .then(async rows => {
        const seen = new Set();
        const candidates = rows.filter(row => {
          if (row.partner_id===order.partner_id || seen.has(row.partner_id)) return false;
          seen.add(row.partner_id); return true;
        }).slice(0,3);
        const priced = await Promise.all(candidates.map(async row => ({ ...row,
          estimate: await getServiceBookingEstimate(row.id).catch(() => ({ available:false }))
        })));
        if (active) setOptions(priced);
      }).catch(error => { if (active) notify(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  },[order.id,order.match_city,order.match_service,order.partner_id,notify]);
  async function submit(event) {
    event.preventDefault();
    if (!chosen?.estimate?.available || !approved || !slot || busy) return;
    setBusy(true);
    try {
      await rpc('request_selected_alternative_booking',{
        p_original:order.id,p_post:chosen.id,p_slot:new Date(slot).toISOString(),
        p_key:key.current,p_approved_estimate:chosen.estimate
      });
      key.current=crypto.randomUUID();
      notify('New request sent to your selected professional. The earlier booking remains cancelled.');
      await onChange?.();
      setChosen(null);setApproved(false);setSlot('');
    } catch(error) { notify(error.message); }
    finally { setBusy(false); }
  }
  return <section className="seller-panel"><h3>{t('Choose another professional')}</h3>
    <p>{t('This request ended. No other professional received or accepted it. Select a new professional and review their price before sending a separate request.')}</p>
    {!order.match_service || !order.match_city ? <p>{t('Open the service list to compare current professionals and prices.')}</p> : loading ? <p>{t('Checking available alternatives…')}</p> : options.length ? <>
      {options.map(option=><div className="choice" key={option.id}><b>{t(option.display_name || option.business_name)}</b><p>{t(order.match_service)} · {t(option.city)}</p>
        {option.estimate?.available ? <p>{t('Estimated payable')}: <b>{money(option.estimate.totalPaise)}</b> · {t('Service')} {money(option.estimate.servicePaise)} · {t('Visit')} {money(option.estimate.visitingPaise)} · {t('Platform')} {money(option.estimate.platformPaise)} · {t('Tax')} {money(option.estimate.taxPaise)}</p> : <p>{t('A confirmed price breakdown is unavailable. You cannot request this alternative here yet.')}</p>}
        {option.estimate?.available&&<button type="button" className="btn btn-outline" onClick={()=>{setChosen(option);setApproved(false);}}>{t('Select this professional')}</button>}
      </div>)}
      {chosen&&<form onSubmit={submit}><p>{t(chosen.display_name || chosen.business_name)} · {t('Estimated payable')} {money(chosen.estimate.totalPaise)}</p><Field label={t('Preferred date and time')} type="datetime-local" value={slot} onChange={event=>setSlot(event.target.value)} required/><label className="consent"><input type="checkbox" checked={approved} onChange={event=>setApproved(event.target.checked)}/>{t(`I choose ${chosen.display_name || chosen.business_name} and approve the displayed estimate of ${money(chosen.estimate.totalPaise)} for this new request.`)}</label><button className="btn btn-primary" disabled={!approved||!slot||busy}>{t('Send new request')}</button></form>}
    </> : <p>{t('No other available professionals for this service and city right now.')}</p>}
  </section>;
}
export default function OrderDetail({ order, customer = false, notify, onChange }) {
  const { revision, networkOnline } = useRealtime();
  const [quote,setQuote] = useState(null), [events,setEvents] = useState([]), [otp,setOtp] = useState(''), [reason,setReason] = useState(''), [busy,setBusy] = useState(false);
  const [intake,setIntake] = useState(null);
  const [intakeError,setIntakeError] = useState(false);
  const [offerAvailable,setOfferAvailable] = useState(null);
  const [input,setInput] = useState({service:'',visit:'0',extra:'0',quantity:'1',scope:'',taxInclusive:false});
  const [issueText,setIssueText] = useState(''), [issues,setIssues] = useState([]);
  const [helpOpen,setHelpOpen] = useState(false);
  const key = useRef(crypto.randomUUID());
  async function reload() { const [q,e] = await Promise.all([rpc('get_order_quote',{p_order:order.id}),readRows('seller_order_events',q=>q.eq('order_id',order.id).order('created_at'))]); setQuote(q);setEvents(e); }
  useEffect(() => { let active=true; Promise.all([rpc('get_order_quote',{p_order:order.id}),readRows('seller_order_events',q=>q.eq('order_id',order.id).order('created_at'))]).then(([q,e])=>{if(active){setQuote(q);setEvents(e);}}).catch(e=>notify(e.message));return()=>{active=false;}; },[order.id,notify,revision]);
  useEffect(() => { if(order.role!=='professional')return undefined;let active=true;setIntake(null);setIntakeError(false);rpc('get_service_booking_intake',{p_order:order.id}).then(value=>{if(active)setIntake(value);}).catch(()=>{if(active)setIntakeError(true);});return()=>{active=false;}; },[order.id,order.role,order.status,revision]);
  useEffect(() => {
    if (customer || order.role !== 'professional' || order.status !== 'requested' || order.backup_price_approval_pending) return undefined;
    let active = true, timer;
    setOfferAvailable(null);
    readRows('service_booking_offers', query => query.eq('order_id', order.id).eq('partner_id', order.partner_id).eq('status', 'offered').limit(1))
      .then(rows => {
        if (!active) return;
        const remaining = rows[0] ? Date.parse(rows[0].expires_at) - Date.now() : 0;
        setOfferAvailable(remaining > 0);
        if (remaining > 0) timer = setTimeout(() => setOfferAvailable(false), remaining);
      }).catch(() => { if (active) setOfferAvailable(false); });
    return () => { active = false; clearTimeout(timer); };
  }, [customer, order.id, order.partner_id, order.role, order.status, order.backup_price_approval_pending, revision]);
  useEffect(() => { if(!customer||order.role!=='professional'||order.status!=='completed')return;let active=true;readRows('support_tickets',q=>q.eq('partner_order_id',order.id).order('created_at',{ascending:false})).then(rows=>{if(active)setIssues(rows);}).catch(()=>{});return()=>{active=false;}; },[customer,order.id,order.role,order.status,revision]);
  async function action(fn) { if(busy)return;if(!networkOnline){notify('You are offline. Reconnect before changing this booking.');return;}setBusy(true);try{await fn();await reload();await onChange?.();}catch(e){notify(e.message);}finally{setBusy(false);} }
  const field = (name,label,props={}) => <Field label={t(label)} value={input[name]} onChange={e=>setInput(v=>({...v,[name]:e.target.value}))} {...props}/>;
  return <section className="seller-panel"><h2>{order.title}</h2><p>EAZ-{order.id.slice(0,8).toUpperCase()} · {t(order.backup_price_approval_pending ? 'Backup price approval needed' : order.role==='professional' && order.journey_status==='on_the_way' && order.status==='accepted' ? 'On the way' : order.role==='consultant' && order.status==='requested' ? (customer ? 'Consultation enquiry sent' : 'Enquiry received') : order.role==='consultant' && order.status==='accepted' ? (customer ? 'Consultation enquiry accepted' : 'Enquiry accepted') : customer && order.role==='professional' ? ({requested:'Requested · awaiting professional',accepted:'Accepted · Confirmed',active:'In progress',awaiting_acceptance:'Awaiting customer confirmation',completed:'Completed',cancelled:'Cancelled'}[order.status] || order.status) : order.status)}</p>{order.deadline&&<p>{new Date(order.deadline).toLocaleString('en-IN')}</p>}
    {intake&&<section className="payment-breakdown"><h3>{t('Work requirement')}</h3><p>{intake.requirement}</p>{intake.address&&<p><b>{t('Service address')}:</b> {intake.address}</p>}</section>}
    {intakeError&&<p role="status">{t('Booking work details are unavailable. Please try again later.')}</p>}
    {customer&&order.role==='professional'&&order.status==='requested'&&<p>{t(order.details?.matchResult || 'Waiting for the selected professional to respond.')}{order.response_due_at&&` · ${t('Response due')} ${new Date(order.response_due_at).toLocaleString('en-IN')}`}</p>}
    {order.role==='professional'&&order.backup_price_approval_pending&&(customer?<section className="payment-breakdown"><h3>{t('Review backup professional price')}</h3><p>{t('The backup professional accepted, but this booking is not Confirmed until you approve the changed estimate.')}</p>{order.details?.initialEstimate?.available&&<p>{t('Original professional estimate')}: <b>{money(order.details.initialEstimate.totalPaise)}</b></p>}{[['servicePaise','Service price'],['visitingPaise','Visiting charge'],['platformPaise','Platform charges'],['taxPaise','Applicable tax'],['totalPaise','Estimated payable']].map(([key,label])=><p key={key}>{t(label)}: <b>{money(order.details?.backupEstimate?.[key])}</b></p>)}<button className="btn btn-primary" disabled={busy||!networkOnline||!order.details?.backupEstimate?.available} onClick={()=>action(()=>rpc('customer_respond_backup_price',{p_order:order.id,p_approve:true,p_estimate:order.details.backupEstimate}))}>{t('Approve backup price and confirm')}</button><button className="btn btn-outline" disabled={busy||!networkOnline} onClick={()=>action(()=>rpc('customer_respond_backup_price',{p_order:order.id,p_approve:false,p_estimate:order.details?.backupEstimate||null}))}>{t('Decline backup price')}</button></section>:<p>{t('You accepted the backup offer. Waiting for customer price approval; this booking is not Confirmed yet.')}</p>)}
    {customer&&order.role==='professional'&&order.status==='cancelled'&&order.match_mode!=='find_professional'&&<BookingAlternatives order={order} notify={notify} onChange={onChange}/>}
    {!networkOnline&&<p className="testing-notice" role="status">Offline. Booking and payment actions are available again after reconnecting.</p>}
    {!customer && order.status==='requested' && !order.backup_price_approval_pending && (order.role!=='professional'||offerAvailable===true) && <><Field label={t('Reason')} value={reason} onChange={e=>setReason(e.target.value)}/><div className="post-actions">{['accept','reject'].map(a=><button className="btn btn-outline" disabled={busy||!networkOnline} key={a} onClick={()=>action(()=>rpc('change_seller_order',{p_order:order.id,p_action:a,p_reason:reason}))}>{t(a==='accept'?'Accept':'Reject')}</button>)}</div></>}
    {!customer && order.role==='professional' && order.status==='requested' && !order.backup_price_approval_pending && offerAvailable===false && <p role="status">{t('No current offer is available. An expired offer cannot be accepted.')}</p>}
    {!customer&&order.role==='professional'&&order.status==='accepted'&&order.journey_status!=='on_the_way'&&<button className="btn btn-outline" disabled={busy||!networkOnline} onClick={()=>action(()=>rpc('change_seller_order',{p_order:order.id,p_action:'on_the_way',p_reason:''}))}>{t('Mark on the way')}</button>}
    {order.role==='professional'&&order.status==='accepted'&&(customer?<><button className="btn btn-primary" disabled={busy} onClick={()=>action(async()=>setOtp(await rpc('get_booking_otp',{p_order:order.id})))}>{t('Show booking verification code')}</button>{otp&&<p><b>{otp}</b> · {t('For this booking arrival only. Not a payment code.')}</p>}</>:<><Field label={t('Booking verification code')} inputMode="numeric" maxLength={6} value={otp} onChange={e=>setOtp(e.target.value)}/><button className="btn btn-primary" disabled={busy} onClick={()=>action(async()=>{const result=await rpc('verify_booking_arrival',{p_order:order.id,p_otp:otp});notify(result.verified?'Arrival verified':result.message);})}>{t('Verify arrival')}</button></>)}
    {!customer&&order.role==='professional'&&['active','awaiting_acceptance'].includes(order.status)&&quote?.status!=='paid'&&<form onSubmit={e=>{e.preventDefault();action(async()=>{await rpc('create_seller_quote',{p_order:order.id,p_input:{servicePaise:paise(input.service),visitingPaise:paise(input.visit),additionalPaise:paise(input.extra),quantity:Number(input.quantity),taxInclusive:input.taxInclusive},p_scope:input.scope,p_key:key.current});key.current=crypto.randomUUID();});}}><h3>{t('Work completed — final quote')}</h3>{field('scope','Completed work',{required:true,as:'textarea'})}{field('service','Your service price (₹)',{required:true,inputMode:'decimal'})}{field('visit','Visiting charge (₹)',{required:true,inputMode:'decimal'})}{field('extra','Additional work (₹)',{required:true,inputMode:'decimal'})}{field('quantity','Quantity',{type:'number',min:1,required:true})}<label className="consent"><input type="checkbox" checked={input.taxInclusive} onChange={e=>setInput(v=>({...v,taxInclusive:e.target.checked}))}/>{t('My entered prices include applicable GST')}</label><button className="btn btn-primary" disabled={busy}>{t('Send final quote')}</button></form>}
    {!customer&&order.status==='disputed'&&<button className="btn btn-outline" disabled={busy} onClick={()=>action(()=>rpc('change_seller_order',{p_order:order.id,p_action:'correct_quote'}))}>{t('Prepare corrected quote')}</button>}
    {quote&&<section className="payment-breakdown"><h3>{t('Final Service Quote')} · {quote.version}</h3><p>{quote.scope}</p><p>{t(quote.status)}</p>{(customer?[['servicePaise','Service price'],['feePaise','Platform fee'],['taxPaise','Applicable GST'],['totalPaise','Total payable']]:[['sellerBasePaise','Your price'],['sellerTaxPaise','Your applicable tax'],['sellerPayablePaise','Your payable amount']]).map(([key,label])=>quote[key]!=null&&<p key={key}>{t(label)}: <b>{money(quote[key])}</b></p>)}
      {customer&&quote.status==='proposed'&&<><Field label={t('Correction or dispute reason')} value={reason} onChange={e=>setReason(e.target.value)}/><button className="btn btn-primary" disabled={busy} onClick={()=>action(()=>rpc('respond_to_quote',{p_order:order.id,p_quote:quote.id,p_approve:true}))}>{t(order.role==='professional'?'Approve final quote':order.role==='consultant'?'Approve proposed quote':'YES — Approve & Pay')}</button><button className="btn btn-outline" disabled={busy} onClick={()=>action(()=>rpc('respond_to_quote',{p_order:order.id,p_quote:quote.id,p_approve:false,p_reason:reason}))}>{t('NO — Request Correction')}</button></>}
      {customer&&quote.status==='approved'&&<><p>{t(order.role==='professional'||order.role==='consultant'?'Official checkout is available only when enabled. Do not pay to a personal QR code.':'Use official Eazily payments. Payments to personal QR codes may not be protected.')}</p><button className="btn btn-primary" disabled={busy} onClick={()=>action(async()=>{const result=await rpc('request_official_payment',{p_order:order.id,p_quote:quote.id});if(result.providerReady)await openOfficialCheckout(result.id);else notify(result.message);})}>{t(order.role==='professional'||order.role==='consultant'?'Check official payment availability':'Pay Securely Through Eazily')}</button></>}
    </section>}
    {customer&&order.status==='awaiting_acceptance'&&<button className="btn btn-outline" disabled={busy} onClick={()=>action(()=>rpc('change_seller_order',{p_order:order.id,p_action:'complete'}))}>{t('Confirm work completed')}</button>}
    {customer&&order.role==='professional'&&order.status==='completed'&&<section><h3>{t('Report a service issue')}</h3><p>{t('Support will review this booking. No warranty or refund outcome is promised here.')}</p><form onSubmit={event=>{event.preventDefault();action(async()=>{await rpc('report_service_booking_issue',{p_order:order.id,p_description:issueText});setIssueText('');setIssues(await readRows('support_tickets',q=>q.eq('partner_order_id',order.id).order('created_at',{ascending:false})));notify('Issue sent to support.');});}}><Field label={t('What happened?')} as="textarea" value={issueText} onChange={event=>setIssueText(event.target.value)} required minLength={10} maxLength={5000}/><button className="btn btn-outline" disabled={busy||!networkOnline}>{t('Send issue to support')}</button></form>{issues.map(issue=><p key={issue.id}>{t('Issue')} {issue.id.slice(0,8)} · {t(issue.status)}</p>)}</section>}
    {customer&&!(order.role==='professional'&&order.status==='completed')&&<section className="booking-problem"><h3>{t('Problem with this booking?')}</h3><p>{t('Not arrived, running late, asked for extra money or feeling unsafe? Tell support now — this booking is attached automatically.')}</p>{helpOpen?<SupportForm notify={notify} initialBooking={`partner:${order.id}`} bookingContext={order}/>:<button type="button" className="btn btn-outline" onClick={()=>setHelpOpen(true)}>{t('Report a problem')}</button>}</section>}
    {customer&&quote?.status==='paid'&&<><Field label={t('Refund issue')} value={reason} onChange={e=>setReason(e.target.value)}/><button className="btn btn-outline" disabled={busy} onClick={()=>action(async()=>{await rpc('request_seller_refund',{p_order:order.id,p_reason:reason});notify('Refund requested. Eazily will review the issue.');})}>{t('Request refund review')}</button></>}
    <h3>{t('Booking history')}</h3>{events.map(e=><p key={e.id}>{t(e.kind)} · {new Date(e.created_at).toLocaleString('en-IN')}{e.notes&&<> · {e.notes}</>}</p>)}
  </section>;
}
