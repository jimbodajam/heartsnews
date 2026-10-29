// Writes site/public/bulletins/mock-phonein/bulletin.json: a template programme with the phone-in (from `npm run phonein`,
// saved in .cache/phonein/phonein.json) after the debate. Play it at ?bulletin=bulletins/mock-phonein/bulletin.json&segment=phonein.
// Its own folder, so rendering its voices doesn't clear the live bulletin's clips.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PhoneIn } from '../src/phonein.ts';
import { assemble } from '../src/script/assemble.ts';
import { templateDraft } from '../src/script/draft.ts';
import { buildFacts, type Channel } from '../src/script/facts.ts';
import { voiceLines } from '../src/voice.ts';
import type { ClubConfig } from '../src/types.ts';
const rd = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const f = buildFacts(rd('../../clubs/hearts.json') as ClubConfig, rd('../../channel.json') as Channel, [], [], { next: [], last: [], table: [] }, new Date('2026-10-28T23:45:00Z'));
const draft = templateDraft(f);
draft.phonein = rd('../../.cache/phonein/phonein.json') as PhoneIn;
draft.debate ??= { topic: 'Williams or Kabore', lines: [{ speaker: 'fraser', text: 'Give me the old-fashioned winger.' }, { speaker: 'ross', text: 'The numbers say otherwise.' }, { speaker: 'fraser', text: 'Numbers do not tackle.' }, { speaker: 'ross', text: 'They do not, Fraser, but they do win games.' }], predictions: [] };
mkdirSync(new URL('../../site/public/bulletins/mock-phonein/', import.meta.url), { recursive: true });
const path = new URL('../../site/public/bulletins/mock-phonein/bulletin.json', import.meta.url);
const bulletin = assemble(f, draft, 'templates');
// Only the phone-in is voiced: it's what this mock is for, and the rest would take a while on the CPU.
if (!process.argv.includes('--no-voice')) await voiceLines(bulletin.presenters, bulletin.segments.find((s) => s.id === 'phonein')!.lines, fileURLToPath(new URL('.', path)));
writeFileSync(path, JSON.stringify(bulletin, null, 2));
