# Maintain a fork

Public forks can use the Vercel clone flow directly. Private installations should mirror the repository into a private Git host, connect that repository to Vercel, and configure `OPENBOT_GITHUB_REPOSITORY` plus a repository-scoped `OPENBOT_GITHUB_TOKEN` when runtime pull-request publication is desired.

Keep the upstream project as a second remote:

```bash
git remote add upstream https://github.com/trytilde/openbot.git
git fetch upstream
git switch -c update/openbot
git merge upstream/main
pnpm install
pnpm check
pnpm build
```

Treat `openbot.config.ts` and the complete `configuration/` tree as fork-owned during conflict resolution. The `.agents/skills/update-openbot` workflow gives coding agents the same rule. Put generally useful contracts and implementations in a focused upstream pull request; keep business-specific agents and secrets in the fork.
