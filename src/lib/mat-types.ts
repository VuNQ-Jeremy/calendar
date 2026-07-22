import type { IconName } from '../icons.jsx';

export interface MatType {
  icon: IconName;
  tk: string;
  color: string;
}

export const MAT_TYPES: Record<string, MatType> = {
  notes: { icon: 'file', tk: 'type_notes', color: 'blue' },
  worksheet: { icon: 'clipboard', tk: 'type_worksheet', color: 'green' },
  video: { icon: 'video', tk: 'type_video', color: 'violet' },
  link: { icon: 'link', tk: 'type_link', color: 'orange' },
  curriculum: { icon: 'book', tk: 'type_curriculum', color: 'cocoa' },
};
