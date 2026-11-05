import { createClient } from 'npm:@supabase/supabase-js@2';
Deno.serve(async req => {
  if (Deno.env.get('EAZILY_FINANCIAL_PROVIDERS_ENABLED') !== 'true') return new Response('Financial providers are disabled', { status: 503 });
  if (!Deno.env.get('CASHFREE_INTERNAL_SECRET') || req.headers.get('x-eazily-internal-secret') !== Deno.env.get('CASHFREE_INTERNAL_SECRET')) return new Response(JSON.stringify({error:'Trusted workflow authentication required'}),{status:401});
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!); const {orderId}=await req.json();
  // Invoke from a trusted workflow only after both parties confirm the scope. Never expose this function directly to clients.
  const {data:c}=await admin.from('cashfree_collaborations').select('*,partner_orders!inner(status)').eq('order_id',orderId).eq('payment_status','paid').single();
  if(!c||c.scope_confirmed_at||!c.cashfree_vendor_id) return new Response(JSON.stringify({error:'Paid, vendor-onboarded, unprocessed collaboration required'}),{status:409});
  const response=await fetch(`${Deno.env.get('CASHFREE_BASE_URL')||'https://sandbox.cashfree.com'}/pg/easy-split/orders/${c.cashfree_order_id}/split`,{method:'POST',headers:{'content-type':'application/json','x-api-version':'2025-01-01','x-client-id':Deno.env.get('CASHFREE_CLIENT_ID')!,'x-client-secret':Deno.env.get('CASHFREE_CLIENT_SECRET')!,'x-idempotency-key':`initial-${orderId}`},body:JSON.stringify({split:[{vendor_id:c.cashfree_vendor_id,amount:c.initial_release}]})});
  const body=await response.json(); if(!response.ok)return new Response(JSON.stringify({error:'Cashfree split failed',provider:body}),{status:502});
  await admin.from('cashfree_collaborations').update({scope_confirmed_at:new Date().toISOString(),initial_split_reference:body.split_id||body.reference_id,raw_provider_state:body}).eq('order_id',orderId).is('scope_confirmed_at',null);
  await admin.from('partner_earnings').upsert([{partner_id:c.partner_orders.partner_id,order_id:orderId,role:'influencer',state:'pending',amount:c.initial_release,provider_reference:body.split_id||body.reference_id},{partner_id:c.partner_orders.partner_id,order_id:orderId,role:'influencer',state:'security_hold',amount:c.security_hold}],{onConflict:'order_id,state'});
  return new Response(JSON.stringify({ok:true}),{headers:{'content-type':'application/json'}});
});
