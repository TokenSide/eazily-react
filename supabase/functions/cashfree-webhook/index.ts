import { createClient } from 'npm:@supabase/supabase-js@2';
const encoder = new TextEncoder();
const equal = (a: string, b: string) => { if (a.length !== b.length) return false; let out=0; for(let i=0;i<a.length;i++) out|=a.charCodeAt(i)^b.charCodeAt(i); return out===0; };
Deno.serve(async req => {
  if (Deno.env.get('EAZILY_FINANCIAL_PROVIDERS_ENABLED') !== 'true') return new Response('Financial providers are disabled', { status: 503 });
  const raw = await req.text(), timestamp = req.headers.get('x-webhook-timestamp') || '', signature = req.headers.get('x-webhook-signature') || '';
  const key = await crypto.subtle.importKey('raw', encoder.encode(Deno.env.get('CASHFREE_CLIENT_SECRET')!), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(timestamp + raw));
  const expected = btoa(String.fromCharCode(...new Uint8Array(signed)));
  if (!equal(signature, expected)) return new Response('Invalid signature', { status: 401 });
  const event = JSON.parse(raw), cashfreeOrderId = event.data?.order?.order_id;
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  if (typeof cashfreeOrderId === 'string' && /^eazq_[a-f0-9]{32}$/i.test(cashfreeOrderId)) {
    const rawId = cashfreeOrderId.slice(5);
    const requestId = `${rawId.slice(0,8)}-${rawId.slice(8,12)}-${rawId.slice(12,16)}-${rawId.slice(16,20)}-${rawId.slice(20)}`;
    if (event.type !== 'PAYMENT_SUCCESS_WEBHOOK') return new Response('Pending payment retained');
    const paymentId = event.data?.payment?.cf_payment_id;
    const amount = String(event.data?.payment?.payment_amount ?? '');
    if (!paymentId || !/^\d+(\.\d{1,2})?$/.test(amount)) return new Response('Invalid payment amount or reference', {status:400});
    const [whole, decimal=''] = amount.split('.');
    const {error} = await admin.rpc('record_verified_seller_payment', {p_request:requestId,p_event:`cashfree:${paymentId}`,p_amount:Number(whole)*100+Number(decimal.padEnd(2,'0')),p_currency:event.data.payment.payment_currency});
    return new Response(error ? 'Payment requires reconciliation' : 'ok', {status:error?409:200});
  }
  const { data: collaboration } = await admin.from('cashfree_collaborations').select('*').eq('cashfree_order_id', cashfreeOrderId).single();
  if (!collaboration) return new Response('Unknown order', { status: 404 });
  if (event.type === 'PAYMENT_SUCCESS_WEBHOOK') {
    if (Number(event.data.payment.payment_amount) !== Number(collaboration.customer_total) || event.data.payment.payment_currency !== 'INR') return new Response('Amount mismatch', { status: 409 });
    const { data: paid, error } = await admin.from('cashfree_collaborations')
      .update({ payment_status: 'paid', raw_provider_state: event.data })
      .eq('order_id', collaboration.order_id).in('payment_status', ['pending', 'failed'])
      .select('order_id').maybeSingle();
    if (error) return new Response('Payment requires reconciliation', { status: 503 });
    if (paid) {
      const { error: orderError } = await admin.from('partner_orders')
        .update({ status: 'awaiting_acceptance' }).eq('id', collaboration.order_id)
        .eq('status', 'pending_payment');
      if (orderError) return new Response('Order requires reconciliation', { status: 503 });
    }
  } else if (event.type === 'PAYMENT_FAILED_WEBHOOK') {
    const { error } = await admin.from('cashfree_collaborations')
      .update({ payment_status: 'failed', raw_provider_state: event.data })
      .eq('order_id', collaboration.order_id).eq('payment_status', 'pending');
    if (error) return new Response('Payment requires reconciliation', { status: 503 });
  }
  return new Response('ok');
});
