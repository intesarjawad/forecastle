import { localDateForInstant } from "../core/dates";
import { type HistoryPlay, mergeHistory, parseHistory } from "../core/history";
import { type LiveEntryRecord, type Play, parseLiveEntry } from "../io/storage";
import { messages, PRIVACY_URL } from "./messages";

const SCHEMA_VERSION = 1;
const CROWD_OPT_OUT_KEY = "forecastle.v1.crowdOptOut";

type StorageAccess = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type DataPageOptions = {
  readonly plays: readonly Play[];
  readonly entries: readonly LiveEntryRecord[];
  readonly openStorage: () => StorageAccess;
  readonly save: (play: Play) => boolean;
  readonly saveEntry: (entry: LiveEntryRecord) => boolean;
  readonly onRestore: (plays: readonly Play[]) => void;
  readonly now: () => number;
};

/** The download is dated in the player's local calendar, not in UTC. */
export function historyFileName(day: string): string {
  return `forecastle-history-${day}.json`;
}

/**
 * The download keeps both storage schemas, plays first and then live entries, so the same file
 * can be restored. Only a live entry has a `status`.
 */
export function historyFile(
  plays: readonly Play[],
  entries: readonly LiveEntryRecord[] = [],
): string {
  return JSON.stringify(
    [...plays, ...entries].map((record) => ({ ...record, schemaVersion: SCHEMA_VERSION })),
    null,
    2,
  );
}

/** One bad record rejects the whole file, whether it is a play or a live entry. */
export function parseHistoryFile(
  value: unknown,
): { readonly plays: HistoryPlay[]; readonly entries: LiveEntryRecord[] } | null {
  if (!Array.isArray(value)) return null;
  const isEntry = (item: unknown) => typeof item === "object" && item !== null && "status" in item;
  const plays = parseHistory(value.filter((item) => !isEntry(item)));
  const entries: LiveEntryRecord[] = [];
  for (const item of value.filter(isEntry)) {
    const entry = parseLiveEntry(item);
    if (entry === null) return null;
    entries.push(entry);
  }
  return plays === null ? null : { plays, entries };
}

function saveDownload(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function paragraph(className: string, text: string): HTMLParagraphElement {
  const element = document.createElement("p");
  element.className = className;
  element.textContent = text;
  return element;
}

/**
 * Render the local history as it is stored: every play, the crowd-line choice,
 * a download of the same records and a restore that never overwrites a play.
 */
export function renderData(root: HTMLElement, options: DataPageOptions): void {
  let plays: Play[] = [...options.plays];
  let entries: LiveEntryRecord[] = [...options.entries];
  const section = document.createElement("section");
  section.className = "page-data";

  const list = document.createElement("ul");
  list.className = "history-list";
  const empty = paragraph("history-empty", messages.data.empty);
  const paint = () => {
    list.replaceChildren(
      ...plays.map((play) => {
        const item = document.createElement("li");
        item.textContent = messages.data.play(
          play.kind,
          play.puzzleId,
          play.playedOn,
          play.closeness,
          play.aiCloseness,
        );
        return item;
      }),
      ...entries.map((entry) => {
        const item = document.createElement("li");
        item.textContent = messages.data.entry(
          entry.puzzleId,
          messages.data.entryStatus[entry.status],
        );
        return item;
      }),
    );
    list.hidden = plays.length + entries.length === 0;
    empty.hidden = !list.hidden;
  };
  paint();

  const status = paragraph("data-status", "");
  status.setAttribute("role", "status");

  const crowd = document.createElement("input");
  crowd.type = "checkbox";
  crowd.id = "crowd-line";
  const crowdLabel = document.createElement("label");
  crowdLabel.htmlFor = crowd.id;
  crowdLabel.textContent = messages.data.crowd;
  try {
    crowd.checked = options.openStorage().getItem(CROWD_OPT_OUT_KEY) !== "true";
  } catch {
    crowd.checked = true;
    status.textContent = messages.data.storageBlocked;
  }
  crowd.addEventListener("change", () => {
    try {
      const storage = options.openStorage();
      if (crowd.checked) storage.removeItem(CROWD_OPT_OUT_KEY);
      else storage.setItem(CROWD_OPT_OUT_KEY, "true");
    } catch {
      status.textContent = messages.data.storageBlocked;
    }
  });

  const download = document.createElement("button");
  download.type = "button";
  download.className = "key-button";
  download.textContent = messages.data.download;
  download.addEventListener("click", () => {
    try {
      const now = options.now();
      const day = localDateForInstant(now, new Date(now).getTimezoneOffset());
      saveDownload(historyFile(plays, entries), historyFileName(day));
      status.textContent = "";
    } catch {
      status.textContent = messages.data.downloadFailed;
    }
  });

  const restoreInput = document.createElement("input");
  restoreInput.type = "file";
  restoreInput.id = "restore-file";
  restoreInput.accept = "application/json,.json";
  const restoreLabel = document.createElement("label");
  restoreLabel.htmlFor = restoreInput.id;
  restoreLabel.textContent = messages.data.restore;
  let retryFile: File | undefined;
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "key-button";
  retry.textContent = messages.data.restoreRetry;
  retry.hidden = true;
  retry.addEventListener("click", () => {
    if (retryFile) void restore(retryFile);
  });
  const restore = async (file: File) => {
    retry.hidden = true;
    retryFile = undefined;
    let value: unknown;
    try {
      value = JSON.parse(await file.text());
    } catch {
      status.textContent = messages.data.restoreFailed;
      return;
    }
    const restored = parseHistoryFile(value);
    if (restored === null) {
      status.textContent = messages.data.restoreFailed;
      return;
    }
    const merged = mergeHistory(plays, restored.plays);
    const added: Play[] = [];
    let failed = false;
    for (const play of merged.slice(plays.length)) {
      if (options.save(play)) added.push(play);
      else failed = true;
    }
    plays = [...plays, ...added];
    const addedEntries: LiveEntryRecord[] = [];
    for (const entry of restored.entries) {
      if ([...entries, ...addedEntries].some((local) => local.puzzleId === entry.puzzleId))
        continue;
      if (options.saveEntry(entry)) addedEntries.push(entry);
      else failed = true;
    }
    entries = [...entries, ...addedEntries];
    options.onRestore(plays);
    paint();
    status.textContent = failed
      ? messages.data.restoreWriteFailed
      : messages.data.restored(added.length, addedEntries.length);
    if (failed) {
      retryFile = file;
      retry.hidden = false;
    }
  };
  restoreInput.addEventListener("change", () => {
    const file = restoreInput.files?.[0];
    if (!file) return;
    void restore(file).finally(() => {
      restoreInput.value = "";
    });
  });

  const privacy = document.createElement("a");
  privacy.href = PRIVACY_URL;
  privacy.textContent = messages.data.privacy;
  const privacyNote = document.createElement("p");
  privacyNote.className = "data-help";
  privacyNote.append(privacy);

  section.append(
    paragraph("page-text", messages.data.intro),
    empty,
    list,
    crowd,
    crowdLabel,
    paragraph("data-help", messages.data.crowdHelp),
    download,
    restoreLabel,
    restoreInput,
    paragraph("data-help", messages.data.restoreHelp),
    privacyNote,
    status,
    retry,
  );
  root.replaceChildren(section);
}
