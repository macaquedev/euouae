# euouae — a fast Collins Zyzzyva replacement

A keyboard-first study & adjudication tool for tournament Scrabble players.
Goal: everything Collins Zyzzyva does, with the same correctness but far better
speed and UX. Named after `EUOUAE` — a legal all-vowel word.

## Guiding principles

1. **The lexicon is a read-only oracle.** We never recompute the
   correctness-critical data at runtime; we query a precomputed dataset. The
   only logic we author is *querying* and *scheduling*, both unit-testable
   against Zyzzyva's own outputs.
2. **One core, many thin views.** Judge, Search, Word Info, Quiz, and Lists are
   all different queries over a single Lexicon Engine. No duplicated query code.
3. **Offline-first, zero runtime dependency on Zyzzyva.** All data is bundled
   into the app at build time. Reading Zyzzyva's export is a *build input*, not
   a runtime dependency.
4. **Faithful where it matters.** Search semantics, quiz types, and the Cardbox
   (Leitner) schedule replicate Zyzzyva exactly so existing muscle memory and
   study progress transfer 1:1.

## Locked decisions

| Area | Decision |
|---|---|
| Frontend | Svelte 5 + SvelteKit, TypeScript, bun toolchain |
| Lexicon engine | wa-sqlite (SQLite compiled to WASM) over OPFS storage |
| Search acceleration | in-memory alphagram index built once at load |
| Shells | PWA **and** Tauri desktop, both from day one (shared frontend) |
| Schedulers | Leitner (Cardbox-compatible) **and** FSRS, behind one interface |
| Pillars (v1) | Judge · Search · Word Info · Quiz+Cardbox · List management |
| Lexicons | Multi-lexicon from day one (ship CSW24 first) |
| Data sourcing | Build-time pipeline ingests a full export from Zyzzyva-on-Windows |

## Data model (ground truth from `~/.collinszyzzyva/lexicons/CSW24.db`)

`words` table, 280,887 rows. All derived fields are precomputed:

- Identity: `word`, `length`, `alphagram`, `point_value`
- Counts: `num_anagrams`, `num_unique_letters`, `num_vowels`
- Hooks: `front_hooks`, `back_hooks`, `is_front_hook`, `is_back_hook`
- Probability: `combinations{0,1,2}` (draw with 0/1/2 blanks),
  `probability_order{0,1,2}` (+min/max variants)
- Playability: `playability`, `playability_order` (+min/max)
- Meta: `lexicon_symbols`, `definition`

### Computable vs. import-only

- **Computable from a word list + tile distribution** (recompute *and verify*
  against the export): `alphagram`, hooks, `combinations*`, `probability_order*`,
  `num_*`, `point_value`, `is_*_hook`.
- **Import-only (cannot be regenerated):** `definition` (copyrighted text) and
  `playability`/`playability_order` (derived from real-game corpora).

### What the *local* CSW24.db actually contains (verified 2026-06-22)

The Linux `~/.collinszyzzyva/lexicons/CSW24.db` was built **without** the
definitions/playability data files:

- ✅ Present & verified: word list, `alphagram`, hooks, `point_value`, counts,
  and probability (`combinations*`/`probability_order*` — sane: top 7s = AEINORT).
- ❌ Absent: `definition` (0/280887), `playability` (all 0.0, order is a useless
  alphabetical fallback), `lexicon_symbols` (all empty).

Consequence: the local DB drives Judge, Search, anagram & probability study now.
`definition` + `playability` come from the **Windows Zyzzyva export** later and
are modelled nullable so nothing rearchitects when they arrive. Confirmed rules:
`num_vowels` counts AEIOU only (Y excluded); standard Collins tile values.

### User state (mirrors Zyzzyva `quiz/data/<lex>/<list>.db`)

`questions(question, correct, incorrect, streak, last_correct, difficulty,
cardbox, next_scheduled)`. Lives in a separate writable SQLite DB in OPFS.
For FSRS we add a `review_log(question, reviewed_at, grade, ...)` table from
day one so both schedulers work; existing data imports straight into Leitner.

## Cardbox / Leitner algorithm (replicate exactly)

- Schedule (days per box): `1 4 7 12 20 30 60 90 150 270 480`
- Window (± days for spread): `0 1 2 3 5 7 10 15 20 30 50`
- Correct → `cardbox += 1`; incorrect → `cardbox = 0`.
- `next_scheduled = now + schedule[cardbox]` days, jittered within the window.
- Box 0 is nudged back 16h so freshly-missed cards are due immediately.

## Scheduler interface (Leitner + FSRS)

```
interface Scheduler {
  review(state: CardState, grade: Grade, now: Date): CardState
  due(now: Date): CardId[]
}
```

- **Leitner** reads/writes the `cardbox` + `next_scheduled` columns.
- **FSRS** maintains stability/difficulty per card and a full `review_log`,
  scheduling each card for the moment predicted recall hits the target retention.
- Selectable per deck. Same review event feeds both.

## Search (replicate the 22 Zyzzyva condition types)

Pattern / Anagram / Subanagram match, Length, Prefix, Suffix, Include Letters,
Consist Of (%), Belong To Group (set), In Lexicon, In Word List, Num Anagrams,
Num Vowels, Num Unique Letters, Point Value, Probability, Probability Order
(+limit), Playability Order (+limit), Part Of Speech, Definition.

Predefined **sets**: hook words, front/back hooks, high fives, type 1/2/3
sevens & eights, eights-from-seven-letter-stems.

Pattern syntax: `?` = one tile, `*` = run of tiles, `[...]` = char class.

## Quiz types & methods

- **Types:** Anagrams, Anagrams w/ Hooks, Subanagrams, Hooks, Anagram Hooks,
  Anagram Jumble, Subanagram Jumble, Word List Recall, Patterns, Build.
- **Methods:** Standard (plain drilling) / Cardbox (spaced repetition).
- **Question order:** Random / Alphabetical / Probability / Playability.

## Architecture

```
        bundled lexicon artifact (read-only, per lexicon)
                       |
              Lexicon Engine (wa-sqlite + alphagram index)  -- queries only
        ____________________|____________________________
       |        |          |           |                  |
     Judge   Search    Word Info     Quiz               Lists
                                       |
                               Scheduler interface
                              ______|________
                             |               |
                          Leitner           FSRS
                             |_______________|
                        user.db (OPFS): questions + review_log
```

## Build pipeline (dev-time, never shipped as a runtime dep)

1. Input: full export from Zyzzyva-on-Windows (all `words` fields).
2. Normalise into the canonical schema; recompute the computable fields and
   **assert** they match the export (catches our own bugs automatically).
3. Copy import-only fields (`definition`, `playability*`).
4. Emit one self-contained, optimised lexicon artifact per lexicon, bundled
   into the app.

## Phased delivery

- **Phase 0 — Skeleton:** SvelteKit + bun + Tauri scaffold; wa-sqlite/OPFS
  bootstrapping; load bundled CSW24; build pipeline producing the artifact.
- **Phase 1 — Judge + Word Info:** instant single/multi-word adjudication;
  word detail panel (hooks, anagrams, definition, probability, playability).
- **Phase 2 — Search:** full condition engine + predefined sets + saved searches.
- **Phase 3 — Quiz + Cardbox:** quiz types, Leitner scheduler, import existing
  cardbox progress.
- **Phase 4 — FSRS + Lists:** FSRS scheduler, custom/saved lists, import/export.
- **Phase 5 — Polish:** PWA install, Tauri installer, multi-lexicon UX, theming.

## Open questions (deferred, not blocking)

- Exact UX/keyboard model for Judge and Search (the core speed wins).
- Whether to ship a built-in "study sets" library (all 7s, 2s, etc.).
- FSRS target-retention default and per-deck overrides.
