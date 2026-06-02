export type LinkCard = {
  title: string;
  body: string;
  href: string;
  label?: string;
};

export type SkillListing = {
  title: string;
  name: string;
  description: string;
  version: string;
  requires: string;
  habits?: string[];
  downloadHref: string;
  inspectHref: string;
  sourceHref: string;
  installCode: string;
};

export type CommandRow = {
  name: string;
  title?: string;
  description: string;
  example?: string;
};

export type NpmPackage = {
  name: string;
  version: string;
  tag: string;
  npmHref: string;
  versionsHref: string;
};

export type DocSection = {
  id: string;
  title: string;
  kicker?: string;
  body: string;
  code?: string;
  items?: string[];
  cards?: LinkCard[];
  skills?: SkillListing[];
  packages?: NpmPackage[];
  commands?: CommandRow[];
  note?: string;
};

export type DocPage = {
  path: string;
  title: string;
  navTitle: string;
  group: string;
  eyebrow: string;
  description: string;
  npmPackage?: NpmPackage;
  heroCode?: string;
  heroItems?: string[];
  sections: DocSection[];
};

export const docGroups = [
  { title: "Start", pages: ["/developers/", "/developers/quickstart"] },
  { title: "Develop with AI", pages: ["/developers/ai"] },
  {
    title: "Build",
    pages: ["/developers/cli", "/developers/sdk", "/developers/unity"],
  },
  {
    title: "Reference",
    pages: ["/developers/reference"],
  },
] as const;

export const cliNpmPackage: NpmPackage = {
  name: "@oasiz/cli",
  version: "1.1.11",
  tag: "latest",
  npmHref: "https://www.npmjs.com/package/@oasiz/cli",
  versionsHref: "https://www.npmjs.com/package/@oasiz/cli?activeTab=versions",
};

export const sdkNpmPackage: NpmPackage = {
  name: "@oasiz/sdk",
  version: "1.8.2",
  tag: "latest",
  npmHref: "https://www.npmjs.com/package/@oasiz/sdk",
  versionsHref: "https://www.npmjs.com/package/@oasiz/sdk?activeTab=versions",
};

export const pages: DocPage[] = [
  {
    path: "/developers/",
    title: "Oasiz Developer Platform",
    navTitle: "Overview",
    group: "Start",
    eyebrow: "Developer platform",
    description:
      "Build, test, and publish games into the Oasiz social arcade with one docs home for the CLI, JavaScript SDK, and Unity WebGL runtime.",
    heroCode:
      "npm install -g @oasiz/cli\n" +
      "oasiz login\n" +
      "oasiz create neon-dash\n" +
      "cd neon-dash\n" +
      "npm install @oasiz/sdk",
    heroItems: [
      "Quickstarts first, reference when you need details.",
      "CLI and SDK docs live with the tooling packages.",
      "Served from /developers on the main Oasiz domains.",
    ],
    sections: [
      {
        id: "paths",
        kicker: "Start by platform",
        title: "Choose your path",
        body:
          "The docs are organized like a mature developer platform: start with a short quickstart, then move into the tool guide or reference page that matches the thing you are shipping.",
        cards: [
          {
            title: "Publish with the CLI",
            body:
              "Create a game, authenticate, dry-run uploads, publish versions, and manage game servers.",
            href: "/developers/cli",
            label: "CLI guide",
          },
          {
            title: "Integrate the JS SDK",
            body:
              "Submit scores, persist state, handle haptics, react to lifecycle events, and preview Oasiz app chrome locally.",
            href: "/developers/sdk",
            label: "SDK guide",
          },
          {
            title: "Ship Unity WebGL",
            body:
              "Use the Unity runtime package for score, state, haptics, and host bridge behavior in WebGL builds.",
            href: "/developers/unity",
            label: "Unity guide",
          },
          {
            title: "Check the reference",
            body:
              "Scan command names and SDK calls without reading a full walkthrough.",
            href: "/developers/reference",
            label: "Reference",
          },
        ],
      },
      {
        id: "develop-with-ai",
        kicker: "Must-have",
        title: "Use Oasiz AI skills",
        body:
          "When developing Oasiz games with AI, start with Oasiz Linear Learning so Linear captures progress and reusable fixes, then use the SDK and CLI usage skills for platform integration and publishing work.",
        cards: [
          {
            title: "Develop with AI",
            body:
              "Download and inspect the Oasiz Linear Learning, SDK Usage, and CLI Usage skills before starting AI-assisted Oasiz game work.",
            href: "/developers/ai",
            label: "View AI skills",
          },
        ],
      },
      {
        id: "platform-shape",
        title: "Built beside the tooling",
        body:
          "The developer website lives in oasiz-tooling so CLI and SDK documentation can update in the same repository as the tools while remaining linked from the main Oasiz website.",
        items: [
          "Content changes in the tooling repo can ship without rebuilding the main Oasiz app.",
          "The main Oasiz footer links into /developers/ so users can navigate from the same public website.",
          "CLI, JavaScript SDK, and Unity docs can stay close to the packages they describe.",
        ],
      },
    ],
  },
  {
    path: "/developers/ai",
    title: "Develop with AI",
    navTitle: "Develop with AI",
    group: "Develop with AI",
    eyebrow: "Agent skills",
    description:
      "Install Oasiz-specific AI development skills so agent work updates Linear, captures platform learnings, and stays auditable across game projects.",
    heroCode:
      "Use $linear-game-dev-journal while developing this Oasiz game.\n" +
      "Use $oasiz-sdk-usage when adding SDK calls.\n" +
      "Use $oasiz-cli-usage before publishing.\n\n" +
      "mkdir -p ~/.codex/skills\n" +
      "unzip linear-game-dev-journal.zip -d ~/.codex/skills\n" +
      "unzip oasiz-sdk-usage.zip -d ~/.codex/skills\n" +
      "unzip oasiz-cli-usage.zip -d ~/.codex/skills",
    heroItems: [
      "Oasiz Linear Learning captures progress, verification, risks, and reusable learnings in the Oasiz Linear developer workspace.",
      "Oasiz SDK Usage guides score, state, haptics, lifecycle, simulator, and host bridge integrations.",
      "Oasiz CLI Usage guides creation, dry-runs, uploads, versions, activation, and game-server commands.",
    ],
    sections: [
      {
        id: "skills",
        kicker: "Skill library",
        title: "Oasiz AI skill library",
        body:
          "Install the skills that match the work an AI agent is doing. Use Linear Learning for development memory, SDK Usage for platform bridge integrations, and CLI Usage for publishing and server workflows.",
        skills: [
          {
            title: "Oasiz Linear Learning",
            name: "linear-game-dev-journal",
            description:
              "A repo-owned Agent Skill for updating Oasiz Linear issues, project status, and Game Development Learnings with concise game-dev progress.",
            version: "1.0.0",
            requires: "Oasiz Linear developer workspace access",
            habits: [
              "Authorized Oasiz developers should already have access to the Oasiz Linear developer workspace in Linear.",
              "If access is missing, email contact@oasiz.ai to request Oasiz Developers Program and Linear workspace access.",
              "When Linear cannot authenticate yet, keep working and leave a Linear-ready summary for posting later.",
            ],
            downloadHref: "/developers/downloads/linear-game-dev-journal.zip",
            inspectHref: "/developers/skills/linear-game-dev-journal/SKILL.md",
            sourceHref:
              "https://github.com/oasiz-ai/oasiz-game-studio/tree/main/skills/linear-game-dev-journal",
            installCode:
              "mkdir -p ~/.codex/skills\n" +
              "unzip linear-game-dev-journal.zip -d ~/.codex/skills",
          },
          {
            title: "Oasiz SDK Usage",
            name: "oasiz-sdk-usage",
            description:
              "A repo-owned Agent Skill for adding or reviewing @oasiz/sdk score, state, haptics, lifecycle, simulator, and host bridge integrations.",
            version: "1.0.0",
            requires: "@oasiz/sdk project context",
            downloadHref: "/developers/downloads/oasiz-sdk-usage.zip",
            inspectHref: "/developers/skills/oasiz-sdk-usage/SKILL.md",
            sourceHref:
              "https://github.com/oasiz-ai/oasiz-game-studio/tree/main/skills/oasiz-sdk-usage",
            installCode:
              "mkdir -p ~/.codex/skills\n" +
              "unzip oasiz-sdk-usage.zip -d ~/.codex/skills",
          },
          {
            title: "Oasiz CLI Usage",
            name: "oasiz-cli-usage",
            description:
              "A repo-owned Agent Skill for @oasiz/cli game creation, authentication, dry-runs, uploads, versions, activation, and game-server commands.",
            version: "1.0.0",
            requires: "@oasiz/cli and a target game",
            downloadHref: "/developers/downloads/oasiz-cli-usage.zip",
            inspectHref: "/developers/skills/oasiz-cli-usage/SKILL.md",
            sourceHref:
              "https://github.com/oasiz-ai/oasiz-game-studio/tree/main/skills/oasiz-cli-usage",
            installCode:
              "mkdir -p ~/.codex/skills\n" +
              "unzip oasiz-cli-usage.zip -d ~/.codex/skills",
          },
        ],
      },
      {
        id: "when-to-use",
        title: "When to use each skill",
        body:
          "Use the most specific skill for the task, and combine them when the work crosses from integration into publishing.",
        items: [
          "Use Oasiz Linear Learning for substantive development, debugging, review, playtesting, release-risk notes, and verification summaries in the Oasiz Linear developer workspace.",
          "Use Oasiz SDK Usage for score submission, state persistence, haptics, lifecycle, leaderboard visibility, simulator, and log overlay work.",
          "Use Oasiz CLI Usage for create, login, whoami, list, dry-run upload, upload, versions, activation, and Colyseus game-server work.",
        ],
      },
      {
        id: "install",
        title: "Install the skills",
        body:
          "Download each ZIP, inspect SKILL.md, then place the folders in your agent skills directory. Each skill is plain Markdown with optional UI metadata, so it can be reviewed before use.",
        code:
          "mkdir -p ~/.codex/skills\n" +
          "unzip linear-game-dev-journal.zip -d ~/.codex/skills\n" +
          "unzip oasiz-sdk-usage.zip -d ~/.codex/skills\n" +
          "unzip oasiz-cli-usage.zip -d ~/.codex/skills",
      },
      {
        id: "how-they-help",
        title: "How they help",
        body:
          "The skills keep AI-assisted Oasiz work consistent without making every agent rediscover platform behavior from scratch.",
        items: [
          "Linear Learning records what changed, how it was verified, and what risk remains.",
          "SDK Usage keeps platform calls near the right gameplay moments and avoids invented SDK methods.",
          "CLI Usage keeps publishing safe by preferring dry-runs and requiring explicit live-state changes.",
        ],
      },
    ],
  },
  {
    path: "/developers/quickstart",
    title: "Quickstart",
    navTitle: "Quickstart",
    group: "Start",
    eyebrow: "Five-minute path",
    description:
      "Create a game shell, add the SDK, test locally, and publish a first draft with the same flow a new Oasiz developer should see first.",
    heroCode:
      "npm install -g @oasiz/cli\n" +
      "oasiz login\n" +
      "oasiz create neon-dash\n" +
      "cd neon-dash\n" +
      "npm install\n" +
      "npm install @oasiz/sdk\n" +
      "oasiz upload neon-dash --dry-run",
    heroItems: [
      "Use dry-run before every first upload.",
      "Add the SDK at gameplay boundaries.",
      "Activate only after the draft looks right in Oasiz.",
    ],
    sections: [
      {
        id: "create",
        kicker: "Step 1",
        title: "Create the project",
        body:
          "Use the CLI template for new browser games. It gives you the publishing metadata and a working Oasiz bridge shape before you add your own game loop.",
        code: "oasiz create neon-dash\ncd neon-dash\nnpm install\nnpm run dev",
      },
      {
        id: "integrate",
        kicker: "Step 2",
        title: "Add platform calls",
        body:
          "Keep platform calls near the moments that matter: session start, checkpoints, player feedback, pause menus, and game over.",
        code:
          'import { oasiz } from "@oasiz/sdk";\n\n' +
          "const state = oasiz.loadGameState();\n" +
          "oasiz.saveGameState({ level, coins });\n" +
          'oasiz.triggerHaptic("success");\n' +
          "oasiz.submitScore(Math.floor(score));",
      },
      {
        id: "publish",
        kicker: "Step 3",
        title: "Publish a draft",
        body:
          "Dry-run the upload first so asset size, orientation, thumbnail state, and CDN transport are visible before anything leaves your machine.",
        code:
          "oasiz upload neon-dash --dry-run\n" +
          "oasiz upload neon-dash\n" +
          "oasiz versions neon-dash\n" +
          "oasiz upload neon-dash --activate",
        note:
          "Use --activate only when you are ready to publish the uploaded version live.",
      },
    ],
  },
  {
    path: "/developers/cli",
    title: "Oasiz CLI",
    navTitle: "CLI",
    group: "Build",
    eyebrow: "@oasiz/cli",
    description:
      "Create games, sign in, upload builds, activate versions, and manage Colyseus game servers from the terminal.",
    npmPackage: cliNpmPackage,
    heroCode:
      "npm install -g @oasiz/cli\n" +
      "oasiz login\n" +
      "oasiz whoami\n" +
      "oasiz list\n" +
      "oasiz upload block-blast --dry-run",
    heroItems: [
      "Production API: https://www.oasiz.gg",
      "Browser login: https://oasiz.ai",
      "Auth also supports OASIZ_CLI_TOKEN and OASIZ_UPLOAD_TOKEN.",
    ],
    sections: [
      {
        id: "install",
        title: "Install and authenticate",
        body:
          "Install the CLI globally for everyday publishing, or use npx when you want the latest published command without changing your global setup.",
        code:
          "npm install -g @oasiz/cli\n" +
          "oasiz login\n" +
          "oasiz whoami\n\n" +
          "# one-off usage\n" +
          "npx @oasiz/cli list",
      },
      {
        id: "upload",
        title: "Upload workflow",
        body:
          "Normal uploads initialize through the Oasiz API, request presigned R2 URLs, send static assets directly to CDN storage, sync the final HTML, and upload a thumbnail when one is available.",
        items: [
          "--dry-run checks the bundle without contacting the upload API.",
          "--skip-build reuses an existing dist/ output.",
          "--inline keeps the legacy single-HTML upload path.",
          "--withlog injects a preboot log overlay into uploaded HTML.",
          "--public marks the game public during upload.",
          "--activate publishes the uploaded game or version live.",
        ],
        code:
          "oasiz upload block-blast --dry-run\n" +
          "oasiz upload block-blast\n" +
          "oasiz upload block-blast --public\n" +
          "oasiz upload block-blast --activate",
      },
      {
        id: "commands",
        title: "Command map",
        body:
          "The CLI reference is grouped by jobs, so developers can scan for the command they need without reading the full publishing walkthrough.",
        commands: [
          {
            title: "List local upload targets",
            name: "oasiz list",
            description:
              "List local TypeScript/Vite and Unity WebGL game folders that the uploader can find.",
            example: "oasiz list",
          },
          {
            title: "List platform games",
            name: "oasiz games",
            description:
              "Fetch your canonical Oasiz games and print title, public state, live version, and updated time.",
            example: "oasiz games",
          },
          {
            title: "Sign in to the CLI",
            name: "oasiz login",
            description: "Start browser login and store the returned CLI token locally.",
            example: "oasiz login",
          },
          {
            title: "Show current auth state",
            name: "oasiz whoami",
            description:
              "Print whether the CLI is authenticated, which token source is active, and the API base URL.",
            example: "oasiz whoami",
          },
          {
            title: "Clear saved CLI credentials",
            name: "oasiz logout",
            description:
              "Remove saved CLI credentials from local storage; environment tokens can still authenticate the shell.",
            example: "oasiz logout",
          },
          {
            title: "Scaffold a game project",
            name: "oasiz create [name]",
            description:
              "Create a local game folder from the bundled template and write the project metadata used by the uploader.",
            example: "oasiz create neon-dash",
          },
          {
            title: "Upload a build",
            name: "oasiz upload <game>",
            description:
              "Build a local game folder or detect a Unity WebGL export, then upload the resulting assets to Oasiz.",
            example: "oasiz upload neon-dash --dry-run",
          },
          {
            title: "List uploaded versions",
            name: "oasiz versions <game>",
            description:
              "Print uploaded versions for a platform game with upload time, public state, and live status.",
            example: "oasiz versions neon-dash",
          },
          {
            title: "Promote a version live",
            name: "oasiz activate <game>",
            description:
              "Prompt for an uploaded version, publish it as the live version, and set the game public.",
            example: "oasiz activate neon-dash",
          },
          {
            title: "Create multiplayer server",
            name: "oasiz game-server create <slug>",
            description:
              "Create a Colyseus server from the platform default, a custom image, local source, or workspace source.",
            example:
              "oasiz game-server create arena --source server --entrypoint rooms/index.ts --wait",
          },
          {
            title: "Check server build status",
            name: "oasiz game-server status <build_id>",
            description:
              "Fetch a game server build status, or poll until completion when --wait is provided.",
            example: "oasiz game-server status gs-build-... --wait",
          },
        ],
      },
      {
        id: "servers",
        title: "Game servers",
        body:
          "Game server commands default to standalone production routes. Workspace-scoped routes are used only when you pass --workspace or --workspace-id.",
        code:
          "oasiz game-server create arena\n" +
          "oasiz game-server create arena \\\n" +
          "  --source server \\\n" +
          "  --entrypoint rooms/index.ts \\\n" +
          "  --build-command \"npm run build\" \\\n" +
          "  --wait\n" +
          "oasiz game-server status gs-build-... --wait",
      },
    ],
  },
  {
    path: "/developers/sdk",
    title: "Oasiz SDK",
    navTitle: "JavaScript SDK",
    group: "Build",
    eyebrow: "@oasiz/sdk",
    description:
      "Typed browser APIs for score submission, haptics, state persistence, layout, lifecycle events, app simulation, and local debugging.",
    npmPackage: sdkNpmPackage,
    heroCode:
      "npm install @oasiz/sdk\n\n" +
      'import { oasiz } from "@oasiz/sdk";\n\n' +
      "const state = oasiz.loadGameState();\n" +
      'oasiz.triggerHaptic("medium");\n' +
      "oasiz.submitScore(score);",
    heroItems: [
      "ESM, CommonJS, and TypeScript declarations.",
      "No-ops safely when the Oasiz host bridge is unavailable.",
      "Includes an app simulator for local web development.",
    ],
    sections: [
      {
        id: "install",
        title: "Install",
        body:
          "Install the SDK in any browser game stack: Canvas, Phaser, custom TypeScript, or exported HTML that runs inside the Oasiz app.",
        code: "npm install @oasiz/sdk",
      },
      {
        id: "quickstart",
        title: "Quickstart",
        body:
          "Initialize local app simulation only in development, load player state at boot, save at checkpoints, and submit the final score once at game over.",
        code:
          'import { oasiz } from "@oasiz/sdk";\n\n' +
          "if (import.meta.env.DEV) {\n" +
          "  oasiz.enableAppSimulator();\n" +
          "}\n\n" +
          "const state = oasiz.loadGameState();\n" +
          "const level = typeof state.level === \"number\" ? state.level : 1;\n\n" +
          "oasiz.saveGameState({ level, coins: 42 });\n" +
          'oasiz.triggerHaptic("success");\n' +
          "oasiz.submitScore(Math.floor(score));",
      },
      {
        id: "apis",
        title: "Core APIs",
        body:
          "These SDK calls map directly to score, state, and device-feedback bridge behavior. Keep them near the gameplay moment that needs them.",
        commands: [
          {
            title: "Submit final run score",
            name: "oasiz.submitScore(score)",
            description:
              "Floor a finite score to a non-negative integer and pass it to the host score bridge.",
            example: "oasiz.submitScore(Math.floor(score));",
          },
          {
            title: "Adjust score by delta",
            name: "oasiz.addScore(delta)",
            description:
              "Send a non-zero integer delta to the score-edit bridge and return the updated score result or null.",
            example: "await oasiz.addScore(100);",
          },
          {
            title: "Set score exactly",
            name: "oasiz.setScore(score)",
            description:
              "Send a non-negative integer score to the score-edit bridge and return the updated score result or null.",
            example: "await oasiz.setScore(total);",
          },
          {
            title: "Read saved game state",
            name: "oasiz.loadGameState()",
            description:
              "Return a plain object from the host state bridge, or an empty object when state is missing or invalid.",
            example: "const state = oasiz.loadGameState();",
          },
          {
            title: "Save game state",
            name: "oasiz.saveGameState(state)",
            description:
              "Pass a plain object to the host state bridge for cross-session persistence.",
            example: "oasiz.saveGameState({ level, coins });",
          },
          {
            title: "Request haptic feedback",
            name: "oasiz.triggerHaptic(type)",
            description:
              "Call the host haptic bridge with a supported haptic type such as light, medium, success, or error.",
            example: 'oasiz.triggerHaptic("light");',
          },
        ],
      },
      {
        id: "simulator",
        title: "Local app simulator",
        body:
          "The simulator previews Oasiz-style mobile chrome in a normal browser. It can inject safe-area values, back-button behavior, comments, leaderboard UI, and a phone-sized frame.",
        code:
          "const appPreview = oasiz.enableAppSimulator({\n" +
          '  device: "iphone-17-pro-max",\n' +
          "  likes: 2400,\n" +
          "  comments: 18,\n" +
          "  score: 12400,\n" +
          "});\n\n" +
          "appPreview.openLeaderboard();",
      },
      {
        id: "cdn",
        title: "No-build HTML",
        body:
          "For prototypes or exported HTML that do not run a bundler, load the hosted SDK bundle before your game script.",
        code:
          '<script src="https://www.oasiz.gg/sdk/v1/oasiz.min.js"></script>',
      },
    ],
  },
  {
    path: "/developers/unity",
    title: "Unity WebGL",
    navTitle: "Unity WebGL",
    group: "Build",
    eyebrow: "Unity SDK",
    description:
      "Use the Unity runtime package for WebGL games that need the same Oasiz platform bridge as browser games.",
    heroCode:
      "packages/OasizSDK/\n\n" +
      "using Oasiz;\n\n" +
      "private void Awake()\n" +
      "{\n" +
      "    _ = OasizSDK.Instance;\n" +
      "    OasizSDK.OnPause += HandlePause;\n" +
      "    OasizSDK.OnResume += HandleResume;\n" +
      "}",
    heroItems: [
      "Runtime package is in packages/OasizSDK/.",
      "The WebGL bridge lives in Runtime/Plugins/WebGL/OasizBridge.jslib.",
      "Editor paths log safely when the browser host bridge is absent.",
    ],
    sections: [
      {
        id: "install",
        title: "Install the package",
        body:
          "Import the Unity runtime package before building WebGL. Keep the runtime files under Assets so Unity includes the WebGL plugin during export.",
        code:
          "packages/OasizSDK/Runtime/OasizSDK.cs\n" +
          "packages/OasizSDK/Runtime/OasizTypes.cs\n" +
          "packages/OasizSDK/Runtime/Plugins/WebGL/OasizBridge.jslib",
      },
      {
        id: "initialize",
        title: "Initialize early",
        body:
          "Create the SDK singleton at startup and keep lifecycle listeners stable across scene changes.",
        code:
          "using Oasiz;\n\n" +
          "private void Awake()\n" +
          "{\n" +
          "    _ = OasizSDK.Instance;\n" +
          "    OasizSDK.OnPause += HandlePause;\n" +
          "    OasizSDK.OnResume += HandleResume;\n" +
          "}",
      },
      {
        id: "mapping",
        title: "Runtime call map",
        body:
          "Unity exposes the same core concepts as the JavaScript SDK so teams can keep gameplay integration consistent across engines.",
        commands: [
          {
            title: "Submit final Unity score",
            name: "OasizSDK.SubmitScore(int)",
            description:
              "Clamp negative scores to zero and send the final score to the WebGL score bridge.",
            example: "OasizSDK.SubmitScore(score);",
          },
          {
            title: "Request Unity haptics",
            name: "OasizSDK.TriggerHaptic(HapticType)",
            description:
              "Send the selected haptic type to the WebGL haptic bridge when the host supports it.",
            example: "OasizSDK.TriggerHaptic(HapticType.Success);",
          },
          {
            title: "Read Unity game state",
            name: "OasizSDK.LoadGameState()",
            description:
              "Read JSON state from the WebGL state bridge and fall back to an empty object when unavailable.",
            example: "var state = OasizSDK.LoadGameState();",
          },
          {
            title: "Save Unity game state",
            name: "OasizSDK.SaveGameState(...)",
            description:
              "Serialize game state and pass it to the WebGL state bridge for persistence.",
            example: "OasizSDK.SaveGameState(state);",
          },
        ],
      },
      {
        id: "publish",
        title: "Upload Unity WebGL builds",
        body:
          "The CLI detects Unity WebGL exports under Unity/<game>/Build/index.html, preserves the OasizDefault template marker behavior, and rewrites asset paths for CDN delivery when needed.",
        code:
          "oasiz upload WarriorIO --dry-run\n" +
          "oasiz upload WarriorIO --withlog\n" +
          "oasiz upload WarriorIO --activate",
      },
    ],
  },
  {
    path: "/developers/reference",
    title: "Reference",
    navTitle: "Reference",
    group: "Reference",
    eyebrow: "Commands and APIs",
    description:
      "A compact scan of the CLI commands and SDK methods that developers reach for most often.",
    heroCode:
      "oasiz --help\n" +
      "oasiz upload <game> --dry-run\n" +
      "oasiz game-server create <slug> --wait\n\n" +
      'import { oasiz } from "@oasiz/sdk";',
    heroItems: [
      "CLI commands are grouped by workflow.",
      "SDK APIs are grouped by gameplay responsibility.",
      "Detailed guides live on the CLI, SDK, and Unity pages.",
    ],
    sections: [
      {
        id: "npm",
        title: "npm packages",
        body:
          "Use npm to inspect the published package page, latest tag, and version history for the official Oasiz CLI and JavaScript SDK.",
        packages: [cliNpmPackage, sdkNpmPackage],
      },
      {
        id: "cli",
        title: "CLI commands",
        body:
          "Use these commands for local project creation, publishing, draft management, and multiplayer server operations.",
        commands: [
          {
            title: "List local upload targets",
            name: "oasiz list",
            description:
              "List local TypeScript/Vite and Unity WebGL game folders that the uploader can find.",
            example: "oasiz list",
          },
          {
            title: "List platform games",
            name: "oasiz games",
            description:
              "Fetch your canonical Oasiz games and print title, public state, live version, and updated time.",
            example: "oasiz games",
          },
          {
            title: "Sign in to the CLI",
            name: "oasiz login",
            description: "Start browser login and store the returned CLI token locally.",
            example: "oasiz login",
          },
          {
            title: "Show current auth state",
            name: "oasiz whoami",
            description:
              "Print whether the CLI is authenticated, which token source is active, and the API base URL.",
            example: "oasiz whoami",
          },
          {
            title: "Clear saved CLI credentials",
            name: "oasiz logout",
            description:
              "Remove saved CLI credentials from local storage; environment tokens can still authenticate the shell.",
            example: "oasiz logout",
          },
          {
            title: "Create a new game project",
            name: "oasiz create [name]",
            description:
              "Create a local game folder from the bundled template and write the project metadata used by the uploader.",
            example: "oasiz create neon-dash",
          },
          {
            title: "Upload a game build",
            name: "oasiz upload <game>",
            description:
              "Build a local game folder or detect a Unity WebGL export, then upload the resulting assets to Oasiz.",
            example: "oasiz upload neon-dash --dry-run",
          },
          {
            title: "View uploaded game versions",
            name: "oasiz versions <game>",
            description:
              "List the uploaded versions for a game, including upload time, public state, and which version is live.",
            example: "oasiz versions neon-dash",
          },
          {
            title: "Publish a version live",
            name: "oasiz activate <game>",
            description:
              "Prompt for an uploaded version, publish it as the live version, and set the game public.",
            example: "oasiz activate neon-dash",
          },
          {
            title: "Create Colyseus multiplayer server",
            name: "oasiz game-server create <slug>",
            description:
              "Create a Colyseus server using the platform default template unless source, workspace, or image options are supplied.",
            example: "oasiz game-server create arena --wait",
          },
          {
            title: "Check server build status",
            name: "oasiz game-server status <build_id>",
            description:
              "Fetch a game server build status, or poll until completion when --wait is provided.",
            example: "oasiz game-server status gs-build-... --wait",
          },
        ],
      },
      {
        id: "sdk",
        title: "SDK methods",
        body:
          "The JavaScript SDK wraps host bridge behavior and falls back safely during local browser development.",
        commands: [
          {
            title: "Preview app chrome locally",
            name: "oasiz.enableAppSimulator(options)",
            description:
              "Mount the local app simulator, install test bridges, and return a handle for preview controls.",
            example: "oasiz.enableAppSimulator();",
          },
          {
            title: "Show in-game logs",
            name: "oasiz.enableLogOverlay(options)",
            description:
              "Mirror console output into a draggable in-game overlay and return its control handle.",
            example: "oasiz.enableLogOverlay({ collapsed: true });",
          },
          {
            title: "Handle host back actions",
            name: "oasiz.onBackButton(handler)",
            description:
              "Subscribe to host back events and enable back override while at least one listener is active.",
            example: "oasiz.onBackButton(openPauseMenu);",
          },
          {
            title: "Show or hide leaderboard UI",
            name: "oasiz.setLeaderboardVisible(visible)",
            description:
              "Call the host leaderboard visibility bridge with a boolean value.",
            example: "oasiz.setLeaderboardVisible(false);",
          },
          {
            title: "Read render performance profile",
            name: "oasiz.getGraphicsPerformance()",
            description:
              "Return the host-provided or locally estimated FPS target and graphics tier.",
            example: "const graphics = oasiz.getGraphicsPerformance();",
          },
        ],
      },
    ],
  },
];

export function normalizePath(pathname: string): string {
  if (pathname === "/developers") return "/developers/";
  if (pathname.endsWith("/") && pathname !== "/developers/") {
    return pathname.slice(0, -1);
  }
  return pathname;
}

export function pageForPath(pathname: string): DocPage {
  const normalized = normalizePath(pathname);
  return pages.find((page) => normalizePath(page.path) === normalized) ?? pages[0];
}
