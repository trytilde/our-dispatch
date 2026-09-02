---
name: memory-quality
description: Validate provenance, temporal consistency, actor boundaries, deduplication, and safe supersession during memory synthesis.
---

# Memory quality

- Prefer atomic, answerable memories over transcript summaries.
- Merge exact duplicates and preserve source provenance.
- Represent changed facts with validity times and `SUPERSEDES`; do not erase
  history merely because a newer value exists.
- Never turn an inference into a high-confidence fact without supporting evidence.
- Never move private actor evidence into a team-global memory.
- Record reusable tool or skill lessons only after an observed outcome.
