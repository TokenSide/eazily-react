import Icon from '../Icon.jsx';

const CARD = { purple: 'bg-accent-soft', blue: 'bg-info-soft', amber: 'bg-warn-soft', green: 'bg-ok-soft' };
const ICON = { purple: 'bg-[#E4D7FB] text-accent', blue: 'bg-[#D5E5FC] text-info', amber: 'bg-[#FAE6C8] text-warn', green: 'bg-[#D3F1DE] text-ok' };

export function StatCard({ icon, tint = 'purple', value, label }) {
  return (
    <article data-slot="stat-card" className={`rounded-[18px] p-4 ${CARD[tint]}`}>
      <div className={`grid place-items-center w-11 h-11 rounded-[12px] ${ICON[tint]}`}><Icon name={icon} size={22} /></div>
      <strong className="mt-2.5 block text-[24px] leading-tight font-extrabold tracking-tight text-ink">{value}</strong>
      <span className="text-[13px] font-semibold text-ink/70">{label}</span>
    </article>
  );
}

export default function StatGrid({ children }) {
  return <div data-slot="stat-grid" className="grid grid-cols-2 gap-3">{children}</div>;
}
