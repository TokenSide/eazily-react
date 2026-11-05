import { useEffect, useState } from 'react';

// Public, key-free lookups used only to suggest values in partner registration.
// Every result is editable and a failed lookup never blocks manual entry.
const cache = new Map();

async function fetchJson(url, signal) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 8000);
  const abort = () => timeout.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(url, { signal: timeout.signal, headers: { Accept: 'application/json' } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Lookup unavailable');
    return await response.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function cached(key, load) {
  if (!cache.has(key)) cache.set(key, load().catch(error => { cache.delete(key); throw error; }));
  return cache.get(key);
}

export function lookupPincode(pin, signal) {
  if (!/^[1-9]\d{5}$/.test(pin)) return Promise.resolve(null);
  return cached(`pin:${pin}`, async () => {
    const body = await fetchJson(`https://api.postalpincode.in/pincode/${pin}`, signal);
    const offices = Array.isArray(body) && body[0]?.Status === 'Success' ? body[0].PostOffice || [] : [];
    if (!offices.length) return null;
    return {
      city: offices[0].District || '',
      state: offices[0].State || '',
      localities: [...new Set(offices.map(office => office.Name).filter(Boolean))],
    };
  });
}

export function lookupIfsc(code, signal) {
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(code)) return Promise.resolve(null);
  return cached(`ifsc:${code}`, async () => {
    const body = await fetchJson(`https://ifsc.razorpay.com/${code}`, signal);
    return body?.BANK ? { bank: body.BANK, branch: body.BRANCH || '', city: body.CITY || '' } : null;
  });
}

// status: idle | loading | found | not_found | unavailable
export function useLookup(lookup, value) {
  const [state, setState] = useState({ key: '', status: 'idle', result: null });
  useEffect(() => {
    if (!value) return undefined;
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => {
      setState({ key: value, status: 'loading', result: null });
      lookup(value, controller.signal)
        .then(result => { if (active) setState({ key: value, status: result ? 'found' : 'not_found', result }); })
        .catch(() => { if (active) setState({ key: value, status: 'unavailable', result: null }); });
    }, 250);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [lookup, value]);
  return state.key === value ? state : { key: value, status: 'idle', result: null };
}
