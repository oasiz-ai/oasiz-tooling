import "./styles.css";
import {
  docGroups,
  normalizePath,
  pageForPath,
  pages,
  type CommandRow,
  type DocPage,
  type DocSection,
  type LinkCard,
  type NpmPackage,
  type SkillListing,
} from "./content";
import { handlePortalClick, isPortalPath, renderPortal } from "./portal";

const app = document.querySelector<HTMLDivElement>("#app");
const LOGO_URL = "https://oasiz.ai/logo-transparent.webp";
const COPY_ICON = `
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <rect x="9" y="9" width="10" height="10" rx="2"></rect>
    <path d="M5 15V7a2 2 0 0 1 2-2h8"></path>
  </svg>
`;
const CHECK_ICON = `
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <path d="M20 6 9 17l-5-5"></path>
  </svg>
`;
const ERROR_ICON = `
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <path d="M12 7v6"></path>
    <path d="M12 17h.01"></path>
  </svg>
`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function copyValue(value: string): string {
  return encodeURIComponent(value);
}

function copyButtonMarkup(value: string, label: string): string {
  return `
    <button
      class="copy-button"
      type="button"
      data-copy="${copyValue(value)}"
      data-label="${escapeHtml(label)}"
      aria-label="${escapeHtml(label)}"
      title="${escapeHtml(label)}"
    >${COPY_ICON}</button>
  `;
}

function pageByPath(path: string): DocPage | undefined {
  const normalized = normalizePath(path);
  return pages.find((page) => normalizePath(page.path) === normalized);
}

function isActivePath(page: DocPage, activePage: DocPage): boolean {
  return normalizePath(page.path) === normalizePath(activePage.path);
}

function navMarkup(activePage: DocPage): string {
  return docGroups
    .map((group) => {
      const links = group.pages
        .map((path) => pageByPath(path))
        .filter((page): page is DocPage => Boolean(page))
        .map((page) => {
          const active = isActivePath(page, activePage);
          return `
            <a class="side-link${active ? " side-link-active" : ""}" href="${escapeHtml(
              page.path,
            )}">
              <span>${escapeHtml(page.navTitle)}</span>
            </a>
          `;
        })
        .join("");

      return `
        <div class="side-group">
          <p>${escapeHtml(group.title)}</p>
          ${links}
        </div>
      `;
    })
    .join("");
}

function heroItemsMarkup(page: DocPage): string {
  if (!page.heroItems?.length) return "";
  return `
    <ul class="hero-list">
      ${page.heroItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>
  `;
}

function codeMarkup(code?: string, compact = false): string {
  if (!code) return "";
  return `
    <div class="code-frame${compact ? " code-frame-compact" : ""}">
      <div class="code-header">
        <div class="code-dots" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
        ${copyButtonMarkup(code, "Copy code example")}
      </div>
      <pre><code>${escapeHtml(code)}</code></pre>
    </div>
  `;
}

function cardsMarkup(cards?: LinkCard[]): string {
  if (!cards?.length) return "";
  return `
    <div class="card-grid">
      ${cards
        .map(
          (card) => `
            <a class="doc-card" href="${escapeHtml(card.href)}">
              <strong>${escapeHtml(card.title)}</strong>
              <span>${escapeHtml(card.body)}</span>
              ${
                card.label
                  ? `<em>${escapeHtml(card.label)}</em>`
                  : ""
              }
            </a>
          `,
        )
        .join("")}
    </div>
  `;
}

function npmPackageMarkup(npmPackage?: NpmPackage): string {
  if (!npmPackage) return "";
  return `
    <aside class="package-panel" aria-label="npm package">
      <div>
        <span>npm package</span>
        <code>${escapeHtml(npmPackage.name)}</code>
      </div>
      <div>
        <span>${escapeHtml(npmPackage.tag)}</span>
        <strong>${escapeHtml(npmPackage.version)}</strong>
      </div>
      <nav aria-label="${escapeHtml(npmPackage.name)} npm links">
        <a href="${escapeHtml(npmPackage.npmHref)}" rel="noreferrer">View on npm</a>
        <a href="${escapeHtml(npmPackage.versionsHref)}" rel="noreferrer">Versions</a>
      </nav>
    </aside>
  `;
}

function npmPackagesMarkup(packages?: NpmPackage[]): string {
  if (!packages?.length) return "";
  return `
    <div class="package-grid">
      ${packages.map((npmPackage) => npmPackageMarkup(npmPackage)).join("")}
    </div>
  `;
}

function skillListingsMarkup(skills?: SkillListing[]): string {
  if (!skills?.length) return "";
  return `
    <div class="skill-list">
      ${skills
        .map(
          (skill) => `
            <article class="skill-panel">
              <div class="skill-panel-head">
                <div>
                  <p>Agent Skill</p>
                  <h3>${escapeHtml(skill.title)}</h3>
                </div>
                <code>${escapeHtml(skill.name)}</code>
              </div>
              <p>${escapeHtml(skill.description)}</p>
              ${
                skill.habits?.length
                  ? `<div class="skill-habits">
                      <h4>Habits</h4>
                      <ul>
                        ${skill.habits
                          .map((habit) => `<li>${escapeHtml(habit)}</li>`)
                          .join("")}
                      </ul>
                    </div>`
                  : ""
              }
              <dl class="skill-meta">
                <div>
                  <dt>Version</dt>
                  <dd>${escapeHtml(skill.version)}</dd>
                </div>
                <div>
                  <dt>Requires</dt>
                  <dd>${escapeHtml(skill.requires)}</dd>
                </div>
              </dl>
              <div class="skill-actions">
                <a href="${escapeHtml(skill.downloadHref)}" download="${escapeHtml(
                  `${skill.name}.zip`,
                )}">Download ZIP</a>
                <a href="${escapeHtml(skill.inspectHref)}">Inspect SKILL.md</a>
                <a href="${escapeHtml(skill.sourceHref)}" rel="noreferrer">Source</a>
              </div>
              <div class="command-example skill-install">
                <pre><code>${escapeHtml(skill.installCode)}</code></pre>
                ${copyButtonMarkup(skill.installCode, "Copy install command")}
              </div>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function commandMarkup(commands?: CommandRow[]): string {
  if (!commands?.length) return "";
  return `
    <div class="command-list">
      ${commands
        .map(
          (command) => `
            <div class="command-row">
              <div class="command-info">
                ${
                  command.title
                    ? `<strong class="command-title">${escapeHtml(command.title)}</strong>`
                    : ""
                }
                <code class="command-name">${escapeHtml(command.name)}</code>
                <p>${escapeHtml(command.description)}</p>
              </div>
              ${
                command.example
                  ? `
                    <div class="command-example">
                      <pre><code>${escapeHtml(command.example)}</code></pre>
                      ${copyButtonMarkup(command.example, "Copy command example")}
                    </div>
                  `
                  : ""
              }
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function listMarkup(items?: string[]): string {
  if (!items?.length) return "";
  return `
    <ul class="check-list">
      ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>
  `;
}

function sectionMarkup(section: DocSection): string {
  return `
    <section class="doc-section" id="${escapeHtml(section.id)}">
      ${section.kicker ? `<p class="section-kicker">${escapeHtml(section.kicker)}</p>` : ""}
      <h2>${escapeHtml(section.title)}</h2>
      <p>${escapeHtml(section.body)}</p>
      ${listMarkup(section.items)}
      ${cardsMarkup(section.cards)}
      ${skillListingsMarkup(section.skills)}
      ${npmPackagesMarkup(section.packages)}
      ${commandMarkup(section.commands)}
      ${codeMarkup(section.code)}
      ${section.note ? `<p class="note">${escapeHtml(section.note)}</p>` : ""}
    </section>
  `;
}

function tocMarkup(page: DocPage): string {
  return `
    <aside class="toc" aria-label="On this page">
      <p>On this page</p>
      ${page.sections
        .map(
          (section) => `
            <a href="#${escapeHtml(section.id)}">${escapeHtml(section.title)}</a>
          `,
        )
        .join("")}
    </aside>
  `;
}

function topNavMarkup(activePage: DocPage): string {
  const links = [
    pages[0],
    pageByPath("/developers/ai"),
    pageByPath("/developers/cli"),
    pageByPath("/developers/sdk"),
    pageByPath("/developers/reference"),
  ].filter((page): page is DocPage => Boolean(page));

  return links
    .map(
      (page) => `
        <a class="${isActivePath(page, activePage) ? "active" : ""}" href="${escapeHtml(
          page.path,
        )}">${escapeHtml(page.navTitle)}</a>
      `,
    )
    .join("") + `<a href="/developers/portal">Portal</a>`;
}

function render() {
  if (!app) return;
  if (isPortalPath(window.location.pathname)) {
    renderPortal(app, LOGO_URL);
    return;
  }

  const page = pageForPath(window.location.pathname);
  document.title =
    normalizePath(page.path) === "/developers/"
      ? "Oasiz Developers"
      : `${page.title} - Oasiz Developers`;

  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <a class="brand" href="/developers/">
          <img src="${LOGO_URL}" alt="Oasiz logo" />
          <span>OASIZ</span>
          <small>Developers</small>
        </a>
        <nav class="topnav" aria-label="Primary">
          ${topNavMarkup(page)}
          <a href="https://oasiz.ai" rel="noreferrer" target="_blank">Open app</a>
        </nav>
      </header>

      <main class="layout">
        <aside class="sidebar" aria-label="Developer docs">
          ${navMarkup(page)}
        </aside>

        <article class="content">
          <section class="hero">
            <div class="hero-copy">
              <p class="eyebrow">${escapeHtml(page.eyebrow)}</p>
              <h1>${escapeHtml(page.title)}</h1>
              <p class="lede">${escapeHtml(page.description)}</p>
              ${heroItemsMarkup(page)}
              ${npmPackageMarkup(page.npmPackage)}
            </div>
            ${codeMarkup(page.heroCode, true)}
          </section>

          <div class="section-stack">
            ${page.sections.map(sectionMarkup).join("")}
          </div>
        </article>

        ${tocMarkup(page)}
      </main>
    </div>
  `;
}

async function copyToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall back for embedded browsers that expose Clipboard but deny writes.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Copy command failed");
}

function setCopyButtonState(
  button: HTMLButtonElement,
  state: "idle" | "copied" | "failed",
) {
  if (state === "copied") {
    button.innerHTML = CHECK_ICON;
    button.dataset.copied = "true";
    button.setAttribute("aria-label", "Copied");
    button.setAttribute("title", "Copied");
    return;
  }

  if (state === "failed") {
    button.innerHTML = ERROR_ICON;
    button.dataset.failed = "true";
    button.setAttribute("aria-label", "Copy failed");
    button.setAttribute("title", "Copy failed");
    return;
  }

  button.innerHTML = COPY_ICON;
  delete button.dataset.copied;
  delete button.dataset.failed;
  const label = button.dataset.label ?? "Copy";
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
}

window.addEventListener("popstate", render);
document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const copyButton = target.closest<HTMLButtonElement>(".copy-button");
  if (copyButton) {
    const value = copyButton.dataset.copy;
    if (!value) return;

    void copyToClipboard(decodeURIComponent(value))
      .then(() => {
        setCopyButtonState(copyButton, "copied");
        window.setTimeout(() => {
          setCopyButtonState(copyButton, "idle");
        }, 1300);
      })
      .catch(() => {
        setCopyButtonState(copyButton, "failed");
        window.setTimeout(() => {
          setCopyButtonState(copyButton, "idle");
        }, 1300);
      });
    return;
  }

  if (handlePortalClick(target, render)) {
    return;
  }

  const link = target.closest<HTMLAnchorElement>("a[href]");
  if (!link) return;
  if (link.hasAttribute("download")) return;

  const url = new URL(link.href);
  if (url.origin !== window.location.origin) return;
  if (!url.pathname.startsWith("/developers")) return;
  if (url.pathname.includes(".")) return;
  if (url.pathname === window.location.pathname && url.hash) return;

  event.preventDefault();
  window.history.pushState({}, "", url);
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

render();
