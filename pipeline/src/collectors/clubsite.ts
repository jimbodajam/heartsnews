import { PAGES, people } from '../faces.ts';
import { fetchText } from '../http.ts';
import type { Person } from '../entities.ts';

// The squad and coaching staff, read from the club's own pages: the only automatic source of who is at the club.

export async function collectSquad(): Promise<Person[]> {
  const squad: Person[] = [];
  for (const [page, role] of Object.entries(PAGES)) {
    for (const p of people(await fetchText(`https://www.heartsfc.co.uk/pages/${page}`))) squad.push({ name: p.name, role });
  }
  return squad;
}
