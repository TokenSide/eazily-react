import { useCallback, useEffect, useState } from 'react';
import { Field } from '../../components/Ui.jsx';
import { readRows, requireBackend, rpc } from '../../services/experience.js';
import { useRealtime } from '../../lib/realtime.jsx';
import MediaPreview from './MediaPreview.jsx';

export default function ServicePostApprovalAdmin({ notify }) {
  const { revision } = useRealtime();
  const [posts, setPosts] = useState([]);
  const [edits, setEdits] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [config, setConfig] = useState(null);
  const [reasons, setReasons] = useState({});
  const load = useCallback(async () => {
    const [nextPosts, nextEdits, nextDecisions, rules] = await Promise.all([
      readRows('partner_posts', q => q.eq('role', 'professional').order('updated_at', { ascending: false }).limit(100)),
      readRows('service_post_revisions', q => q.eq('status', 'pending_review').limit(100)),
      readRows('service_post_approval_decisions', q => q.order('decided_at', { ascending: false }).limit(500)),
      readRows('service_post_approval_config'),
    ]);
    setPosts(nextPosts);
    setEdits(nextEdits);
    setDecisions(nextDecisions);
    setConfig(rules[0] || null);
  }, []);
  useEffect(() => { load().catch(error => notify(error.message)); }, [load, notify, revision]);
  const reasonField = id => <Field label="Decision reason" value={reasons[id] || ''}
    onChange={event => setReasons(current => ({ ...current, [id]: event.target.value }))} />;
  async function reviewPost(post, status) {
    try {
      await rpc('admin_review_post', { p_id: post.id, p_status: status, p_notes: reasons[post.id]?.trim() || '' });
      await load();
    } catch (error) { notify(error.message); }
  }
  async function reviewEdit(edit, approve) {
    try {
      await rpc('review_service_post_revision', { p_revision: edit.id, p_approve: approve, p_reason: reasons[edit.id]?.trim() || '' });
      await load();
    } catch (error) { notify(error.message); }
  }
  async function saveRules(event) {
    event.preventDefault();
    try {
      const { error } = await requireBackend().from('service_post_approval_config').update({
        auto_publish_enabled: config.auto_publish_enabled,
        min_description_length: Number(config.min_description_length),
        duplicate_window_days: Number(config.duplicate_window_days),
        require_review_for_new_media: config.require_review_for_new_media,
        flagged_text_pattern: config.flagged_text_pattern,
        flagged_media_pattern: config.flagged_media_pattern,
        updated_at: new Date().toISOString(),
      }).eq('id', true);
      if (error) throw error;
      notify('Service Partner approval rules saved');
      await load();
    } catch (error) { notify(error.message); }
  }
  return <>
    <section className="admin-panel"><h2>Service Partner post approval</h2>
      {posts.map(post => {
        const latest = decisions.find(item => item.post_id === post.id);
        const autoApproved = decisions.some(item => item.post_id === post.id && item.decision === 'auto_published');
        return <article className="activity" key={post.id}>
          <div><b>{post.details?.title || 'Service post'}</b><p>{post.status}{autoApproved ? ' · Auto-approved' : ''}</p>
            <p>{post.details?.category} · {post.details?.service}</p><p>{post.details?.description}</p>
            {post.details?.media?.length > 0 && <MediaPreview media={post.details.media} />}
            {latest && <small>{latest.decision} · {latest.reason} · {new Date(latest.decided_at).toLocaleString('en-IN')}</small>}
            {reasonField(post.id)}</div>
          <div>{post.status === 'published' ? <button onClick={() => reviewPost(post, 'paused')}>Hide</button>
            : <><button onClick={() => reviewPost(post, 'published')}>Publish / override</button>
              <button onClick={() => reviewPost(post, 'rejected')}>Reject</button></>}</div>
        </article>;
      })}
      {edits.map(edit => <article className="activity" key={edit.id}><div>
        <b>Pending edit: {edit.details?.title || 'Service post'}</b>
        <p>{edit.details?.category} · {edit.details?.service}</p><p>{edit.details?.description}</p>
        {edit.details?.media?.length > 0 && <MediaPreview media={edit.details.media} />}
        <p>Currently live: {posts.find(post => post.id === edit.post_id)?.details?.description || 'Approved version remains live.'}</p>
        {reasonField(edit.id)}
      </div><div><button onClick={() => reviewEdit(edit, true)}>Approve edit</button>
        <button onClick={() => reviewEdit(edit, false)}>Reject edit</button></div></article>)}
    </section>
    {config && <form className="admin-panel" onSubmit={saveRules}><h2>Fast approval rules</h2>
      <label><input type="checkbox" checked={config.auto_publish_enabled} onChange={event => setConfig({ ...config, auto_publish_enabled: event.target.checked })} /> Auto-publish trusted later posts</label>
      <Field label="Minimum description length" type="number" min="3" max="500" value={config.min_description_length} onChange={event => setConfig({ ...config, min_description_length: event.target.value })} />
      <Field label="Duplicate review window (days)" type="number" min="1" max="365" value={config.duplicate_window_days} onChange={event => setConfig({ ...config, duplicate_window_days: event.target.value })} />
      <label><input type="checkbox" checked={config.require_review_for_new_media} onChange={event => setConfig({ ...config, require_review_for_new_media: event.target.checked })} /> Review new photos and videos</label>
      <Field label="Flagged text pattern" value={config.flagged_text_pattern} onChange={event => setConfig({ ...config, flagged_text_pattern: event.target.value })} />
      <Field label="Flagged media path pattern" value={config.flagged_media_pattern} onChange={event => setConfig({ ...config, flagged_media_pattern: event.target.value })} />
      <button className="btn btn-primary">Save approval rules</button>
    </form>}
  </>;
}
