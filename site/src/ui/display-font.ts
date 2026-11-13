import textFace from "@fontsource/shippori-mincho/files/shippori-mincho-latin-400-normal.woff2?url";
import displayFace from "@fontsource/shippori-mincho/files/shippori-mincho-latin-800-normal.woff2?url";

export function loadDisplayFace(): void {
  for (const [weight, source] of [
    ["400", textFace],
    ["800", displayFace],
  ] as const) {
    if (
      [...document.fonts].some(
        (face) => face.family === "Shippori Mincho" && face.weight === weight,
      )
    )
      continue;
    const face = new FontFace("Shippori Mincho", `url(${source})`, { weight, display: "swap" });
    document.fonts.add(face);
    void face.load().catch(() => document.fonts.delete(face));
  }
}
