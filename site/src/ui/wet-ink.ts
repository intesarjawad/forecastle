import { loadDisplayFace } from "./display-font";
import { type Ink, paintSwatch } from "./ink";
import { loadInstallAssets } from "./install";
import { token } from "./lesson";

export function wetInk(
  lesson: HTMLElement,
  ink: Ink,
  reducedMotion: MediaQueryList,
  drawing: () => boolean,
  painted: Promise<void>,
): () => void {
  let disposed = false;
  let idle = 0;
  let frame = 0;
  let sampled = false;
  const start = () => {
    idle = 0;
    frame = 0;
    if (disposed) return;
    if (!sampled) {
      sampled = true;
      loadDisplayFace();
      loadInstallAssets();
      const swatch = lesson.querySelector("#swatch-ink");
      if (swatch instanceof HTMLCanvasElement)
        paintSwatch(swatch, token("--sumi"), Math.min(2, devicePixelRatio || 1));
      // Supporting fonts finish before the optional shader competes for bandwidth and CPU.
      void document.fonts.ready.then(() => {
        if (!disposed)
          frame = requestAnimationFrame(() => {
            frame = 0;
            schedule();
          });
      });
      return;
    }
    if (drawing()) {
      lesson.addEventListener("pointerup", schedule, { once: true });
      lesson.addEventListener("pointercancel", schedule, { once: true });
      return;
    }
    void import("./ink-gl").then(({ createInkEngine }) => {
      if (disposed) return;
      const canvas = document.createElement("canvas");
      canvas.className = "ink-layer ink-gl";
      canvas.setAttribute("aria-hidden", "true");
      lesson.append(canvas);
      const engine = createInkEngine(
        canvas,
        ink.canvases,
        { sumi: token("--sumi"), dilute: token("--usuzumi"), shu: token("--shu-ink") },
        () => reducedMotion.matches,
      );
      if (!engine) {
        canvas.remove();
        return;
      }
      lesson.classList.add("is-wet");
      canvas.addEventListener("inkfallback", () => lesson.classList.remove("is-wet"));
      ink.attach(engine);
    });
  };
  function schedule() {
    lesson.removeEventListener("pointerup", schedule);
    lesson.removeEventListener("pointercancel", schedule);
    if (disposed || idle || frame) return;
    if ("requestIdleCallback" in window) idle = requestIdleCallback(start);
    else frame = requestAnimationFrame(start);
  }
  // Font layout and the playable sheet paint before optional GPU allocation.
  void Promise.all([document.fonts.ready, painted]).then(() => {
    if (!disposed)
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          frame = 0;
          schedule();
        });
      });
  });
  return () => {
    disposed = true;
    if (idle) cancelIdleCallback(idle);
    cancelAnimationFrame(frame);
    lesson.removeEventListener("pointerup", schedule);
    lesson.removeEventListener("pointercancel", schedule);
  };
}
