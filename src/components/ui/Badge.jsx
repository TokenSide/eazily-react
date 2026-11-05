import Icon from '../Icon.jsx';

export function StatusPill({ tone = 'ok', icon = 'check', children }) {
  const tones = { ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', danger: 'bg-danger-soft text-danger', info: 'bg-info-soft text-info', accent: 'bg-accent-soft text-accent' };
  return <span data-slot="status-pill" className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-bold ${tones[tone]}`}>{icon && <Icon name={icon} size={15} />}{children}</span>;
}
export default StatusPill;
