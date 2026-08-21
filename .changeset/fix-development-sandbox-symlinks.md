---
"@tryopenbot/computer-service-provider": patch
---

Seed tracked repository symlinks into the trusted development sandbox instead of failing, so a repository that links `.claude/skills` at `.agents/skills` or `CLAUDE.md` at `AGENTS.md` can still start development. Symlink targets must stay relative and resolve inside the repository.
