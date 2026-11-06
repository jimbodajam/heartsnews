import type { SegmentKind } from '../../../shared/bulletin';

/** The on-air label for each kind of segment, as the headline bar and the sting show it. */
export const SEGMENT_LABEL: Record<SegmentKind, string> = {
  headlines: 'HEADLINES',
  story: 'IN FOCUS',
  transfers: 'TRANSFER CENTRE',
  fans: 'FAN ZONE',
  match: 'MATCH CENTRE',
  debate: 'THE DEBATE',
  phonein: 'PHONE-IN',
  opponent: 'OPPOSITION FOCUS',
  adverts: 'AD BREAK',
  breaking: 'BREAKING',
  history: 'ON THIS DAY',
  papers: 'THE PAPERS',
};
