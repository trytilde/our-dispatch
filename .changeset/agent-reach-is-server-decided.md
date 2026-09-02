---
"@trytilde/sdk-vercel-ai-node": minor
---

Remove `chatkit.permissions` from `createMCPClient`. What an agent may reach is
now recorded on the agent in Tilde and enforced there, so the client no longer
declares it. A permission sent from the client was a claim by whoever held the
credentials rather than a decision by whoever administers the team, and two
clients connecting as the same agent could have declared different reach.

Nothing needs to replace it in client code: the session-scoped tools an agent is
offered are already filtered to what its record permits, so an agent without a
delegation grant simply is not shown the delegation tools. Change what an agent
may reach on its page in Tilde.
