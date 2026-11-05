import { createClient } from 'npm:@supabase/supabase-js@2';

const encoder = new TextEncoder();
const safeEqual = (left: string, right: string) => {
  const a = encoder.encode(left), b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a[index] ^ b[index];
  return result === 0;
};

Deno.serve(async request => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const expected = Deno.env.get('AUTOMATION_SCHEDULER_SECRET') ?? '';
  const supplied = request.headers.get('x-eazily-scheduler-secret') ?? '';
  if (!expected || !safeEqual(expected, supplied)) return new Response('Unauthorized', { status: 401 });

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return new Response('Worker configuration is missing', { status: 503 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const workerId = `edge:${crypto.randomUUID()}`;
  const startedAt = new Date().toISOString();
  const { data: run, error: runError } = await admin.from('automation_worker_runs').insert({ worker_id: workerId, started_at: startedAt }).select('id').single();
  if (runError) return Response.json({ ok: false, code: 'worker_run_unavailable' }, { status: 503 });

  let succeeded = 0, retried = 0, dead = 0;
  try {
    const maintenance = await admin.rpc('enqueue_due_maintenance', { p_now: startedAt });
    if (maintenance.error) throw maintenance.error;
    const supportAttention = await admin.rpc('enqueue_due_support_attention', { p_now: startedAt });
    if (supportAttention.error) throw supportAttention.error;
    const claimed = await admin.rpc('claim_background_jobs', { p_worker_id: workerId, p_limit: 25, p_now: startedAt });
    if (claimed.error) throw claimed.error;

    for (const job of claimed.data ?? []) {
      // External adapters deliberately remain unavailable until their provider-specific
      // credentials and destination lookup/confirmation implementations are configured.
      const result = await admin.rpc(['booking_attention', 'urgent_ticket_attention'].includes(job.job_type)
        ? 'execute_support_attention_job' : 'execute_background_job', {
        p_job: job.id, p_worker: workerId, p_external_result: null, p_now: new Date().toISOString()
      });
      if (result.error) {
        const failure = await admin.rpc('fail_background_job', {
          p_job: job.id, p_worker: workerId, p_failure_class: 'transient',
          p_code: 'worker_execution_error', p_safe_message: 'Trusted job execution failed', p_now: new Date().toISOString()
        });
        if (failure.data === 'dead_letter') dead += 1;
        else retried += 1;
      } else if (result.data === 'succeeded') succeeded += 1;
      else if (result.data === 'retry_scheduled') retried += 1;
      else if (result.data === 'dead_letter') dead += 1;
    }

    await admin.from('automation_worker_runs').update({
      finished_at: new Date().toISOString(), claimed_count: (claimed.data ?? []).length,
      succeeded_count: succeeded, retry_count: retried, dead_letter_count: dead,
      status: retried || dead ? 'partial' : 'succeeded'
    }).eq('id', run.id);
    return Response.json({ ok: true, claimed: (claimed.data ?? []).length, succeeded, retried, deadLetter: dead });
  } catch (_error) {
    await admin.from('automation_worker_runs').update({
      finished_at: new Date().toISOString(), status: 'failed', safe_error: 'Worker batch failed before completion'
    }).eq('id', run.id);
    return Response.json({ ok: false, code: 'worker_batch_failed' }, { status: 500 });
  }
});
