# Curriculum data

Committed vocabulary books, in the CSV shape the in-app importer reads
(`shared/logic/vocab-csv.ts`). These are **reviewable artefacts**: the diff a reviewer sees is the
book, not somebody's retyping of it.

## `en9-global-success.csv`

_Tiếng Anh 9 — Global Success_, term 1. 392 words across the six units:

| Unit | Title | Words |
| ---- | ----- | ----- |
| 1 | Local community | 83 |
| 2 | City life | 88 |
| 3 | Healthy living for teens | 52 |
| 4 | Remembering the past | 58 |
| 5 | Our experiences | 54 |
| 6 | Vietnamese lifestyles: then and now | 57 |

**Source.** A Google Doc, _Chữa bài_Tiếng Anh 9 GB_Kì 1_:
`https://docs.google.com/document/d/1wjYeXWo-6v7Xc-py1XPYSHuFjCucvsUq0uX5yJ8eLaE`. Its export
endpoint needs no authentication, so regenerating needs no credentials.

**Regenerate** — never scrape at runtime, and never hand-edit rows the script produces:

```bash
curl -sL "https://docs.google.com/document/d/1wjYeXWo-6v7Xc-py1XPYSHuFjCucvsUq0uX5yJ8eLaE/export?format=html" -o /tmp/en9.html
node scripts/gdoc-vocab-csv.mjs /tmp/en9.html > data/curricula/en9-global-success.csv
npx vitest run test/en9-curriculum-fixture.test.ts
```

### Four things that will bite whoever touches this next

1. **Use the HTML export, not the text export.** `?format=txt` flattens tables to one cell per line,
   and the cells cannot be safely regrouped, because **the column order varies between units**. This
   book uses three different orders across its six vocabulary tables, and unit 6 labels the part of
   speech `Từ loại` where the other five write `Loại từ`. Position is never trustworthy; each table's
   own header row is.

2. **Google emits Latin-1 characters as *named* entities** (`&ocirc;`) and everything above Latin-1 as
   numeric references (`&#7897;`). Decoding only the numeric form leaves `Phi&ecirc;n &acirc;m`
   looking nothing like `phien am`, so the header match fails and **the IPA and example columns come
   out empty for the entire book** — with no error, because the rows were never missing, the header
   was merely unreadable. The script now fails loudly on any entity it does not know; add it to
   `ENTITIES` rather than working around the failure. IPA needs some unobvious ones: `&theta;` is θ,
   `&int;` is ʃ, `&eta;` is ŋ.

3. **`example_answer` must be the exact substring appearing in `example_en`, inflection and all** —
   `looks after`, not `look after`. The importer checks whole-word containment with the games' own
   `exampleContainsAnswer`, and on a mismatch it drops **both** example fields, so the cloze and
   listen games silently lose that word. The script only fills the column when the headword appears
   verbatim; the ~65 rows where it is blank are ones where the sentence inflects the word, and they
   import with no sentence rather than a broken one. Filling those in by hand is a genuine
   improvement, and `test/en9-curriculum-fixture.test.ts` will hold you to the rule.

4. **Phrasal verbs appear in two different layouts in one book.** Units 1 and 2 have three-column
   tables (`Cụm động từ | nghĩa | ví dụ`, no IPA), and unit 2 *also* has a numbered prose list
   (`1. Get around: Dạo quanh` followed by a bulleted example). Both are read. A consequence:
   `come down with`, `hang out with` and `cut down on` occur twice in unit 2 — once from its
   vocabulary table, once from the prose list — so the importer flags them `vi_issue_duplicate` and
   they arrive **unchecked** on the review screen. That is the intended behaviour, not a defect.

### Deliberately out of scope

The grammar explanations and the ~475 practice multiple-choice questions in the source doc are **not**
extracted. Questions belong to the question bank and arrive through its own importer and the
`question-csv` skill; see the header of `shared/logic/question-csv.ts` for why that path deliberately
does not read a paper with a model.

### Seeding a deployed instance

The importer's parse step runs in the browser, so there is no server endpoint that takes a CSV. To
seed a book without clicking through the dialog, use the driver — it imports the *same*
`parseVocabRows` the UI uses and writes through `/vocabulary`'s own intents, so every ownership and
tier check applies:

```bash
MOCHI_URL=https://calendar.ngqv0712.workers.dev MOCHI_EMAIL=dev@mochi.edu MOCHI_PASSWORD=… \
  npx tsx scripts/import-curriculum.mts data/curricula/en9-global-success.csv \
  "Tiếng Anh 9 Global Success" --library
```

`--library` writes to the shared platform tier and needs a platform-admin account. Re-run into the
same book with `--curriculum-id <uuid>`; it is a no-op, because `importUnits` skips words already in a
unit.

**Already seeded on production** as curriculum `5fde15f6-ae01-482d-b768-2a558a07be60`, shared tier,
Khối 9: 6 units, **381 words**. That is 392 parsed minus 11 the source lists twice — `take care of`,
`cut down on`, `come down with`, `hang out with` and friends appear in both a unit's vocabulary table
and its phrasal-verb section. One copy per topic is the intended outcome; the parser flags the second
as `vi_issue_duplicate` so it is visible on the review screen rather than silent.

### Topic tags

The `topics` column is emitted **empty**. Tags are semantic judgements
(`shared/logic/vocab-topics.ts` holds the catalog of 24), and the extractor does not invent them —
a wrong tag is worse than no tag. Fill them in by hand, or in the app after import.
