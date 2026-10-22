// Home colours of the clubs we're likely to visit, for the crowd behind our reporter at their ground.

/** [main, second] shirt colours, keyed by a lower-case fragment of the club's name. Longer keys are tried first. */
const KITS: Record<string, [string, string]> = {
  'aberdeen': ['#c8102e', '#f2efe6'],
  'celtic': ['#14804a', '#f2efe6'],
  'rangers': ['#1b4f9c', '#f2efe6'],
  'hibernian': ['#0f6b3a', '#f2efe6'],
  'hibs': ['#0f6b3a', '#f2efe6'],
  'dundee united': ['#f28c1c', '#1a1620'],
  'dundee utd': ['#f28c1c', '#1a1620'],
  'dundee': ['#1b2a5c', '#f2efe6'],
  'motherwell': ['#f2b01e', '#8a1c2a'],
  'kilmarnock': ['#1b3f8f', '#f2efe6'],
  'st mirren': ['#1a1620', '#f2efe6'],
  'st johnstone': ['#1b4f9c', '#f2efe6'],
  'livingston': ['#f2b01e', '#1a1620'],
  'falkirk': ['#1b2a5c', '#f2efe6'],
  'ross county': ['#1b2a5c', '#c8102e'],
  'partick': ['#e3c21c', '#c8102e'],
  'dunfermline': ['#1a1620', '#f2efe6'],
  'raith': ['#1b3f8f', '#f2efe6'],
  'queen of the south': ['#1b3f8f', '#f2efe6'],
  'ayr': ['#f2efe6', '#1a1620'],
  'inverness': ['#1b3f8f', '#c8102e'],
  'trabzonspor': ['#7b1f3a', '#4a9fd8'],
};

const KEYS = Object.keys(KITS).sort((a, b) => b.length - a.length);

/** A club's home colours by name, or undefined if we don't know them. */
export function kitColours(name: string): [string, string] | undefined {
  const n = name.toLowerCase().replace(/\./g, '');
  const key = KEYS.find((k) => n.includes(k));
  return key ? KITS[key] : undefined;
}
