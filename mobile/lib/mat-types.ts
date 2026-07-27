import { Book, ClipboardList, FileText, Link2, Video } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

/**
 * The five material types, their labels and their colours.
 *
 * Mirrors `src/lib/mat-types.ts` key-for-key — the keys ARE the `MaterialInput.type` enum, so
 * they cannot drift without failing validation. Only the icon differs: the web stores a name from
 * its own `MIcon` set, this stores the lucide component directly.
 */
export interface MatType {
  icon: LucideIcon;
  tk: string;
  color: string;
}

export const MAT_TYPES: Record<string, MatType> = {
  notes: { icon: FileText, tk: 'type_notes', color: 'blue' },
  worksheet: { icon: ClipboardList, tk: 'type_worksheet', color: 'green' },
  video: { icon: Video, tk: 'type_video', color: 'violet' },
  link: { icon: Link2, tk: 'type_link', color: 'orange' },
  curriculum: { icon: Book, tk: 'type_curriculum', color: 'cocoa' },
};

export const MAT_TYPE_IDS = Object.keys(MAT_TYPES) as (keyof typeof MAT_TYPES)[];

/** `link` and `video` carry a URL and no file — the one branch every material screen needs. */
export const isLinkType = (type: string) => type === 'link' || type === 'video';
