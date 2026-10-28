// The contract between the pipeline (which writes bulletin.json) and the player (which plays it).

export type SceneId = 'desk' | 'transfer' | 'touchscreen' | 'advert' | 'pitchside' | 'museum' | 'videowall';
export type SegmentKind = 'headlines' | 'story' | 'transfers' | 'fans' | 'match' | 'debate' | 'opponent' | 'adverts' | 'breaking' | 'history';
/** The 16×16 pixel picture on an advert card. */
export type AdArt = 'pig' | 'fish' | 'shirt' | 'pint' | 'ticket';
export type IconId = 'ball' | 'contract' | 'whistle' | 'trophy' | 'medical' | 'mic' | 'stadium' | 'chat';
export type HairStyle = 'short' | 'quiff' | 'bald' | 'long' | 'bob' | 'ponytail';

export interface PresenterLook {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  suit: string;
  shirt: string;
  tie?: string;
  glasses?: boolean;
  beard?: boolean;
  /** Body and face shape: "female" gives a softer jaw, lashes, lip colour, earrings and a tailored jacket. */
  build?: 'male' | 'female';
  /** Out at the ground: `suit` is drawn as a touchline overcoat with the collar up. */
  coat?: boolean;
  /** A striped scarf in this colour. */
  scarf?: string;
  /** A broadcast headset with a boom mic. */
  headset?: boolean;
}

export interface Presenter {
  id: string;
  name: string;
  role: string;
  /** Used to pick a browser voice when a line has no pre-rendered audio. */
  voice: 'male' | 'female';
  /** Kokoro voice used to pre-render this presenter's lines, e.g. "bf_emma". */
  tts?: { voice: string; speed?: number };
  /** Character notes the script writer plays to. */
  persona?: string;
  /** Lasting views that keep their opinions consistent, e.g. "always backs academy players" (pipeline/src/script/notebook.ts). */
  leanings?: string[];
  /** Old ids after a rename, so their memory (opinions, predictions) carries over. */
  formerIds?: string[];
  look: PresenterLook;
}

export interface FixtureRow {
  date: string; // ISO
  home: string;
  away: string;
  competition: string;
}

export interface TableRow {
  pos: number;
  team: string;
  played: number;
  gd: number;
  pts: number;
}

export type Graphic =
  | { type: 'headline'; title: string; source?: string; icon?: IconId; /** Pixel portrait (faces/<slug>.png) of who it's about. */ face?: string }
  | { type: 'transfer'; player: string; from: string; to: string; status: 'rumour' | 'talks' | 'medical' | 'done'; fee?: string }
  | { type: 'sentiment'; score: number; topics: string[] } // score: -1 (raging) .. 1 (buzzing)
  | { type: 'table'; title: string; rows: TableRow[]; highlight: string }
  | { type: 'fixtures'; title: string; fixtures: FixtureRow[] }
  | {
      type: 'result';
      home: string;
      away: string;
      homeScore: number;
      awayScore: number;
      competition: string;
      /** e.g. "FULL TIME", "LIVE 63'", "HALF TIME". Defaults to full time. */
      status?: string;
      homeScorers?: string[];
      awayScorers?: string[];
    }
  /** Team stats side by side under the score, e.g. at half-time: possession, shots, on target… */
  | {
      type: 'stats';
      home: string;
      away: string;
      homeScore: number;
      awayScore: number;
      competition: string;
      /** e.g. "HALF TIME", "FULL TIME", "LIVE 63'". */
      status: string;
      rows: { label: string; home: number; away: number; /** Shown as "61%". */ percent?: boolean }[];
    }
  | { type: 'quote'; text: string; author: string; face?: string }
  | { type: 'predictions'; fixture: string; picks: { name: string; pick: string; record?: string }[] }
  /** A team's recent results with W/D/L. */
  | { type: 'form'; team: string; results: { against: string; score: string; outcome: 'W' | 'D' | 'L'; venue: 'H' | 'A' }[] }
  /** Our record against the next opponent (league and cups), the record at the coming game's ground and the notable results. */
  | {
      type: 'headtohead';
      team: string;
      venue: 'H' | 'A';
      all: { played: number; won: number; drawn: number; lost: number };
      atVenue: { played: number; won: number; drawn: number; lost: number };
      /** Short date ("MAY 2026"), score from our side and where it was. */
      lastWin?: { date: string; score: string; venue: 'H' | 'A' | 'N' };
      biggestWin?: { date: string; score: string; venue: 'H' | 'A' | 'N' };
      /** The last few meetings, newest first. */
      recent: { outcome: 'W' | 'D' | 'L'; score: string; venue: 'H' | 'A' | 'N' }[];
    }
  /** A starting XI on a pitch: rows from the goalkeeper forwards. `changes`: the names new to the side, picked out. */
  | { type: 'formation'; label: string; team: string; formation: string; rows: string[][]; ours: boolean; changes?: string[] }
  /** The substitutes on a team sheet. */
  | { type: 'bench'; team: string; players: { name: string; number?: number; /** faces/<slug>.png */ face?: string }[] }
  /** One player of a team sheet, big on the video wall as the team news is read out. */
  | {
      type: 'player';
      team: string;
      name: string;
      number?: number;
      position?: string;
      /** Pixel portrait (faces/<slug>.png). */
      face?: string;
      captain?: boolean;
      /** Not in the last game's starting XI. */
      isNew?: boolean;
    }
  /** On This Day: players born on this date, with the one getting the package picked out. */
  | { type: 'birthdays'; title: string; rows: { name: string; years: string; apps: number; goals: number; star?: boolean }[] }
  /** A full-screen advert card in an ad break (adverts.json). */
  | {
      type: 'advert';
      id: string;
      brand: string;
      tagline: string;
      small?: string;
      art: AdArt;
      colours: { bg: string; fg: string; accent: string };
      /** This line's backdrop picture (breaks/<id>-<n>.png); without one the code-drawn card shows. */
      photo?: string;
    };

export interface Line {
  speaker: string; // Presenter id
  text: string;
  graphic?: Graphic;
  /** Pre-rendered voice clip, relative to the bulletin file. Written by `npm run voice`. */
  audio?: string;
  /**
   * A line that links segments together rather than reporting news: the welcome, "still to come", a hand-over into
   * the next segment, the sign-off. A quiet slot rewrites just these (pipeline/src/script/quiet.ts).
   */
  link?: 'welcome' | 'comingUp' | 'handover' | 'outro';
}

export interface Segment {
  id: string;
  kind: SegmentKind;
  title: string; // shown on the segment sting
  strap: string; // default text for the headline bar
  scene: SceneId;
  presenters: string[]; // who is on screen
  lines: Line[];
}

export interface Bulletin {
  version: 1;
  generatedAt: string;
  /** Which script writer produced it, e.g. "templates" or "Gemini (gemini-flash-latest)". */
  generatedBy?: string;
  demo?: boolean;
  channel: {
    name: string;
    club: string;
    colours: { primary: string; secondary: string; accent: string };
  };
  presenters: Presenter[];
  ticker: string[];
  segments: Segment[];
  /** Always-useful info for the side panel beside a presenter in close-up (Sky style). */
  sidebar?: Sidebar;
  /** What this bulletin was built from, so the next slot can tell whether anything has changed (quiet.ts). */
  desk?: DeskSignature;
}

/** The running order and match phase a bulletin was written from. */
export interface DeskSignature {
  /** In-depth package story ids, in order. */
  features: string[];
  /** The top four stories in the pool. */
  top: string[];
  /** The lead story. */
  lead?: string;
  transfers: string[];
  /** Every story the script aired (headlines, packages, transfers). */
  aired: string[];
  /** The match phase: kind, then the fixture's date and teams, and the score for a reaction. */
  phase: string;
  /** The UK date, YYYY-MM-DD. */
  day: string;
  /** A full rewrite, or only the links (a quiet slot). */
  kind: 'full' | 'partial';
}

export interface Sidebar {
  highlight: string;
  next?: FixtureRow;
  last?: { home: string; away: string; homeScore: number; awayScore: number; competition: string };
  table?: TableRow[];
  /** Which table it is when it isn't the league, e.g. "Conference League" on a European matchday. */
  tableTitle?: string;
}
