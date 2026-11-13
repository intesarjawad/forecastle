import game from "../../../data/game.json";
import { parseStats, type Stats } from "../core/history";
import { type SubmitRateEntry, submitRate } from "../core/rate";

const SECRET_KEY = "forecastle.v1.secret";
const OPT_OUT_KEY = "forecastle.v1.crowdOptOut";
const SECRET_BYTES = 32;
const REQUEST_TIMEOUT_MS = 3_000;
const MS_PER_DAY = 86_400_000;

type StorageAccess = Pick<Storage, "getItem" | "setItem">;
type Transport = (url: string, init: RequestInit) => Promise<Response>;
type Forecast = {
  readonly path: readonly number[];
  readonly halfWidth: number;
  readonly msToLock: number;
};

/**
 * Live outcomes: `entered` and `duplicate` mean the Worker holds an entry, `closed` that it refused
 * one after the cutoff, `busy` any other refusal, and `kept` that the crowd switch kept it local.
 */
export type CrowdResult =
  | {
      readonly kind:
        | "hidden"
        | "pending"
        | "unavailable"
        | "skipped"
        | "entered"
        | "duplicate"
        | "closed"
        | "busy"
        | "kept";
    }
  | { readonly kind: "ready"; readonly stats: Stats }
  | {
      readonly kind: "sampled-out";
      readonly what: string;
    };

type Play = {
  readonly puzzleId: string;
  readonly kind: "daily" | "live" | "custom";
  readonly utcDate: string;
  readonly previous?: { readonly stats: unknown };
  /** Receive validated stats for the play record, including null on failure. */
  readonly saveStats: (stats: Stats | null) => void;
  /** Called only after reveal, including when the response arrives later. */
  readonly onResult: (result: CrowdResult) => void;
};

type Dependencies = {
  readonly fetch: Transport;
  readonly storage: StorageAccess;
  readonly crypto: Crypto;
  readonly random: () => number;
};

/** Derive an unlinkable UUID for a puzzle without disclosing the local secret. */
export async function submissionId(
  secret: Uint8Array<ArrayBuffer>,
  puzzleId: string,
  subtle: SubtleCrypto,
): Promise<string> {
  const key = await subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = new Uint8Array(
    await subtle.sign("HMAC", key, new TextEncoder().encode(puzzleId)),
  );
  const bytes = signature.slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function readSecret(storage: StorageAccess, crypto: Crypto): Uint8Array<ArrayBuffer> {
  const stored = storage.getItem(SECRET_KEY);
  if (stored !== null) {
    if (!/^[0-9a-f]{64}$/.test(stored)) throw new Error("Invalid local submission secret.");
    return Uint8Array.from(stored.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
  }
  const secret = crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
  storage.setItem(
    SECRET_KEY,
    Array.from(secret, (byte) => byte.toString(16).padStart(2, "0")).join(""),
  );
  return secret;
}

/**
 * The Worker keeps a daily play only within one day of the UTC date, so an archive play
 * reads the crowd line instead of sending an entry the Worker would refuse.
 */
function storable(play: Play): boolean {
  return (
    play.kind !== "daily" ||
    Math.abs(Date.parse(play.puzzleId) - Date.parse(play.utcDate)) <= MS_PER_DAY
  );
}

/** One instance per play; locking and revealing are synchronous and never await the network. */
export function createSubmission(
  play: Play,
  dependencies: Dependencies,
  config: {
    readonly workerUrl: string;
    readonly submitRateSchedule: readonly SubmitRateEntry[];
  } = game,
) {
  let locked = play.previous !== undefined;
  let revealed = false;
  let result: CrowdResult =
    play.previous === undefined ? { kind: "pending" } : restoredResult(play.previous.stats);

  function publish(next: CrowdResult): void {
    result = next;
    play.saveStats(next.kind === "ready" ? next.stats : null);
    if (revealed) play.onResult(next);
  }

  async function request(
    forecast: Forecast,
    optOut: boolean,
    signal: AbortSignal,
  ): Promise<CrowdResult> {
    try {
      const base = config.workerUrl.replace(/\/$/, "");
      let url = `${base}/v1/stats/${encodeURIComponent(play.puzzleId)}`;
      let init: RequestInit = { method: "GET", signal, credentials: "omit", redirect: "error" };
      if (!optOut) {
        const clientId = await submissionId(
          readSecret(dependencies.storage, dependencies.crypto),
          play.puzzleId,
          dependencies.crypto.subtle,
        );
        if (signal.aborted) return { kind: "unavailable" };
        url = `${base}/v1/submit`;
        init = {
          ...init,
          method: "POST",
          // A safelisted content type avoids spending a second request on a CORS preflight.
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          body: JSON.stringify({ puzzleId: play.puzzleId, clientId, ...forecast }),
        };
      }
      const response = await dependencies.fetch(url, init);
      if (play.kind === "live") return await liveResult(response);
      if (!(response.ok || (!optOut && response.status === 409))) return { kind: "unavailable" };
      const body: unknown = await response.json();
      const stats = parseStats(
        optOut
          ? body
          : typeof body === "object" && body !== null && "stats" in body
            ? body.stats
            : null,
      );
      return stats === null ? { kind: "unavailable" } : { kind: "ready", stats };
    } catch {
      return { kind: "unavailable" };
    }
  }

  async function send(forecast: Forecast, optOut: boolean): Promise<CrowdResult> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<CrowdResult>((resolve) => {
      timeout = setTimeout(() => {
        controller.abort();
        resolve({ kind: "unavailable" });
      }, REQUEST_TIMEOUT_MS);
    });
    try {
      return await Promise.race([request(forecast, optOut, controller.signal), expired]);
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    lock(forecast: Forecast): void {
      if (locked) return;
      locked = true;
      if (play.kind === "custom" || config.workerUrl === "") {
        publish({ kind: "skipped" });
        return;
      }
      let optOut: boolean;
      try {
        optOut = dependencies.storage.getItem(OPT_OUT_KEY) === "true" || !storable(play);
      } catch {
        publish({ kind: "unavailable" });
        return;
      }
      if (play.kind === "live" && optOut) {
        publish({ kind: "kept" });
        return;
      }
      if (
        play.kind === "daily" &&
        dependencies.random() >= submitRate(config.submitRateSchedule, play.utcDate)
      ) {
        publish({
          kind: "sampled-out",
          what: "Busy day: the crowd line is shown to a share of players today. Your score is not affected.",
        });
        return;
      }
      // Copy the locked forecast before asynchronous identity derivation.
      void send(
        { path: [...forecast.path], halfWidth: forecast.halfWidth, msToLock: forecast.msToLock },
        optOut,
      ).then(publish);
    },
    reveal(): void {
      if (revealed) return;
      revealed = true;
      play.onResult(result);
    },
    get result(): CrowdResult {
      return revealed ? result : { kind: "hidden" };
    },
  };
}

function restoredResult(value: unknown): CrowdResult {
  const stats = parseStats(value);
  return stats === null ? { kind: "unavailable" } : { kind: "ready", stats };
}

/** Both refusals are 409; only the cutoff refusal carries an error, a live duplicate has none. */
async function liveResult(response: Response): Promise<CrowdResult> {
  if (response.ok) return { kind: "entered" };
  if (response.status !== 409) return { kind: "busy" };
  const body: unknown = await response.json();
  return typeof body === "object" && body !== null && "error" in body
    ? { kind: "closed" }
    : { kind: "duplicate" };
}
