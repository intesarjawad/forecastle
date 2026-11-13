import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs, promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { measured, medians, resultRows } from "./lighthouse-metrics.mjs";

const run = promisify(execFile);
const root = new URL("../", import.meta.url).pathname;
const port = Number(process.env.FORECASTLE_PORT ?? "43873");
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("FORECASTLE_PORT must be an integer from 1 to 65535.");
const origin = `http://127.0.0.1:${port}`;
const { values } = parseArgs({
  options: { puzzle: { type: "string" }, runs: { type: "string", default: "3" } },
});
const count = Number(values.runs);
if (!Number.isSafeInteger(count) || count < 1)
  throw new Error("--runs must be a positive integer.");
const id = values.puzzle ?? "2026-10-21";
if (!/^\d{4}-\d{2}-\d{2}$/u.test(id) || !Number.isFinite(Date.parse(id)))
  throw new Error("--puzzle requires a calendar date.");
const url = `${origin}/#/p/${id}`;

async function compressedBytes(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) total += await compressedBytes(path);
    else if (/\.(html|js|css|woff2?)$/u.test(entry.name))
      total += gzipSync(await readFile(path)).byteLength;
  }
  return total;
}

await run("npm", ["run", "build", "-w", "site"], { cwd: root });
if (values.puzzle === undefined) {
  const destination = join(root, "site/dist/puzzles", id);
  await mkdir(destination, { recursive: true });
  for (const name of ["puzzle.json", "answer.json"]) {
    await copyFile(join(root, "site/tests/fixtures", id, name), join(destination, name));
  }
}
const bytes = await compressedBytes(join(root, "site/dist"));
const directory = join(root, ".cache/lighthouse", new Date().toISOString().replaceAll(":", "-"));
await mkdir(directory, { recursive: true });
const preview = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "site",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { cwd: root, stdio: ["ignore", "pipe", "inherit"] },
);
const ready = new AbortController();
const exited = () => ready.abort(new Error("Preview exited before becoming ready."));
preview.on("exit", exited);
try {
  for (;;) {
    const [chunk] = await once(preview.stdout, "data", {
      signal: AbortSignal.any([ready.signal, AbortSignal.timeout(10000)]),
    });
    const output = chunk.toString();
    process.stdout.write(output);
    if (output.includes(origin)) break;
  }
  preview.removeListener("exit", exited);
  const puzzleResponse = await fetch(`${origin}/puzzles/${id}/puzzle.json`);
  const puzzle = await puzzleResponse.json();
  if (!puzzleResponse.ok || puzzle.id !== id || puzzle.visible?.length !== 28)
    throw new Error(`No playable puzzle at ${url}`);
  console.log(`Playable puzzle: ${url} (${puzzle.label})`);
  const runs = [];
  const sections = [];
  let version = "";
  for (let index = 0; index < count; index++) {
    const reportPath = join(directory, `run-${index + 1}.json`);
    await run(
      process.execPath,
      [
        "node_modules/lighthouse/cli/index.js",
        url,
        "--form-factor=mobile",
        "--only-categories=performance,accessibility",
        "--output=json",
        `--output-path=${reportPath}`,
        "--quiet",
        "--chrome-flags=--headless",
        "--no-enable-error-reporting",
      ],
      { cwd: root, timeout: 180000 },
    );
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    if (report.runtimeError) throw new Error(report.runtimeError.message);
    version = report.lighthouseVersion;
    const measurements = measured(report, bytes);
    runs.push(measurements);
    const rows = resultRows(measurements);
    if (rows.some((row) => !row.passed)) process.exitCode = 1;
    sections.push(
      `Run ${index + 1}: LCP ${measurements[2]} ms, Performance ${measurements[0]}, Accessibility ${measurements[1]}, CLS ${measurements[3]}.`,
    );
    console.log(sections.at(-1));
  }
  const results = resultRows(medians(runs));
  const rows = results.map(
    ({ name, value, budget, passed }) =>
      `| ${name} | ${value} | ${budget} | ${passed ? "pass" : "fail"} |`,
  );
  await writeFile(
    join(directory, "summary.json"),
    `${JSON.stringify({ url, puzzle: puzzle.label, lighthouse: version, runs, medians: results }, null, 2)}\n`,
  );
  const performanceDoc = join(root, "docs/perf.md");
  const previous = await readFile(performanceDoc, "utf8");
  await writeFile(
    performanceDoc,
    previous.split("\n## Playable puzzle measurement,")[0] +
      `\n## Playable puzzle measurement, ${new Date().toISOString()}\n\nLighthouse ${version}, local Vite preview, default mobile simulated throttling.\nPuzzle: ${id}, ${puzzle.label}. ${count} serial runs, separate browser launches.\n\n${sections.join("\n\n")}\n\n| Metric (median) | Value | Budget | Result |\n| --- | ---: | --- | --- |\n${rows.join("\n")}\n`,
  );
  await run(join(root, "node_modules/.bin/biome"), ["format", "--write", "docs/perf.md"], {
    cwd: root,
  });
  for (const row of rows) console.log(row);
  if (results.some((row) => !row.passed)) process.exitCode = 1;
  console.log(`Reports: ${directory}`);
} finally {
  preview.kill("SIGTERM");
}
