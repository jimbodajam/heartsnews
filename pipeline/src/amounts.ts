// Issue #100: amounts as printed in an article ("£33.4m", "£33.4 million", "12 per cent"), so a figure the model pulled
// out can be checked against the article's text whatever way the article wrote it.

export type AmountKind = 'money' | 'percent' | 'count';
export interface Amount {
  n: number;
  kind: AmountKind;
}

const MULT: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, bn: 1e9, billion: 1e9 };

// currency symbol? number (with thousands commas or decimals), then a multiplier, a percent or a currency word.
const AMOUNT =
  '(?<![\\w.,£$€])(?<cur>[£$€])?\\s?(?<num>\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)' +
  '(?:\\s?(?<mult>billion|bn|million|thousand|m|k)(?![a-z]))?' +
  '(?:\\s?(?<pct>%|per ?cent(?![a-z])))?' +
  '(?:\\s(?<word>pounds|euros|dollars)(?![a-z]))?';

function toAmount(g: Record<string, string | undefined>): Amount | undefined {
  const n = Number((g.num ?? '').replace(/,/g, ''));
  if (!Number.isFinite(n)) return undefined;
  const mult = g.mult ? MULT[g.mult.toLowerCase()] : 1;
  const money = Boolean(g.cur || g.word || (g.mult && /^(m|million|bn|billion)$/i.test(g.mult)));
  if (g.pct) return { n, kind: 'percent' };
  return { n: n * mult, kind: money ? 'money' : 'count' };
}

/** One amount written out ("£33.4m", "33.4 million pounds", "12%", "18,000"), or undefined if the string isn't one. */
export function parseAmount(s: string): Amount | undefined {
  const m = new RegExp(`^\\s*${AMOUNT.replace('(?<![\\w.,£$€])', '')}\\s*$`, 'i').exec(s);
  return m?.groups ? toAmount(m.groups) : undefined;
}

/** Every amount found in a text. */
export function amountsIn(text: string): Amount[] {
  const out: Amount[] = [];
  for (const m of text.matchAll(new RegExp(AMOUNT, 'gi'))) {
    const a = m.groups && toAmount(m.groups);
    if (a) out.push(a);
  }
  return out;
}

const same = (a: number, b: number) => a === b || Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b));

/** Whether the text has an amount of the same kind and value. */
export function hasAmount(text: string, a: Amount): boolean {
  return amountsIn(text).some((x) => x.kind === a.kind && same(x.n, a.n));
}

/** The short form for a card: "£33.4M", "£1.2BN", "12%", "18,000". */
export function displayAmount(a: Amount): string {
  if (a.kind === 'percent') return `${trim(a.n)}%`;
  const money = a.kind === 'money';
  const [div, suffix] = a.n >= 1e9 ? [1e9, 'BN'] : a.n >= 1e6 ? [1e6, 'M'] : money && a.n >= 1e3 ? [1e3, 'K'] : [1, ''];
  const body = div === 1 ? Math.round(a.n * 100) / 100 : trim(a.n / div);
  return `${money ? '£' : ''}${div === 1 ? body.toLocaleString('en-GB') : body}${suffix}`;
}

/** At most two decimal places, without trailing zeros, so a shown figure never rounds away a printed digit. */
function trim(n: number): string {
  return String(Math.round(n * 100) / 100);
}
