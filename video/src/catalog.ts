import type { FormatId } from './formats';

export type Series = 'guide' | 'short' | 'trailer' | 'changelog';

export type GuideStep = {
  /** Must match a step id in the recording's manifest.json. */
  manifestStep: string;
  /** The Vietnamese caption. Timing comes from the manifest; the words live here. */
  captionVi: string;
  /**
   * Push the camera in on this step's recorded target.
   *
   * Off by default, and that default is editorial rather than technical. Zooming
   * scales about the target, so a control near an edge — a sidebar item, say —
   * pushes the rest of the screen out of frame, hiding the very thing the click just
   * caused. Reach for it only when the subject is centred and detail genuinely helps,
   * such as the fields inside a dialog; elsewhere the cursor pulse does the pointing.
   */
  zoom?: boolean;
  /** Pulse a ring where the script clicked. */
  highlightClick?: boolean;
  /** Move the caption off the bottom when it would cover the subject. */
  captionAt?: 'bottom' | 'top';
};

export type CatalogEntry = {
  id: string;
  series: Series;
  titleVi: string;
  /** Second line on the title card. */
  subtitleVi?: string;
  formats: FormatId[];
  /** Recording directory under `public/recordings/`. Guides only. */
  recording?: string;
  steps?: GuideStep[];
  /** File in `public/music/`. Omitted = silent, which is a valid state. */
  music?: string;
};

/**
 * Every video in the catalog.
 *
 * One entry per video; `src/Root.tsx` registers it once per format. Adding a guide
 * means recording a walkthrough (`npm run record -- <id>`) and writing its captions
 * here against the step ids that walkthrough declared.
 *
 * See BACKLOG.md for the videos that are planned but not built.
 */
export const CATALOG: CatalogEntry[] = [
  {
    id: 'guide-calendar-basics',
    series: 'guide',
    titleVi: 'Lịch & tạo buổi học',
    subtitleVi: 'Hướng dẫn nhanh cho giáo viên',
    formats: ['landscape'],
    recording: 'calendar-basics',
    steps: [
      {
        manifestStep: 'open-calendar',
        captionVi: 'Mở mục Lịch ở thanh bên trái.',
        highlightClick: true,
      },
      {
        manifestStep: 'switch-views',
        captionVi: 'Xem theo Ngày, Tuần, Tháng hoặc Lịch trình.',
        highlightClick: true,
      },
      {
        manifestStep: 'month-overview',
        captionVi: 'Mỗi buổi học mang màu của lớp, nhìn là nhận ra ngay.',
      },
      {
        manifestStep: 'new-event',
        captionVi: 'Nhấn Sự kiện mới để thêm một buổi học.',
        highlightClick: true,
      },
      {
        manifestStep: 'type-title',
        captionVi: 'Nhập tiêu đề cho buổi học.',
        zoom: true,
      },
      {
        manifestStep: 'pick-time',
        captionVi: 'Chọn giờ bắt đầu và giờ kết thúc.',
        zoom: true,
        highlightClick: true,
      },
      {
        manifestStep: 'pick-class',
        captionVi: 'Chọn lớp — buổi học tự nhận màu của lớp đó.',
        zoom: true,
        highlightClick: true,
      },
      {
        manifestStep: 'repeat-weekly',
        captionVi: 'Chọn Hằng tuần nếu buổi học lặp lại mỗi tuần.',
        zoom: true,
        highlightClick: true,
      },
      {
        // Framed on the dialog's footer, caption moved up top: the button being
        // pressed sits at the bottom, exactly where a caption would otherwise land,
        // and pushing in there also crops away the page header a top caption would
        // have collided with.
        manifestStep: 'save',
        captionVi: 'Nhấn Thêm sự kiện để lưu.',
        zoom: true,
        captionAt: 'top',
        highlightClick: true,
      },
      {
        manifestStep: 'see-result',
        captionVi: 'Buổi học mới đã có trên lịch.',
        zoom: true,
      },
      {
        manifestStep: 'see-recurrence',
        captionVi: 'Và tự lặp lại đều đặn ở những tuần sau.',
      },
      {
        manifestStep: 'drag-to-move',
        captionVi: 'Ở dạng Tuần, kéo thả để dời buổi học sang giờ khác.',
      },
    ],
  },
];

export function entry(id: string): CatalogEntry {
  const found = CATALOG.find((e) => e.id === id);
  if (!found) throw new Error(`no catalog entry "${id}"`);
  return found;
}
