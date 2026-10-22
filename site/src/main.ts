import type { Bulletin } from '../../shared/bulletin';
import { audioContext } from './audio/sting';
import { Voices } from './audio/voice';
import { drawSplash } from './gfx/overlay';
import { createScreen } from './gfx/screen';
import { type FeedSource, LiveScore, workerSource } from './live';
import { Player } from './player';

// ?bulletin=bulletins/other.json plays a different file; ?segment=<id> jumps straight to a segment.
const params = new URLSearchParams(location.search);
const BULLETIN_URL = params.get('bulletin') ?? 'bulletins/latest.json';
let START_SEGMENT = params.get('segment') ?? undefined;
// In dev, ?scene=pitchside opens on a demo of our reporter at the ground (see pitchside-preview.ts).
const PITCHSIDE = import.meta.env.DEV && params.get('scene') === 'pitchside';
// ?live=off turns the live score off, ?live=<url> reads live.json from elsewhere (e.g. `npm run worker:dev`), and in
// dev ?live=replay[&from=17:15][&speed=20] replays the recorded Trabzonspor v Hearts match.
const LIVE = params.get('live') ?? 'https://heartsnews-live.heartsnews.workers.dev/live.json';

async function liveSource(): Promise<{ source: FeedSource; pace: number } | undefined> {
  if (LIVE === 'off') return undefined;
  if (LIVE === 'replay') {
    if (!import.meta.env.DEV) return undefined;
    const speed = Number(params.get('speed')) || 20;
    const { replaySource } = await import('./live-replay');
    return { source: replaySource(params.get('from') ?? undefined, speed), pace: speed };
  }
  return { source: workerSource(LIVE), pace: 1 };
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
  const canvas = document.querySelector<HTMLCanvasElement>('#tv')!;
  const g = createScreen(canvas);

  let bulletin: Bulletin;
  try {
    bulletin = await fetchBulletin();
  } catch (err) {
    console.error(err);
    drawSplash(g, 0, 'HEARTS NEWS 24', 'OFF AIR');
    return;
  }

  const voices = new Voices();
  // Between loops, pick up a newer bulletin if one has been published; keep the old one if that fails.
  const player = new Player(g, voices, bulletin, new URL(BULLETIN_URL, location.href), () =>
    fetchBulletin().catch(() => undefined),
  );

  const live = await liveSource();
  if (live) {
    player.live = new LiveScore(live.source, live.pace);
    player.live.onGoal = () => player.goal();
    player.live.start();
  }

  // ?tv=1 starts with the retro TV filter on (T toggles it).
  if (params.get('tv') === '1') document.querySelector('#screen')?.classList.add('crt');

  // Painted studio background, if one has been made with `npm run pixelate`. ?bg=classic starts with the code-drawn set.
  player.classicStudio = params.get('bg') === 'classic';
  if (params.has('night')) player.night = params.get('night') === '1';
  const studio = new Image();
  studio.onload = () => (player.studioImage = studio);
  studio.src = 'backgrounds/studio.png';

  // Browsers only allow sound after a user gesture, hence the "click to tune in" splash.
  const start = async () => {
    player.status = 'TUNING IN...';
    void audioContext().resume();
    await voices.init();
    player.begin(START_SEGMENT);
  };
  canvas.addEventListener('click', () => void start(), { once: true });

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
        document.querySelector('#screen')?.classList.toggle('crt');
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
  canvas.focus();
}

void boot();
