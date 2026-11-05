import { createClient } from 'npm:@supabase/supabase-js@2';
Deno.serve(async req => {
  if (Deno.env.get('EAZILY_FINANCIAL_PROVIDERS_ENABLED') !== 'true') return new Response('Financial providers are disabled', { status: 503 });
  if (!Deno.env.get('CASHFREE_INTERNAL_SECRET') || req.headers.get('x-eazily-internal-secret') !== Deno.env.get('CASHFREE_INTERNAL_SECRET')) return new Response(JSON.stringify({error:'Trusted workflow authentication required'}),{status:401});
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!); const {orderId}=await req.json();
  // Invoke from a trusted acceptance/dispute workflow only. Customer-facing callbacks cannot release funds.
  const {data:c}=await admin.from('cashfree_collaborations').select('*,partner_orders!inner(partner_id,status)').eq('order_id',orderId).eq('payment_status','paid').single();
  if(!c||!c.scope_confirmed_at||c.hold_release_reference||c.partner_orders.status!=='completed') return new Response(JSON.stringify({error:'Completed, accepted collaboration with an unreleased hold required'}),{status:409});
  const response=await fetch(`${Deno.env.get('CASHFREE_BASE_URL')||'https://sandbox.cashfree.com'}/pg/easy-split/vendors/${c.cashfree_vendor_id}/transfer`,{method:'POST',headers:{'content-type':'application/json','x-api-version':Deno.env.get('CASHFREE_SPLIT_API_VERSION')||'2022-09-01','x-client-id':Deno.env.get('CASHFREE_CLIENT_ID')!,'x-client-secret':Deno.env.get('CASHFREE_CLIENT_SECRET')!},body:JSON.stringify({transfer_from:'MERCHANT',transfer_type:'ADJUSTMENT',transfer_amount:c.security_hold,remark:`Release security hold ${orderId}`,tags:{order_id:orderId}})});
  const body=await response.json(); if(!response.ok)return new Response(JSON.stringify({error:'Cashfree hold release failed',provider:body}),{status:502});
  const reference=body.transfer_id||body.reference_id||crypto.randomUUID();
  await admin.from('cashfree_collaborations').update({hold_release_reference:reference,raw_provider_state:body}).eq('order_id',orderId).is('hold_release_reference',null);
  await admin.from('partner_earnings').update({state:'available',provider_reference:reference}).eq('order_id',orderId).eq('state','security_hold');
  return new Response(JSON.stringify({ok:true}),{headers:{'content-type':'application/json'}});
});
