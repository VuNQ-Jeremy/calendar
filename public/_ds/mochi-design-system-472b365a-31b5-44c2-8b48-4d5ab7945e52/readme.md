# Mochi Design System

**Mochi** is a warm, friendly app that keeps a whole family's school life in one cosy
place — **student management, a color-coded calendar, and homework tracking** for
parents and kids. The brand is named after (and represented by) Mochi, a British
longhair cat with brown-orange-and-white fur. The product should always feel
**calm, encouraging, and human** — never like enterprise admin software.

This project is the source of truth for Mochi's visual language: tokens, fonts,
reusable React components, foundation specimens, and a full app UI kit.

> **Sources.** This system was created from a brand brief (no existing codebase or
> Figma file was provided). Brand inputs: *"Personal/family app for education — student
> management, calendar, homework management. Brand is Mochi, a British longhair
> brown-orange and white cat. Preferred colors: light violet, light orange, light
> green, light blue."* If a production codebase or Figma file exists, link it here and
> reconcile the tokens below against it.

---

## Index / manifest

| Path | What's there |
|---|---|
| `styles.css` | **Global entry point** — consumers link this one file. Only `@import`s. |
| `tokens/fonts.css` | Webfont loading (Fredoka, Nunito Sans, DM Mono via Google Fonts). |
| `tokens/colors.css` | Color primitives + semantic aliases (`--brand`, `--text-body`, category hues). |
| `tokens/typography.css` | Families, weights, type scale, line-height, tracking. |
| `tokens/spacing.css` | 4px spacing scale + layout rails. |
| `tokens/effects.css` | Radii, warm shadows, borders, motion easings. |
| `tokens/base.css` | Light reset + document defaults. |
| `tokens/components.css` | Class-based styling backing the React primitives. |
| `components/core/` | Button, IconButton, Card, Badge, Tag, Avatar. |
| `components/forms/` | Input, Checkbox, Switch. |
| `components/feedback/` | ProgressBar. |
| `components/navigation/` | Tabs. |
| `guidelines/*.card.html` | Foundation specimen cards (Type, Colors, Spacing, Brand). |
| `ui_kits/app/` | The Mochi family app — Today, Homework, Calendar, Students. |
| `assets/` | Logo lockup + app mark (SVG). |
| `SKILL.md` | Agent-skill manifest for use in Claude Code. |

**Components:** `Button`, `IconButton`, `Card`, `Badge`, `Tag`, `Avatar`, `Input`,
`Checkbox`, `Switch`, `ProgressBar`, `Tabs`. Consume them from the compiled bundle:
`const { Button } = window.MochiDesignSystem_472b36`.

---

## CONTENT FUNDAMENTALS

Mochi talks like **a kind, organized friend who happens to love your kids** — warm,
plain-spoken, and quietly encouraging. Never clinical, never corporate.

- **Voice & person.** Address the parent as **"you"**; refer to children by **first
  name** ("Leo's spelling test", "Mia has piano overdue"). The app refers to itself
  rarely and softly ("Mochi's tip"). Avoid the royal "we."
- **Tone.** Encouraging and low-pressure. Celebrate small wins ("All caught up — nice
  work!"), soften overdue items rather than alarming ("a quick 15 minutes will clear
  it"), never scold.
- **Casing.** **Sentence case everywhere** — buttons, headers, nav, labels. No
  Title Case Buttons, no ALL CAPS except the tiny uppercase eyebrow labels (e.g.
  `THIS WEEK`) used sparingly as section kickers.
- **Length.** Short. Headlines are a phrase, helper text is one sentence. Prefer
  concrete nouns kids and parents use ("homework", "pickup", "soccer") over jargon
  ("assignment entity", "engagement").
- **Verbs.** Friendly imperatives for actions: "Add homework", "Mark as done",
  "Add student". Not "Submit", "Create new record".
- **Numbers & dates.** Human and relative — "Due today", "Tomorrow", "Yesterday",
  "Fri". Exact times use mono digits ("9:00–9:45").
- **Emoji.** Used **sparingly and only as a warm garnish** — a single 🎉 on a
  celebratory empty-state, a 🍂 on a seasonal event. Never in body copy, button
  labels, or as a substitute for an icon. When in doubt, leave it out.
- **Examples.**
  - ✅ "Nothing due today 🎉" · "Tap a box when it's done — Mochi keeps score" · "Your little learners and their subjects"
  - ❌ "0 tasks remaining" · "Task completed successfully" · "Manage student entities"

---

## VISUAL FOUNDATIONS

The feeling is **a sunlit kitchen table** — warm paper, soft edges, a sleepy cat
nearby. Everything is rounded, cushioned, and calm.

- **Color.** Warm cream surfaces (never pure white pages; cards are white on cream).
  **Mochi orange** (`--brand`, `#F79A4E`) is the single primary — the cat's coat. Four
  pastel **category hues** — violet, green, blue, orange — code subjects and event
  types consistently across the whole product (each subject keeps one hue everywhere).
  Neutrals are warm (cream → sand → taupe → cocoa **ink**), never cool gray. Status
  colors are warmed (sage success, amber warning, terracotta danger).
- **Type.** **Fredoka** (rounded geometric) for all headings, titles, and numbers worth
  celebrating; **Nunito Sans** (humanist, rounded terminals) for UI and body; **DM Mono**
  for times, dates, and grades. Headings are semibold with slight negative tracking;
  body is comfy at 16px / 1.55.
- **Shape & radii.** Generous and pillowy. Buttons, chips, and avatars are **fully
  pill** (`--radius-pill`); inputs are 14px; cards 20px; sheets/panels 28px. Nothing
  has a sharp 90° corner.
- **Backgrounds.** Flat warm cream — **no gradients, no photographic hero washes, no
  noise textures.** Color comes from soft tinted fills (`*-soft` tokens), not gradients.
  The cat mark is the only illustration.
- **Borders.** 1.5px hairlines in warm sand (`--border-subtle`/`--border-strong`).
  Used lightly — separation comes mostly from surface color and shadow.
- **Shadows.** **Warm, cocoa-tinted** (`rgba(110,71,44,…)`), soft and diffuse, low
  opacity — like a cat sinking into a cushion. Never neutral-gray box-shadows. Scale
  xs→xl; cards default to `sm`, hover lifts to `lg`.
- **Elevation model.** Page (cream) → card (white + `shadow-sm`) → raised card
  (`shadow-md`, borderless) → dialog/sheet (`shadow-xl`). Inputs are flat with a 1.5px
  border, not sunken.
- **Motion.** Gentle and slightly springy. Default easing `--ease-soft`
  (subtle overshoot, `cubic-bezier(.34,1.18,.64,1)`); durations 120/200/320ms. Press
  states **shrink** (`scale(.96)` on buttons, `.92` on icon buttons); cards **lift**
  (`translateY(-2px)`) on hover. Fades and small slides, no flashy spins or infinite
  loops. Respect `prefers-reduced-motion`.
- **Hover / press.** Hover = a step toward the warmer/deeper brand shade or a soft
  tinted fill; ghost controls fill with `--surface-sunken`. Press = shrink. Focus = a
  soft orange ring (`--ring`, 3px, ~35% alpha), never a hard outline.
- **Transparency & blur.** Used once, intentionally: the sticky topbar is a
  `color-mix` of the page color with an 8px `backdrop-filter` blur so content scrolls
  softly beneath it. Otherwise surfaces are opaque.
- **Layout.** Fixed left sidebar (260px) on cream; scrollable main with a sticky
  blurred topbar; content max-width ~1180px with 32px padding and 24px gutters. Calm,
  breathable density — lots of air.
- **Imagery vibe.** If photos are ever used, keep them warm and softly lit. The system
  ships no stock photography by default; the cat mark carries the personality.

---

## ICONOGRAPHY

- **System: Lucide** (https://lucide.dev) — its 2px rounded-cap, rounded-join stroke
  style is the exact match for Mochi's soft personality. Use Lucide for all UI icons.
- **Implementation.** The UI kit ships the glyphs it uses inline in
  `ui_kits/app/icons.jsx` as an `<Icon name="…" />` component (Lucide path data,
  24×24, `stroke="currentColor"`, `stroke-width="2"`). To add an icon, copy its path
  from Lucide into that map — don't hand-draw icons or improvise SVGs. In production
  you can instead install `lucide-react` and keep the same names.
- **Sizing & color.** 18–22px inside controls; icons inherit text color via
  `currentColor` so they pick up tints automatically (e.g. category-soft fills).
- **No emoji as icons.** Emoji are a rare decorative garnish only (see Content
  Fundamentals) — never load-bearing UI iconography. No icon fonts, no unicode glyphs
  standing in for icons.
- **Brand mark.** `assets/mochi-mark.svg` (the cat face, also the app icon) and
  `assets/mochi-logo.svg` (horizontal lockup) are the only bespoke vector art. Don't
  recolor the mark outside the orange/cream/cocoa palette.

---

## Using this system

1. Link the styles: `<link rel="stylesheet" href="styles.css">` (adjust the path).
2. Load React UMD, then the compiled bundle `_ds_bundle.js`.
3. Read components off the namespace: `const { Button, Card } = window.MochiDesignSystem_472b36;`
4. Style with the CSS custom properties — prefer the **semantic aliases**
   (`--brand`, `--text-body`, `--surface-card`, `--cat-violet-soft`) over raw scale
   values.

See each component's `*.prompt.md` for usage and the Design System tab for live
specimens of every token and component.
