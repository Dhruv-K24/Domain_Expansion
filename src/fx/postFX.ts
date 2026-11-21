// PostFX — GPU post-processing with WebGL shaders.
//
// The domains still draw with Canvas 2D (onto a hidden canvas). Every frame we upload that
// picture to the GPU as a TEXTURE and run it through small programs called SHADERS, which
// run once PER PIXEL, in parallel, on your graphics chip. That's why they can do things that
// would be far too slow in JavaScript:
//
//   1. BRIGHT PASS  keep only the bright parts of the picture
//   2. BLUR         blur those bright parts (at 1/4 size: cheap), sideways then up/down, twice
//   3. COMPOSITE    original + blurred bright parts = BLOOM (light that bleeds into the dark)
//                   + HEAT DISTORTION: every pixel samples from a slightly shifted spot,
//                     shifted by animated noise -> shimmering hot air
//                   + COLOUR GRADING: tint, contrast, vignette
//
// Shaders are written in GLSL, a small C-like language. Each one gets a pixel position (uv,
// 0..1) and returns that pixel's colour.

export type PostSettings = {
  bloom: number                   // how strong the glow is (0 = off)
  threshold: number               // how bright a pixel must be to glow (0..1)
  distortion: number              // heat haze strength (0 = off)
  tint: [number, number, number]  // colour multiplier (1,1,1 = unchanged)
  contrast: number                // 1 = unchanged
  vignette: number                // 0..1 darkening of the corners
}

export const defaultPost = (): PostSettings => ({
  bloom: 0, threshold: 0.6, distortion: 0, tint: [1, 1, 1], contrast: 1, vignette: 0,
})

const VERT = `
attribute vec2 pos;
varying vec2 uv;
void main() {
  uv = pos * 0.5 + 0.5;
  gl_Position = vec4(pos, 0.0, 1.0);
}`

// 1. keep only what's brighter than the threshold (soft knee so it doesn't pop)
const BRIGHT = `
precision mediump float;
varying vec2 uv;
uniform sampler2D src;
uniform float threshold;
void main() {
  vec4 c = texture2D(src, uv);
  float lum = max(c.r, max(c.g, c.b));
  float k = smoothstep(threshold, threshold + 0.25, lum);
  gl_FragColor = vec4(c.rgb * k, c.a * k);
}`

// 2. 9-tap gaussian blur in one direction (we run it horizontally, then vertically)
const BLUR = `
precision mediump float;
varying vec2 uv;
uniform sampler2D src;
uniform vec2 dir; // one-pixel step, along x or y
void main() {
  vec4 s = texture2D(src, uv) * 0.227;
  s += (texture2D(src, uv + dir * 1.385) + texture2D(src, uv - dir * 1.385)) * 0.316;
  s += (texture2D(src, uv + dir * 3.231) + texture2D(src, uv - dir * 3.231)) * 0.070;
  gl_FragColor = s;
}`

// 3. combine everything
const COMPOSITE = `
precision mediump float;
varying vec2 uv;
uniform sampler2D src;
uniform sampler2D glow;
uniform float bloom, distortion, time, contrast, vignette;
uniform vec3 tint;

// cheap smooth noise (value noise): random values on a grid, smoothly blended between
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void main() {
  vec2 p = uv;
  if (distortion > 0.0) {
    // heat rises: noise scrolls upward, and the effect is stronger near the bottom (uv.y small)
    float heat = distortion * (0.3 + 0.7 * (1.0 - uv.y));
    vec2 n = vec2(noise(uv * vec2(9.0, 14.0) + vec2(0.0, -time * 1.6)),
                  noise(uv * vec2(11.0, 7.0) + vec2(time * 0.7, -time * 1.2))) - 0.5;
    p += n * 0.012 * heat;
  }
  vec4 base = texture2D(src, p);
  vec4 g = texture2D(glow, p);
  vec3 col = base.rgb + g.rgb * bloom;               // add the glow (premultiplied colours)
  float a = clamp(base.a + g.a * bloom * 0.6, 0.0, 1.0);
  col *= tint;
  col = (col - 0.5 * a) * contrast + 0.5 * a;        // contrast around mid-grey
  float v = 1.0 - vignette * smoothstep(0.35, 0.95, length(uv - 0.5) * 1.3);
  col *= v;
  gl_FragColor = vec4(max(col, 0.0), a);
}`

type Target = { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }

export class PostFX {
  readonly canvas: HTMLCanvasElement
  private gl: WebGLRenderingContext | null
  private progs: Record<string, WebGLProgram> = {}
  private srcTex: WebGLTexture | null = null
  private a: Target | null = null
  private b: Target | null = null
  private quad: WebGLBuffer | null = null
  readonly ok: boolean

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false })
    this.ok = !!this.gl && this.init()
    if (!this.ok) console.warn('WebGL post-processing unavailable; falling back to plain 2D')
  }

  private compile(fragSrc: string) {
    const gl = this.gl!
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error')
      return s
    }
    const p = gl.createProgram()!
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT))
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fragSrc))
    gl.bindAttribLocation(p, 0, 'pos')
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error')
    return p
  }

  private init() {
    try {
      const gl = this.gl!
      this.progs = { bright: this.compile(BRIGHT), blur: this.compile(BLUR), comp: this.compile(COMPOSITE) }
      // one rectangle covering the whole screen; every pass draws it, the shader does the work
      this.quad = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
      this.srcTex = this.makeTex()
      return true
    } catch (e) {
      console.warn(e)
      return false
    }
  }

  private makeTex() {
    const gl = this.gl!
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }

  /** an offscreen image the GPU can draw INTO (framebuffer) and then read FROM (texture) */
  private makeTarget(w: number, h: number): Target {
    const gl = this.gl!
    const tex = this.makeTex()
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    const fb = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    return { fb, tex, w, h }
  }

  private pass(prog: WebGLProgram, target: Target | null, uniforms: (gl: WebGLRenderingContext, p: WebGLProgram) => void) {
    const gl = this.gl!
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null)
    gl.viewport(0, 0, target ? target.w : this.canvas.width, target ? target.h : this.canvas.height)
    gl.useProgram(prog)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    uniforms(gl, prog)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  clear() {
    if (!this.ok) return
    const gl = this.gl!
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  /** run the full chain: source 2D canvas -> screen */
  render(source: HTMLCanvasElement, s: PostSettings, time: number) {
    if (!this.ok) return
    const gl = this.gl!
    const W = source.width, H = source.height
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H }
    const qw = Math.max(1, W >> 2), qh = Math.max(1, H >> 2)
    if (!this.a || this.a.w !== qw) { this.a = this.makeTarget(qw, qh); this.b = this.makeTarget(qw, qh) }
    const A = this.a, B = this.b!

    // upload the 2D canvas as a texture (premultiplied, so glow adds up correctly on transparency)
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)

    const bindTex = (unit: number, tex: WebGLTexture, p: WebGLProgram, name: string) => {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.uniform1i(gl.getUniformLocation(p, name), unit)
    }

    if (s.bloom > 0) {
      // 1. bright pass -> A (quarter size)
      this.pass(this.progs.bright, A, (gl, p) => {
        bindTex(0, this.srcTex!, p, 'src')
        gl.uniform1f(gl.getUniformLocation(p, 'threshold'), s.threshold)
      })
      // 2. blur A -> B (horizontal) -> A (vertical), twice = wide soft glow
      for (let i = 0; i < 2; i++) {
        this.pass(this.progs.blur, B, (gl, p) => { bindTex(0, A.tex, p, 'src'); gl.uniform2f(gl.getUniformLocation(p, 'dir'), (1 + i) / qw, 0) })
        this.pass(this.progs.blur, A, (gl, p) => { bindTex(0, B.tex, p, 'src'); gl.uniform2f(gl.getUniformLocation(p, 'dir'), 0, (1 + i) / qh) })
      }
    }

    // 3. composite -> screen
    gl.clearColor(0, 0, 0, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.clear(gl.COLOR_BUFFER_BIT)
    this.pass(this.progs.comp, null, (gl, p) => {
      bindTex(0, this.srcTex!, p, 'src')
      bindTex(1, A.tex, p, 'glow')
      const u = (n: string) => gl.getUniformLocation(p, n)
      gl.uniform1f(u('bloom'), s.bloom)
      gl.uniform1f(u('distortion'), s.distortion)
      gl.uniform1f(u('time'), time)
      gl.uniform1f(u('contrast'), s.contrast)
      gl.uniform1f(u('vignette'), s.vignette)
      gl.uniform3f(u('tint'), s.tint[0], s.tint[1], s.tint[2])
    })
  }
}
