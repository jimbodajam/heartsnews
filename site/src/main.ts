import { BREAKING_PATH } from '../../shared/breaking';
import type { Bulletin } from '../../shared/bulletin';
import { LIVE_URL } from '../../shared/live';
import type { Weather } from '../../shared/weather';
import { audioContext } from './audio/sting';
import { Voices } from './audio/voice';
import { BreakingNews } from './breaking';
import { type FeedSource, LiveScore, workerSource } from './live';
import { Player } from './player';
import { SdRenderer } from './render/sd';

// ?bulletin=bulletins/other.json plays a different file; ?segment=<id> jumps straight to a segment.
const params = new URLSearchParams(location.search);
const BULLETIN_URL = params.get('bulletin') ?? 'bulletins/latest.json';
let START_SEGMENT = params.get('segment') ?? undefined;
// In dev, ?scene=pitchside opens on a demo of our reporter at the ground (see pitchside-preview.ts).
const PITCHSIDE = import.meta.env.DEV && params.get('scene') === 'pitchside';
// ?live=off turns the live score off, ?live=<url> reads live.json from elsewhere (e.g. `npm run worker:dev`, or
// `npm run replay` with &speed=20 to poll as fast as it replays), and in dev ?live=replay[&from=17:15][&speed=20]
// replays the recorded Trabzonspor v Hearts match in the page alone (no breaking news).
const LIVE = params.get('live') ?? LIVE_URL;

async function liveSource(): Promise<{ source: FeedSource; pace: number } | undefined> {
  if (LIVE === 'off') return undefined;
  if (LIVE === 'replay') {
    if (!import.meta.env.DEV) return undefined;
    const speed = Number(params.get('speed')) || 20;
    const { replaySource } = await import('./live-replay');
    return { source: replaySource(params.get('from') ?? undefined, speed), pace: speed };
  }
  return { source: workerSource(LIVE), pace: Number(params.get('speed')) || 1 };
}

async function fetchBulletin(): Promise<Bulletin> {
  const res = await fetch(`${BULLETIN_URL}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`Could not load bulletin (${res.status})`);
  const bulletin = (await res.json()) as Bulletin;
  if (!PITCHSIDE) return bulletin;
  const { PREVIEW_SEGMENT, withPitchside } = await import('./pitchside-preview');
  START_SEGMENT ??= PREVIEW_SEGMENT;
  return withPitchside(bulletin);
}

async function boot(): Promise<void> {
  // The renderer puts its own canvas (#tv) in the screen.
  const screen = document.querySelector<HTMLElement>('#screen')!;
  const sd = new SdRenderer();
  sd.mount(screen);

  let bulletin: Bulletin;
  try {
    bulletin = await fetchBulletin();
  } catch (err) {
    console.error(err);
    sd.offAir();
    return;
  }

  const voices = new Voices();
  // Between loops, pick up a newer bulletin if one has been published; keep the old one if that fails.
  const player = new Player(screen, sd, voices, bulletin, new URL(BULLETIN_URL, location.href), () =>
    fetchBulletin().catch(() => undefined),
  );

  // Dev only: ?stinger=goal|red|calm|ko plays just the break-in flash at the first line, for checking its look and sound.
  const stinger = import.meta.env.DEV ? params.get('stinger') : null;
  if (stinger) {
    const flash = { goal: 'GOAL', red: 'RED CARD', calm: 'TEAM NEWS', ko: 'KICK-OFF' }[stinger] ?? stinger.toUpperCase();
    const now = new Date().toISOString();
    player.queueBreaking({ id: `stinger-${stinger}`, kind: 'goal', publishedAt: now, kickOff: now, flash, presenters: [], segments: [] });
  }

  const live = await liveSource();
  if (live) {
    player.live = new LiveScore(live.source, live.pace);
    player.live.onGoal = () => player.goal();
    player.live.start();
    // Goals and red cards: the home PC publishes a package for each, and the player breaks in with it.
    const breaking = new BreakingNews(BREAKING_PATH, player.live, live.pace);
    breaking.onPackage = (p) => player.queueBreaking(p);
    breaking.start();
  }

  // ?tv=1 starts with the retro TV filter on (T toggles it).
  if (params.get('tv') === '1') screen.classList.add('crt');

  // Painted studio background, if one has been made with `npm run pixelate`. ?bg=classic starts with the code-drawn set.
  player.classicStudio = params.get('bg') === 'classic';
  if (params.has('night')) player.night = params.get('night') === '1';
  // ?weather=clear|overcast|rain|snow|fog, with ,windy for a breeze: the scene at the ground in that weather.
  const [sky, wind] = (params.get('weather') ?? '').split(',');
  if (['clear', 'overcast', 'rain', 'snow', 'fog'].includes(sky)) player.weather = { sky: sky as Weather['sky'], windy: wind === 'windy' };
  const logo = new Image();
  logo.onload = () => (player.sponsorLogo = logo);
  logo.src = 'backgrounds/marshalls-logo.png';
  const studio = new Image();
  studio.onload = () => (player.studioImage = studio);
  studio.src = 'backgrounds/studio.png';
  for (const [key, file] of [['front', 'museum-front'], ['inside', 'museum']] as const) {
    const img = new Image();
    img.onload = () => (player.museum[key] = img);
    img.src = `backgrounds/${file}.png`;
  }

  // Browsers only allow sound after a user gesture, hence the "click to tune in" splash.
  const start = async () => {
    player.status = 'TUNING IN...';
    void audioContext().resume();
    await voices.init();
    player.begin(START_SEGMENT);
  };
  // On the screen rather than the canvas, so it still works whichever renderer is in it.
  screen.addEventListener('click', () => void start(), { once: true });

  addEventListener('keydown', (e) => {
    switch (e.key.toLowerCase()) {
      case 'm':
        voices.muted = !voices.muted;
        break;
      case 'c':
        player.captions = !player.captions;
        break;
      case 'b':
        player.classicStudio = !player.classicStudio;
        break;
      case 't':
        screen.classList.toggle('crt');
        break;
      case 'arrowright':
      case 'n':
        player.skip();
        break;
      case 'f':
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
        break;
      case 'enter':
      case ' ':
        void start();
        break;
    }
  });
  sd.focus();
}

void boot();
