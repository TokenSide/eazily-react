import Icon from '../Icon.jsx';
import Avatar from './Avatar.jsx';
import StatusPill from './Badge.jsx';

export default function ProfileHeaderCard({ name, photoUrl, verified, location, rating, reviews, children }) {
  return (
    <section data-slot="profile-header-card" className="flex items-center gap-4">
      <Avatar url={photoUrl} name={name} size={76} verified={verified} />
      <div className="grid gap-1.5">
        {verified && <StatusPill tone="ok" icon="check">Verified Partner</StatusPill>}
        {location && <p className="flex items-center gap-1.5 text-[14px] font-semibold text-ink"><Icon name="location" size={16} />{location}</p>}
        {rating != null && <p className="flex items-center gap-1.5 text-[14px] font-semibold text-ink"><Icon name="star" size={16} />Rating: <b>{rating}</b>{reviews != null && <span className="text-muted font-medium">({reviews} reviews)</span>}</p>}
        {children}
      </div>
    </section>
  );
}
