import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { BottomNav } from '../../components/Ui.jsx';
import './customer-videos.css';

const channelUrl = 'https://www.youtube.com/@Ansh_Cares';
const youtubeOrigin = 'https://www.youtube.com';

// Curated local playlist. New uploads do not sync automatically in the local-only app.
const fallbackVideos = [
  ['58gRPomCjC0', 'Daily habits. good or bad'],
  ['h1ZXp_82E68', 'breakfast - important or not'],
  ['p7amIcHo-A8', 'how many crunches'],
  ['xFP53Ui6fNA', 'Carbs are not always bad'],
  ['nUUsz_dHMNQ', 'Creatine ki kahani usi kay jubani'],
  ['1HVXpRQWqlc', 'Reduce sedentary lifestyl'],
  ['tqn1IDL2V3g', 'Workout is necessary but recovery is also necessary.'],
  ['vgyIKVVGvKU', 'Peanut butter - a good choice ?'],
  ['ionRBEZS5qo', 'Do you like eating Banana 🍌'],
  ['8y1rwP7bXkc', 'Good sleep, a luxury'],
  ['IC4FJHDPM1c', 'Learn about Chia seeds'],
  ['CxFw3nYKKX0', 'Pea protein vs Whey'],
  ['WwP4XSa42cQ', 'Bell peppers aka Capsicum. Which is best?'],
  ['o80moaWwOew', 'Sehat ki baat Ansh kay saath'],
].map(([id, title]) => ({ id, title, isShort: true }));

const watchUrl = video => video.isShort ? `https://www.youtube.com/shorts/${video.id}` : `https://www.youtube.com/watch?v=${video.id}`;

// YouTube player states: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued.
function ReelPlayer({ video, active, muted, onPausedChange }) {
  const frameRef = useRef(null);
  const wasActive = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [playerState, setPlayerState] = useState(-1);
  const [fallback, setFallback] = useState(false);
  const send = useCallback((func, args = []) => {
    frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), youtubeOrigin);
  }, []);

  useEffect(() => {
    const onMessage = event => {
      if (event.origin !== youtubeOrigin || event.source !== frameRef.current?.contentWindow) return;
      let data;
      try { data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
      if (data?.event === 'onReady' || data?.event === 'initialDelivery') setReady(true);
      const state = data?.event === 'onStateChange' ? data.info : data?.info?.playerState;
      if (typeof state !== 'number') return;
      setReady(true);
      setPlayerState(state);
      if (state === 1) setStarted(true);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Subscribe to player events; retry until the embedded player answers.
  useEffect(() => {
    if (!loaded || ready) return undefined;
    const listen = () => frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: video.id, channel: 'widget' }), youtubeOrigin);
    listen();
    const retry = setInterval(listen, 250);
    const giveUp = setTimeout(() => setFallback(true), 5000);
    return () => { clearInterval(retry); clearTimeout(giveUp); };
  }, [loaded, ready, video.id]);

  useEffect(() => { if (ready) send(muted ? 'mute' : 'unMute'); }, [ready, muted, send]);

  useEffect(() => {
    if (!ready) return;
    // seekTo starts an unstarted player, so only rewind a reel that was actually on screen.
    // A paused player stays paused after seekTo.
    if (active) send('playVideo');
    else if (wasActive.current) { send('pauseVideo'); send('seekTo', [0, true]); }
    wasActive.current = active;
  }, [ready, active, send]);

  useEffect(() => {
    if (!ready) return;
    if (active && playerState === 0) { send('seekTo', [0, true]); send('playVideo'); }
    if (!active && playerState === 1) send('pauseVideo');
  }, [ready, active, playerState, send]);

  useEffect(() => {
    if (!ready || !active) return undefined;
    const onVisibility = () => send(document.hidden ? 'pauseVideo' : 'playVideo');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [ready, active, send]);

  const playing = playerState === 1 || playerState === 3;
  const paused = active && ready && (playerState === 2 || playerState === 5);
  useEffect(() => { if (active) onPausedChange(paused); }, [active, paused, onPausedChange]);

  return <div className={`customer-reel-player${started ? ' is-started' : ''}${fallback && !ready ? ' is-fallback' : ''}`} data-player-state={playerState}>
    <iframe
      ref={frameRef}
      title={video.title}
      src={`https://www.youtube.com/embed/${encodeURIComponent(video.id)}?enablejsapi=1&playsinline=1&controls=0&rel=0&mute=1&origin=${encodeURIComponent(window.location.origin)}`}
      tabIndex={-1}
      onLoad={() => setLoaded(true)}
      referrerPolicy="strict-origin-when-cross-origin"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowFullScreen
    />
    {ready && <button type="button" className="customer-reel-tap" aria-label={playing ? 'Pause video' : 'Play video'} onClick={() => send(playing ? 'pauseVideo' : 'playVideo')}>
      {paused && <span className="customer-reel-paused"><Icon name="play" size={34} /></span>}
    </button>}
  </div>;
}

function Reel({ video, active, mounted, muted, onToggleMute, onShare, onPausedChange }) {
  return <li className={`customer-reel${active ? ' is-active' : ''}`} aria-label={video.title}>
    <img className="customer-reel-poster" src={`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`} alt="" loading="lazy" />
    {mounted && <ReelPlayer video={video} active={active} muted={muted} onPausedChange={onPausedChange} />}
    <div className="customer-reel-info">
      <a href={channelUrl} target="_blank" rel="noreferrer"><span aria-hidden="true">A</span>@Ansh_Cares</a>
      <p>{video.title}</p>
    </div>
    <div className="customer-reel-actions">
      <button type="button" onClick={onToggleMute} aria-label={muted ? 'Turn sound on' : 'Mute'} aria-pressed={!muted}>
        <span><Icon name={muted ? 'volumeOff' : 'volume'} size={24} /></span>{muted ? 'Sound' : 'Mute'}
      </button>
      <button type="button" onClick={() => onShare(video)}><span><Icon name="share" size={24} /></span>Share</button>
      <a href={watchUrl(video)} target="_blank" rel="noreferrer"><span><Icon name="external" size={24} /></span>YouTube</a>
    </div>
  </li>;
}

export default function CustomerVideos({ route, onNavigate, notify }) {
  const videos = fallbackVideos;
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [activePaused, setActivePaused] = useState(false);
  const [height, setHeight] = useState(null);
  const reelsRef = useRef(null);
  const feedRef = useRef(null);

  // Fill the space between the top of the page and the bottom navigation, like a Reels screen.
  useLayoutEffect(() => {
    const measure = () => {
      if (!reelsRef.current) return;
      const nav = document.querySelector('.bottom-nav');
      const bottom = nav ? nav.getBoundingClientRect().top : window.innerHeight;
      setHeight(Math.max(320, Math.round(bottom - reelsRef.current.getBoundingClientRect().top)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const onScroll = () => {
    const feed = feedRef.current;
    if (feed?.clientHeight) setActiveIndex(Math.min(videos.length - 1, Math.round(feed.scrollTop / feed.clientHeight)));
  };

  const share = async video => {
    const url = watchUrl(video);
    try {
      if (navigator.share) await navigator.share({ title: video.title, url });
      else { await navigator.clipboard.writeText(url); notify?.('Video link copied'); }
    } catch (error) {
      if (error?.name !== 'AbortError') notify?.('Could not share this video');
    }
  };

  return <main className="screen customer-videos-page">
    <section ref={reelsRef} className={`customer-reels${activePaused ? ' is-paused' : ''}`} style={height ? { height } : undefined} aria-label="Ansh Cares YouTube videos">
      <header className="customer-reels-heading">
        <span className="eyebrow">ANSH CARES</span>
        <h1>Videos</h1>
      </header>
      <ol ref={feedRef} className="customer-reels-feed" onScroll={onScroll} tabIndex={0} aria-label="Swipe up for the next video">
        {videos.map((video, index) => <Reel
          key={video.id}
          video={video}
          active={index === activeIndex}
          mounted={Math.abs(index - activeIndex) <= 1}
          muted={muted}
          onToggleMute={() => setMuted(value => !value)}
          onShare={share}
          onPausedChange={setActivePaused}
        />)}
      </ol>
    </section>
    <BottomNav route={route} onChange={onNavigate} />
  </main>;
}
