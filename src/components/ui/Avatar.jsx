import { useState } from 'react';
import Icon from '../Icon.jsx';

const TINTS = {
  purple: 'bg-accent-soft text-accent',
  blue: 'bg-info-soft text-info',
  amber: 'bg-warn-soft text-warn',
  green: 'bg-ok-soft text-ok',
};

export default function Avatar({ url, name = '', tint = 'purple', size = 48, verified = false }) {
  const [failed, setFailed] = useState(false);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || 'E';
  return (
    <span data-slot="avatar" className={`relative inline-flex shrink-0 items-center justify-center rounded-full overflow-hidden font-bold ${TINTS[tint] || TINTS.purple}`} style={{ width: size, height: size, fontSize: size * 0.34 }}>
      {url && !failed
        ? <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
        : (name ? initials : <Icon name="person" size={Math.round(size * 0.5)} />)}
      {verified && <span data-slot="avatar-verified" className="absolute bottom-0 right-0 grid place-items-center rounded-full bg-ok text-white" style={{ width: size * 0.34, height: size * 0.34 }}><Icon name="check" size={Math.round(size * 0.22)} /></span>}
    </span>
  );
}
