---
name: question-csv
description: Turn a school test paper or exam (Word, PDF, photo, or pasted text) into the question-import CSV that Mochi accepts — questions, passages, option letters and a separate answer key — without inventing answers. Use whenever a teacher supplies a test paper and wants the questions imported into Mochi.
---

# Test paper → Mochi question-import CSV

Mochi imports questions from a spreadsheet, and nothing else. There is no "let the app read my
paper" button any more: the reading happens here, in this conversation, and the teacher uploads the
file you produce. That makes your output the whole product — if a column is misnamed or an answer is
invented, nobody downstream catches it.

## When to use this

A teacher gives you a test paper — a `.docx`, a PDF, a photo of a printed page, or text pasted into
the chat — and wants those questions in Mochi. Often the answers arrive separately: a second file, a
photo of the last page, or a list typed into the message ("1. B 2. C 3. A"). Sometimes there is no
key at all, which is normal and handled below.

Your job is to transcribe the paper into one CSV file, check it, and hand it over with a short
summary. You are not writing questions, grading them, or improving them.

## The CSV spec

### The header row

Exactly this, as line 1 (this is also `template.csv`, next to this file):

```
number,type,context,prompt,optionA,optionB,optionC,optionD,answer,explanation,difficulty,tags
```

**A paper with more than four choices needs the extra columns written into that header line.** Add
`optionE`, `optionF` … up to `optionJ`, in order, between `optionD` and `answer` — the importer reads
every option column it finds, but it cannot read one the header never named.

The importer matches header names case-insensitively, trims whitespace, tolerates a byte-order mark,
and ignores columns it does not recognise, so a column you add for your own notes does no harm. It
also looks for this header in the first ten rows rather than demanding it be line 1, so a school
template with its own title row above the table imports fine. These aliases are accepted (after
lowercasing and trimming):

| Column                 | Also accepted                                     |
| ---------------------- | ------------------------------------------------- |
| `number`               | `no`, `#`, `q`                                    |
| `type`                 | —                                                 |
| `context`              | `passage`                                         |
| `prompt`               | `question`                                        |
| `optionA`..`optionJ`   | `option a` .. `option j` (a space is allowed)      |
| `answer`               | `key`, `correct`                                  |
| `explanation`          | `explain`                                         |
| `difficulty`           | `level`                                           |
| `tags`                 | `tag`                                             |

Prefer the canonical names. The aliases exist so a teacher's own spreadsheet imports without being
rebuilt; a file you write should look like the template.

### What goes in each column

**`number`** — the question number as PRINTED on the paper. The importer takes the first run of one
to three digits in the cell, so `1.`, `Câu 12` and `Question 7:` all work, and a cell with no digits
becomes nothing. Blank is allowed. This number is what an answer key is matched against and what
raises the "missing question" warning; it is never saved with the question, so it costs the teacher
nothing and saves them a great deal.

**`type`** — one of `mcq` (one correct option), `multi` (two or more correct options), `text` (short
written answer, graded automatically) or `essay` (written answer, no key). Leave it blank and the
importer infers: two or more non-blank option cells means `mcq`; otherwise a non-blank `answer`
means `text`; otherwise `essay`. Write the type anyway — it is the only way to say "this is a
multi-select" or "this looks like a short answer but I want it hand-marked".

The app then reconciles what you wrote against what the row actually contains, and the row wins: two
correct letters promote `mcq` to `multi`, and fewer than two surviving options downgrade a choice
question to `text` or `essay`. So a disagreement is not fatal — but it does mean a typo in the
option columns quietly changes the type, which is what the self-check below is for.

**`context`** — the shared passage and/or the section instruction that the question is answered
from. Repeat it VERBATIM on every row of the group it covers; the app dedupes consecutive identical
contexts wherever it renders them, so the passage is shown once, not seven times. Join an
instruction and a passage with one blank line. Cap 8000 characters.

**`optionA`..`optionJ`** — one option per column, ten at most, **and the column letter is the
printed letter**. This is the part that goes wrong: if the paper's option B is missing or you cannot
read it, leave `optionB` empty and still put the third option in `optionC`. The importer walks the
option columns in letter order including the blanks, drops the blank, and remembers that position C
was the third printed choice — which is how a key that says "17. C" lands on the right option. Never
close the gap by shifting options left. Cap 500 characters each.

Two options whose text is **word-for-word identical** are treated as one, and an answer letter
pointing at the one that was dropped then finds nothing. Options that differ only in capitalisation
are NOT duplicates and both survive, so a "choose the correct capitalisation" item works as written
(`hanoi` / `Hanoi` / `HANOI`). If a paper really does print the same words twice, quote enough of the
sentence in each option to tell them apart.

**`answer`** — **if the paper does not give its answers and no separate key was supplied, every cell
in this column is blank. That is not a fallback, it is the rule** — see "Answers — the binding rule"
below before you fill in a single one. When you do have answers, the format depends on the type:

- `mcq` — one letter: `B`.
- `multi` — the letters: `B,D`. Comma, semicolon, slash, ampersand, plus and plain space all work as
  separators.
- `text` — the accepted answers separated by the pipe character: `since|Since`. Every variant the
  teacher would mark right belongs here; grading also ignores case and accents on its own.
- `essay` — blank.

Lowercase and trailing punctuation are tolerated (`b.` is B). A letter pointing at a blank or absent
option column resolves to nothing: the question still imports, flagged as "no answer marked", rather
than importing with a wrong answer. That is a safe failure, but it is a failure — `validate.mjs`
reports it as an error.

**`explanation`** — optional, shown after grading. Cap 2000. Copy one the paper gives; do not write
one the paper does not.

**`difficulty`** — `easy`, `medium`, `hard`, or blank.

**`tags`** — split on comma or semicolon, at most 20 tags, each at most 50 characters. Useful for
finding questions later (`reading`, `unit 3`, `grammar`).

### Encoding, quoting, size

- **UTF-8**, no byte-order mark needed (one is tolerated). Write Vietnamese in composed (NFC) form.
- **Quote** any field containing a comma, a double quote or a newline, and double a literal quote
  inside a quoted field: `"She said ""no"" twice."` A passage with paragraphs is a single quoted
  field with real newlines inside it — that is valid CSV and the importer reads it correctly.
- **Prompt cap 4000 characters.** Caps at a glance: prompt 4000, context 8000, option 500,
  explanation 2000, tag 50, 20 tags.
- **A completely empty row is skipped in silence**, so an empty line between two sections is
  harmless. A row that has content but an empty `prompt` is skipped too — and reported as skipped,
  because a question that vanishes quietly is the one mistake a teacher never notices.
- **At most 50 questions per file.** A longer paper is split into `part1.csv`, `part2.csv`, … with
  the printed numbering CONTINUING across the parts (part 2 starts at 51, not at 1), so every number
  still identifies one question across the whole paper. **Each part is imported on its own, and the
  key is pasted one part at a time**: the key box only sees the questions in the batch on screen, so
  pasting a 1–100 key while importing part 2 reports numbers 1–50 as questions it could not find.
  When a key was supplied, hand over a matching `part1-key.txt`, `part2-key.txt` … so each paste
  covers exactly that part's numbers.
- **Delimiter and file format are not your problem.** `.csv`, `.xlsx` and `.xls` all go through the
  same spreadsheet reader, which sniffs comma, semicolon and tab and strips the BOM. A teacher who
  opens your file in a Vietnamese-locale Excel and saves it again gets semicolons, and it still
  imports. Write plain comma-delimited CSV.

## Transcription rules

Each of these cost something to learn — they come from running this against a real 40-question
Vietnamese English practice paper — so keep the reason in mind rather than the rule alone.

**Copy a passage or a section instruction verbatim into `context`, repeated identically on every row
of its group.** Never merge it into the prompt, never summarise it, never shorten it: the student
answers FROM that text, so a paraphrase changes what the correct answer is. Join instruction and
passage with one blank line. Identical repetition is what lets the app tell that seven rows share
one passage.

**A shared option list is copied into every row that uses it.** "Use the options below for questions
37–40" means those four rows each carry the same `optionA`..`optionD`. A row that references options
it does not contain is unanswerable in the app.

**An underlined part of a word is written with underscores around it:** `pleas_ed_`, `wash_ed_`.
Options are plain text in Mochi — no bold, no underline — so this is the only way a pronunciation or
stress question survives the trip. Use it consistently across the whole question.

**Keep the source language.** A Vietnamese paper stays Vietnamese, an English paper stays English,
and a bilingual instruction keeps both. Normalise Vietnamese to composed (NFC) form, which is what
PDF and Word text often is not. Skip everything that is not a question: page headers and footers,
watermarks, the school's name, "Trang 2/4", exam-hall instructions, ads.

**Bold or underline counts as an answer mark only when it marks exactly one whole option AND the
same convention repeats across questions.** This genre uses bold for structure constantly: bold
question labels ("**Câu 12.**"), bold quoted words inside the prompt, bold section headings, a
stray bold space left by an editor. Treating any of those as an answer produces a key that is wrong
in a way the teacher cannot see. One bolded option per question, question after question, is a
marked-up teacher's copy; anything less regular is formatting.

**Every printed question number goes in `number`, and then you count.** If the paper's numbering
runs 1..N, you must have produced exactly N rows. Say the count out loud in your reply, and name any
number you could not find and why (an image-only question, an unreadable scan, a page that was cut
off). A silent gap looks like a complete import to the teacher.

## Answers — the binding rule

**Decide once, for the whole paper, whether the document gives its answers at all.** Marked on the
options, stated in words ("Đáp án: B"), or listed at the end — any of those counts. If it does none
of them, and no separate key was supplied, then EVERY `answer` cell in your file stays blank.

This rule is absolute, and it is worth understanding why. A model that has just read forty questions
is under enormous pressure to answer them; the questions are right there, most of them are easy, and
filling the column feels like doing the job well. But a plausible invented key is far worse than a
blank one, because the teacher cannot see that it is wrong. They will hand it to a class. A blank
column, by contrast, is visible: the app flags every unanswered question, leaves it unchecked in the
review screen, and offers a box to paste the key into afterwards. Blank costs the teacher one
minute. A wrong key costs them a lesson, and their students' trust.

You are transcribing a document, not sitting the exam. Decide once, up front, and hold to it for
every row.

**When a key IS supplied**, apply it properly:

- Match by PRINTED question number, never by position in the list. Papers skip numbers and sections
  restart; a positional match silently shifts every answer after the first discrepancy.
- A letter means the printed option letter — the one in that row's `optionX` column.
- Two letters for one question mean it is multi-select: set `type` to `multi` and write `B,D`.
- A key line written out in words is the answer to a `text` row: `3. since` becomes `since` (add the
  capitalised variant when the blank starts a sentence: `since|Since`).
- Report the tally: how many questions the key filled in, and any key numbers that matched no
  question. A key naming question 41 on a 40-question paper means one of the two documents is not
  the one the teacher thinks it is.

## Self-check before you deliver

Run the validator that ships beside this skill. Give it the path it actually lives at:

```
node validate.mjs questions.csv                               # skill files in the working directory
node .claude/skills/question-csv/validate.mjs questions.csv   # inside the Mochi repo
```

It needs nothing installed — plain Node 18 or newer, no dependencies. It reports errors (the file
will not import correctly) and warnings (probably fine, look at them). Fix and re-run until it is
clean.

**The validator cannot check the one thing that matters most.** An invented answer is indistinguishable
from a real one, so a fully fabricated key passes with `with answers 40 / 40 · RESULT: OK`. Do not
report that as "checked, no problems" without saying where those answers came from.

When you cannot execute code, walk the same checklist by hand:

0. Did the paper — or a key the teacher supplied — actually state its answers? If not, confirm the
   `answer` column is empty on EVERY row. Say which of the two it was in your reply.
1. The header row contains `prompt`, with nothing above it but a title or blank rows.
2. Every row has a prompt, and the row count equals the paper's question count.
3. Every `mcq`/`multi` row has at least two non-blank options, and no two options in a row repeat
   each other word for word.
4. Every answer letter points at an option column that exists and is non-blank in that row — every
   letter, not just the first: a `multi` answer of `B,D` needs both `optionB` and `optionD` filled in.
5. Every `type` is `mcq`/`multi`/`text`/`essay` or blank; every `difficulty` is
   `easy`/`medium`/`hard` or blank.
6. At most 50 rows; nothing over its cap.
7. Numbers run without duplicates or unexplained gaps.
8. Fields containing a comma, a quote or a newline are quoted, and inner quotes are doubled.

A blank-answer warning is not a defect when the paper has no key. It is the correct result.

## Delivering the file

State a short summary first: how many questions, how many carry answers **and where those answers
came from** (marked on the paper, stated in it, or a key the teacher gave you — and say so plainly if
the column is blank because the paper had none), any numbering gaps, and any key numbers that matched
nothing. Then hand over the file — in claude.ai as a downloadable `.csv`; in Claude Code, write it
next to the source file and give the path.

Reply in the teacher's own language, which is usually Vietnamese, even though this file is in
English. Tell them what to do next: open Mochi → the question bank → import from file → upload the
CSV → check the rows → save. And if the answer column is blank, tell them that too, along with the
box where the key can be pasted.
