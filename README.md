# Search Relevance Lab

Local workbench for query judgments.

Run `npm install`, then `npm run dev`.

## Search & highlight offsets

`POST /api/experiments/:id/search` accepts `{query, content?, caseFold?, diacriticFold?, context?}`
and searches with case/diacritic folding (ß↔ss, İ/I→i, NFC≡NFD). The server
normalizes the text per grapheme, keeps a map from the normalized search
representation back to original-text UTF-16 offsets, and returns hits already
converted to original coordinates:

- `hits`: `[{start, end}]` — UTF-16 ranges into the original content, always on
  grapheme boundaries (never inside a surrogate pair, combining sequence, or
  emoji ZWJ cluster).
- `snippets`: `[{id, text, ranges, ellipsisBefore, ellipsisAfter}]` — text
  trimmed around each hit with `ranges` relative to the snippet string.

Clients render `<mark>` segments directly from these structured ranges; they
never re-normalize text or recompute offsets. Shared logic lives in
`src/shared/search.ts` (`searchText`, `segments`).
