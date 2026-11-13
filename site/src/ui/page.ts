import { loadDisplayFace } from "./display-font";
import { loadInstallAssets } from "./install";
import { type Message, messages, PRIVACY_URL } from "./messages";

export function paragraph(className: string, value: string): HTMLElement {
  const element = document.createElement("p");
  element.className = className;
  element.textContent = value;
  return element;
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
