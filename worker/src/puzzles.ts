import { type Puzzle, parsePuzzle } from "./validate";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function puzzleFileUrl(pagesUrl: string, id: string, file: string): URL {
  const path = id.startsWith("live-")
    ? `live/${id.slice(0, -2)}/${id.slice(-1)}/${file}`
    : `puzzles/${id}/${file}`;
  return new URL(path, `${pagesUrl.replace(/\/$/, "")}/`);
}

export async function loadPuzzle(pagesUrl: string, id: string): Promise<Puzzle> {
  const response = await fetch(puzzleFileUrl(pagesUrl, id, "puzzle.json"), { redirect: "manual" });
  if (response.status === 404) throw new HttpError(404, "Puzzle not found");
  if (!response.ok) throw new HttpError(502, "Puzzle unavailable");
  const puzzle = parsePuzzle(await response.json(), id);
  if (!puzzle) throw new HttpError(502, "Invalid puzzle file");
  return puzzle;
}
