// The contract between the pipeline (which writes bulletin.json) and the player (which plays it).

export type SceneId = 'desk' | 'transfer' | 'touchscreen';
export type SegmentKind = 'headlines' | 'story' | 'transfers' | 'fans' | 'match' | 'debate';
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
  | { type: 'headline'; title: string; source?: string; icon?: IconId }
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
  | { type: 'quote'; text: string; author: string }
  | { type: 'predictions'; fixture: string; picks: { name: string; pick: string; record?: string }[] };

export interface Line {
  speaker: string; // Presenter id
  text: string;
  graphic?: Graphic;
  /** Pre-rendered voice clip, relative to the bulletin file. Written by `npm run voice`. */
  audio?: string;
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
}
