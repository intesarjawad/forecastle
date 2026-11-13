import "./styles.css";
import { localDateForInstant } from "./core/dates";
import {
  createInitialTransport,
  createPuzzleLoader,
  type InitialPuzzleRequest,
  type PuzzleLoad,
} from "./io/puzzles";
import { createLiveEntryStore, createPlayStore, dailyHistory } from "./io/storage";
import { loadArchivePuzzle, parseRoute, renderArchive, renderOtherLiveRounds } from "./ui/archive";
import { type CustomMatch, mountPuzzle } from "./ui/daily";
import { type MatchShell, mountMatchShell } from "./ui/lesson";
import { messages } from "./ui/messages";
import { messagePanel, mountPage, pageFailed, pageLoading, paragraph } from "./ui/page";

declare global {
  interface Window {
    forecastleInitialPuzzle?: InitialPuzzleRequest;
  }
}

const fetchPublished = createInitialTransport(
  window.forecastleInitialPuzzle,
  (url) => fetch(url),
  location.href,
);
delete window.forecastleInitialPuzzle;

const appElement = document.querySelector<HTMLElement>("#app");
if (!appElement) {
  throw new Error("The site requires a main element with id app.");
}
const app: HTMLElement = appElement;

const store = createPlayStore(() => localStorage);
const stored = store.read();
const history = { plays: stored.plays };
let storageWarned = false;
const liveEntries = createLiveEntryStore(() => localStorage);

const submissionDependencies = {
  fetch: (url: string, init: RequestInit) => fetch(url, init),
  storage: {
    getItem: (key: string) => localStorage.getItem(key),
    setItem: (key: string, value: string) => localStorage.setItem(key, value),
  },
  crypto: globalThis.crypto,
  random: Math.random,
};

let shell: MatchShell | null = null;

function warnStorageBlocked(): void {
  if (storageWarned) return;
  storageWarned = true;
  const notice = document.createElement("div");
  notice.className = "storage-notice";
  const message = document.createElement("p");
  message.setAttribute("role", "status");
  const copy = messages.storageBlocked(() => notice.remove());
  message.textContent = copy.what;
  const proceed = document.createElement("button");
  proceed.type = "button";
  proceed.className = "key-button";
  proceed.textContent = copy.action.label;
  proceed.addEventListener("click", () => void copy.action.run());
  notice.append(message, proceed);
  document.querySelector(".masthead")?.after(notice);
}

let disposePuzzle = () => {};

function showPuzzle(state: PuzzleLoad, custom?: CustomMatch): void {
  disposePuzzle();
  disposePuzzle = () => {};
  if (!shell) return;
  disposePuzzle = mountPuzzle(
    shell,
    state,
    { history, store, warnStorageBlocked, submissionDependencies, showPuzzle },
    custom,
  );
}

async function renderDataRoute(version: number): Promise<void> {
  const content = mountPage(app, messages.data.title);
  pageLoading(content, "Loading your data…");
  try {
    const { renderData } = await import("./ui/data");
    if (version !== routeVersion) return;
    content.removeAttribute("aria-busy");
    renderData(content, {
      plays: history.plays,
      entries: liveEntries.read(),
      openStorage: () => localStorage,
      save: (play) => store.save(play),
      saveEntry: (entry) => liveEntries.save(entry),
      onRestore: (restored) => {
        history.plays = [...restored];
      },
      now: Date.now,
    });
  } catch {
    if (version === routeVersion) pageFailed(content);
  }
}

let todayShown: string | undefined;
let routeVersion = 0;
let disposePage: () => void = () => {};

function renderRoute(): void {
  routeVersion += 1;
  const version = routeVersion;
  disposePage();
  disposePage = () => {};
  disposePuzzle();
  disposePuzzle = () => {};
  shell = null;
  if (location.hash === "#/data") {
    void renderDataRoute(version);
    return;
  }
  if (location.hash.startsWith("#/c/")) {
    const content = mountPage(app, messages.custom.title);
    app.querySelector(".page-title")?.classList.add("custom-title");
    pageLoading(content, "Loading puzzle…");
    void import("./ui/custom-route")
      .then(({ renderCustom }) => {
        if (version !== routeVersion) return;
        renderCustom(app, location.hash.slice(4), (current, state, custom) => {
          shell = current;
          storageWarned = false;
          if (stored.blocked) warnStorageBlocked();
          showPuzzle(state, custom);
        });
      })
      .catch(() => {
        if (version === routeVersion) pageFailed(content);
      });
    return;
  }
  const route = parseRoute(location.hash);
  switch (route.kind) {
    case "today": {
      const now = new Date();
      todayShown = localDateForInstant(now.getTime(), now.getTimezoneOffset());
      shell = mountMatchShell(app);
      storageWarned = false;
      if (stored.blocked) warnStorageBlocked();
      void createPuzzleLoader(fetchPublished)
        .loadToday(now.getTime(), now.getTimezoneOffset(), (state) => {
          if (version === routeVersion) showPuzzle(state);
        })
        .then((state) => {
          if (version === routeVersion) showPuzzle(state);
        });
      break;
    }
    case "puzzle": {
      shell = mountMatchShell(app);
      storageWarned = false;
      if (stored.blocked) warnStorageBlocked();
      void loadArchivePuzzle(route.id, fetchPublished).then(
        (puzzle) => {
          if (version === routeVersion) showPuzzle({ kind: "ready", puzzle });
        },
        () => {
          if (version !== routeVersion) return;
          const content = mountPage(app, messages.archive.title);
          content.append(
            messagePanel(
              messages.archive.missing(() => {
                location.hash = "#/archive";
              }),
            ),
          );
        },
      );
      break;
    }
    case "archive": {
      const content = mountPage(app, messages.archive.title);
      pageLoading(content, "Loading archive…");
      void createPuzzleLoader(fetchPublished)
        .loadIndex("archive")
        .then((index) => {
          if (version === routeVersion) {
            content.removeAttribute("aria-busy");
            renderArchive(content, index);
          }
        })
        .catch(() => {
          if (version === routeVersion) {
            content.removeAttribute("aria-busy");
            content.replaceChildren(messagePanel(messages.archive.failed(renderRoute)));
          }
        });
      break;
    }
    case "live": {
      const content = mountPage(app, messages.live.title);
      pageLoading(content, "Loading live rounds…");
      void createPuzzleLoader(fetchPublished)
        .loadIndex("archive")
        .then(async (index) => {
          const modules = await Promise.all([
            import("./ui/live"),
            import("./io/submissions"),
          ]).catch(() => null);
          if (version !== routeVersion) return;
          if (!modules) {
            pageFailed(content);
            return;
          }
          const [{ renderLive }, { createSubmission }] = modules;
          content.removeAttribute("aria-busy");
          content.replaceChildren();
          const entry =
            route.id === undefined
              ? index.live.at(-1)
              : index.live.find((round) => round.id === route.id);
          if (!entry) {
            content.append(
              route.id === undefined
                ? messagePanel({ kind: "notice", what: messages.live.empty })
                : messagePanel(
                    messages.live.missing(() => {
                      location.hash = "#/live";
                    }),
                  ),
            );
            return;
          }
          disposePage = renderLive(content, {
            entry,
            transport: (url) => fetch(url),
            baseUrl: import.meta.env.BASE_URL,
            now: Date.now,
            entries: liveEntries,
            send: (puzzleId, forecast, onResult) => {
              const submission = createSubmission(
                {
                  puzzleId,
                  kind: "live",
                  utcDate: new Date().toISOString().slice(0, 10),
                  saveStats: () => {},
                  onResult,
                },
                submissionDependencies,
              );
              submission.lock(forecast);
              // A live entry has nothing to reveal, so its outcome is reported as soon as it lands.
              submission.reveal();
            },
            playToday: () => {
              location.hash = "#/";
            },
          });
          renderOtherLiveRounds(content, index, entry.id);
        })
        .catch(() => {
          if (version === routeVersion) {
            content.removeAttribute("aria-busy");
            content.replaceChildren(messagePanel(messages.live.failed(renderRoute)));
          }
        });
      break;
    }
    case "how": {
      const content = mountPage(app, messages.how.title);
      pageLoading(content, "Loading scoring…");
      void Promise.all([import("./ui/how"), import("./ui/share-panel")])
        .then(([{ renderHow }, { calibrationLine }]) => {
          if (version !== routeVersion) return;
          content.removeAttribute("aria-busy");
          renderHow(content);
          const calibration = calibrationLine(dailyHistory(history.plays));
          if (calibration)
            content.querySelector("#how-coverage")?.append(paragraph("page-text", calibration));
        })
        .catch(() => {
          if (version === routeVersion) pageFailed(content);
        });
      break;
    }
    case "unknown": {
      const content = mountPage(app, messages.missing.title);
      content.append(
        messagePanel({
          kind: "error",
          what: messages.missing.what,
          action: {
            label: messages.missing.action,
            run: () => {
              location.hash = "#/";
            },
          },
        }),
      );
      break;
    }
  }
}

const refreshToday = () => {
  if (document.visibilityState === "hidden" || parseRoute(location.hash).kind !== "today") return;
  const now = new Date();
  if (localDateForInstant(now.getTime(), now.getTimezoneOffset()) !== todayShown) renderRoute();
};
addEventListener("focus", refreshToday);
addEventListener("pageshow", refreshToday);
document.addEventListener("visibilitychange", refreshToday);
addEventListener("hashchange", renderRoute);
renderRoute();
