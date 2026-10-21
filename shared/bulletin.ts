// The contract between the pipeline (which writes bulletin.json) and the player (which plays it).

export type SceneId = 'desk' | 'transfer' | 'touchscreen';
export type SegmentKind = 'headlines' | 'story' | 'transfers' | 'fans' | 'match';
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
  voice: 'male' | 'female';
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
  | { type: 'result'; home: string; away: string; homeScore: number; awayScore: number; competition: string; scorers?: string[] }
  | { type: 'quote'; text: string; author: string };

export interface Line {
  speaker: string; // Presenter id
  text: string;
  graphic?: Graphic;
  audio?: string; // pre-rendered voice clip (milestone 5)
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
