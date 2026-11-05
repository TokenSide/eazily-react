import Icon from '../../components/Icon.jsx';
import { translate as t } from '../../lib/translate.js';
import './registration-assist.css';

// Small helpers shared by the Service Partner, Influencer and Consultant registration steps.
export function LookupHint({ id, state, idle, found, notFound }) {
  const text = state.status === 'loading' ? 'Checking…'
    : state.status === 'found' ? found(state.result)
      : state.status === 'not_found' ? notFound
        : state.status === 'unavailable' ? 'Automatic lookup is unavailable right now. Enter the details manually.'
          : idle;
  return text ? <small id={id} className={`registration-lookup ${state.status}`} role="status">{state.status === 'found' && <Icon name="check" size={14} />}{t(text)}</small> : null;
}

export function PresetChips({ label, options }) {
  return <div className="registration-presets" role="group" aria-label={t(label)}>
    <span>{t(label)}</span>
    {options.map(([text, onClick, active]) => <button type="button" key={text} className={active ? 'selected' : ''} aria-pressed={Boolean(active)} onClick={onClick}>{t(text)}</button>)}
  </div>;
}
