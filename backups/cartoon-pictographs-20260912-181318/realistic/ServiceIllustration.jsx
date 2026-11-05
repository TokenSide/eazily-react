import { artworkFor, assetById } from './artwork.js';
import './user-art.css';

// Decorative local artwork: the unchanged adjacent service label names each action.
export default function ServiceIllustration({ name }) {
  const [id] = artworkFor(name);
  return <img className="user-service-art" data-artwork={id} src={assetById[id]} width="216" height="216" alt="" aria-hidden="true" decoding="async" draggable="false" />;
}
