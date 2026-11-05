import { useCallback, useEffect, useState } from 'react';
import { getConsumerLegalStatus } from '../../services/consumerConsent.js';
import { useAccount } from '../../lib/account.js';

export function useConsumerLegal() {
  const { user } = useAccount();
  const [state, setState] = useState({ documents: [], acceptances: [], required: false, accepted: false, loading: true, error: '' });
  const refresh = useCallback(async () => {
    try { const result = await getConsumerLegalStatus(); setState({ ...result, loading: false, error: '' }); }
    catch (error) { setState(current => ({ ...current, loading: false, error: error.message, accepted: false })); }
  }, []);
  useEffect(() => {
    let active = true;
    const load = () => getConsumerLegalStatus()
      .then(result => { if (active) setState({ ...result, loading: false, error: '' }); })
      .catch(error => { if (active) setState(current => ({ ...current, loading: false, error: error.message, accepted: false })); });
    load();
    window.addEventListener('focus', load);
    window.addEventListener('eazily-consumer-consent-updated', load);
    return () => { active = false; window.removeEventListener('focus', load); window.removeEventListener('eazily-consumer-consent-updated', load); };
  }, [user?.id]);
  return { ...state, refresh };
}
