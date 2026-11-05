const aliases = { 'home cleaning': 'deep cleaning', 'painting service': 'painter', 'ac repair': 'ac service' };
const identity = service => {
  const value = String(service?.requestName || service?.name || '').trim().toLocaleLowerCase();
  return aliases[value] || value;
};

export function mergeServicePool(preferred, catalogue) {
  const active = new Map((catalogue || []).map(service => [identity(service), service]));
  const available = active.size ? (preferred || []).filter(service => active.has(identity(service))) : (preferred || []);
  const ordered = [...available, ...(catalogue || [])];
  const seen = new Set();
  return ordered.filter(service => {
    const key = identity(service);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function serviceWindow(pool, start, size = 6) {
  if (pool.length <= size) return pool;
  return Array.from({ length: size }, (_, index) => pool[(start + index) % pool.length]);
}

export function nextServiceStart(pool, start, size = 6) {
  return pool.length <= size ? 0 : (start + size) % pool.length;
}
