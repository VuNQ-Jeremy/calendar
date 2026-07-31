/**
 * Curated topics offered by the AI vocabulary generator, shared by the web app and the mobile
 * app so both show the same list.
 *
 * Purely a UI convenience: `VocabGenerateInput.topic` is any string, so adding or removing an
 * entry here needs no schema, migration, or server change. `en` is what the model sees (it
 * generates English words); `vi` is display only.
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
