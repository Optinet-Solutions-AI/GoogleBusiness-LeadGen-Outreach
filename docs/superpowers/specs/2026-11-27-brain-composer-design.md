# The Brain's message box: files + voice — design

Date: 27 Nov 2026 · Operator request: "make it like the Claude or GPT UI, with a plus for adding files and a mic for
voice messages; use Google's mic since our app runs in Chrome."

## Why

The Brain's box (`/brain`, "What should I do?") is a one-line input. The operator wants the familiar chat-style box:
type or **speak** the job, and **attach files**: a **list of businesses** to work (instead of a Google Maps search) or a
**brief** that guides the job (offer sheet, notes, a screenshot). Operator decision (27 Nov 2026): accept **both**
kinds; files travel **with the message** (approach A).

Success: the operator drops `austin-dentists.csv` + `offer-sheet.pdf` into the box, says "work these, pitch the AI
receptionist" by voice, presses Send, answers the Brain's usual questions and gets a plan for exactly those businesses,
judged with the brief in mind. Nothing is sent before Approve (unchanged).

## Goals

1. **The box** (`components/brain/BrainClient.tsx`): a multi-line text box that grows, a **+** button (and drag &
   drop) to attach files, file chips with × to remove, a **mic** button, a **Send** button. Enter sends, Shift+Enter
   is a new line.
2. **Voice:** the mic uses the app's existing Chrome speech (`components/assistant/useSpeech.ts`, Google speech,
   English / Hebrew, as in "Ask how" and voice-agent training); the words land in the box for editing; nothing is sent
   by speaking alone. Not offered in browsers without it (the mic hides).
3. **A list** (CSV or Excel `.xlsx`): the rows become the leads of a **new batch** (scraper `import`, no scraping
   cost), the Brain asks its usual questions, then the usual checks run on each lead (AI Lookup, website check, lead
   score, contact-page check: about 3.5¢ a lead, shown in the estimate and counted against the job's budget), then the
   Brain judges and makes the plan as today.
4. **A brief** (PDF, Word `.docx`, `.txt` / `.md`, or an image PNG / JPG / WEBP): its text (PDF and images read by
   OpenAI, about 1¢ each) is kept on the job and given to the AI when it reads the command and when it judges each
   lead, as guidance **inside the existing rules** (it can't add offers or channels the code doesn't allow).

## Non-goals

- No change to Approve, sending, Test mode, or what the Brain may decide.
- No other file types (zip, old `.xls`, `.doc`, audio, video). No reading of links inside files.
- Files themselves are not stored: only the leads made from a list and the brief's text.

## Anti-goals

- A file that steers the AI past the rules: brief text is data ("guidance from the operator's file"), never
  instructions that override the rules; the AI still picks only from the allowed offers / channels (unchanged
  `validateDecision`).
- Paying for checks on a list the operator didn't confirm: the checks start only after the Brain's questions are
  answered ("Start"), with the cost shown.
- Silent junk leads: rows with no business name are skipped, and the Brain says how many rows it used / skipped and why.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (picked)** | Files go with the message (≤ 4 MB in total), read on the spot | Simple, fast, nothing stored; a huge list must be split |
| B | Upload to Storage first, the worker reads them | Any size, but more moving parts and other businesses' contact data kept in Storage |

## How it works

### Sending

`POST /api/brain/jobs` accepts `multipart/form-data`: `command` + up to **5 files**, **4 MB in total** (Vercel's
request limit; my call). The old JSON `{command}` keeps working. Each file is classified by extension
(list: `.csv`, `.xlsx`; brief: `.pdf`, `.docx`, `.txt`, `.md`, `.png`, `.jpg`, `.jpeg`, `.webp`); anything else is
refused with a plain sentence before anything is paid. At most **one list** per message (my call).

### A list

- Read on the server: CSV (plain parser, quoted fields, comma / semicolon / tab) and `.xlsx` (first sheet; new
  dependency `exceljs`). The first row is the header.
- Columns are matched by name, case-insensitively (my call): business / company / name → `business_name`;
  website / url / site → `website_url`; email / e-mail → `email`; phone / tel / mobile → `phone`; address →
  `address`; city → `city`; category / type / niche → `category`; country → country code (2 letters, or a country
  name mapped by the existing helpers). No business-name column → the list is refused ("I need a column with the
  business name").
- Rows without a business name are skipped; duplicate rows (same website, email or phone) are kept once; at most
  **1,000 rows** (my call; the rest are reported as not used).
- When the job starts: a batch is created (`scraper = 'import'`, `niche` = the command's niche or "Imported list",
  `city` = the command's place or the most common city in the rows, `country_code` likewise, `brain_job_id` = the job,
  `estimated_cost_usd` = the checks' estimate), the rows are inserted as leads (`stage 'scraped'`, `qualified true`,
  `place_id = 'import:' + a hash of name|website|phone`), and the batch runs with `resume_from = 'enrich'` on the Cloud
  Run job (the existing enrichment-only path: never a scrape). When it finishes, the existing hook
  (`planJobForBatch`) judges and makes the plan.
- The command's intent with a list attached is **work_list** (new): the AI still reads the command for the settings
  hints (budget, channels) but never searches Google Maps.

### A brief

- Text files and `.docx` (new dependency `mammoth`) become text on the server; PDF and images go to OpenAI once
  (`OPENAI_BRAIN_MODEL`, ~1¢ each) with "copy out the text and key facts". At most **6,000 characters** kept (my
  call).
- Saved on the job (`brain_jobs.brief`). Given to the AI (1) when reading the command and (2) when judging each lead,
  labelled as the operator's guidance; the instructions say it can shape the offer / wording choice only within the
  allowed lists and never overrides a rule.

### What the operator sees

- The chips while composing; after Send, the job shows "Using: austin-dentists.csv (212 leads, 3 rows skipped:
  no business name) · offer-sheet.pdf (brief)".
- The Brain's questions as today, with the estimate covering the checks on the imported leads.

## Storage (migration 081)

`batches.scraper` check adds `'import'`; `brain_jobs.brief text`; `brain_jobs.attachments jsonb` (each file's name,
kind, rows used / skipped, reason). The import rows themselves wait on the job (`brain_jobs.attachments` keeps the
parsed rows until Start, then the batch holds them; my call). Code tolerates 081 missing: attaching files is then
refused with "Run database update 081 first".

## Constraints

- Golden rules: pure parsing / mapping / classification in `lib/brain/attachments.ts` with tests; file reading and the
  OpenAI read in `lib/`; thin route; dumb components; zod.
- No paid call before the operator answers the questions, except reading a PDF / image brief (~1¢, needed to
  understand the job; my call).
- Test mode unchanged (imported emails are real businesses: blocked while it's on).
- New dependencies `exceljs`, `mammoth` noted in the commit.
- Workflow first: update `workflows/run_brain_job.md`; CLAUDE.md, `lib/assistant/knowledge.ts`.

## Left to the builder

The box's exact look (follow the app's styles); the CSV parser details; how the parsed rows are held until Start
(as long as nothing is lost between the questions and Start); chip icons.
