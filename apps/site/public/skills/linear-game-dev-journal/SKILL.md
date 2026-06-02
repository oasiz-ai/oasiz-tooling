---
name: linear-game-dev-journal
description: "Track substantive Oasiz game-development work in Linear while an AI coding agent develops, debugs, polishes, reviews, or playtests a game. Use when work should update a Linear issue, project status, or Game Development Learnings document with concise progress, verification, Oasiz SDK learnings, mobile/WebView issues, performance notes, and reusable development guidance."
metadata:
  author: "Oasiz"
  version: "1.0.0"
  category: "ai-development"
---

# Linear Game Dev Journal

Use this skill alongside substantive Oasiz game development work. Keep the active Linear task current, and leave the game project smarter than it was before.

## Access Requirements

- Expect authorized Oasiz developers to have access to the Oasiz Linear developer workspace in Linear.
- If workspace access is missing, tell the developer to email contact@oasiz.ai for Oasiz Developers Program and Linear workspace access.
- If Linear cannot authenticate during the turn, continue the requested work and include a short Linear-ready note in the final response.

## Core Workflow

1. Decide whether Linear tracking applies:
   - Use Linear for substantive implementation, debugging, investigation, review, playtesting, or planning work.
   - Skip Linear for quick meta questions, local environment checks, tiny clarifications, and purely conversational messages.

2. Identify the work tracker:
   - Look for a Linear issue ID in the user request, branch name, recent context, or existing Linear search results.
   - If the task maps to an existing issue, use that issue. Do not create a duplicate.
   - If no issue is obvious and the work is substantial enough to track independently, create or propose a concise issue and assign it to the current user when possible.
   - If Linear is unavailable, continue the work and include a short Linear-ready note in the final response.

3. Determine the game name:
   - Prefer the user-provided game name.
   - Otherwise infer from the game directory, package name, route, page title, or visible start-screen title.
   - If multiple names are plausible, ask once before updating project-level learning docs.

4. Load Linear access:
   - If Linear tools are not available, use tool discovery for Linear.
   - Confirm the available Linear workspace is the Oasiz Linear developer workspace before writing.
   - Read first with Linear search, fetch, list-documents, or equivalent tools.
   - Write only after the target issue or project is clear.

5. Find the target game project:
   - Search Linear projects for the exact game name and common normalized variants.
   - If exactly one matching project exists, use it.
   - If no project or multiple plausible projects exist, do not create or update a project blindly. Keep issue-level tracking and ask before project-level writes.

6. Keep a private work journal during the coding turn:
   - Bug or issue discovered.
   - Root cause or likely cause.
   - Files or systems touched.
   - Fix or design decision.
   - Verification performed, including browser/device sizes when relevant.
   - Reusable lesson for future work on this game or Oasiz games.

7. Post concise Linear updates:
   - At start: comment only when attaching to an existing issue or creating a new issue helps orient future agents.
   - During work: comment when a blocker, failed approach, or decision changes the plan.
   - At completion: comment with meaningful results, verification, blockers, and remaining risks.
   - Do not post play-by-play command logs, searches, tool calls, or minor mistakes.

8. Update project learnings at the end when useful:
   - Update or create a project document named `Game Development Learnings`.
   - Append a dated entry; preserve existing content.
   - Add a project status update only when the work meaningfully changes project risk, scope, readiness, or release confidence.

## Linear Write Targets

Prefer these Linear tools when available:

- Search to find the game project or existing learning document.
- Fetch to inspect selected project results.
- List documents and get documents to find and read `Game Development Learnings`.
- Save documents to create or update the project document.
- Save status updates for concise project-level progress or risk notes.
- Save comments only when the learning belongs on a specific issue instead of the project-wide log.

Do not store durable game progress in Linear as a substitute for `oasiz.saveGameState`; Linear is for development knowledge, decisions, and project tracking.

## Comment Format

Use this shape for issue comments. Keep it short.

```markdown
Worked on GAME_NAME: SHORT_THEME.

Progress:
- What changed or was learned.

Verification:
- What was tested, or what remains unverified.

Next / risk:
- Remaining blocker, follow-up, or "None observed".
```

## What To Capture

Capture concrete learnings, not a transcript of every command. Prioritize:

- Oasiz SDK integration issues: score submission, score config anchors, haptics, lifecycle, room sharing, gameplay start/stop, save-state validation.
- Mobile and embedded runtime bugs: top safe area, touch double-firing, hidden overlays intercepting input, responsive sizing, portrait/landscape layout, iOS WebView graphics tiering.
- Game-loop and performance fixes: RAF cancellation, delta spikes, object pooling, asset loading, random values in render loops, memory or GC spikes.
- UI polish and game feel: settings panel behavior, start/game-over UI visibility, haptics and sound synchronization, mobile controls, visual feedback.
- Testing and verification: viewports, browser playtests, screenshots, device-specific notes, commands run, known unverified areas.
- Recurring pitfalls: anything that would help the next agent avoid rediscovering the same problem.

Skip noise:

- Raw terminal logs unless the exact error matters.
- Generic game-development advice unrelated to this game.
- Secrets, credentials, private user data, or large code dumps.
- Claims of verification that were not actually performed.

## Project Learning Entry

Use this shape for the `Game Development Learnings` project document. Omit empty sections.

```markdown
## YYYY-MM-DD - Short Work Theme

### Context
- Game area:
- Goal:
- Related issue or request:

### Bugs, Fixes, and Decisions
- **Issue:** What broke or needed improvement.
  **Cause:** Why it happened, or the strongest current hypothesis.
  **Fix:** What changed, with important file paths or systems.
  **Verification:** What was tested and what remains unverified.

### Reusable Learnings
- Learning that should guide future work on this game.
- Oasiz/platform rule or repo pattern reinforced by this work.
- Common pitfall to check before shipping similar changes.

### Follow-Ups
- Open risk, TODO, missing test, asset need, or Linear issue that should exist.
```

For project status updates, use `health: "onTrack"` for normal progress, `health: "atRisk"` for unresolved bugs or unverified platform risk, and `health: "offTrack"` only for severe blockers.

## Safety Rules

- Preserve existing Linear document content. Append under a new dated heading unless updating a clearly matching entry from the same work session.
- Prefer exact project matches. Ask before writing to an ambiguous project.
- Mention unresolved risks honestly.
- If Linear is unavailable, include the ready-to-post Markdown in the final response and state that it was not posted.
- If no code changes were made, still log useful investigation findings when they will help future work.
