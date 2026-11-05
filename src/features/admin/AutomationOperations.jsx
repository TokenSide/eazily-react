import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '../../components/Ui.jsx';
import { readRows, rpc } from '../../services/experience.js';
import { useRealtime } from '../../lib/realtime.jsx';

const statusLabel = value => String(value || '').replaceAll('_', ' ');
const ageLabel = seconds => {
  const value = Number(seconds) || 0;
  if (value < 60) return `${value}s`;
  if (value < 3600) return `${Math.floor(value / 60)}m`;
  return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`;
};

function Breakdown({ title, values }) {
  const entries = Object.entries(values || {});
  return <div className="automation-breakdown"><b>{title}</b>{entries.length ? entries.map(([key, value]) => <span key={key}>{statusLabel(key)}: {value}</span>) : <span>None</span>}</div>;
}

export default function AutomationOperations({ notify }) {
  const { revision } = useRealtime();
  const [summary, setSummary] = useState(null), [jobs, setJobs] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    try {
      setError('');
      const [health, rows] = await Promise.all([
        rpc('automation_health_summary'),
        readRows('background_jobs', query => query.order('created_at', { ascending: false }).limit(50))
      ]);
      setSummary(health); setJobs(rows);
    } catch (reason) { setError(reason.message); }
  }, []);
  useEffect(() => { load(); }, [load, revision]);

  async function act(action, id) {
    const reason = window.prompt(`Reason for ${action}`);
    if (!reason) return;
    setBusy(id);
    try {
      await rpc(action === 'retry' ? 'admin_retry_automation_job' : 'admin_cancel_automation_job', { p_job: id, p_reason: reason });
      notify(`Automation job ${action === 'retry' ? 'queued again' : 'cancelled'}.`); await load();
    } catch (reasonError) { setError(reasonError.message); }
    finally { setBusy(''); }
  }

  if (error && !summary) return <section className="admin-panel"><h2>Background automation</h2><p role="alert">Unable to load automation health: {error}</p><small>This view requires the automation.view staff permission or a verified Admin account.</small></section>;
  const cards = summary ? [
    ['Execution', summary.enabled ? 'Enabled' : 'Paused'], ['Scheduler', statusLabel(summary.schedulerStatus)], ['Pending', summary.pendingJobs], ['Retrying', summary.retryingJobs],
    ['Dead letter', summary.deadLetterJobs], ['Notifications queued', summary.notificationRequested], ['Workbook pending', summary.excelPending],
    ['Finance review', summary.financialCases], ['Review tasks due', summary.reviewTasksDue], ['Oldest queue age', ageLabel(summary.oldestPendingSeconds)],
    ['Last successful run', summary.lastWorkerRun ? new Date(summary.lastWorkerRun).toLocaleString() : 'No run yet']
  ] : [];
  return <>
    <section className="admin-kpis automation-kpis">{cards.map(([label, value]) => <div className="admin-kpi" key={label}><b>{value ?? 0}</b><span>{label}</span></div>)}</section>
    <section className="admin-panel">
      <div className="admin-panel-head"><div><h2>Background jobs</h2><small>The master switch and every financial adapter start disabled. Job data contains identifiers and safe errors only.</small></div><button onClick={load}>Refresh</button></div>
      {error && <p role="alert">{error}</p>}
      {summary && <div className="automation-health-grid"><Breakdown title="Active jobs by type" values={summary.jobsByType} /><Breakdown title="Notification states" values={summary.notificationByState} /><Breakdown title="Workbook states" values={summary.excelByState} /><div className="automation-breakdown"><b>Worker attention</b><span>Expired leases: {summary.expiredLeases || 0}</span><span>Review tasks overdue: {summary.reviewTasksOverdue || 0}</span><span>Expected heartbeat: {summary.schedulerExpectedSeconds || 0}s</span></div></div>}
      {jobs.map(job => <article className="admin-record automation-record" key={job.id}>
        <div><b>{statusLabel(job.job_type)}</b><span className="application-state">{statusLabel(job.status)}</span><p>{job.related_entity_type} · {job.related_entity_id}</p><small>Attempt {job.attempt_count}/{job.max_attempts} · due {new Date(job.next_retry_at || job.scheduled_at).toLocaleString()}</small>{job.last_error_message && <small> · {job.last_error_code}: {job.last_error_message}</small>}</div>
        <div>{['dead_letter','cancelled','retry_scheduled'].includes(job.status) && <button disabled={busy === job.id} onClick={() => act('retry', job.id)}>Retry</button>}{['pending','retry_scheduled'].includes(job.status) && <button disabled={busy === job.id} onClick={() => act('cancel', job.id)}>Cancel</button>}</div>
      </article>)}
      {!jobs.length && <EmptyState title="No background jobs" text="Queued work will appear here after the migration is applied and business events occur." />}
    </section>
  </>;
}
