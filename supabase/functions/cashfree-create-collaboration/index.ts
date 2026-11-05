import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
Deno.serve(async req => {
  if (Deno.env.get('EAZILY_FINANCIAL_PROVIDERS_ENABLED') !== 'true') return new Response('Financial providers are disabled', { status: 503 });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const auth = req.headers.get('authorization') || '';
  const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const admin = createClient(url, service);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'Sign in required' }, 401);
  const { postId } = await req.json();
  const { data: config } = await admin.from('partner_config').select('*').single();
  if (!config?.cashfree_enabled) return json({ error: 'Cashfree checkout is not enabled' }, 503);
  const { data: post } = await admin.from('partner_posts').select('*,partner_applications!inner(*)').eq('id', postId).eq('role', 'influencer').eq('status', 'published').single();
  if (!post) return json({ error: 'Published collaboration not found' }, 404);
  const customerTotal = Number(post.details.packagePrice), fee = Math.round(customerTotal * Number(config.influencer_platform_fee_percent)) / 100;
  const payout = customerTotal - fee, initial = Math.round(payout * Number(config.influencer_initial_release_percent)) / 100, hold = payout - initial;
  const { data: order, error: orderError } = await admin.from('partner_orders').insert({ partner_id: post.partner_id, customer_id: user.id, role: 'influencer', title: post.details.title, status: 'awaiting_acceptance', details: post.details, deadline: post.details.deadline || null }).select().single();
  if (orderError) return json({ error: orderError.message }, 400);
  const cashfreeOrderId = `eazily_${order.id.replaceAll('-', '')}`;
  const cf = await fetch(`${Deno.env.get('CASHFREE_BASE_URL') || 'https://sandbox.cashfree.com'}/pg/orders`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-version': '2025-01-01', 'x-client-id': Deno.env.get('CASHFREE_CLIENT_ID')!, 'x-client-secret': Deno.env.get('CASHFREE_CLIENT_SECRET')!, 'x-idempotency-key': order.id }, body: JSON.stringify({ order_id: cashfreeOrderId, order_amount: customerTotal, order_currency: 'INR', customer_details: { customer_id: user.id, customer_phone: user.phone, customer_email: user.email || post.details.email || 'payments@eazily.invalid' }, order_meta: { notify_url: `${url}/functions/v1/cashfree-webhook` }, order_note: `Prepaid collaboration: ${post.details.title}` }) });
  const payload = await cf.json();
  if (!cf.ok) { await admin.from('partner_orders').delete().eq('id', order.id); return json({ error: 'Cashfree could not create the order', provider: payload }, 502); }
  await admin.from('cashfree_collaborations').insert({ order_id: order.id, cashfree_order_id: cashfreeOrderId, payment_status: 'pending', customer_total: customerTotal, partner_payout: payout, platform_fee: fee, initial_release: initial, security_hold: hold, cashfree_vendor_id: post.partner_applications.details.cashfreeVendorId });
  return json({ orderId: order.id, paymentSessionId: payload.payment_session_id, breakdown: { customerTotal, platformFee: fee, partnerPayout: payout, initialRelease: initial, securityHold: hold, reviewWindowHours: config.influencer_review_window_hours } });
});
