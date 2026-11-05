import Icon from '../Icon.jsx';
import Avatar from './Avatar.jsx';

export default function JobCard({ name, work, area, distance, date, time, photoUrl, tint = 'purple', onChat, chatLabel = 'Chat' }) {
  return (
    <article data-slot="job-card" className="flex items-center gap-3 rounded-[18px] border border-line bg-surface px-4 py-3.5">
      <Avatar url={photoUrl} name={name} tint={tint} size={52} />
      <div className="min-w-0 flex-1 grid gap-0.5">
        <h3 className="truncate text-[16px] font-bold text-ink">{name}</h3>
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12.5px] text-muted">
          <span><b className="font-bold text-ink">Work:</b> {work}</span>
          {area && <span className="inline-flex items-center gap-1"><Icon name="location" size={13} />{area}</span>}
          {distance && <span className="inline-flex items-center gap-1"><Icon name="compass" size={13} />{distance}</span>}
        </p>
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12.5px] text-muted">
          {date && <span className="inline-flex items-center gap-1"><Icon name="calendar" size={13} /><b className="font-bold text-ink">Working Date:</b> {date}</span>}
          {time && <span className="inline-flex items-center gap-1"><Icon name="clock" size={13} /><b className="font-bold text-ink">Time:</b> {time}</span>}
        </p>
      </div>
      {onChat && <button type="button" aria-label={chatLabel} onClick={onChat} className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-accent-soft text-accent"><Icon name="messageCircle" size={20} /></button>}
    </article>
  );
}
