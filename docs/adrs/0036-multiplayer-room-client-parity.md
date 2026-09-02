# ADR 0036: Multiplayer room clients share one runtime contract

Status: Accepted

OpenBot retains the shared client-runtime room contract for durable roster,
roles, invitation lifecycle, departure, typing/presence, and shared session
attachments. The public Tilde SDK remains the supported programmatic surface.
Owner-facing web, desktop, and mobile room controls are intentionally deferred;
the earlier raw-user-ID invitation UI was not a shippable identity experience.

Tilde owns membership, admission, authorization, and event audiences. OpenBot
owns presentation and bounded group-turn policy. Client code must not copy a
participant's credential, personal tool, or private memory into shared room
configuration.

<FOLLOW UP>
Owner: OpenBot web and mobile clients
Trigger: when multiplayer owner UX is prioritized
Work: restore room roster, presence, invitation, and moderation UI using shared
client-runtime contracts; replace raw Tilde user-ID entry with human identity
discovery and prove web/mobile parity.
</FOLLOW UP>

## Updates

- 2026-09-01: Deferred owner-facing multiplayer UI while retaining backend and
  SDK functionality; recorded the identity-discovery requirement for revival.
