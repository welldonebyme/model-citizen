export interface ReviewLink { kind: 'lesson' | 'lab' | 'chapter'; href: string; text: string }
/** objective id -> where it is taught (lessons and labs, or chapters) */
export type ObjectiveLinks = Record<string, ReviewLink[]>;
