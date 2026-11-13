/** The privacy notice is a repository document, so the site links to its published copy. */
export const PRIVACY_URL = "https://github.com/intesarjawad/forecastle/blob/main/docs/privacy.md";

/** Runs the one control that can resolve an error. */
export type MessageRun = () => void | Promise<void>;

export type ErrorMessage = {
  readonly kind: "error";
  readonly what: string;
  readonly action: { readonly label: string; readonly run: MessageRun };
};

/** A state the player can only be told about, so it has no control. */
export type NoticeMessage = {
  readonly kind: "notice";
  readonly what: string;
};

export type Message = ErrorMessage | NoticeMessage;

export const messages = {
  pageFailed: (run: MessageRun): ErrorMessage => ({
    kind: "error",
    what: "This page did not load. Reload to try again.",
    action: { label: "Reload page", run },
  }),
  storageBlocked: (run: MessageRun): ErrorMessage => ({
    kind: "error",
    what: "This browser is not saving data, so your streak will not be kept.",
    action: { label: "Play anyway", run },
  }),
  puzzleMissing: (run: MessageRun): ErrorMessage => ({
    kind: "error",
    what: "Today's puzzle is not published yet.",
    action: { label: "Play the latest puzzle", run },
  }),
  answerFailed: (run: MessageRun): ErrorMessage => ({
    kind: "error",
    what: "The answer did not load. Your drawing is kept.",
    action: { label: "Try again", run },
  }),
  answerLoading: {
    kind: "notice",
    what: "Loading the answer.",
  } satisfies NoticeMessage,
  nav: {
    label: "Pages",
    today: "Today",
    archive: "Archive",
    live: "Live",
    how: "Scoring",
    data: "Your data",
    privacy: "Privacy",
  },
  archive: {
    title: "Archive",
    intro: "Every daily puzzle, newest first.",
    empty: "No daily puzzles are published yet.",
    entry: (number: number, label: string, date: string) => `#${number}: ${label}, ${date}`,
    missing: (run: MessageRun): ErrorMessage => ({
      kind: "error",
      what: "That puzzle is not published.",
      action: { label: "Back to the archive", run },
    }),
    failed: (run: MessageRun): ErrorMessage => ({
      kind: "error",
      what: "The archive did not load.",
      action: { label: "Try again", run },
    }),
  },
  live: {
    title: "Live",
    intro: "Three charts from the current round. The record and the crowd appear once it resolves.",
    empty: "No live round is open yet.",
    otherRounds: "Other rounds",
    roundEntry: (openDay: string, resolved: boolean) =>
      `Round opened ${openDay}${resolved ? ": results" : ""}`,
    missing: (run: MessageRun): ErrorMessage => ({
      kind: "error",
      what: "There is no live round with that date.",
      action: { label: "Open the current round", run },
    }),
    loading: "Loading the live chart.",
    chart: (number: number) => `Chart ${number}`,
    chartTitle: (number: number, label: string) => `Chart ${number}: ${label}`,
    badge: (closes: string, resolves: string) => `Closes ${closes}. Resolves ${resolves}.`,
    pending: "The forecast is locked until the round closes.",
    awaiting: "The round is closed and waiting for the record.",
    resolved: "The round is resolved.",
    lock: (date: string) => `Locked until ${date}.`,
    commit: "Forecast commit",
    proof: "OpenTimestamps proof",
    gap: (days: number) => `${days} unscored gap ${days === 1 ? "day" : "days"}`,
    gapNote: (days: number) =>
      `The ${days} hatched ${days === 1 ? "day is" : "days are"} not scored.`,
    chartFailed: "This live chart did not load.",
    forecastFailed: "The forecast did not load.",
    recordFailed: "The record did not load.",
    legend: {
      ai: "AI forecast",
      crowd: "Crowd median",
      actual: "Recorded values",
    },
    table: (label: string) => `${label}: seven scored days`,
    columns: {
      date: "Date",
      ai: "AI",
      crowd: "Crowd median",
      actual: "Recorded",
    },
    blank: "not yet",
    failed: (run: MessageRun): ErrorMessage => ({
      kind: "error",
      what: "The live round did not load.",
      action: { label: "Try again", run },
    }),
    draw: "Draw the seven scored days after the hatched gap, set your band, then lock.",
    sending: "Locked. Sending your entry.",
    entered: (sealed: string, resolves: string): NoticeMessage => ({
      kind: "notice",
      what: `Locked. The AI forecast was sealed ${sealed} and is revealed when entries close. The round resolves ${resolves}.`,
    }),
    duplicate: (resolves: string): NoticeMessage => ({
      kind: "notice",
      what: `This device already entered this chart, so the first entry stands. The round resolves ${resolves}.`,
    }),
    kept: {
      kind: "notice",
      what: "The crowd switch on Your data is off, so this entry stays on this device and is not counted.",
    } satisfies NoticeMessage,
    unserved: {
      kind: "notice",
      what: "This copy of the site has no entry service, so this entry stays on this device and is not counted.",
    } satisfies NoticeMessage,
    closed: (cutoff: string, resolves: string, run: MessageRun): ErrorMessage => ({
      kind: "error",
      what: `Entries for this round closed at ${cutoff}. It resolves ${resolves}.`,
      action: { label: "Play today's puzzle", run },
    }),
    offline: (run: MessageRun): ErrorMessage => ({
      kind: "error",
      what: "You are offline, so your entry was not sent. It is kept on this device.",
      action: { label: "Send again", run },
    }),
    busy: (run: MessageRun): ErrorMessage => ({
      kind: "error",
      what: "The entry service is busy or at its daily limit, which resets at 00:00 UTC, so your entry was not sent. It is kept on this device.",
      action: { label: "Send again", run },
    }),
    awaitingEntry: (resolves: string): NoticeMessage => ({
      kind: "notice",
      what: `Your entry is locked. The round resolves ${resolves}.`,
    }),
    notCounted: {
      kind: "notice",
      what: "This entry did not reach the entry service before the round closed, so it is not counted.",
    } satisfies NoticeMessage,
    result: (you: number, ai: number, verdict: string, caught: number) =>
      `You ${you}, model ${ai}. ${verdict}. Your band caught ${caught} of 7 days.`,
  },
  how: {
    title: "How scoring works",
    closeness: {
      title: "Closeness",
      text: "Closeness falls in a straight line from 100 at zero error to 0 at k typical moves, rounded and never below 0.",
      figure: {
        title: "One typical move around your line",
        description:
          "A line with a shaded band one typical move either side. A recorded value inside the band earns a double circle.",
        caption:
          "Each day is marked in vermilion: a double circle, very close, when the recorded value is within one typical move of your line; a single circle, close, within two; and no mark when it is further away. A typical move is the series' usual change from one day to the next.",
        labels: {
          line: "Your line",
          band: "One typical move",
          actual: "Recorded value",
        },
      },
    },
    coverage: {
      title: "Coverage and calibration",
      paragraphs: [
        "Your band catches a day when the recorded value falls inside it.",
        "A well calibrated 80% band should catch about 80% of days. The AI's band, dotted on the sheet, is its middle 80%, from the 10th to the 90th percentile.",
        "Coverage checks calibration. It is not part of Closeness.",
      ],
    },
    crps: {
      title: "Why not CRPS",
      paragraphs: [
        "CRPS scores a full forecast distribution.",
        "You draw one line and a two-sided band, so the game has no distribution to score.",
        "The benchmark still reports scaled Winkler and quantile loss for the model.",
      ],
    },
    k: {
      title: "How k was calibrated",
      paragraphs: (k: string, low: string, high: string) => [
        `k is ${k} typical moves.`,
        `A percentile bootstrap gave a 95% interval from ${low} to ${high}.`,
        "k is twice the median flat-line error in typical moves on the historical puzzles. The flat line repeats the last visible value.",
      ],
    },
    ai: {
      title: "How the AI forecast is made",
      paragraphs: (model: string, revision: string) => [
        "The AI sees the same 28 points you see.",
        "On the sheet it is a second student. Its week is printed rather than brushed because a machine wrote it, and the teacher marks it the same way as yours.",
        `It is ${model} at revision ${revision}.`,
        "It returns the 10th, 50th and 90th percentiles for the next seven days.",
        "It runs on a GitHub Actions CPU runner.",
      ],
      link: "forecasters/chronos2.py",
    },
    sealing: {
      title: "How live rounds are sealed",
      paragraphs: [
        "At open, the live page publishes only a SHA-256 commitment to the AI forecast and an OpenTimestamps proof.",
        "The forecast stays encrypted outside the site.",
        "After the cutoff, the forecast is published and checked against the commitment. Recorded values follow at resolution.",
      ],
    },
    data: {
      title: "What leaves your device",
      paragraphs: [
        "Your plays stay in this browser.",
        "If the crowd line is on, a locked play is sent without your name or IP address.",
        "The crowd switch is on your data page.",
      ],
      link: "Your data",
    },
    run: {
      title: "Run it yourself",
      steps: [
        {
          text: "Install uv.",
          code: "curl -LsSf https://astral.sh/uv/install.sh | sh",
        },
        {
          text: "Run the pipeline on your own CSV.",
          code: "uvx --torch-backend cpu forecastle-pipeline custom my.csv",
        },
        {
          text: "For a first run with no CSV, use a Wikipedia article.",
          code: "uvx --torch-backend cpu forecastle-pipeline custom --wikipedia Pumpkin",
        },
      ],
      note: "Open-Meteo data is for non-commercial use.",
    },
    teacher: {
      title: "For teachers",
      paragraphs: [
        "A class can run the pipeline on a CSV of daily values.",
        "The model runs on the local machine, so no account is needed.",
        "Students draw the same chart and compare their lines with the AI band.",
      ],
    },
  },
  custom: {
    title: "Custom puzzle, made by whoever sent you this link",
    damaged: (run: MessageRun): ErrorMessage => ({
      kind: "error",
      what: "That custom link is damaged. Ask the sender for a new one.",
      action: { label: "Play today's puzzle", run },
    }),
  },
  data: {
    title: "Your data",
    intro: "The plays saved in this browser, exactly as they are kept on this device.",
    empty: "No plays are saved on this device yet.",
    play: (kind: string, puzzleId: string, playedOn: string, you: number, ai: number) =>
      `${puzzleId}, ${kind}, played ${playedOn}: You ${you}, AI ${ai}`,
    crowd: "Add my plays to the crowd line",
    crowdHelp:
      "On, your locked play is sent anonymously to the crowd line. Off, plays stay on this device. Crowd statistics are still requested.",
    download: "Download my history",
    restore: "Restore from a file",
    restoreHelp:
      "Adds plays from a Forecastle history file. A play already on this device stays as it is.",
    entry: (puzzleId: string, status: string) => `Live entry ${puzzleId}: ${status}`,
    entryStatus: {
      sent: "sent",
      unsent: "not sent yet",
      kept: "kept on this device",
      unserved: "kept on this device",
    },
    restored: (plays: number, entries = 0) =>
      `Restored ${plays} ${plays === 1 ? "play" : "plays"}${
        entries > 0 ? ` and ${entries} live ${entries === 1 ? "entry" : "entries"}` : ""
      }.`,
    restoreWriteFailed:
      "Some records could not be saved. Free browser storage, then retry the restore.",
    restoreRetry: "Retry restore",
    restoreFailed: "That file is not a Forecastle history file.",
    downloadFailed: "The history file could not be written.",
    storageBlocked: "This browser is not saving data, so nothing can be kept here.",
    privacy: "Read the privacy notice",
  },
  missing: {
    title: "Page not found",
    what: "That page does not exist.",
    action: "Back to today's puzzle",
  },
} as const;
