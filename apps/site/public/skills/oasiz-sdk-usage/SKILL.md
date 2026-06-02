---
name: oasiz-sdk-usage
description: "Guide Oasiz JavaScript SDK integrations for browser games. Use when adding or reviewing @oasiz/sdk usage, score submission, addScore/setScore, game-state save/load, haptics, lifecycle or back-button handlers, leaderboard visibility, graphics performance, local app simulator, or log overlay behavior in an Oasiz game."
---

# Oasiz SDK Usage

Use this skill when integrating or reviewing the Oasiz JavaScript SDK in a game. Keep platform calls close to the gameplay moments they represent, and verify behavior locally before publishing.

## Workflow

1. Inspect the game first:
   - Identify the framework, package manager, entry files, and existing Oasiz SDK calls.
   - Check `package.json` for `@oasiz/sdk`.
   - Prefer existing local patterns before adding new wrappers.

2. Install or import the SDK:
   - Add `@oasiz/sdk` only when it is missing.
   - Use `import { oasiz } from "@oasiz/sdk";` in bundled browser games.
   - For no-build prototypes, use the hosted SDK script only when the project already follows that style.

3. Add local-only simulator support:
   - Use `oasiz.enableAppSimulator()` only in development or explicit preview code.
   - Keep simulator setup out of production gameplay paths unless the project already gates it safely.
   - Use the simulator to preview mobile chrome, safe areas, leaderboard UI, comments, and back-button behavior.

4. Integrate gameplay APIs at boundaries:
   - Load state once during boot or resume.
   - Save state at checkpoints, level completion, settings changes, or pause/game-over transitions.
   - Trigger haptics for meaningful feedback, not every frame.
   - Submit the final score once at game over or at an intentional scoring milestone.

5. Verify the integration:
   - Run the project locally and check browser console output.
   - Test at a mobile-sized viewport when layout or host chrome may matter.
   - Verify that SDK calls no-op safely outside the Oasiz host.
   - If publishing follows, run the Oasiz CLI dry-run before upload.

## Core Patterns

Use this shape for bundled JavaScript or TypeScript games:

```ts
import { oasiz } from "@oasiz/sdk";

if (import.meta.env.DEV) {
  oasiz.enableAppSimulator();
}

const state = oasiz.loadGameState();
const level = typeof state.level === "number" ? state.level : 1;

oasiz.saveGameState({ level, coins });
oasiz.triggerHaptic("success");
oasiz.submitScore(Math.floor(score));
```

Use score editing APIs only when the game needs incremental score bridge updates:

```ts
await oasiz.addScore(100);
await oasiz.setScore(total);
```

Use host UI and lifecycle calls when the game has matching UX:

```ts
oasiz.onBackButton(openPauseMenu);
oasiz.setLeaderboardVisible(false);
const graphics = oasiz.getGraphicsPerformance();
```

## SDK Rules

- `submitScore(score)` should receive a finite, non-negative integer score.
- `loadGameState()` should be treated as untrusted data; validate fields before use.
- `saveGameState(state)` should receive a plain object with small, serializable game state.
- Haptic types should match supported host values such as `light`, `medium`, `success`, or `error`.
- Log overlays and simulators are development tools unless the project intentionally ships them.
- Do not invent SDK methods. Inspect the installed package or local `packages/sdk` source when unsure.

## Final Response

When finishing SDK work, state:

- Which SDK calls were added or changed.
- Where the calls live in the gameplay flow.
- What local browser or viewport verification was performed.
- Any host-only behavior that remains unverified outside the Oasiz app.
