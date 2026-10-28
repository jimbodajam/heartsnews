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

/** A person an admin has edited or added (the entities table's `locked` rows): it wins over the club page. */
export interface Override extends Entity {
  active: boolean;
  /** Not on the club's pages: put in by hand. */
  added: boolean;
}

/**
 * Our club (with its nicknames) and every team and competition in the fixtures and table, plus the squad and staff.
 * `people` is the club's own pages, the only automatic source. `overrides` are the admin's edits on top: a corrected
 * spelling ("Jamie McCart", where the club page's capitals give "Jamie Mccart"), someone signed but not listed yet,
 * or someone switched off.
 */
export function seedEntities(club: ClubConfig, match: MatchData | undefined, people: Person[][], overrides: Override[] = []): Entity[] {
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
  for (const o of overrides) {
    // An edit only holds while the club page still lists them; someone the admin added stays until switched off.
    if (!o.active) byId.delete(o.id);
    else if (o.added || byId.has(o.id)) byId.set(o.id, { id: o.id, type: o.type, name: o.name, aliases: o.aliases });
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
