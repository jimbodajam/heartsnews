import type { Bulletin } from '../../shared/bulletin';
import { audioContext } from './audio/sting';
import { Voices } from './audio/voice';
import { drawSplash } from './gfx/overlay';
import { createScreen } from './gfx/screen';
import { Player } from './player';

// ?bulletin=bulletins/other.json plays a different file; ?segment=<id> jumps straight to a segment.
const params = new URLSearchParams(location.search);
const BULLETIN_URL = params.get('bulletin') ?? 'bulletins/latest.json';
const START_SEGMENT = params.get('segment') ?? undefined;

async function fetchBulletin(): Promise<Bulletin> {
  const res = await fetch(`${BULLETIN_URL}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`Could not load bulletin (${res.status})`);
  return (await res.json()) as Bulletin;
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

  // Painted studio background, if one has been made with `npm run pixelate`. ?bg=classic starts with the code-drawn set.
  player.classicStudio = params.get('bg') === 'classic';
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
