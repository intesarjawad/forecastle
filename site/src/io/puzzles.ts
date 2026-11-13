import game from "../../../data/game.json";
import { localDateForInstant, puzzleIdForLocalDate } from "../core/dates";
import { type Puzzle, type PuzzleIndex, parsePuzzle, parsePuzzleIndex } from "./puzzle-validation";

type FetchPuzzle = (url: string) => Promise<Response>;
export type InitialPuzzleRequest = {
  readonly url: string;
  readonly response: Promise<Response>;
};

export function createInitialTransport(
  initial: InitialPuzzleRequest | undefined,
  transport: FetchPuzzle,
  baseUrl: string,
): FetchPuzzle {
  let available = initial;
  return (url) => {
    if (available?.url === new URL(url, baseUrl).href) {
      const response = available.response;
      // Retrying a missing file must start a fresh request, including after an initial 404.
      available = undefined;
      return response;
    }
    return transport(url);
  };
}

export type PuzzleLoad =
  | { kind: "ready"; puzzle: Puzzle }
  | {
      kind: "missing";
      what: string;
      action: { label: string; run: () => Promise<PuzzleLoad> };
    };

type IndexReason = "archive" | "interactive";

/** Network shell with an injected transport and explicit local clock inputs. */
export function createPuzzleLoader(fetchPuzzle: FetchPuzzle, baseUrl = import.meta.env.BASE_URL) {
  async function readIndex(): Promise<PuzzleIndex> {
    const response = await fetchPuzzle(`${baseUrl}puzzles/index.json`);
    if (!response.ok) throw new Error(`Puzzle index request failed (${response.status}).`);
    const value: unknown = await response.json();
    const index = parsePuzzleIndex(value);
    if (index.launchDate !== game.launchDate)
      throw new Error("Puzzle index launch date does not match.");
    return index;
  }

  async function readPuzzle(id: string): Promise<Response> {
    return fetchPuzzle(`${baseUrl}puzzles/${id}/puzzle.json`);
  }

  async function parseResponse(response: Response, id: string): Promise<Puzzle> {
    if (!response.ok) throw new Error(`Puzzle request failed (${response.status}).`);
    const value: unknown = await response.json();
    const puzzle = parsePuzzle(value);
    if (puzzle.id !== id) throw new Error("Puzzle id does not match its URL.");
    return puzzle;
  }

  /** Report missing content before requesting the fallback index; never auto-open an older puzzle. */
  async function loadToday(
    nowMs: number,
    tzOffsetMin: number,
    onMissing: (state: Extract<PuzzleLoad, { kind: "missing" }>) => void,
  ): Promise<PuzzleLoad> {
    const today = localDateForInstant(nowMs, tzOffsetMin);
    const id = puzzleIdForLocalDate(game.launchDate, today);
    let fallbackIndex: Promise<PuzzleIndex | null> | undefined;
    const missing: Extract<PuzzleLoad, { kind: "missing" }> = {
      kind: "missing",
      what: "Today's puzzle is not published yet.",
      action: {
        label: "Play the latest puzzle",
        async run() {
          try {
            const cachedIndex = await fallbackIndex;
            const index = cachedIndex ?? (await readIndex());
            const latest = index?.puzzles
              .filter((entry) => entry.id <= today)
              .reduce<string | null>(
                (latest, entry) => (latest === null || entry.id > latest ? entry.id : latest),
                null,
              );
            if (!latest) return missing;
            return { kind: "ready", puzzle: await parseResponse(await readPuzzle(latest), latest) };
          } catch {
            return missing;
          }
        },
      },
    };
    if (id !== null) {
      let response: Response;
      try {
        response = await readPuzzle(id);
        if (response.status !== 404)
          return { kind: "ready", puzzle: await parseResponse(response, id) };
      } catch {
        onMissing(missing);
        return missing;
      }
      onMissing(missing);
      fallbackIndex = readIndex().catch(() => null);
      return missing;
    }
    onMissing(missing);
    return missing;
  }

  return {
    loadToday,
    /** Call for the archive route, or once the drawing surface accepts input. */
    loadIndex(_reason: IndexReason): Promise<PuzzleIndex> {
      return readIndex();
    },
  };
}
