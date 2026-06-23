// src/lib/i18n.js — lightweight English/Vietnamese i18n.
//
// Provides a language preference (persisted to localStorage), a translate
// helper `t(key)`, and a small EN/Tiếng Việt toggle. Strings are keyed; missing
// keys fall back to English, then to the key itself. Extend STRINGS to translate
// more of the app.
import { React } from './globals.js';

export const LANG_KEY = 'mochi_lang_v1';
export const LANGUAGES = [{ id: 'en', label: 'EN' }, { id: 'vi', label: 'Tiếng Việt' }];

export const STRINGS = {
  en: {
    language: 'Language',

    // Onboarding / instructions popup
    intro_title: 'Welcome to Mochi 🐾',
    intro_lead: 'A calm home for your classes, calendar and coursework. Here’s what you can do, feature by feature:',
    intro_get_started: 'Get started',
    intro_footer: 'Everything you add is saved to your school’s database — reopen this guide from the ? in the sidebar.',

    feat_dashboard_title: 'Dashboard',
    feat_dashboard_text: 'See today’s schedule and homework due, plus quick stats, the moment you sign in.',
    feat_calendar_title: 'Calendar',
    feat_calendar_text: 'Month, Week, Day and Agenda views. Click a slot to add an event, drag to reschedule, and customize the colors.',
    feat_classes_title: 'Classes',
    feat_classes_text: 'Create classes with weekly schedules, rooms and rosters, and open any card for its full details.',
    feat_people_title: 'People',
    feat_people_text: 'Add students, staff and parents, link them with type-ahead search, and generate one-time invite codes.',
    feat_materials_title: 'Materials',
    feat_materials_text: 'Upload notes and worksheets or link videos and pages, organized by class and easy to favorite.',
    feat_homework_title: 'Homework',
    feat_homework_text: 'Keep a checklist with due dates, points and notes, and tick items off as they’re done.',
    feat_feedback_title: 'Feedback',
    feat_feedback_text: 'Tap “Give feedback” in the sidebar to log ideas, bugs or praise — all collected on the Feedback page.',

    // Sidebar
    nav_overview: 'Overview',
    nav_manage: 'Manage',
    nav_dashboard: 'Dashboard',
    nav_calendar: 'Calendar',
    nav_classes: 'Classes',
    nav_people: 'People',
    nav_materials: 'Materials',
    nav_homework: 'Homework',
    nav_feedback: 'Feedback',
    cta_feedback: 'Give feedback',
    help_label: 'How Mochi works',
  },
  vi: {
    language: 'Ngôn ngữ',

    intro_title: 'Chào mừng đến với Mochi 🐾',
    intro_lead: 'Một không gian gọn gàng cho lớp học, lịch và bài tập của bạn. Đây là những gì bạn có thể làm, theo từng tính năng:',
    intro_get_started: 'Bắt đầu',
    intro_footer: 'Mọi thứ bạn thêm đều được lưu vào cơ sở dữ liệu của trường — mở lại hướng dẫn này từ biểu tượng ? ở thanh bên.',

    feat_dashboard_title: 'Bảng điều khiển',
    feat_dashboard_text: 'Xem lịch hôm nay và bài tập đến hạn, cùng số liệu nhanh, ngay khi bạn đăng nhập.',
    feat_calendar_title: 'Lịch',
    feat_calendar_text: 'Chế độ xem Tháng, Tuần, Ngày và Lịch trình. Nhấp vào một ô để thêm sự kiện, kéo để dời lịch, và tùy chỉnh màu sắc.',
    feat_classes_title: 'Lớp học',
    feat_classes_text: 'Tạo lớp với lịch hằng tuần, phòng học và danh sách học sinh, và mở mỗi thẻ để xem đầy đủ chi tiết.',
    feat_people_title: 'Mọi người',
    feat_people_text: 'Thêm học sinh, nhân viên và phụ huynh, liên kết bằng tìm kiếm gợi ý, và tạo mã mời dùng một lần.',
    feat_materials_title: 'Tài liệu',
    feat_materials_text: 'Tải lên ghi chú và phiếu bài tập hoặc liên kết video và trang web, sắp xếp theo lớp và dễ đánh dấu yêu thích.',
    feat_homework_title: 'Bài tập',
    feat_homework_text: 'Giữ một danh sách kiểm với hạn nộp, điểm và ghi chú, và đánh dấu hoàn thành khi xong.',
    feat_feedback_title: 'Phản hồi',
    feat_feedback_text: 'Nhấn “Gửi phản hồi” ở thanh bên để ghi lại ý tưởng, lỗi hoặc lời khen — tất cả được tập hợp ở trang Phản hồi.',

    nav_overview: 'Tổng quan',
    nav_manage: 'Quản lý',
    nav_dashboard: 'Bảng điều khiển',
    nav_calendar: 'Lịch',
    nav_classes: 'Lớp học',
    nav_people: 'Mọi người',
    nav_materials: 'Tài liệu',
    nav_homework: 'Bài tập',
    nav_feedback: 'Phản hồi',
    cta_feedback: 'Gửi phản hồi',
    help_label: 'Mochi hoạt động thế nào',
  },
};

const LangCtx = React.createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLangState] = React.useState(() => {
    try { return localStorage.getItem(LANG_KEY) || 'en'; } catch (e) { return 'en'; }
  });
  const setLang = React.useCallback((l) => {
    setLangState(l);
    try { localStorage.setItem(LANG_KEY, l); } catch (e) { /* storage unavailable */ }
  }, []);
  const t = React.useCallback(
    (key) => (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || key,
    [lang],
  );
  const value = React.useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return React.createElement(LangCtx.Provider, { value }, children);
}

export function useLang() {
  const ctx = React.useContext(LangCtx);
  if (!ctx) throw new Error('useLang must be used within LanguageProvider');
  return ctx;
}

// Compact EN | Tiếng Việt switch.
export function LanguageToggle() {
  const { lang, setLang } = useLang();
  return React.createElement('div', { className: 'lang-toggle' },
    LANGUAGES.map((l) => React.createElement('button', {
      key: l.id, type: 'button',
      className: 'lang-opt' + (lang === l.id ? ' is-active' : ''),
      onClick: () => setLang(l.id),
    }, l.label)),
  );
}
