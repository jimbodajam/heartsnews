// Plays a baked presenter: stacks cropped layers from one sprite sheet (#69, made by tools/bake). No keying, detection or colour matching happens here.
const load = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

export async function loadPresenter(base) {
  const [data, sheet] = await Promise.all([fetch(base + '.json').then(r => r.json()), load(base + '.png')]);
  const cache = new Map();
  const draw = (g, name) => { const l = data.layers[name]; if (l) g.drawImage(sheet, l[0], l[1], l[2], l[3], l[4], l[5], l[2], l[3]); };
  /** One full frame as a canvas: head, arm pose and feet are frame names, eye is open or a key of data.eyes, mouth is rest or a key of data.mouths. */
  const frame = ({ head = 'b1', pose = 'b1', feet = 'b1', eye = 'open', mouth = 'rest' } = {}) => {
    const k = [head, pose, feet, eye, mouth].join('|'); if (cache.has(k)) return cache.get(k);
    const c = document.createElement('canvas'); c.width = data.w; c.height = data.h;
    const g = c.getContext('2d');
    for (const n of [`feet/${feet}`, `body/${pose}`, `low/${pose}`, `head/${head}`, `eye/${head}/${eye}`, `mouth/${head}/${mouth}`]) {
      // a change can clear cells as well as paint them: the bake gives those as a cut layer
      if (data.layers['cut/' + n]) { g.globalCompositeOperation = 'destination-out'; draw(g, 'cut/' + n); g.globalCompositeOperation = 'source-over'; }
      draw(g, n);
    }
    cache.set(k, c); return c;
  };
  return { ...data, frame };
}
