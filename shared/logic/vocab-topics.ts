/**
 * The global semantic topic catalog — the seed source of record for the `vocab_topics` table
 * (migration 0046), and still shared by the web and mobile apps so a generator picker can render
 * before its loader resolves.
 *
 * These are TAGS on a word (Food, Travel, Environment), not decks. `flashcard_topics` is the deck.
 *
 * Adding an entry here no longer just changes a dropdown: since 0046 there is a row behind each id,
 * so a new topic needs a row too (a migration, or the platform screen). `test/vocab-topics.test.ts`
 * asserts this array and the 0046 seed agree, so the two cannot drift silently.
 *
 * `en` is also what the AI generator sends the model (it generates English words); `vi` is display
 * only. `id` doubles as the slug, so it must stay URL-safe.
 */

export interface VocabTopic {
  id: string;
  en: string;
  vi: string;
}

export const VOCAB_TOPICS: VocabTopic[] = [
  { id: 'family', en: 'Family', vi: 'Gia đình' },
  { id: 'food', en: 'Food & Cooking', vi: 'Ẩm thực & Nấu ăn' },
  { id: 'travel', en: 'Travel', vi: 'Du lịch' },
  { id: 'school', en: 'School', vi: 'Trường học' },
  { id: 'animals', en: 'Animals', vi: 'Động vật' },
  { id: 'weather', en: 'Weather', vi: 'Thời tiết' },
  { id: 'sports', en: 'Sports', vi: 'Thể thao' },
  { id: 'health', en: 'Health', vi: 'Sức khỏe' },
  { id: 'shopping', en: 'Shopping', vi: 'Mua sắm' },
  { id: 'technology', en: 'Technology', vi: 'Công nghệ' },
  { id: 'jobs', en: 'Jobs & Work', vi: 'Nghề nghiệp' },
  { id: 'emotions', en: 'Emotions & Feelings', vi: 'Cảm xúc' },
  { id: 'clothing', en: 'Clothing', vi: 'Quần áo' },
  { id: 'home', en: 'House & Home', vi: 'Nhà cửa' },
  { id: 'nature', en: 'Nature', vi: 'Thiên nhiên' },
  { id: 'transport', en: 'Transportation', vi: 'Giao thông' },
  { id: 'music-arts', en: 'Music & Arts', vi: 'Âm nhạc & Nghệ thuật' },
  { id: 'time', en: 'Time & Dates', vi: 'Thời gian & Ngày tháng' },
  { id: 'body', en: 'The Human Body', vi: 'Cơ thể người' },
  { id: 'daily', en: 'Daily Routines', vi: 'Sinh hoạt hằng ngày' },
  { id: 'colors-shapes', en: 'Colors & Shapes', vi: 'Màu sắc & Hình khối' },
  { id: 'numbers', en: 'Numbers', vi: 'Số đếm' },
  { id: 'hobbies', en: 'Hobbies & Free Time', vi: 'Sở thích' },
  { id: 'environment', en: 'Environment', vi: 'Môi trường' },
];

/** The label to display for a topic in the given UI language. */
export function vocabTopicLabel(topic: VocabTopic, lang: string): string {
  return lang === 'vi' ? topic.vi : topic.en;
}

/** The English name to send to the model for a catalog id, or '' when the id is unknown. */
export function vocabTopicEnName(id: string): string {
  return VOCAB_TOPICS.find((t) => t.id === id)?.en ?? '';
}
