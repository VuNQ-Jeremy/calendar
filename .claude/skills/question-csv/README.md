# question-csv — packaging and handing it round

This folder is a Claude skill. It teaches Claude to read a school test paper and write the CSV that
Mochi's question import accepts, and it ships the validator that checks the result.

```
.claude/skills/question-csv/
  SKILL.md       what Claude reads: the CSV spec, the transcription rules, the answer rule
  template.csv   the 12-column template, byte-identical to the one the app hands out
  validate.mjs   node validate.mjs questions.csv  — zero dependencies, Node 18+
  validate.d.mts the type declaration that lets the repo's test import the validator
  README.md      this file
```

## In Claude Code

Nothing to do. Claude Code picks skills up from `.claude/skills/` in the repo, so anyone with this
checkout has it. Ask in plain language — "here's the test paper, make me the import CSV" — and hand
over the file.

## In the claude.ai app (phone or browser)

Zip the folder and upload it once:

```powershell
Compress-Archive -Path .claude/skills/question-csv -DestinationPath question-csv-skill.zip
```

Then in claude.ai: **Settings → Capabilities → Skills → upload the zip.** After that, a teacher can
start a chat, attach a photo of the paper, and ask for the CSV — on a phone, which is where most of
this will actually happen.

**Check the current upload format against Anthropic's own documentation before you troubleshoot a
failed upload.** The expected zip layout and the location of the Skills screen have changed before
and can change again; when this README and the product disagree, the product is right.

## Giving it to other teachers

- **Each teacher uploads the zip to their own claude.ai account.** Skills are per-account, so
  emailing the zip round works and needs no admin.
- **An organisation admin can enable it workspace-wide** so every teacher in the school has it
  without uploading anything.
- **In Claude Code it needs no distribution at all** — it lives in the repo.

Re-zip and re-upload after any change to `SKILL.md`; an uploaded skill is a copy, not a link.

## What good output looks like

For a 40-question paper whose answers are printed on the last page, the reply should read roughly
like this (in Vietnamese, for a Vietnamese teacher), followed by the file:

> 40 câu, 40 câu có đáp án. Câu 21–25 dùng chung một đoạn đọc. Không có câu nào bị thiếu số.
> `de-thi-anh-9.csv` đã kiểm tra: không có lỗi.

And the file itself:

```
number,type,context,prompt,optionA,optionB,optionC,optionD,answer,explanation,difficulty,tags
1,mcq,,"Choose the word whose underlined part is pronounced differently.",pleas_ed_,wash_ed_,lik_ed_,laugh_ed_,A,,easy,pronunciation
21,mcq,"Read the passage and answer questions 21-25.  Plastic waste reaches the sea from rivers.","What reaches the sea, according to the passage?","plastic waste","clean water","fish farms","rain",A,,medium,reading
```

If the paper has no answer key and none was supplied, the `answer` column is empty on every row and
the summary says so. That is the correct output, not a failure: Mochi flags every unanswered question
and gives the teacher a box to paste the key into. An invented key would look identical and be wrong.
