import { describe, expect, it } from 'vitest';
import {
  MAX_IMPORT_WORDS,
  parseVocabRows,
  VOCAB_HEADER_ALIASES,
  VOCAB_TEMPLATE_CSV,
} from '../shared/logic/vocab-csv';
import { VOCAB_TOPICS } from '../shared/logic/vocab-topics';

const KNOWN = VOCAB_TOPICS.map((t) => t.id);
const head = [
  'unit',
  'unit_name',
  'word',
  'pos',
  'ipa',
  'meaning_vi',
  'example_en',
  'example_answer',
  'topics',
];
const row = (...cells: string[]) => cells;

describe('parseVocabRows — grouping', () => {
  it('groups rows into units and keeps file order as word order', () => {
    const f = parseVocabRows(
      [
        head,
        row('1', 'Local community', 'local', 'adj', '/ˈləʊkəl/', '(thuộc) địa phương', '', '', ''),
        row('1', 'Local community', 'community', 'n', '/kəˈmjuːnɪti/', 'cộng đồng', '', '', ''),
        row('2', 'City life', 'packed', 'adj', '/pækt/', 'chật chội', '', '', ''),
      ],
      KNOWN,
    );
    expect(f.units.map((u) => [u.unitNo, u.name, u.words.length])).toEqual([
      [1, 'Local community', 2],
      [2, 'City life', 1],
    ]);
    expect(f.units[0].words.map((w) => w.word)).toEqual(['local', 'community']);
  });

  it('sorts units by number even when the file does not', () => {
    const f = parseVocabRows(
      [
        head,
        row('3', 'C', 'c', '', '', 'm', '', '', ''),
        row('1', 'A', 'a', '', '', 'm', '', '', ''),
      ],
      KNOWN,
    );
    expect(f.units.map((u) => u.unitNo)).toEqual([1, 3]);
  });

  it('files everything under unit 1 when there is no unit column', () => {
    const f = parseVocabRows([['word', 'nghia'], row('alpha', 'chữ alpha')], KNOWN);
    expect(f.units).toHaveLength(1);
    expect(f.units[0]).toMatchObject({ unitNo: 1, name: 'Unit 1' });
  });

  it('names an unnamed unit after its number, since a nameless deck is unusable', () => {
    const f = parseVocabRows([head, row('4', '', 'w', '', '', 'm', '', '', '')], KNOWN);
    expect(f.units[0].name).toBe('Unit 4');
  });

  it('lets the first non-blank unit name win, so a repeated column does not fight itself', () => {
    const f = parseVocabRows(
      [
        head,
        row('1', '', 'a', '', '', 'm', '', '', ''),
        row('1', 'Local community', 'b', '', '', 'm', '', '', ''),
      ],
      KNOWN,
    );
    expect(f.units[0].name).toBe('Local community');
  });
});

describe('parseVocabRows — headers', () => {
  it('reads columns by header, not by position', () => {
    // Unit 1 of the source book orders them word/pos/ipa/meaning; unit 2 word/ipa/meaning/pos.
    const f = parseVocabRows(
      [
        ['unit', 'từ vựng', 'phiên âm', 'nghĩa', 'từ loại'],
        row('1', 'suburb', '/ˈsʌbɜːrb/', 'ngoại ô', 'n'),
      ],
      KNOWN,
    );
    expect(f.units[0].words[0]).toMatchObject({
      word: 'suburb',
      ipa: '/ˈsʌbɜːrb/',
      meaningVi: 'ngoại ô',
      partOfSpeech: 'n',
    });
  });

  it('accepts "Loại từ" and "Từ loại", which the source book uses interchangeably', () => {
    const a = parseVocabRows([['từ vựng', 'Loại từ'], row('x', 'adj')], KNOWN);
    const b = parseVocabRows([['từ vựng', 'Từ loại'], row('x', 'adj')], KNOWN);
    expect(a.units[0].words[0].partOfSpeech).toBe('adj');
    expect(b.units[0].words[0].partOfSpeech).toBe('adj');
  });

  it('matches headings typed without tone marks', () => {
    const f = parseVocabRows([['tu vung', 'nghia', 'phien am'], row('x', 'nghĩa x', '/x/')], KNOWN);
    expect(f.units[0].words[0]).toMatchObject({ word: 'x', meaningVi: 'nghĩa x', ipa: '/x/' });
  });

  it('skips a title row above the header', () => {
    const f = parseVocabRows(
      [['Tiếng Anh 9 — Global Success', '', ''], head, row('1', 'U', 'w', '', '', 'm', '', '', '')],
      KNOWN,
    );
    expect(f.units[0].words).toHaveLength(1);
  });

  it('throws a bad-header error when no word column exists', () => {
    expect(() => parseVocabRows([['unit', 'nghĩa'], row('1', 'x')], KNOWN)).toThrow(
      'vi_err_bad_header',
    );
  });

  it('exports its aliases as data, so the template and the parser cannot drift', () => {
    const headerCells = VOCAB_TEMPLATE_CSV.split('\n')[0].split(',');
    for (const cell of headerCells) {
      const matched = Object.values(VOCAB_HEADER_ALIASES).some((aliases) =>
        aliases.includes(cell.replace(/_/g, ' ')),
      );
      expect(matched, `template column "${cell}" matches no alias`).toBe(true);
    }
  });
});

describe('parseVocabRows — examples', () => {
  it('keeps an example whose answer really appears in it', () => {
    const f = parseVocabRows(
      [
        head,
        row(
          '1',
          'U',
          'look after',
          'phr.v',
          '',
          'chăm sóc',
          'She looks after her brother.',
          'looks after',
          '',
        ),
      ],
      KNOWN,
    );
    expect(f.units[0].words[0]).toMatchObject({
      exampleEn: 'She looks after her brother.',
      exampleAnswer: 'looks after',
    });
    expect(f.units[0].words[0].issues).toEqual([]);
  });

  it('drops BOTH example fields when the answer is not in the sentence, and says so', () => {
    // The uninflected headword is absent, so the cloze and listen games could never blank it.
    const f = parseVocabRows(
      [
        head,
        row(
          '1',
          'U',
          'look after',
          'phr.v',
          '',
          'chăm sóc',
          'She looks after her brother.',
          'look after',
          '',
        ),
      ],
      KNOWN,
    );
    expect(f.units[0].words[0]).toMatchObject({ exampleEn: null, exampleAnswer: null });
    expect(f.units[0].words[0].issues).toContain('vi_issue_example_dropped');
  });

  it('derives a blank answer from the headword when it appears whole-word', () => {
    const f = parseVocabRows(
      [head, row('1', 'U', 'community', 'n', '', 'cộng đồng', 'The community gathered.', '', '')],
      KNOWN,
    );
    expect(f.units[0].words[0].exampleAnswer).toBe('community');
    expect(f.units[0].words[0].issues).toEqual([]);
  });

  it('does not accept the headword inside a longer word', () => {
    // "run" must not match "running" — that is the model returning the wrong form.
    const f = parseVocabRows(
      [head, row('1', 'U', 'run', 'v', '', 'chạy', 'He is running fast.', '', '')],
      KNOWN,
    );
    expect(f.units[0].words[0].exampleEn).toBeNull();
    expect(f.units[0].words[0].issues).toContain('vi_issue_example_dropped');
  });

  it('discards an answer that has no sentence to sit in', () => {
    const f = parseVocabRows([head, row('1', 'U', 'w', '', '', 'm', '', 'w', '')], KNOWN);
    expect(f.units[0].words[0].exampleAnswer).toBeNull();
    expect(f.units[0].words[0].issues).toEqual([]);
  });
});

describe('parseVocabRows — issues', () => {
  it('flags a word with no meaning and no definition', () => {
    const f = parseVocabRows([head, row('1', 'U', 'lantern', 'n', '', '', '', '', '')], KNOWN);
    expect(f.units[0].words[0].issues).toContain('vi_issue_no_meaning');
  });

  it('accepts a word with only an English definition', () => {
    const f = parseVocabRows(
      [
        ['unit', 'word', 'definition_en'],
        row('1', 'lantern', 'a portable lamp with a protective case'),
      ],
      KNOWN,
    );
    expect(f.units[0].words[0].issues).toEqual([]);
  });

  it('drops an unknown topic tag but keeps the word', () => {
    const f = parseVocabRows(
      [head, row('1', 'U', 'local', 'adj', '', 'địa phương', '', '', 'family, not-a-topic')],
      KNOWN,
    );
    expect(f.units[0].words[0].topicIds).toEqual(['family']);
    expect(f.units[0].words[0].issues).toContain('vi_issue_unknown_topic');
  });

  it('accepts a semicolon-separated tag list', () => {
    const f = parseVocabRows([head, row('1', 'U', 'w', '', '', 'm', '', '', 'family;home')], KNOWN);
    expect(f.units[0].words[0].topicIds).toEqual(['family', 'home']);
  });

  it('caps tags at five', () => {
    const f = parseVocabRows(
      [head, row('1', 'U', 'w', '', '', 'm', '', '', 'family,home,school,travel,food,sports')],
      KNOWN,
    );
    expect(f.units[0].words[0].topicIds).toHaveLength(5);
  });

  it('flags the second copy of a word repeated inside one unit', () => {
    const f = parseVocabRows(
      [
        head,
        row('1', 'U', 'local', 'adj', '', 'a', '', '', ''),
        row('1', 'U', 'local', 'adj', '', 'b', '', '', ''),
      ],
      KNOWN,
    );
    expect(f.units[0].words[0].issues).toEqual([]);
    expect(f.units[0].words[1].issues).toContain('vi_issue_duplicate');
  });

  it('does not flag the same word appearing in two different units', () => {
    const f = parseVocabRows(
      [
        head,
        row('1', 'A', 'local', '', '', 'a', '', '', ''),
        row('2', 'B', 'local', '', '', 'a', '', '', ''),
      ],
      KNOWN,
    );
    expect(f.units[1].words[0].issues).toEqual([]);
  });
});

describe('parseVocabRows — skipped and truncated', () => {
  it('records the spreadsheet row number of a row with content but no word', () => {
    const f = parseVocabRows([head, row('1', 'U', '', '', '', 'nghĩa', '', '', '')], KNOWN);
    expect(f.skipped).toEqual([2]);
    expect(f.units).toEqual([]);
  });

  it('ignores a wholly blank row rather than reporting it', () => {
    const f = parseVocabRows(
      [head, row('', '', '', '', '', '', '', '', ''), row('1', 'U', 'w', '', '', 'm', '', '', '')],
      KNOWN,
    );
    expect(f.skipped).toEqual([]);
    expect(f.units[0].words).toHaveLength(1);
  });

  it('truncates past the word cap instead of refusing the file', () => {
    const rows = [head];
    for (let i = 0; i < MAX_IMPORT_WORDS + 5; i++) {
      rows.push(row('1', 'U', `w${i}`, '', '', 'm', '', '', ''));
    }
    const f = parseVocabRows(rows, KNOWN);
    expect(f.truncated).toBe(true);
    expect(f.units[0].words).toHaveLength(MAX_IMPORT_WORDS);
  });
});

describe('the shipped template', () => {
  it('parses with no issues on any row', () => {
    const rows = VOCAB_TEMPLATE_CSV.split('\n').map((l) => l.split(','));
    const f = parseVocabRows(rows, KNOWN);
    expect(f.units.map((u) => u.unitNo)).toEqual([1, 2]);
    expect(f.skipped).toEqual([]);
    expect(f.truncated).toBe(false);
    const allIssues = f.units.flatMap((u) => u.words).flatMap((w) => w.issues);
    expect(allIssues).toEqual([]);
  });

  it('demonstrates the inflected example answer, which is the trap it exists to teach', () => {
    const rows = VOCAB_TEMPLATE_CSV.split('\n').map((l) => l.split(','));
    const f = parseVocabRows(rows, KNOWN);
    const lookAfter = f.units[0].words.find((w) => w.word === 'look after');
    expect(lookAfter?.exampleAnswer).toBe('looks after');
  });
});
