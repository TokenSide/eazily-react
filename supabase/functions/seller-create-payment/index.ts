import { createClient } from 'npm:@supabase/supabase-js@2';
const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info' };
const json = (body: unknown, status=200) => new Response(JSON.stringify(body),{status,headers});
Deno.serve(async req => {
  if (Deno.env.get('EAZILY_FINANCIAL_PROVIDERS_ENABLED') !== 'true') return new Response('Financial providers are disabled', { status: 503 });
 if(req.method==='OPTIONS') return new Response('ok',{headers});
 if(req.method!=='POST') return json({error:'Method not allowed'},405);
 try {
  const url=Deno.env.get('SUPABASE_URL')!, secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const userClient=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:req.headers.get('authorization')||''}}});
  const {data:{user}}=await userClient.auth.getUser(); if(!user) return json({error:'Sign in required'},401);
  const {requestId}=await req.json(); if(typeof requestId!=='string'||!/^[0-9a-f-]{36}$/i.test(requestId)) return json({error:'Invalid payment reference'},400);
  const clientId=Deno.env.get('CASHFREE_CLIENT_ID'),clientSecret=Deno.env.get('CASHFREE_CLIENT_SECRET'),base=Deno.env.get('CASHFREE_BASE_URL');
  if(!clientId||!clientSecret||!['https://sandbox.cashfree.com','https://api.cashfree.com'].includes(base||'')) return json({error:'Official payment provider is not configured'},503);
  const admin=createClient(url,secret); const {data:payment,error}=await admin.rpc('prepare_seller_gateway',{p_request:requestId,p_customer:user.id});
  if(error) return json({error:error.message},409);
  const orderId='eazq_'+requestId.replaceAll('-','');
  const response=await fetch(base+'/pg/orders',{method:'POST',headers:{'content-type':'application/json','x-api-version':'2025-01-01','x-client-id':clientId,'x-client-secret':clientSecret,'x-idempotency-key':requestId},body:JSON.stringify({order_id:orderId,order_amount:payment.amountPaise/100,order_currency:'INR',customer_details:{customer_id:user.id,customer_phone:user.phone?.replace(/^\+91/,'')},order_meta:{notify_url:url+'/functions/v1/cashfree-webhook'},order_note:'Eazily booking '+payment.orderId})});
  let payload=await response.json();
  if(response.status===409){const existing=await fetch(base+'/pg/orders/'+orderId,{headers:{'x-api-version':'2025-01-01','x-client-id':clientId,'x-client-secret':clientSecret}});payload=await existing.json();if(!existing.ok)return json({error:'Payment request could not be restored'},502);}
  else if(!response.ok)return json({error:'The payment provider could not create checkout. Retry with the same request.'},502);
  if(!payload.payment_session_id)return json({error:'Payment provider did not return a checkout session'},502);
  return json({paymentSessionId:payload.payment_session_id,mode:base.includes('sandbox')?'sandbox':'production'});
 }catch{return json({error:'Payment checkout is temporarily unavailable'},503);}
});
