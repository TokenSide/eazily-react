// Public, read-only proxy for the Ansh Cares YouTube feed. YouTube's RSS feed does not send
// CORS headers, so the Videos tab cannot read it directly from the browser or the app.
const channelId = Deno.env.get('YOUTUBE_CHANNEL_ID') ?? 'UC9eLcVvCintcfYeKCISRKhQ';
const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info' };
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });

const decode = (value: string) => value
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&amp;/g, '&');
const tag = (entry: string, name: string) => decode(entry.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? '');

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!/^UC[\w-]{22}$/.test(channelId)) return json({ error: 'YouTube channel is not configured' }, 503);
  try {
    const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
    if (!response.ok) return json({ error: 'YouTube feed is unavailable' }, 502);
    const xml = await response.text();
    const videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, entry]) => ({
      id: tag(entry, 'yt:videoId'),
      title: tag(entry, 'title'),
      publishedAt: tag(entry, 'published'),
      isShort: /href="https:\/\/www\.youtube\.com\/shorts\//.test(entry),
    })).filter(video => /^[\w-]{11}$/.test(video.id));
    return json({ videos }, 200, { 'cache-control': 'public, max-age=600' });
  } catch {
    return json({ error: 'YouTube feed is temporarily unavailable' }, 503);
  }
});
