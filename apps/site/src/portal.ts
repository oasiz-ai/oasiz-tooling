import { normalizePath, pageForPath, pages, type DocPage } from "./content";

const PORTAL_SESSION_KEY = "oasiz.developers.portal.session.v1";
const PORTAL_LOGIN_STATE_KEY = "oasiz.developers.portal.loginState";
const DEFAULT_LOCAL_WEB_BASE = "http://localhost:5173";
const DEFAULT_PRODUCTION_AUTH_BASE = "https://www.oasiz.ai";
const PORTAL_CHECK_ICON = `
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <path d="M20 6 9 17l-5-5"></path>
  </svg>
`;
const PORTAL_FIX_MARKER_FIXED = "Fixed";
const PORTAL_FIX_MARKER_NOT_FIXED = "Not fixed";

type PortalSession = {
  token: string;
  email?: string;
  expiresAt?: string;
  developer?: boolean;
  userId?: string;
  createdAt: string;
};

type PortalUser = {
  id: string;
  name: string;
  email?: string;
  image?: string | null;
  color?: string | null;
  developer?: boolean;
  stats?: {
    gamesCreated?: number;
    totalLikes?: number;
    totalPlays?: number;
    reviewsReceived?: number;
  };
};

type PortalGame = {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  imageUrl?: string | null;
  isPublic: boolean;
  isReviewed?: boolean;
  activeVersionId?: string | null;
  rootGameId?: string | null;
  parentId?: string | null;
  plays?: number;
  likes?: number;
  comments?: number;
  isLiked?: boolean;
  betaSubmittedAt?: string;
  betaReviewEndsAt?: string;
  betaTypeTag?: string;
  creatorName?: string;
  testersCount?: number;
  uniquePlayers?: number;
  unreadCommentNotificationCount?: number;
  unreadCommentNotificationIds?: string[];
  fixesCompleted?: number;
  fixTotal?: number;
  fixStatsLoaded?: boolean;
  createdAt: string;
  updatedAt: string;
};

type PortalComment = {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  userId: string;
  userName: string;
  userImage: string | null;
  userColor: string | null;
  hidden?: boolean;
  likes: number;
  isLiked: boolean;
  canEdit: boolean;
  canDelete: boolean;
  parentId?: string | null;
  replyToUserId?: string | null;
  replyToUsername?: string | null;
  linkedGameId: string | null;
  linkedGameImageUrl: string | null;
  linkedGameTitle: string | null;
  linkedGameIsPublic?: boolean | null;
  linkedGameCreator?: string | null;
  imageUrl?: string | null;
  imageKey?: string | null;
};

type PortalCommentsPage = {
  comments: PortalComment[];
  totalCount: number;
  nextOffset: number | null;
  hasMore: boolean;
};

type PortalBetaGamesResponse = {
  games: PortalGame[];
};

type PortalPostCommentResponse = {
  ok: boolean;
  commentId?: string | null;
};

type PortalFixStats = {
  fixed: number;
  total: number;
};

type PortalAuthProvider = "google" | "apple";

type PortalSocialAuthResponse = {
  url?: string;
  redirect?: boolean;
  error?: string;
};

type PortalCliTokenResponse = {
  token?: string;
  email?: string;
  expiresAt?: string;
  developer?: boolean;
  user?: {
    id?: string;
  };
  error?: string;
  contactEmail?: string;
};

type DashboardTabId = "drafts" | "games" | "beta" | "saved";

type PortalDashboardCollections = Record<DashboardTabId, PortalGame[]>;

type PortalDashboardData = {
  session: PortalSession;
  user: PortalUser | null;
  collections: PortalDashboardCollections;
};

type PortalOpenGame = {
  gameId: string;
  tabId: DashboardTabId;
};

type PortalReplyTarget = {
  id: string;
  rootId: string;
  userId: string;
  userName: string;
};

type PortalCommentsState = {
  gameId: string;
  comments: PortalComment[];
  totalCount: number;
  nextOffset: number | null;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  posting: boolean;
  error: string | null;
  replyTarget: PortalReplyTarget | null;
};

const PORTAL_TABS: Array<{
  id: DashboardTabId;
  label: string;
  kicker: string;
  emptyTitle: string;
  emptyBody: string;
}> = [
  {
    id: "drafts",
    label: "Drafts",
    kicker: "Private builds",
    emptyTitle: "No draft games yet",
    emptyBody: "Private uploads from your Oasiz account will appear here.",
  },
  {
    id: "games",
    label: "Public Games",
    kicker: "Published games",
    emptyTitle: "No published games yet",
    emptyBody: "Reviewed public games from your Oasiz profile will appear here.",
  },
  {
    id: "beta",
    label: "Beta",
    kicker: "Review builds",
    emptyTitle: "No beta builds right now",
    emptyBody: "Games in Oasiz beta review will appear here with feedback counts.",
  },
  {
    id: "saved",
    label: "Saved",
    kicker: "Saved games",
    emptyTitle: "No saved games yet",
    emptyBody: "Games saved from your Oasiz account will appear here.",
  },
];

let portalDashboardData: PortalDashboardData | null = null;
let portalActiveTab: DashboardTabId = "drafts";
let portalOpenGame: PortalOpenGame | null = null;
let portalCommentsState: PortalCommentsState | null = null;
let portalBetaTimerInterval: number | null = null;

export function isPortalPath(pathname: string): boolean {
  const normalized = normalizePath(pathname);
  return (
    normalized === "/developers/portal" ||
    normalized === "/developers/dashboard" ||
    normalized === "/developers/auth/start" ||
    normalized === "/developers/auth/token" ||
    normalized === "/developers/auth/callback"
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeAvatarColor(value: string | null | undefined): string {
  if (value && /^#[0-9a-f]{6}$/i.test(value)) return value;
  return "#00A1E4";
}

function portalCallbackParams(): URLSearchParams {
  const url = new URL(window.location.href);
  if (url.hash.length > 1) {
    return new URLSearchParams(url.hash.slice(1));
  }
  return url.searchParams;
}

function readPortalSession(): PortalSession | null {
  try {
    const raw = window.localStorage.getItem(PORTAL_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PortalSession>;
    if (!parsed.token || typeof parsed.token !== "string") return null;
    return {
      token: parsed.token,
      email: parsed.email,
      expiresAt: parsed.expiresAt,
      developer: parsed.developer,
      userId: parsed.userId,
      createdAt: parsed.createdAt || new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

function writePortalSession(session: PortalSession): void {
  window.localStorage.setItem(PORTAL_SESSION_KEY, JSON.stringify(session));
}

function clearPortalSession(): void {
  window.localStorage.removeItem(PORTAL_SESSION_KEY);
  window.sessionStorage.removeItem(PORTAL_LOGIN_STATE_KEY);
}

function getPortalWebBase(): string {
  const configured = import.meta.env.VITE_OASIZ_WEB_BASE as string | undefined;
  if (configured) return configured.replace(/\/$/, "");
  if (window.location.hostname === "localhost" && window.location.port === "5174") {
    return DEFAULT_LOCAL_WEB_BASE;
  }
  return window.location.origin;
}

function getPortalAuthBase(): string {
  const configured = import.meta.env.VITE_OASIZ_WEB_BASE as string | undefined;
  if (configured) return configured.replace(/\/$/, "");
  if (window.location.hostname === "localhost" && window.location.port === "5174") {
    return DEFAULT_LOCAL_WEB_BASE;
  }
  return DEFAULT_PRODUCTION_AUTH_BASE;
}

function isLocalPortalDev(): boolean {
  return window.location.hostname === "localhost" && window.location.port === "5174";
}

function getPortalCallbackUrl(): string {
  return new URL("/developers/auth/callback", window.location.origin).toString();
}

function isAllowedPortalCallbackUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    const isOasizDomain =
      url.hostname === "oasiz.gg" ||
      url.hostname === "www.oasiz.gg" ||
      url.hostname === "oasiz.ai" ||
      url.hostname === "www.oasiz.ai";

    if (url.pathname !== "/developers/auth/callback") return false;
    if (isOasizDomain) return url.protocol === "https:";
    return isLocalhost && (url.protocol === "http:" || url.protocol === "https:");
  } catch {
    return false;
  }
}

function portalAuthProvider(value: string | null | undefined): PortalAuthProvider | null {
  return value === "google" || value === "apple" ? value : null;
}

function createPortalLoginUrl(provider: PortalAuthProvider): string {
  const state = crypto.randomUUID();
  window.sessionStorage.setItem(PORTAL_LOGIN_STATE_KEY, state);

  if (!isLocalPortalDev()) {
    const url = new URL("/developers/auth/start", getPortalAuthBase());
    url.searchParams.set("provider", provider);
    url.searchParams.set("return_to", getPortalCallbackUrl());
    url.searchParams.set("state", state);
    return url.toString();
  }

  const url = new URL("/cli-auth", getPortalWebBase());
  url.searchParams.set("audience", "developers");
  url.searchParams.set("return_to", getPortalCallbackUrl());
  url.searchParams.set("state", state);
  return url.toString();
}

function portalTopNavMarkup(activePathname: string): string {
  const activePath = normalizePath(activePathname);
  const links = [
    pages[0],
    pageForPath("/developers/ai"),
    pageForPath("/developers/cli"),
    pageForPath("/developers/sdk"),
    pageForPath("/developers/reference"),
  ].filter((page): page is DocPage => Boolean(page));

  return `
    ${links
      .map(
        (page) => `
          <a class="${normalizePath(page.path) === activePath ? "active" : ""}" href="${escapeHtml(
            page.path,
          )}">${escapeHtml(page.navTitle)}</a>
        `,
      )
      .join("")}
    <a class="${
      activePath === "/developers/portal" || activePath === "/developers/dashboard"
        ? "active"
        : ""
    }" href="/developers/portal">Portal</a>
    <a href="https://oasiz.ai" rel="noreferrer" target="_blank">Open app</a>
  `;
}

function portalShellMarkup(logoUrl: string, body: string): string {
  return `
    <div class="shell">
      <header class="topbar">
        <a class="brand" href="/developers/">
          <img src="${logoUrl}" alt="Oasiz logo" />
          <span>OASIZ</span>
          <small>Developers</small>
        </a>
        <nav class="topnav" aria-label="Primary">
          ${portalTopNavMarkup(window.location.pathname)}
        </nav>
      </header>
      ${body}
    </div>
  `;
}

function renderPortalLogin(error?: string | null): string {
  const existingSession = readPortalSession();
  if (existingSession) {
    return renderPortalDashboardShell(existingSession);
  }

  return `
    <main class="portal-layout portal-auth-layout">
      <section class="portal-auth-panel">
        <p class="eyebrow">Developer portal</p>
        <h1>Developer Login</h1>
        <p class="lede">
          Sign in with your Oasiz account to open the developer dashboard connected to your uploaded games.
        </p>
        ${
          error
            ? `<p class="portal-error" role="alert">${escapeHtml(error)}</p>`
            : ""
        }
        <div class="portal-actions">
          <button class="portal-primary-action" type="button" data-portal-login="google">
            Continue with Google
          </button>
          <button class="portal-secondary-action" type="button" data-portal-login="apple">
            Continue with Apple
          </button>
          <a class="portal-secondary-action" href="/developers/cli">Use CLI docs</a>
        </div>
        <ul class="portal-auth-list">
          <li>Uses the same Oasiz account and developer access gate as the CLI login flow.</li>
          <li>Authorized developers receive a portal token scoped to existing Oasiz APIs.</li>
          <li>If access is missing, email contact@oasiz.ai for Oasiz Developers Program access.</li>
        </ul>
      </section>
    </main>
  `;
}

function renderPortalAuthTransfer(title: string, message: string): string {
  return `
    <main class="portal-layout portal-auth-layout">
      <section class="portal-auth-panel">
        <p class="eyebrow">Developer portal</p>
        <h1>${escapeHtml(title)}</h1>
        <p class="lede" id="portal-auth-status">${escapeHtml(message)}</p>
      </section>
    </main>
  `;
}

function setPortalAuthStatus(message: string): void {
  const status = document.querySelector<HTMLElement>("#portal-auth-status");
  if (status) status.textContent = message;
}

function redirectPortalAuthError(returnTo: string, state: string, message: string): void {
  const callbackUrl = new URL(returnTo);
  callbackUrl.searchParams.set("state", state);
  callbackUrl.searchParams.set("error", message);
  window.location.replace(callbackUrl.toString());
}

async function startPortalSocialAuth(): Promise<void> {
  const search = new URLSearchParams(window.location.search);
  const provider = portalAuthProvider(search.get("provider"));
  const returnTo = search.get("return_to");
  const state = search.get("state");

  if (!provider || !state || !isAllowedPortalCallbackUrl(returnTo)) {
    setPortalAuthStatus("Developer login could not be started. Return to the portal and try again.");
    return;
  }

  setPortalAuthStatus("Opening Oasiz sign in.");

  try {
    const tokenCallbackUrl = new URL("/developers/auth/token", window.location.origin);
    tokenCallbackUrl.searchParams.set("return_to", returnTo);
    tokenCallbackUrl.searchParams.set("state", state);

    const response = await fetch("/api/auth/sign-in/social", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        provider,
        callbackURL: tokenCallbackUrl.toString(),
        disableRedirect: true,
      }),
    });
    const data = (await response.json().catch(() => ({}))) as PortalSocialAuthResponse;
    if (!response.ok || !data.url) {
      throw new Error(data.error || "Failed to start Oasiz sign in.");
    }

    window.location.assign(data.url);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start Oasiz sign in.";
    redirectPortalAuthError(returnTo, state, message);
  }
}

async function completePortalSocialAuth(): Promise<void> {
  const search = new URLSearchParams(window.location.search);
  const returnTo = search.get("return_to");
  const state = search.get("state");
  const authError = search.get("error");

  if (!state || !isAllowedPortalCallbackUrl(returnTo)) {
    setPortalAuthStatus("Developer login could not be completed. Return to the portal and try again.");
    return;
  }

  if (authError) {
    redirectPortalAuthError(returnTo, state, authError);
    return;
  }

  setPortalAuthStatus("Connecting your Oasiz developer account.");

  try {
    const response = await fetch("/api/cli-token", {
      method: "POST",
      credentials: "include",
    });
    const data = (await response.json().catch(() => ({}))) as PortalCliTokenResponse;
    if (!response.ok || !data.token) {
      const message =
        data.error ||
        data.contactEmail ||
        "Failed to issue a developer portal token.";
      throw new Error(message);
    }

    const callbackUrl = new URL(returnTo);
    const callbackParams = new URLSearchParams();
    callbackParams.set("state", state);
    callbackParams.set("token", data.token);
    if (data.email) callbackParams.set("email", data.email);
    if (data.expiresAt) callbackParams.set("expiresAt", data.expiresAt);
    if (data.developer === true) callbackParams.set("developer", "true");
    if (data.user?.id) callbackParams.set("userId", data.user.id);
    callbackUrl.hash = callbackParams.toString();

    window.location.replace(callbackUrl.toString());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to complete developer login.";
    redirectPortalAuthError(returnTo, state, message);
  }
}

function renderPortalCallback(): string {
  const params = portalCallbackParams();
  const returnedState = params.get("state") ?? "";
  const expectedState = window.sessionStorage.getItem(PORTAL_LOGIN_STATE_KEY);
  const error = params.get("error");

  if (error) {
    window.sessionStorage.removeItem(PORTAL_LOGIN_STATE_KEY);
    return renderPortalLogin(error);
  }

  const token = params.get("token");
  if (!token || !expectedState || returnedState !== expectedState) {
    window.sessionStorage.removeItem(PORTAL_LOGIN_STATE_KEY);
    return renderPortalLogin("Developer login could not be verified. Start the flow again.");
  }

  writePortalSession({
    token,
    email: params.get("email") ?? undefined,
    expiresAt: params.get("expiresAt") ?? undefined,
    developer: params.get("developer") === "true",
    userId: params.get("userId") ?? undefined,
    createdAt: new Date().toISOString(),
  });
  window.sessionStorage.removeItem(PORTAL_LOGIN_STATE_KEY);
  window.history.replaceState({}, "", "/developers/dashboard");
  return renderPortalDashboardShell(readPortalSession());
}

function profileInitials(session: PortalSession, user: PortalUser | null): string {
  const source = user?.name || session.email || "Oasiz";
  return source
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function formatNumber(value: number | undefined): string {
  return new Intl.NumberFormat("en-US").format(value ?? 0);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function renderPortalDashboardShell(session: PortalSession | null): string {
  if (!session) return renderPortalLogin();
  return `
    <main class="portal-layout">
      <section class="portal-dashboard" id="portal-dashboard-root" aria-live="polite">
        <div class="portal-dashboard-loading">
          <p class="eyebrow">Developer portal</p>
          <h1>Dashboard</h1>
          <p class="lede">Loading your Oasiz developer account.</p>
        </div>
      </section>
    </main>
  `;
}

function initialsFromName(value: string | null | undefined): string {
  const source = value?.trim() || "Oasiz";
  return source
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function renderProfileAvatar(session: PortalSession, user: PortalUser | null): string {
  if (user?.image) {
    return `<img class="portal-profile-avatar" src="${escapeHtml(user.image)}" alt="" />`;
  }

  return `
    <div class="portal-profile-avatar portal-profile-avatar-fallback" style="--avatar-color: ${safeAvatarColor(user?.color)}">
      ${escapeHtml(profileInitials(session, user))}
    </div>
  `;
}

function emptyPortalCollections(): PortalDashboardCollections {
  return {
    drafts: [],
    games: [],
    beta: [],
    saved: [],
  };
}

function isDashboardTabId(value: string | undefined): value is DashboardTabId {
  return PORTAL_TABS.some((tab) => tab.id === value);
}

function tabDefinition(tabId: DashboardTabId) {
  return PORTAL_TABS.find((tab) => tab.id === tabId) ?? PORTAL_TABS[0];
}

function normalizePortalGame(game: PortalGame): PortalGame {
  return {
    ...game,
    description: game.description ?? "",
    category: game.category ?? null,
    imageUrl: game.imageUrl ?? null,
    rootGameId: game.rootGameId ?? null,
    parentId: game.parentId ?? null,
    plays: Number(game.plays ?? 0),
    likes: Number(game.likes ?? 0),
    comments: Number(game.comments ?? 0),
  };
}

function sortGamesByUpdatedAtDesc(games: PortalGame[]): PortalGame[] {
  return [...games].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

function allDashboardGames(collections: PortalDashboardCollections): PortalGame[] {
  const unique = new Map<string, PortalGame>();
  for (const tab of PORTAL_TABS) {
    for (const game of collections[tab.id]) {
      if (!unique.has(game.id)) unique.set(game.id, game);
    }
  }
  return [...unique.values()];
}

function findPortalGame(
  data: PortalDashboardData | null,
  gameId: string,
  preferredTabId?: DashboardTabId,
): PortalGame | null {
  if (!data) return null;
  const tabOrder = preferredTabId
    ? [preferredTabId, ...PORTAL_TABS.map((tab) => tab.id).filter((tabId) => tabId !== preferredTabId)]
    : PORTAL_TABS.map((tab) => tab.id);

  for (const tabId of tabOrder) {
    const match = data.collections[tabId].find((game) => game.id === gameId);
    if (match) return match;
  }

  return null;
}

function updatePortalGameCommentCount(gameId: string, totalCount: number): void {
  if (!portalDashboardData) return;
  for (const tab of PORTAL_TABS) {
    portalDashboardData.collections[tab.id] = portalDashboardData.collections[tab.id].map(
      (game) =>
        game.id === gameId
          ? {
              ...game,
              comments:
                tab.id === "beta" && typeof game.fixTotal === "number"
                  ? game.fixTotal
                  : totalCount,
            }
          : game,
    );
  }
}

function updatePortalGameFixStats(gameId: string, stats: PortalFixStats): void {
  if (!portalDashboardData) return;
  for (const tab of PORTAL_TABS) {
    portalDashboardData.collections[tab.id] = portalDashboardData.collections[tab.id].map(
      (game) =>
        game.id === gameId
          ? {
              ...game,
              comments: stats.total,
              fixesCompleted: stats.fixed,
              fixTotal: stats.total,
              fixStatsLoaded: true,
            }
          : game,
    );
  }
}

function isPortalFixMarker(comment: PortalComment): boolean {
  const content = comment.content.trim().toLowerCase();
  return (
    content === PORTAL_FIX_MARKER_FIXED.toLowerCase() ||
    content === PORTAL_FIX_MARKER_NOT_FIXED.toLowerCase()
  );
}

function isPortalFixedMarker(comment: PortalComment): boolean {
  return comment.content.trim().toLowerCase() === PORTAL_FIX_MARKER_FIXED.toLowerCase();
}

function getPortalFixStatusForRoot(
  comments: PortalComment[],
  rootId: string,
): "fixed" | "not-fixed" {
  const replies = comments.filter((comment) => comment.parentId === rootId);
  const latestMarker = replies
    .filter(isPortalFixMarker)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  if (latestMarker) {
    return isPortalFixedMarker(latestMarker) ? "fixed" : "not-fixed";
  }

  return replies.length > 0 ? "fixed" : "not-fixed";
}

function computePortalFixStats(comments: PortalComment[]): PortalFixStats {
  const rootIds = new Set<string>();

  for (const comment of comments) {
    if (!comment.parentId) {
      rootIds.add(comment.id);
    }
  }

  let fixed = 0;
  rootIds.forEach((rootId) => {
    if (getPortalFixStatusForRoot(comments, rootId) === "fixed") fixed += 1;
  });

  return {
    fixed,
    total: rootIds.size,
  };
}

function formatBetaTypeTag(value: string | undefined): string | null {
  if (!value || value === "unassigned") return null;
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function formatBetaReviewCountdown(
  betaReviewEndsAt: string | undefined,
  nowMs = Date.now(),
): { label: string; expired: boolean } {
  const endsAtMs = Date.parse(betaReviewEndsAt ?? "");
  if (!Number.isFinite(endsAtMs)) {
    return { label: "24h feedback", expired: false };
  }

  const remainingMs = endsAtMs - nowMs;
  if (remainingMs <= 0) {
    return { label: "Feedback due", expired: true };
  }

  const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) {
    return { label: `${minutes}m left`, expired: false };
  }

  return {
    label: `${hours}h${minutes > 0 ? ` ${minutes}m` : ""} left`,
    expired: false,
  };
}

function gameTabLabel(tabId: DashboardTabId, game: PortalGame): string {
  if (tabId === "drafts") return "Draft";
  if (tabId === "beta") return "Beta";
  if (tabId === "saved") return game.isLiked ? "Saved + liked" : "Saved";
  return game.isPublic ? "Published" : "Private";
}

function fixRequestCount(game: PortalGame): number {
  return Number(game.fixTotal ?? game.comments ?? 0);
}

function openFixCount(game: PortalGame): number {
  const total = fixRequestCount(game);
  const fixed = Number(game.fixesCompleted ?? 0);
  return Math.max(0, total - fixed);
}

function renderGameBadges(game: PortalGame, tabId: DashboardTabId): string {
  const badges: Array<{ label: string; tone?: "danger" }> = [
    { label: gameTabLabel(tabId, game) },
  ];
  const commentCount = tabId === "beta" ? openFixCount(game) : Number(game.comments ?? 0);
  const betaType = formatBetaTypeTag(game.betaTypeTag);
  if (betaType) badges.push({ label: betaType });
  if (commentCount > 0) {
    badges.push({
      label: `${formatNumber(commentCount)} ${commentCount === 1 ? "fix" : "fixes"} needed`,
      tone: "danger",
    });
  }
  if ((game.unreadCommentNotificationCount ?? 0) > 0) {
    badges.push({ label: `${formatNumber(game.unreadCommentNotificationCount)} unread` });
  }

  return `
    <div class="portal-game-badges">
      ${badges
        .map(
          (badge) =>
            `<span class="${badge.tone === "danger" ? "danger" : ""}">${escapeHtml(
              badge.label,
            )}</span>`,
        )
        .join("")}
    </div>
  `;
}

function betaActivityLabel(game: PortalGame): string {
  const testers = Number(game.testersCount ?? 0);
  const uniquePlayers = Number(game.uniquePlayers ?? 0);
  const plays = Number(game.plays ?? 0);

  if (testers > 0) return `${formatNumber(testers)} testers`;
  if (uniquePlayers > 0) return `${formatNumber(uniquePlayers)} players`;
  if (plays > 0) return `${formatNumber(plays)} plays`;
  return "";
}

function betaFixProgressLabel(game: PortalGame): string {
  const commentCount = Number(game.comments ?? 0);
  if (typeof game.fixTotal === "number" && typeof game.fixesCompleted === "number") {
    return `${formatNumber(game.fixesCompleted)}/${formatNumber(game.fixTotal)}`;
  }
  if (commentCount > 0) return "...";
  return "0/0";
}

function renderGameCard(game: PortalGame, tabId: DashboardTabId): string {
  const image = game.imageUrl
    ? `<img src="${escapeHtml(game.imageUrl)}" alt="" loading="lazy" />`
    : `<div class="portal-game-placeholder">${escapeHtml(game.title.slice(0, 2).toUpperCase())}</div>`;
  const updatedLabel = formatDate(game.updatedAt);
  const activityLabel = tabId === "beta" ? betaActivityLabel(game) : "";
  const betaCountdown =
    tabId === "beta" ? formatBetaReviewCountdown(game.betaReviewEndsAt) : null;
  const cardStatCount = tabId === "beta" ? 4 : 3;
  const commentDisplayCount = tabId === "beta" ? fixRequestCount(game) : Number(game.comments ?? 0);

  return `
    <button
      class="portal-game-card"
      type="button"
      data-portal-open-game
      data-game-id="${escapeHtml(game.id)}"
      data-tab-id="${escapeHtml(tabId)}"
    >
      <span class="portal-game-media">
        ${image}
        ${renderGameBadges(game, tabId)}
        ${
          betaCountdown
            ? `<span
                class="portal-beta-timer-badge${betaCountdown.expired ? " expired" : ""}"
                data-beta-review-ends-at="${escapeHtml(game.betaReviewEndsAt ?? "")}"
                aria-label="Beta review timer: ${escapeHtml(betaCountdown.label)}"
              >
                ${escapeHtml(betaCountdown.label)}
              </span>`
            : ""
        }
        <span class="portal-game-card-stats" style="--portal-card-stat-count: ${cardStatCount}">
          <span>Plays <strong>${formatNumber(game.plays)}</strong></span>
          <span>Likes <strong>${formatNumber(game.likes)}</strong></span>
          <span>Comments <strong>${formatNumber(commentDisplayCount)}</strong></span>
          ${
            tabId === "beta"
              ? `<span>Fixed <strong>${escapeHtml(betaFixProgressLabel(game))}</strong></span>`
              : ""
          }
        </span>
      </span>
      <span class="portal-game-body">
        <span class="portal-game-title-row">
          <span>${escapeHtml(game.title)}</span>
          <small>${escapeHtml(game.category ?? "Game")}</small>
        </span>
        <span class="portal-game-footer">
          Updated ${escapeHtml(updatedLabel)}
          ${
            activityLabel
              ? ` - ${escapeHtml(activityLabel)}`
              : ""
          }
        </span>
      </span>
    </button>
  `;
}

function renderTabControls(data: PortalDashboardData): string {
  return `
    <div class="portal-profile-tabs" role="tablist" aria-label="Profile sections">
      ${PORTAL_TABS.map((tab) => {
        const active = tab.id === portalActiveTab;
        const count = data.collections[tab.id].length;
        return `
          <button
            class="${active ? "active" : ""}"
            type="button"
            role="tab"
            aria-selected="${active ? "true" : "false"}"
            data-portal-tab="${tab.id}"
          >
            <span>${escapeHtml(tab.label)}</span>
            <strong>${formatNumber(count)}</strong>
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function renderGamesSection(data: PortalDashboardData): string {
  const tab = tabDefinition(portalActiveTab);
  const games = data.collections[portalActiveTab];
  const betaNote =
    portalActiveTab === "beta"
      ? `<p class="portal-beta-note"><strong>Note:</strong> After a fix is fixed, reply to the comment for that fix. This is important.</p>`
      : "";

  return `
    <section class="portal-panel portal-games-panel">
      <div class="portal-section-head">
        <div>
          <p class="section-kicker">${escapeHtml(tab.kicker)}</p>
          <h2>${escapeHtml(tab.label)}</h2>
        </div>
        <button class="portal-secondary-action portal-compact-action" type="button" data-portal-refresh>
          Refresh
        </button>
      </div>
      ${betaNote}
      ${renderTabControls(data)}
      ${
        games.length
          ? `<div class="portal-game-grid">${games.map((game) => renderGameCard(game, portalActiveTab)).join("")}</div>`
          : `<div class="portal-empty-state">
              <h3>${escapeHtml(tab.emptyTitle)}</h3>
              <p>${escapeHtml(tab.emptyBody)}</p>
              <a href="/developers/cli">Publish with CLI</a>
            </div>`
      }
    </section>
  `;
}

function commentAvatarMarkup(comment: PortalComment): string {
  if (comment.userImage) {
    return `<img class="portal-comment-avatar" src="${escapeHtml(comment.userImage)}" alt="" loading="lazy" />`;
  }

  return `
    <span class="portal-comment-avatar portal-comment-avatar-fallback" style="--avatar-color: ${safeAvatarColor(comment.userColor)}">
      ${escapeHtml(initialsFromName(comment.userName))}
    </span>
  `;
}

function renderCommentContent(content: string): string {
  return escapeHtml(content).replace(/\n/g, "<br>");
}

function renderComment(comment: PortalComment, comments: PortalComment[]): string {
  const rootId = comment.parentId ?? comment.id;
  const isBetaGame = portalOpenGame?.tabId === "beta";
  const isRootComment = !comment.parentId;
  const isFixed =
    isRootComment && getPortalFixStatusForRoot(comments, comment.id) === "fixed";
  const isBusy = portalCommentsState?.posting === true;
  const replyCount = comment.parentId
    ? 0
    : comments.filter((item) => item.parentId === comment.id).length;
  const replyLabel = comment.parentId
    ? `Reply to ${comment.replyToUsername ?? comment.userName}`
    : replyCount > 0
      ? `${formatNumber(replyCount)} replies`
      : "Reply";

  return `
    <article class="portal-comment${comment.parentId ? " portal-comment-reply" : ""}">
      ${commentAvatarMarkup(comment)}
      <div class="portal-comment-body">
        <header>
          <strong>${escapeHtml(comment.userName || "User")}</strong>
          <span>${escapeHtml(formatDate(comment.createdAt))}</span>
        </header>
        ${
          comment.replyToUsername && comment.parentId
            ? `<p class="portal-reply-context">Replying to ${escapeHtml(comment.replyToUsername)}</p>`
            : ""
        }
        <p>${renderCommentContent(comment.hidden ? "This comment is hidden." : comment.content)}</p>
        ${
          comment.imageUrl
            ? `<img class="portal-comment-image" src="${escapeHtml(comment.imageUrl)}" alt="" loading="lazy" />`
            : ""
        }
        <footer>
          <span>${formatNumber(comment.likes)} likes</span>
          <div class="portal-comment-actions">
            ${
              isBetaGame && isRootComment
                ? `<button
                    class="portal-fix-button${isFixed ? " fixed" : ""}"
                    type="button"
                    data-portal-fix-comment
                    data-comment-id="${escapeHtml(comment.id)}"
                    data-user-id="${escapeHtml(comment.userId)}"
                    data-username="${escapeHtml(comment.userName || "User")}"
                    data-fixed="${isFixed ? "true" : "false"}"
                    ${isBusy ? "disabled" : ""}
                  >
                    ${isFixed ? PORTAL_CHECK_ICON : ""}
                    <span>${isFixed ? "Fixed" : "Fix"}</span>
                  </button>`
                : ""
            }
            <button
              type="button"
              data-portal-reply-comment
              data-comment-id="${escapeHtml(comment.id)}"
              data-root-id="${escapeHtml(rootId)}"
              data-user-id="${escapeHtml(comment.userId)}"
              data-username="${escapeHtml(comment.userName || "User")}"
            >${escapeHtml(replyLabel)}</button>
          </div>
        </footer>
      </div>
    </article>
  `;
}

function renderCommentsList(state: PortalCommentsState): string {
  if (state.loading && state.comments.length === 0) {
    return `<div class="portal-comments-status">Loading comments.</div>`;
  }

  if (state.error && state.comments.length === 0) {
    return `<div class="portal-comments-status portal-comments-error">${escapeHtml(state.error)}</div>`;
  }

  if (state.comments.length === 0) {
    return `<div class="portal-comments-status">No comments yet. Start the thread from the dashboard.</div>`;
  }

  const rootComments = state.comments.filter((comment) => !comment.parentId);
  const repliesByRoot = new Map<string, PortalComment[]>();
  for (const comment of state.comments) {
    if (!comment.parentId) continue;
    const replies = repliesByRoot.get(comment.parentId) ?? [];
    replies.push(comment);
    repliesByRoot.set(comment.parentId, replies);
  }

  return `
    <div class="portal-comments-list">
      ${rootComments
        .map((comment) => {
          const replies = (repliesByRoot.get(comment.id) ?? []).sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          );
          return `${renderComment(comment, state.comments)}${replies
            .map((reply) => renderComment(reply, state.comments))
            .join("")}`;
        })
        .join("")}
    </div>
    ${
      state.hasMore
        ? `<button class="portal-secondary-action portal-load-more" type="button" data-portal-load-comments>
            ${state.loadingMore ? "Loading..." : "Load more comments"}
          </button>`
        : ""
    }
  `;
}

function renderCommentComposer(state: PortalCommentsState): string {
  const replyTarget = state.replyTarget;
  return `
    <div class="portal-comment-composer">
      ${
        replyTarget
          ? `<div class="portal-reply-target">
              <span>Replying to ${escapeHtml(replyTarget.userName)}</span>
              <button type="button" data-portal-cancel-reply>Cancel</button>
            </div>`
          : ""
      }
      <textarea
        rows="3"
        data-portal-comment-input
        placeholder="${replyTarget ? `Reply to ${escapeHtml(replyTarget.userName)}` : "Write a comment"}"
      ></textarea>
      <button class="portal-primary-action" type="button" data-portal-comment-submit>
        ${state.posting ? "Posting..." : replyTarget ? "Post reply" : "Post comment"}
      </button>
    </div>
  `;
}

function renderGameModal(data: PortalDashboardData): string {
  if (!portalOpenGame) return "";

  const game = findPortalGame(data, portalOpenGame.gameId, portalOpenGame.tabId);
  if (!game) return "";

  const commentsState =
    portalCommentsState?.gameId === game.id
      ? portalCommentsState
      : {
          gameId: game.id,
          comments: [],
          totalCount: Number(game.comments ?? 0),
          nextOffset: null,
          hasMore: false,
          loading: true,
          loadingMore: false,
          posting: false,
          error: null,
          replyTarget: null,
        };
  const playUrl = new URL(`/api/games/${encodeURIComponent(game.id)}/play`, window.location.origin);
  playUrl.searchParams.set("token", data.session.token);

  return `
    <div class="portal-game-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(game.title)}">
      <button class="portal-modal-backdrop" type="button" data-portal-close-game aria-label="Close game panel"></button>
      <section class="portal-game-modal-panel">
        <header class="portal-game-modal-head">
          <div>
            <p class="section-kicker">${escapeHtml(gameTabLabel(portalOpenGame.tabId, game))}</p>
            <h2>${escapeHtml(game.title)}</h2>
            <span>${escapeHtml(game.description || "No description yet.")}</span>
          </div>
          <button class="portal-icon-action" type="button" data-portal-close-game aria-label="Close game panel">Close</button>
        </header>
        <div class="portal-game-detail-layout">
          <div class="portal-game-play-panel">
            <iframe
              src="${escapeHtml(`${playUrl.pathname}${playUrl.search}`)}"
              sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms"
              allow="microphone; camera; accelerometer; gyroscope"
              referrerpolicy="no-referrer"
              title="${escapeHtml(game.title)}"
            ></iframe>
          </div>
          <aside class="portal-comments-panel" aria-label="Game comments">
            <div class="portal-comments-head">
              <div>
                <p class="section-kicker">Comments</p>
                <h3>${formatNumber(commentsState.totalCount)} comments</h3>
              </div>
              <button class="portal-secondary-action portal-compact-action" type="button" data-portal-reload-comments>
                Reload
              </button>
            </div>
            ${
              commentsState.error && commentsState.comments.length > 0
                ? `<p class="portal-inline-error">${escapeHtml(commentsState.error)}</p>`
                : ""
            }
            ${renderCommentsList(commentsState)}
            ${renderCommentComposer(commentsState)}
          </aside>
        </div>
      </section>
    </div>
  `;
}

function renderDashboard(data: PortalDashboardData): string {
  const { session, user, collections } = data;
  const uniqueGames = allDashboardGames(collections);
  const totalPlays = uniqueGames.reduce((sum, game) => sum + Number(game.plays ?? 0), 0);
  const totalComments = uniqueGames.reduce((sum, game) => sum + Number(game.comments ?? 0), 0);
  const displayName = user?.name || session.email || "Developer";

  return `
    <div class="portal-dashboard-head">
      <div>
        <p class="eyebrow">Developer portal</p>
        <h1>Dashboard</h1>
        <p class="lede">Signed in as ${escapeHtml(displayName)}.</p>
      </div>
      <button class="portal-secondary-action" type="button" data-portal-logout>
        Sign out
      </button>
    </div>

    <section class="portal-profile-panel" aria-label="Oasiz account">
      ${renderProfileAvatar(session, user)}
      <div>
        <p>Oasiz account</p>
        <h2>${escapeHtml(displayName)}</h2>
        <span>${escapeHtml(session.email ?? user?.email ?? "Connected developer")}</span>
      </div>
      <strong>${session.developer || user?.developer ? "Developer access" : "Portal session"}</strong>
    </section>

    <section class="portal-stat-grid" aria-label="Dashboard summary">
      <article><span>Drafts</span><strong>${formatNumber(collections.drafts.length)}</strong></article>
      <article><span>Public Games</span><strong>${formatNumber(collections.games.length)}</strong></article>
      <article><span>Beta</span><strong>${formatNumber(collections.beta.length)}</strong></article>
      <article><span>Saved</span><strong>${formatNumber(collections.saved.length)}</strong></article>
      <article><span>Total plays</span><strong>${formatNumber(totalPlays)}</strong></article>
      <article><span>Comments</span><strong>${formatNumber(totalComments)}</strong></article>
    </section>

    ${renderGamesSection(data)}
    ${renderGameModal(data)}
  `;
}

function renderPortalDashboardRoot(): void {
  const root = document.querySelector<HTMLElement>("#portal-dashboard-root");
  if (!root || !portalDashboardData) return;
  root.innerHTML = renderDashboard(portalDashboardData);
  refreshPortalBetaTimers();
}

function refreshPortalBetaTimers(): void {
  const timerBadges = document.querySelectorAll<HTMLElement>("[data-beta-review-ends-at]");
  const nowMs = Date.now();
  timerBadges.forEach((badge) => {
    const countdown = formatBetaReviewCountdown(badge.dataset.betaReviewEndsAt, nowMs);
    badge.textContent = countdown.label;
    badge.classList.toggle("expired", countdown.expired);
    badge.setAttribute("aria-label", `Beta review timer: ${countdown.label}`);
  });
}

function ensurePortalBetaTimerRefresh(): void {
  if (portalBetaTimerInterval !== null) return;
  portalBetaTimerInterval = window.setInterval(refreshPortalBetaTimers, 30_000);
}

async function portalApi<T>(
  path: string,
  session: PortalSession,
  init?: RequestInit,
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.token}`,
    Accept: "application/json",
  };
  if (init?.body) headers["Content-Type"] = "application/json";

  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers,
  });

  if (response.status === 401 || response.status === 403) {
    clearPortalSession();
  }

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

async function loadPortalFixStatsForGame(
  gameId: string,
  session: PortalSession,
): Promise<PortalFixStats> {
  const commentsById = new Map<string, PortalComment>();
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const page = await portalApi<PortalCommentsPage>(
      `/api/games/${encodeURIComponent(gameId)}/comments/page?offset=${offset}&limit=50`,
      session,
    );

    for (const comment of page.comments) {
      commentsById.set(comment.id, comment);
    }

    hasMore = page.hasMore && page.nextOffset !== null;
    offset = page.nextOffset ?? offset;
  }

  return computePortalFixStats([...commentsById.values()]);
}

async function addPortalBetaFixStats(
  games: PortalGame[],
  session: PortalSession,
): Promise<PortalGame[]> {
  const withStats = await Promise.all(
    games.map(async (game) => {
      const commentCount = Number(game.comments ?? 0);
      if (commentCount <= 0) {
        return {
          ...game,
          comments: 0,
          fixesCompleted: 0,
          fixTotal: 0,
          fixStatsLoaded: true,
        };
      }

      try {
        const stats = await loadPortalFixStatsForGame(game.id, session);
        return {
          ...game,
          comments: stats.total,
          fixesCompleted: stats.fixed,
          fixTotal: stats.total,
          fixStatsLoaded: true,
        };
      } catch {
        return {
          ...game,
          fixStatsLoaded: false,
        };
      }
    }),
  );

  return withStats;
}

async function refreshPortalBetaFixStatsForGame(
  gameId: string,
  session: PortalSession,
): Promise<void> {
  if (!portalDashboardData?.collections.beta.some((game) => game.id === gameId)) {
    return;
  }

  try {
    const stats = await loadPortalFixStatsForGame(gameId, session);
    updatePortalGameFixStats(gameId, stats);
    renderPortalDashboardRoot();
  } catch {
    return;
  }
}

async function loadPortalComments(append = false): Promise<void> {
  const session = readPortalSession();
  const currentState = portalCommentsState;
  const gameId = currentState?.gameId;
  if (!session || !currentState || !gameId) return;

  const offset = append ? (currentState.nextOffset ?? 0) : 0;
  portalCommentsState = {
    ...currentState,
    loading: !append,
    loadingMore: append,
    error: null,
  };
  renderPortalDashboardRoot();

  try {
    const page = await portalApi<PortalCommentsPage>(
      `/api/games/${encodeURIComponent(gameId)}/comments/page?offset=${offset}&limit=20`,
      session,
    );
    if (portalCommentsState?.gameId !== gameId) return;

    const comments = append
      ? [
          ...portalCommentsState.comments,
          ...page.comments.filter(
            (comment) =>
              !portalCommentsState?.comments.some((existing) => existing.id === comment.id),
          ),
        ]
      : page.comments;

    portalCommentsState = {
      ...portalCommentsState,
      comments,
      totalCount: page.totalCount,
      nextOffset: page.nextOffset,
      hasMore: page.hasMore,
      loading: false,
      loadingMore: false,
      error: null,
    };
    updatePortalGameCommentCount(gameId, page.totalCount);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load comments.";
    if (portalCommentsState?.gameId === gameId) {
      portalCommentsState = {
        ...portalCommentsState,
        loading: false,
        loadingMore: false,
        error: message,
      };
    }
  }

  renderPortalDashboardRoot();
}

async function submitPortalComment(): Promise<void> {
  const session = readPortalSession();
  const state = portalCommentsState;
  const input = document.querySelector<HTMLTextAreaElement>("[data-portal-comment-input]");
  const content = input?.value.trim() ?? "";
  if (!session || !state || !content || state.posting) return;

  portalCommentsState = { ...state, posting: true, error: null };
  renderPortalDashboardRoot();

  try {
    const replyTarget = state.replyTarget;
    await portalApi<PortalPostCommentResponse>(
      `/api/games/${encodeURIComponent(state.gameId)}/comments`,
      session,
      {
        method: "POST",
        body: JSON.stringify({
          content,
          parentId: replyTarget?.rootId,
          replyToUserId: replyTarget?.userId,
          replyToUsername: replyTarget?.userName,
          replyToCommentId:
            replyTarget && replyTarget.id !== replyTarget.rootId ? replyTarget.id : undefined,
        }),
      },
    );
    if (portalCommentsState?.gameId === state.gameId) {
      portalCommentsState = {
        ...portalCommentsState,
        posting: false,
        replyTarget: null,
      };
    }
    await loadPortalComments(false);
    if (portalOpenGame?.tabId === "beta") {
      await refreshPortalBetaFixStatsForGame(state.gameId, session);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to post comment.";
    if (portalCommentsState?.gameId === state.gameId) {
      portalCommentsState = {
        ...portalCommentsState,
        posting: false,
        error: message,
      };
    }
    renderPortalDashboardRoot();
  }
}

async function togglePortalCommentFix(params: {
  commentId: string;
  userId: string;
  userName: string;
  fixed: boolean;
}): Promise<void> {
  const session = readPortalSession();
  const state = portalCommentsState;
  if (!session || !state || state.posting) return;
  const nextContent = params.fixed
    ? PORTAL_FIX_MARKER_NOT_FIXED
    : PORTAL_FIX_MARKER_FIXED;

  portalCommentsState = { ...state, posting: true, error: null };
  renderPortalDashboardRoot();

  try {
    await portalApi<PortalPostCommentResponse>(
      `/api/games/${encodeURIComponent(state.gameId)}/comments`,
      session,
      {
        method: "POST",
        body: JSON.stringify({
          content: nextContent,
          parentId: params.commentId,
          replyToUserId: params.userId,
          replyToUsername: params.userName,
        }),
      },
    );

    if (portalCommentsState?.gameId === state.gameId) {
      portalCommentsState = {
        ...portalCommentsState,
        posting: false,
        replyTarget: null,
      };
    }
    await loadPortalComments(false);
    await refreshPortalBetaFixStatsForGame(state.gameId, session);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update fix status.";
    if (portalCommentsState?.gameId === state.gameId) {
      portalCommentsState = {
        ...portalCommentsState,
        posting: false,
        error: message,
      };
    }
    renderPortalDashboardRoot();
  }
}

async function loadPortalDashboard(): Promise<void> {
  const root = document.querySelector<HTMLElement>("#portal-dashboard-root");
  const session = readPortalSession();
  if (!root || !session) return;

  try {
    const [drafts, publicGames, betaResponse, saved, user] = await Promise.all([
      portalApi<PortalGame[]>(
        "/api/games/mine?visibility=private&includeVersions=true&limit=100",
        session,
      ),
      portalApi<PortalGame[]>(
        "/api/games/mine?visibility=public&includeVersions=true&limit=100",
        session,
      ),
      portalApi<PortalBetaGamesResponse>(
        "/api/beta/games",
        session,
      ),
      portalApi<PortalGame[]>(
        "/api/games/saved?offset=0&limit=100",
        session,
      ),
      session.userId
        ? portalApi<PortalUser>(`/api/users/${encodeURIComponent(session.userId)}`, session)
        : Promise.resolve(null),
    ]);

    const betaGames = await addPortalBetaFixStats(
      sortGamesByUpdatedAtDesc(betaResponse.games.map(normalizePortalGame)),
      session,
    );

    const collections: PortalDashboardCollections = {
      drafts: drafts.map(normalizePortalGame),
      games: publicGames
        .filter((game) => game.isReviewed === true)
        .map(normalizePortalGame),
      beta: betaGames,
      saved: saved.map(normalizePortalGame),
    };

    portalDashboardData = { session, user, collections };
    portalOpenGame = null;
    portalCommentsState = null;
    root.innerHTML = renderDashboard(portalDashboardData);
    refreshPortalBetaTimers();
    ensurePortalBetaTimerRefresh();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load developer dashboard.";
    portalDashboardData = null;
    root.innerHTML = `
      <div class="portal-dashboard-loading">
        <p class="eyebrow">Developer portal</p>
        <h1>Dashboard unavailable</h1>
        <p class="lede">${escapeHtml(message)}</p>
        <div class="portal-actions">
          <button class="portal-primary-action" type="button" data-portal-login>
            Sign in again
          </button>
          <a class="portal-secondary-action" href="/developers/cli">CLI docs</a>
        </div>
      </div>
    `;
  }
}

export function renderPortal(app: HTMLDivElement, logoUrl: string): void {
  const normalized = normalizePath(window.location.pathname);
  const body =
    normalized === "/developers/auth/start"
      ? renderPortalAuthTransfer("Opening Sign In", "Preparing Oasiz sign in.")
      : normalized === "/developers/auth/token"
        ? renderPortalAuthTransfer("Completing Login", "Connecting your developer account.")
        : normalized === "/developers/auth/callback"
      ? renderPortalCallback()
      : normalized === "/developers/dashboard"
        ? renderPortalDashboardShell(readPortalSession())
        : renderPortalLogin();

  app.innerHTML = portalShellMarkup(logoUrl, body);

  if (normalized === "/developers/auth/start") {
    void startPortalSocialAuth();
  }
  if (normalized === "/developers/auth/token") {
    void completePortalSocialAuth();
  }
  if (document.querySelector("#portal-dashboard-root") && readPortalSession()) {
    void loadPortalDashboard();
  }
}

export function handlePortalClick(target: Element, rerender: () => void): boolean {
  const loginButton = target.closest<HTMLElement>("[data-portal-login]");
  if (loginButton) {
    const provider = portalAuthProvider(loginButton.dataset.portalLogin) ?? "google";
    window.location.assign(createPortalLoginUrl(provider));
    return true;
  }

  const logoutButton = target.closest<HTMLElement>("[data-portal-logout]");
  if (logoutButton) {
    clearPortalSession();
    portalDashboardData = null;
    portalOpenGame = null;
    portalCommentsState = null;
    window.history.pushState({}, "", "/developers/portal");
    rerender();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return true;
  }

  const refreshButton = target.closest<HTMLElement>("[data-portal-refresh]");
  if (refreshButton) {
    const root = document.querySelector<HTMLElement>("#portal-dashboard-root");
    if (root) {
      root.innerHTML = `
        <div class="portal-dashboard-loading">
          <p class="eyebrow">Developer portal</p>
          <h1>Dashboard</h1>
          <p class="lede">Refreshing your Oasiz profile data.</p>
        </div>
      `;
    }
    void loadPortalDashboard();
    return true;
  }

  const tabButton = target.closest<HTMLElement>("[data-portal-tab]");
  if (tabButton && isDashboardTabId(tabButton.dataset.portalTab)) {
    portalActiveTab = tabButton.dataset.portalTab;
    portalOpenGame = null;
    portalCommentsState = null;
    renderPortalDashboardRoot();
    return true;
  }

  const openGameButton = target.closest<HTMLElement>("[data-portal-open-game]");
  if (openGameButton && portalDashboardData) {
    const gameId = openGameButton.dataset.gameId;
    const tabId = openGameButton.dataset.tabId;
    if (!gameId || !isDashboardTabId(tabId)) return true;
    const game = findPortalGame(portalDashboardData, gameId, tabId);
    if (!game) return true;

    portalOpenGame = { gameId, tabId };
    portalCommentsState = {
      gameId,
      comments: [],
      totalCount: Number(game.comments ?? 0),
      nextOffset: null,
      hasMore: false,
      loading: true,
      loadingMore: false,
      posting: false,
      error: null,
      replyTarget: null,
    };
    renderPortalDashboardRoot();
    void loadPortalComments(false);
    return true;
  }

  const closeGameButton = target.closest<HTMLElement>("[data-portal-close-game]");
  if (closeGameButton) {
    portalOpenGame = null;
    portalCommentsState = null;
    renderPortalDashboardRoot();
    return true;
  }

  const reloadCommentsButton = target.closest<HTMLElement>("[data-portal-reload-comments]");
  if (reloadCommentsButton) {
    void loadPortalComments(false);
    return true;
  }

  const loadCommentsButton = target.closest<HTMLElement>("[data-portal-load-comments]");
  if (loadCommentsButton) {
    void loadPortalComments(true);
    return true;
  }

  const fixButton = target.closest<HTMLElement>("[data-portal-fix-comment]");
  if (fixButton) {
    const commentId = fixButton.dataset.commentId;
    const userId = fixButton.dataset.userId;
    const userName = fixButton.dataset.username;
    if (!commentId || !userId || !userName) return true;
    void togglePortalCommentFix({
      commentId,
      userId,
      userName,
      fixed: fixButton.dataset.fixed === "true",
    });
    return true;
  }

  const replyButton = target.closest<HTMLElement>("[data-portal-reply-comment]");
  if (replyButton && portalCommentsState) {
    const commentId = replyButton.dataset.commentId;
    const rootId = replyButton.dataset.rootId;
    const userId = replyButton.dataset.userId;
    const userName = replyButton.dataset.username;
    if (!commentId || !rootId || !userId || !userName) return true;
    portalCommentsState = {
      ...portalCommentsState,
      replyTarget: {
        id: commentId,
        rootId,
        userId,
        userName,
      },
    };
    renderPortalDashboardRoot();
    window.setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>("[data-portal-comment-input]")?.focus();
    }, 0);
    return true;
  }

  const cancelReplyButton = target.closest<HTMLElement>("[data-portal-cancel-reply]");
  if (cancelReplyButton && portalCommentsState) {
    portalCommentsState = { ...portalCommentsState, replyTarget: null };
    renderPortalDashboardRoot();
    return true;
  }

  const submitCommentButton = target.closest<HTMLElement>("[data-portal-comment-submit]");
  if (submitCommentButton) {
    void submitPortalComment();
    return true;
  }

  return false;
}
