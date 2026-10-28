// Date phrasing for scripts. Everything is in UK time, whatever machine the pipeline runs on.

const TZ = 'Europe/London';
const DAY_MS = 86_400_000;

export const dateKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); // YYYY-MM-DD

export function ukHour(d: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: TZ }).format(d));
}

export function partOfDay(d: Date): 'morning' | 'afternoon' | 'evening' {
  const h = ukHour(d);
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}

const ORDINAL_WORDS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];

/** "third" for league positions read aloud; falls back to "13th". */
export function spokenOrdinal(n: number): string {
  return ORDINAL_WORDS[n] ?? ordinal(n);
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
}

/** Whole calendar days from `now` to `target` in UK time. */
export function daysUntil(target: Date, now: Date): number {
  return Math.round((Date.parse(dateKey(target)) - Date.parse(dateKey(now))) / DAY_MS);
}

/** "today", "tomorrow", "on Saturday", or "on Saturday the 1st of November". */
export function dayPhrase(target: Date, now: Date): string {
  const days = daysUntil(target, now);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: TZ }).format(target);
  if (days > 1 && days < 7) return `on ${weekday}`;
  const day = Number(new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: TZ }).format(target));
  const month = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: TZ }).format(target);
  return `on ${weekday} the ${ordinal(day)} of ${month}`;
}

/** "5:45pm" / "3pm". */
export function timePhrase(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ }).formatToParts(d);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const ampm = (parts.find((p) => p.type === 'dayPeriod')?.value ?? '').toLowerCase().replace(/\./g, '').replace(/\s/g, '');
  return `${hour}${minute === '00' ? '' : `:${minute}`}${ampm}`;
}

/** Scottish transfer windows (approximate): summer 10 Jun – 1 Sep, winter 1 Jan – 2 Feb. */
export function transferWindow(now: Date): { open: boolean; days: number } {
  const y = now.getUTCFullYear();
  const windows = [y - 1, y, y + 1].flatMap((yr) => [
    [new Date(Date.UTC(yr, 0, 1)), new Date(Date.UTC(yr, 1, 2))],
    [new Date(Date.UTC(yr, 5, 10)), new Date(Date.UTC(yr, 8, 1))],
  ]);
  const current = windows.find(([open, close]) => now >= open && now <= close);
  if (current) return { open: true, days: daysUntil(current[1], now) };
  const next = windows.filter(([open]) => open > now).sort((a, b) => a[0].getTime() - b[0].getTime())[0];
  return { open: false, days: daysUntil(next[0], now) };
}

export function spokenList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const UNITS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const under100 = (n: number) => (n < 20 ? UNITS[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${UNITS[n % 10]}` : ''}`);

/** "nineteen fifty-two", "nineteen oh-five", "two thousand and six", "twenty twenty-six": the voice reads 1952 as "nineteen hundred and fifty-two". */
export function spokenYear(year: number): string {
  const [hi, lo] = [Math.floor(year / 100), year % 100];
  if (year >= 2000 && year < 2010) return year === 2000 ? 'two thousand' : `two thousand and ${UNITS[lo]}`;
  if (!lo) return `${under100(hi)} hundred`;
  return `${under100(hi)} ${lo < 10 ? `oh-${UNITS[lo]}` : under100(lo)}`;
}
