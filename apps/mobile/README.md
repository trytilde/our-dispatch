# OpenBot Mobile

Expo owner client for Android and iOS. A first launch presents the same onboarding sequence and
animated agent identity as desktop; later launches open the workspace selector. The app verifies
`/healthz`, discovers the selected installation's public PKCE metadata from `/auth/native-config`,
and saves the origin in SecureStore before showing sign-in.

The authenticated client is chat-app shaped: the full first screen lists agents and conversations,
opening a conversation replaces it, and a left swipe returns to the chat list. Conversation state,
streaming, prompt queues, attachments, and Tilde resource shapes remain owned by
`@tryopenbot/client-runtime`. Native rendering uses assistant-ui's external-store runtime,
auto-scrolling thread and composer primitives over that existing state. It supports rich file,
image, video, audio, reasoning, and tool parts; queued prompt reorder/edit/run/remove controls; and
an authenticated live Computer preview with explicit take-over and release.

Hosted control services must use HTTPS. Loopback HTTP remains available for emulator development.
The app accepts no API keys, client secrets, or Tilde service credentials.

Build the workspace dependency before starting Expo directly. Root `pnpm build` already orders the
workspace packages.

```bash
pnpm --filter @tryopenbot/client-runtime build
pnpm --filter @tryopenbot/mobile dev
pnpm --filter @tryopenbot/mobile android
pnpm --filter @tryopenbot/mobile ios
```

Expo Go is not an authentication acceptance surface because the production redirect scheme belongs to the OpenBot native application.

## UI components

Presentation is built on [BNA UI](https://ui.ahmedbna.com), an Expo and React Native component
library distributed as copy-in source rather than a versioned dependency. Components live in
`src/components/ui`, their hooks in `src/hooks`, and the light and dark token sets in
`src/theme/colors.ts`. That source is owned by this repository: edit it in place and review it like
any other code. Chat behavior uses [assistant-ui native](https://www.assistant-ui.com/native), while
the repository supplies its own OpenBot-specific native markup and Inter typography. The
`assistant-cloud` dependency satisfies an optional assistant-ui Metro peer; OpenBot does not use
Assistant Cloud or move Tilde-owned chat state there.

Add a component from this directory:

```bash
pnpm dlx bna-ui add button
pnpm dlx bna-ui list
```

The CLI requires the `@/*` alias in `tsconfig.json` to resolve to `./src/*`, and it installs any npm
dependencies a component needs. When a component pulls in a native module, rebuild the development
build; a Metro reload will not pick it up.

Read colors through `useColor`. No screen hardcodes a color value, so every surface resolves in both
light and dark, and `ModeProvider` persists the Owner's appearance choice in SecureStore.

## Development tooling

Every script here runs the Expo CLI through the `openbot` CLI, which resolves
the Android SDK and a real Node binary first. Gradle shells out to `node` during settings evaluation
and fails on a version-manager shim, so that resolution is not optional. Commands therefore need no
`export PATH=...` prefix; if one seems necessary, extend `cli/src/toolchain.ts` rather than the
command.

`pnpm dev:mobile:emulator` boots the Android emulator — headless behind Xvfb with loopback VNC on a
display-less Linux host, windowed on a mac — and `pnpm connect -- <host>` tunnels a remote host's
emulator screen, Metro, and adb to your workstation. See ADR-0018 and
`.agents/skills/run-expo/SKILL.md` for the topology, and `cli/README.md` for the command
surface.
