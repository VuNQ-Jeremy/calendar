---
name: discuss
description: Use when the user wants to talk about the repo without changing it — invoked as /discuss, or triggered by "just discussing", "don't edit anything", "I'm not asking you to build it yet", "no plan mode", "just tell me", "thinking out loud", "what do you think about X".
---

# Discuss

## Overview

Read-only conversation about this codebase. Answer, explain, disagree, speculate. Nothing is produced except the reply itself.

**Core principle:** In this mode a finished answer is a *reply*, not an artifact. There are no approval prompts because there is nothing to approve.

## The Rule

**Never call, for any reason:** Edit, Write, NotebookEdit, EnterPlanMode, ExitPlanMode, TodoWrite, Artifact, Agent, Workflow, CronCreate, SendMessage.

**Never run a Bash command that writes.** No `git commit`/`push`/`checkout`/`stash`, no `npm run`/`install`, no `>`, `>>`, `sed -i`, `tee`, `mkdir`, `rm`, `mv`, `cp`, `touch`.

**Freely use:** Read, Grep, Glob, and read-only Bash — `cat`, `sed -n`, `rg`, `ls`, `git log`, `git diff`, `git show`, `git blame`, `wc`. Reading is the whole point; read as much as the question needs.

**Suppress every process skill.** brainstorming, writing-plans, test-driven-development, systematic-debugging, subagent-driven-development, verification-before-completion, requesting-code-review. The user has explicitly opted out of process — that is the direct-user-instruction exception `superpowers:using-superpowers` defers to.

## What the reply looks like

- Prose, in the second person, the length the question deserves. A one-line question gets a few lines back.
- Concrete: cite `file.ts:42` when the repo answers the question. Say "I'd have to look" instead of guessing when it doesn't.
- Opinionated. If the idea has a problem, lead with the problem.
- Ends when the answer ends. **No trailing offer to implement it.** No "want me to…?", no "let me know and I'll…", no summary of what was just said.
- No todo lists, no phase headers, no report formatting for something that is a conversation.

## Asking questions back

One at a time, only when the answer genuinely changes the reply, and only after answering the parts you already can. This is a conversation, not a requirements interview — never open with a numbered list of clarifying questions.

## Leaving discuss mode

Exit **only** on an explicit instruction to act: "do it", "go ahead", "implement that", "write it", "fix it". A question that merely implies a change ("could we make X faster?") is still a question.

On exit, say `Leaving discuss mode.` on its own line, then work normally — including whatever skills, plan mode, and approvals normally apply.

## Rationalizations

| Thought | Reality |
|---|---|
| "It's a trivial one-line fix, faster to just do it" | Speed isn't the ask. They asked to talk. Describe the line. |
| "They obviously want this implemented" | If it were obvious they'd have said so. Obvious things are cheap to ask for. |
| "I'll write it to a scratch file, that's not the repo" | Still a Write. Still a prompt. Put it in the reply. |
| "Plan mode is read-only, so it's fine" | Plan mode ends in an ExitPlanMode approval prompt. That is the prompt they named. |
| "brainstorming would sharpen this idea" | Brainstorming is an interview. They asked for a chat. |
| "A todo list will keep us organized" | There are no tasks. There is a conversation. |
| "I should offer to implement, to be helpful" | The standing offer is implicit. Repeating it every turn is the nagging they left. |
| "They asked how to fix it, that's a request to fix it" | "How" is a question. "Do it" is a request. |

## Red flags — you have left the mode without being told to

- Reaching for Edit/Write
- Composing a numbered implementation plan
- Any sentence beginning "Want me to"
- Opening a reply with a clarifying-question list
- Announcing a skill you're about to use

**All of these mean: stop, delete the draft, answer the question instead.**
