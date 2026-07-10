# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal knowledge vault following the "LLM Wiki" pattern (Karpathy: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). This is not a software project — no build/test/lint commands apply. Instead of RAG-at-query-time, Claude incrementally builds and maintains a structured markdown wiki that sits between the user and raw sources.

Three layers:

1. `raw/` — immutable source material the user drops in. Claude reads these but never edits or deletes them.
2. `wiki/` — LLM-maintained markdown knowledge base derived from `raw/`. This is the layer Claude writes to.
3. This file — the schema governing how the wiki is organized and how Claude should behave when touching it.

## Scope

General personal knowledge — no fixed topic or domain. Sources are mixed: articles, PDFs/papers, personal notes, transcripts, images, and whatever else shows up. Don't assume a domain going in; let the actual contents of `raw/` and the existing wiki pages tell you what's here before inventing new structure.

## Directory layout

```
raw/                    Immutable original sources. Never edit or delete files here.
  articles/             Saved web articles, blog posts, gist/doc pages
  papers/               PDFs, papers, long-form documents
  notes/                Personal notes, journal entries
  transcripts/          Meeting/voice transcripts
  misc/                 Anything that doesn't fit the above

wiki/                   LLM-maintained, interlinked markdown. This is what Claude writes.
  summaries/            One page per raw source, roughly 1:1 with files in raw/
  entities/             People, places, organizations
  concepts/             Ideas, topics, recurring themes
  overview/             Synthesis pages that cross-reference multiple summaries/concepts
  index.md              Entry point: links to every summary/entity/concept/overview page
  log.md                Append-only log of ingest/lint operations (date, what changed, why)
```

Create subfolders under `raw/` or `wiki/` as real content arrives — don't pre-build a taxonomy for sources that don't exist yet.

## Naming conventions

- Filenames: kebab-case, `.md` for all wiki pages (e.g. `wiki/concepts/context-windows.md`)
- Cross-references: Obsidian-style wikilinks `[[page-name]]` between wiki pages
- Every wiki page carries YAML frontmatter:
  ```yaml
  ---
  title: 
  type: summary | entity | concept | overview
  source: raw/path/to/source   # summaries only — path back to the immutable original
  created: 
  updated: 
  ---
  ```

## Workflows

### Ingest — when a new file lands in `raw/`
1. Read the new source in full.
2. Write a page under `wiki/summaries/` capturing its content, frontmatter linking back to the source path.
3. Update the 10-15 most relevant existing wiki pages (entities, concepts, overview pages) with links to and mentions of the new material — don't file it away in isolation.
4. Append an entry to `wiki/log.md`: date, source ingested, pages touched.
5. Add the new page(s) to `wiki/index.md`.

### Query — when asked a question
1. Start at `wiki/index.md`, not `raw/` — the wiki should already hold synthesized answers.
2. Follow wikilinks through relevant entity/concept/summary/overview pages.
3. Fall back to reading `raw/` sources directly only if the wiki doesn't yet cover the answer.
4. Cite which wiki pages (and, transitively, which raw sources) the answer draws from.

### Lint — run periodically or when asked to "clean up the wiki"
1. Look for contradictions between pages.
2. Flag stale claims superseded by newer sources.
3. Find orphan pages (no inbound links) and either link them in or flag for removal.
4. Verify every page in `wiki/summaries/` still has a valid `source:` path into `raw/`.
5. Log findings/fixes in `wiki/log.md`.

## Rules

- Never edit or delete anything under `raw/` — it's the immutable source of truth.
- All wiki edits happen in `wiki/`; update `index.md` and `log.md` as part of every ingest, not as an afterthought.
- Prefer expanding an existing wiki page over creating a near-duplicate new one — check `index.md` first.
