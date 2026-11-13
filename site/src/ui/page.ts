import { loadDisplayFace } from "./display-font";
import { loadInstallAssets } from "./install";
import { type Message, messages, PRIVACY_URL, REPOSITORY_URL } from "./messages";

export function paragraph(className: string, value: string): HTMLElement {
  const element = document.createElement("p");
  element.className = className;
  element.textContent = value;
  return element;
}

const MARK_PATH =
  "M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z";

function repositoryLink(): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = "page-nav-repository";
  link.href = REPOSITORY_URL;
  link.setAttribute("aria-label", messages.nav.github);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "1em");
  svg.setAttribute("height", "1em");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", MARK_PATH);
  svg.append(path);
  const text = document.createElement("span");
  text.textContent = messages.nav.github;
  link.append(svg, text);
  return link;
}

export function navElement(): HTMLElement {
  const nav = document.createElement("nav");
  nav.className = "page-nav";
  nav.setAttribute("aria-label", messages.nav.label);
  for (const [href, label] of [
    ["#/", messages.nav.today],
    ["#/archive", messages.nav.archive],
    ["#/live", messages.nav.live],
    ["#/how", messages.nav.how],
    ["#/data", messages.nav.data],
  ] as const) {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = label;
    if (href === (location.hash || "#/")) link.setAttribute("aria-current", "page");
    nav.append(link);
  }
  nav.append(repositoryLink());
  return nav;
}

export function footerElement(): HTMLElement {
  const footer = document.createElement("footer");
  footer.className = "page-footer";
  const link = document.createElement("a");
  link.href = PRIVACY_URL;
  link.textContent = messages.nav.privacy;
  footer.append(link);
  return footer;
}

export function messagePanel(copy: Message): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "page-message";
  panel.append(paragraph("page-message-text", copy.what));
  if (copy.kind === "error") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "key-button";
    button.textContent = copy.action.label;
    button.addEventListener("click", () => void copy.action.run());
    panel.append(button);
  }
  return panel;
}

export function mountPage(app: HTMLElement, label: string): HTMLElement {
  loadDisplayFace();
  loadInstallAssets();
  app.className = "match-card";
  app.setAttribute("aria-label", label);
  app.replaceChildren();
  const header = document.createElement("header");
  header.className = "masthead page-masthead";
  const wordmark = document.createElement("h1");
  wordmark.className = "wordmark";
  wordmark.textContent = "Forecastle";
  const title = document.createElement("p");
  title.className = "page-title";
  title.textContent = label;
  header.append(wordmark, navElement(), title);
  const content = document.createElement("div");
  content.className = "page";
  app.append(header, content, footerElement());
  return content;
}

export function pageLoading(content: HTMLElement, what: string): void {
  content.setAttribute("aria-busy", "true");
  const status = paragraph("page-loading", what);
  status.setAttribute("role", "status");
  content.replaceChildren(status);
}

export function pageFailed(content: HTMLElement): void {
  content.removeAttribute("aria-busy");
  content.replaceChildren(
    messagePanel(
      messages.pageFailed(async () => {
        // WebKit can retain a failed module across reloads; refresh its declared preload first.
        const urls = Array.from(
          document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]'),
          (link) => link.href,
        ).filter((url) => new URL(url).origin === location.origin);
        await Promise.allSettled(
          urls.map(async (url) => {
            const response = await fetch(url, { cache: "reload" });
            await response.arrayBuffer();
          }),
        );
        location.reload();
      }),
    ),
  );
}
