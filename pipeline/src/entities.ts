import { slug } from './text.ts';
import type { ClubConfig, MatchData } from './types.ts';

// The people, clubs and competitions the story engine can tag, seeded into the store each build.

export interface Entity {
  /** Slug of the name; our own club uses its config id. */
  id: string;
  type: 'player' | 'staff' | 'club' | 'competition';
  name: string;
  aliases: string[];
}

export interface Person {
  name: string;
  role?: 'player' | 'staff';
}

/**
 * Our club (with its nicknames) and every team and competition in the fixtures and table, plus the squad and staff.
 * `people` comes first from the club's own pages (faces.json), whose role wins, then SportsDB, whose spelling wins
 * ("Jamie McCart", where the club page's capitals give "Jamie Mccart").
 */
export function seedEntities(club: ClubConfig, match: MatchData | undefined, people: Person[][]): Entity[] {
  const byId = new Map<string, Entity>();
  const add = (e: Entity) => {
    if (!e.id) return;
    const had = byId.get(e.id);
    byId.set(e.id, had ? { ...had, name: e.name } : e);
  };

  add({ id: club.id, type: 'club', name: club.name, aliases: [club.shortName, ...club.nicknames] });
  const fixtures = [...(match?.next ?? []), ...(match?.last ?? [])];
  const teams = [...fixtures.flatMap((f) => [f.home, f.away]), ...(match?.table ?? []).map((r) => r.team)];
  for (const name of teams) if (name !== club.name) add({ id: slug(name), type: 'club', name, aliases: [] });
  for (const f of fixtures) add({ id: slug(f.competition), type: 'competition', name: f.competition, aliases: [] });

  for (const list of people) {
    for (const p of list) {
      const id = slug(p.name);
      add({ id, type: byId.get(id)?.type ?? p.role ?? 'player', name: p.name, aliases: [] });
    }
  }
  // Headlines often use the surname alone ("Milne ruled out"), so it's an alias, unless two people share it.
  const entities = [...byId.values()];
  const surname = (e: Entity) => (e.type === 'player' || e.type === 'staff') && /\s/.test(e.name) ? e.name.split(/\s+/).at(-1)! : undefined;
  const count = new Map<string, number>();
  for (const e of entities) {
    const s = surname(e);
    if (s) count.set(slug(s), (count.get(slug(s)) ?? 0) + 1);
  }
  for (const e of entities) {
    const s = surname(e);
    if (s && count.get(slug(s)) === 1 && !e.aliases.includes(s)) e.aliases = [...e.aliases, s];
  }
  return entities;
}
