import type { InkChange, InkEngine } from "./ink";

/**
 * Ink soaking into washi, after the dual-scene reveal in Cullen Webber's "Fluid X-Ray"
 * (Codrops, March 2026): a 2D canvas is the input, a ping-pong pair of render targets
 * spreads it with noise-displaced neighbour samples, and the spread field is the mask
 * between bare paper and inked paper. Here the spread runs along the paper's own fibres,
 * fades with distance so it stops where real ink stops, and dries out over a second and
 * a half instead of fading back to white.
 */

const VERTEX = `#version 300 es
in vec2 position;
out vec2 uv;
void main() {
  uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const NOISE = `
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}`;

// Kozo paper: long thin fibres lying in every direction. RG holds the strongest fibre's
// direction, B its strength, A how readily this patch of the sheet soaks up water.
const PAPER = `#version 300 es
precision highp float;
uniform float height;
out vec4 colour;
${NOISE}
void main() {
  // Measured from the top, so the fibres stay under the ink when the sheet grows below.
  vec2 p = vec2(gl_FragCoord.x, height - gl_FragCoord.y);
  float strongest = 0.0;
  vec2 direction = vec2(1.0, 0.0);
  for (int layer = 0; layer < 5; layer++) {
    float seed = float(layer) * 17.31;
    float angle = float(layer) * 0.63 + (noise(p * 0.006 + seed) - 0.5) * 1.4;
    vec2 along = vec2(cos(angle), sin(angle));
    vec2 q = vec2(dot(p, along), dot(p, vec2(-along.y, along.x)));
    float strand = 1.0 - abs(noise(vec2(q.x * 0.018, q.y * 0.42) + seed) * 2.0 - 1.0);
    strand = pow(strand, 14.0) * smoothstep(0.45, 0.8, noise(q * vec2(0.01, 0.03) + seed * 2.0));
    if (strand > strongest) {
      strongest = strand;
      direction = along;
    }
  }
  float soak = noise(p * 0.05) * 0.6 + noise(p * 0.13 + 7.0) * 0.4;
  colour = vec4(direction * 0.5 + 0.5, strongest, soak);
}`;

// R and G are how far the water of sumi and of vermilion has run; B and A the pigment it
// carried. Water creeps about a pixel across the paper and two or three along a fibre, then
// stops, so a stroke keeps its shape. Vermilion only runs where sumi has already wet the paper.
const BLEED = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 colour;
uniform sampler2D field;
uniform sampler2D paper;
uniform sampler2D sumi;
uniform sampler2D shu;
uniform vec2 texel;
uniform vec2 wet;
uniform vec2 reset;
void main() {
  vec4 fibre = texture(paper, uv);
  vec2 along = normalize(fibre.rg * 2.0 - 1.0);
  vec4 here = texture(field, uv);
  vec4 near = max(
    max(texture(field, uv + vec2(texel.x, 0.0)), texture(field, uv - vec2(texel.x, 0.0))),
    max(texture(field, uv + vec2(0.0, texel.y)), texture(field, uv - vec2(0.0, texel.y))));
  vec4 strand = max(texture(field, uv + along * texel), texture(field, uv - along * texel));
  float shuRuns = mix(0.45, 1.0, smoothstep(0.3, 0.6, here.r));
  vec2 across = vec2(0.3, 0.3 * shuRuns);
  // Only the strongest fibres draw the water a pixel or two further: the creep is in threads.
  vec2 grain = vec2(0.5, 0.5 * shuRuns) + 0.24 * fibre.b * fibre.b * fibre.b;
  vec2 water = max(near.rg * across, strand.rg * grain) * wet;
  vec2 pigment = max(near.ba, strand.ba) * 0.55 * wet;
  vec2 laid = vec2(texture(sumi, uv).a, texture(shu, uv).a);
  vec4 spread = vec4(max(here.rg, water), max(here.ba, pigment)) * (1.0 - vec4(reset, reset));
  colour = max(spread, vec4(smoothstep(0.25, 0.45, laid), laid));
}`;

// Inside the stroke the ink is what the brush laid. In the pixel or two the water crept
// beyond it, a little pigment follows the fibres. Where the ink pooled it piles up as it dries
// into a darker edge, on one side of the stroke and in broken lengths, never a traced outline.
// Vermilion is opaque: the sumi just round it is cut back to paper, so it lies on top.
const COMPOSE = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 colour;
uniform sampler2D field;
uniform sampler2D sumi;
uniform sampler2D shu;
uniform vec3 sumiColour;
uniform vec3 diluteColour;
uniform vec3 shuColour;
uniform vec2 pixel;
${NOISE}
vec2 layer(float water, float pigment, float laid, float tooth) {
  float reached = smoothstep(0.26, 0.32, water);
  float front = reached * (1.0 - smoothstep(0.32, 0.55, water));
  vec2 slope = vec2(dFdx(water), dFdy(water));
  float side = smoothstep(0.0, 0.6, dot(slope / max(length(slope), 1e-4), vec2(-0.8, 0.6)));
  float broken = smoothstep(0.42, 0.62, noise(gl_FragCoord.xy * 0.06));
  // Only loaded ink pools at its edge; a wash is too thin to leave a tide line.
  float pooled = front * smoothstep(0.45, 0.8, pigment) * side * broken;
  float crept = max(pigment * reached * 0.45, pooled);
  float alpha = clamp(max(laid, crept) * (0.92 + 0.16 * (tooth - 0.5)), 0.0, 1.0);
  // Ink keeps the tone it was laid with: a wash and what creeps out of it stay pale, so the
  // band's edge never darkens into a second line.
  float tone = smoothstep(0.3, 0.9, laid >= crept ? laid : pigment);
  return vec2(alpha, tone);
}
void main() {
  vec4 spread = texture(field, uv);
  float tooth = noise(gl_FragCoord.xy * 0.7) * 0.5 + noise(gl_FragCoord.xy * 0.23) * 0.5;
  vec2 black = layer(spread.r, spread.b, texture(sumi, uv).a, tooth);
  float red = layer(spread.g, spread.a, texture(shu, uv).a, tooth).x;
  vec3 ink = mix(diluteColour, sumiColour, black.y);
  float near = max(
    max(texture(shu, uv + vec2(pixel.x, 0.0)).a, texture(shu, uv - vec2(pixel.x, 0.0)).a),
    max(texture(shu, uv + vec2(0.0, pixel.y)).a, texture(shu, uv - vec2(0.0, pixel.y)).a));
  // Paper parts the vermilion from the sumi core only; over the pale band there is no halo.
  float core = smoothstep(0.55, 0.85, texture(sumi, uv).a);
  vec4 under = vec4(ink * black.x, black.x) * (1.0 - smoothstep(0.15, 0.5, near) * core);
  colour = vec4(shuColour * red, red) + under * (1.0 - red);
}`;

const DRYING = 0.972;
const DRY = 0.02;
const SETTLE_STEPS = 28;

function rgb(colour: string): [number, number, number] {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu.exec(colour.trim());
  if (!match) throw new Error(`Ink colours must be hex: ${colour}`);
  return [1, 2, 3].map((index) => Number.parseInt(match[index] ?? "0", 16) / 255) as [
    number,
    number,
    number,
  ];
}

/** Returns null where WebGL2 is unavailable; the canvases then stand as the finished ink. */
export function createInkEngine(
  canvas: HTMLCanvasElement,
  sources: { readonly sumi: HTMLCanvasElement; readonly shu: HTMLCanvasElement },
  colours: { readonly sumi: string; readonly dilute: string; readonly shu: string },
  still: () => boolean,
): InkEngine | null {
  const gl = canvas.getContext("webgl2", {
    premultipliedAlpha: true,
    antialias: false,
    failIfMajorPerformanceCaveat: true,
  });
  if (!gl) return null;
  // A renderer emulated on the CPU cannot bleed a full sheet each frame; the still ink is used.
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  if (/swiftshader|llvmpipe|softpipe|software/iu.test(renderer)) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return null;
  }
  const compile = (fragment: string) => {
    const program = gl.createProgram();
    for (const [type, source] of [
      [gl.VERTEX_SHADER, VERTEX],
      [gl.FRAGMENT_SHADER, fragment],
    ] as const) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("WebGL could not create a shader.");
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(shader) ?? "Shader failed to compile.");
      gl.attachShader(program, shader);
    }
    gl.bindAttribLocation(program, 0, "position");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program) ?? "Shader failed to link.");
    return program;
  };
  let programs: { paper: WebGLProgram; bleed: WebGLProgram; compose: WebGLProgram };
  try {
    programs = { paper: compile(PAPER), bleed: compile(BLEED), compose: compile(COMPOSE) };
  } catch {
    return null;
  }
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const texture = () => {
    const made = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, made);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return made;
  };
  const target = (width: number, height: number) => {
    const made = texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const buffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, buffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, made, 0);
    return { texture: made, buffer, width, height };
  };
  type Target = ReturnType<typeof target>;
  const deposit = { sumi: texture(), shu: texture() };
  const colour = { sumi: rgb(colours.sumi), dilute: rgb(colours.dilute), shu: rgb(colours.shu) };
  let paper: Target | null = null;
  let fields: [Target, Target] | null = null;
  let wet: [number, number] = [0, 0];
  let reset: [number, number] = [0, 0];
  let dirty = { sumi: true, shu: true };
  let frame = 0;
  let visible = true;
  let lost = false;

  const bind = (program: WebGLProgram, unit: number, name: string, made: WebGLTexture | null) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, made);
    gl.uniform1i(gl.getUniformLocation(program, name), unit);
  };
  const draw = (into: Target | null) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, into?.buffer ?? null);
    gl.viewport(0, 0, into?.width ?? canvas.width, into?.height ?? canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  const upload = () => {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    for (const name of ["sumi", "shu"] as const) {
      if (!dirty[name]) continue;
      gl.bindTexture(gl.TEXTURE_2D, deposit[name]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sources[name]);
    }
    dirty = { sumi: false, shu: false };
  };
  const step = () => {
    if (!fields || !paper) return;
    const [from, into] = fields;
    const program = programs.bleed;
    gl.useProgram(program);
    bind(program, 0, "field", from.texture);
    bind(program, 1, "paper", paper.texture);
    bind(program, 2, "sumi", deposit.sumi);
    bind(program, 3, "shu", deposit.shu);
    gl.uniform2f(gl.getUniformLocation(program, "texel"), 1 / from.width, 1 / from.height);
    gl.uniform2f(gl.getUniformLocation(program, "wet"), wet[0], wet[1]);
    gl.uniform2f(gl.getUniformLocation(program, "reset"), reset[0], reset[1]);
    draw(into);
    fields = [into, from];
    reset = [0, 0];
  };
  const compose = () => {
    if (!fields || !paper) return;
    const program = programs.compose;
    gl.useProgram(program);
    bind(program, 0, "field", fields[0].texture);
    bind(program, 2, "sumi", deposit.sumi);
    bind(program, 3, "shu", deposit.shu);
    gl.uniform3f(gl.getUniformLocation(program, "sumiColour"), ...colour.sumi);
    gl.uniform3f(gl.getUniformLocation(program, "diluteColour"), ...colour.dilute);
    gl.uniform3f(gl.getUniformLocation(program, "shuColour"), ...colour.shu);
    // The paper cut round the vermilion is about one and a half CSS pixels wide.
    const cut = 1.5 * (canvas.width / Math.max(1, Number.parseFloat(canvas.style.width) || 1));
    gl.uniform2f(gl.getUniformLocation(program, "pixel"), cut / canvas.width, cut / canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clear(gl.COLOR_BUFFER_BIT);
    draw(null);
  };
  const tick = () => {
    frame = 0;
    if (lost) return;
    upload();
    if (still()) {
      wet = [1, 1];
      for (let index = 0; index < SETTLE_STEPS; index += 1) step();
      wet = [0, 0];
    } else {
      step();
      wet = [wet[0] * DRYING, wet[1] * DRYING];
    }
    compose();
    if (Math.max(...wet) > DRY) schedule();
  };
  function schedule() {
    if (!frame && visible && !lost) frame = requestAnimationFrame(tick);
  }

  const resize = (keep = false) => {
    // The field runs at one cell per CSS pixel: finer than the fibres, coarse enough to stay cheap.
    const ratio =
      sources.sumi.width / Math.max(1, Number.parseFloat(sources.sumi.style.width) || 1);
    const width = Math.max(1, Math.round(sources.sumi.width / ratio));
    const height = Math.max(1, Math.round(sources.sumi.height / ratio));
    canvas.width = sources.sumi.width;
    canvas.height = sources.sumi.height;
    canvas.style.width = sources.sumi.style.width;
    canvas.style.height = sources.sumi.style.height;
    const old = fields;
    for (const made of [paper, ...(keep ? [] : (old ?? []))]) {
      if (!made) continue;
      gl.deleteTexture(made.texture);
      gl.deleteFramebuffer(made.buffer);
    }
    paper = target(width, height);
    gl.useProgram(programs.paper);
    gl.uniform1f(gl.getUniformLocation(programs.paper, "height"), height);
    draw(paper);
    fields = [target(width, height), target(width, height)];
    dirty = { sumi: true, shu: true };
    if (keep && old && old[0].width === width) {
      // The field is anchored to the top of the sheet, where GL counts from the bottom.
      const rows = Math.min(old[0].height, height);
      old.forEach((made, index) => {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, made.buffer);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fields?.[index]?.buffer ?? null);
        gl.blitFramebuffer(
          0,
          made.height - rows,
          width,
          made.height,
          0,
          height - rows,
          width,
          height,
          gl.COLOR_BUFFER_BIT,
          gl.NEAREST,
        );
        gl.deleteTexture(made.texture);
        gl.deleteFramebuffer(made.buffer);
      });
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    } else {
      reset = [1, 1];
      wet = [1, 1];
    }
    // Sizing a canvas blanks it, so the ink is laid again at once rather than a frame later.
    cancelAnimationFrame(frame);
    tick();
  };

  const observer = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
    if (visible) schedule();
  });
  observer.observe(canvas);
  const onLost = (event: Event) => {
    event.preventDefault();
    lost = true;
    canvas.dispatchEvent(new CustomEvent("inkfallback", { bubbles: true }));
  };
  canvas.addEventListener("webglcontextlost", onLost);
  resize();

  return {
    changed(change: InkChange) {
      if (change.sumi) {
        dirty.sumi = true;
        wet[0] = 1;
        if (change.sumi === "reset") reset[0] = 1;
      }
      if (change.shu) {
        dirty.shu = true;
        wet[1] = 1;
        if (change.shu === "reset") reset[1] = 1;
      }
      // A reset clears the old spread and lays the new ink, which then soaks in again.
      schedule();
    },
    resize,
    destroy() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
