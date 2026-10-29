// WebGL2 approximation of render/render.py, fast enough for real-time preview.
// Same camera model and panel geometry; LCD subpixels, defocus, reflection, AE, noise and tone
// are approximations (the Python renderer remains the reference).

const VS = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uDesk; uniform sampler2D uWin; uniform sampler2D uBar;
uniform vec2 uOut, uView, uPanel;
uniform vec4 uWinRect, uBarRect;
uniform float uRadius, uPP;
uniform vec3 uC0, uR0, uD0, uF0, uC1, uR1, uD1, uF1;
uniform int uNT, uTaps;
uniform float uFx, uFocus, uMacro, uExposure, uDawn, uGain, uPhys, uMeter, uDof;
uniform uint uFrame;
uniform vec3 uLamp, uWindow;
out vec4 outColor;

float sdRound(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float winSd(vec2 px){ vec2 w = px - uWinRect.xy; return sdRound(w - uWinRect.zw * 0.5, uWinRect.zw * 0.5, uRadius); }
int regionOf(vec2 px){
  vec2 w = px - uWinRect.xy;
  if (w.x >= 0.0 && w.y >= 0.0 && w.x < uWinRect.z && w.y < uWinRect.w && winSd(px) < 0.0) return 1;
  vec2 b = px - uBarRect.xy;
  if (b.x >= 0.0 && b.y >= 0.0 && b.x < uBarRect.z && b.y < uBarRect.w) return 2;
  return 0;
}
vec3 border(vec2 px, vec3 c){ float b = clamp(winSd(px) + 1.5, 0.0, 1.0); return mix(c, vec3(1.0), 0.22 * b); }
bool outside(vec2 px){ return px.x < 0.0 || px.y < 0.0 || px.x >= uPanel.x || px.y >= uPanel.y; }
vec3 fetchN(vec2 px){
  if (outside(px)) return vec3(0.0);
  int r = regionOf(px);
  if (r == 1) return border(px, texelFetch(uWin, ivec2(floor(px - uWinRect.xy)), 0).rgb);
  if (r == 2) return texelFetch(uBar, ivec2(floor(px - uBarRect.xy)), 0).rgb;
  return texelFetch(uDesk, ivec2(floor(px)), 0).rgb;
}
vec3 fetchL(vec2 px, float lod){
  if (outside(px)) return vec3(0.0);
  int r = regionOf(px);
  if (r == 1) return border(px, textureLod(uWin, (px - uWinRect.xy) / uWinRect.zw, lod).rgb);
  if (r == 2) return textureLod(uBar, (px - uBarRect.xy) / uBarRect.zw, lod).rgb;
  return textureLod(uDesk, px / uPanel, lod).rgb;
}
float win1(float x, float lo, float hi, float e){ return clamp((x - lo) / e, 0.0, 1.0) * clamp((hi - x) / e, 0.0, 1.0); }
// LCD emission: pixel colour x RGB-stripe aperture (black matrix), contrast km after blur
vec3 emission(vec2 px, float km, float sigP, float lod){
  if (km > 0.003) {
    vec3 cN = fetchN(px);
    vec3 cL = fetchL(px, max(log2(max(sigP * 2.0, 1e-4)), 0.0));
    vec3 col = mix(cN, cL, smoothstep(0.25, 0.8, sigP));
    float sub = fract(px.x) * 3.0; float k = floor(sub); float g = sub - k;
    float ap = win1(g, 0.13, 0.87, 0.06) * win1(fract(px.y), 0.06, 0.94, 0.05);
    float m = ap * 3.0 / (0.74 * 0.88);
    vec3 mv = vec3(k < 0.5 ? m : 0.0, (k > 0.5 && k < 1.5) ? m : 0.0, k > 1.5 ? m : 0.0);
    return col * (1.0 + km * (mv - 1.0));
  }
  return fetchL(px, lod);
}
uint pcg(uint v){ uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
float rnd(uvec3 v){ return float(pcg(v.x + pcg(v.y + pcg(v.z)))) / 4294967295.0; }
float gauss(uvec3 v){ float u1 = max(rnd(v), 1e-7); float u2 = rnd(v + uvec3(7919u, 104729u, 1299709u)); return sqrt(-2.0 * log(u1)) * cos(6.2831853 * u2); }
vec3 tone(vec3 x){
  float W = 6.0; vec3 y = x * (1.0 + x / (W * W)) / (1.0 + x); y = clamp(y * 1.12, 0.0, 1.0);
  return mix(12.92 * y, 1.055 * pow(y, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), y));
}
void main(){
  vec2 p = vec2(gl_FragCoord.x, uView.y - gl_FragCoord.y) * (uOut / uView);
  float xn = (p.x - uOut.x * 0.5) / uFx, yn = (p.y - uOut.y * 0.5) / uFx;
  float viewScale = uOut.x / uView.x;
  bool mac = uMacro > 0.5;
  float fl = mac ? 2.22 : 6.86, Nf = mac ? 2.2 : 1.78, sw = mac ? 1.8 : 4.9;
  float A = (fl * fl / (Nf * max(uFocus - fl, 1e-3))) / sw * uOut.x;
  vec3 acc = vec3(0.0), Dc = vec3(0.0, 0.0, 1.0);
  int nt = max(uNT, 1);
  for (int j = 0; j < 8; j++) {
    if (j >= nt) break;
    float a = nt > 1 ? (float(j) + 0.5) / float(nt) : 0.5;
    vec3 C = mix(uC0, uC1, a), R = mix(uR0, uR1, a), Dd = mix(uD0, uD1, a), F = mix(uF0, uF1, a);
    vec3 D = R * xn + Dd * yn + F;
    if (j == 0) Dc = D;
    float s = -C.z / D.z;
    vec3 X = C + s * D;
    vec2 px = X.xy / uPP;
    float fpOut = s / uFx / uPP;               // panel px per output px
    float fpView = fpOut * viewScale;           // per displayed px
    float sigCoc = uDof * A * abs(s - uFocus) / max(s, 1e-3) / 2.4 * fpOut;
    float disp = viewScale > 1.01 ? 0.42 * fpView : 0.0;
    float sigP = sqrt(pow(0.275 * fpOut, 2.0) + sigCoc * sigCoc + disp * disp);
    float km = uPhys > 0.5 ? exp(-19.7392 * sigP * sigP) : 0.0;
    vec3 e = vec3(0.0);
    if (sigCoc > 0.5 * max(fpView, 0.6) && uTaps > 1) {
      float lodT = max(log2(max(max(fpView, sigCoc * 0.6), 1e-4)), 0.0);
      float rad = 1.3 * sigCoc;
      for (int i = 0; i < 12; i++) {
        if (i >= uTaps) break;
        float r = sqrt((float(i) + 0.5) / float(uTaps)) * rad, th = float(i) * 2.39996;
        e += emission(px + r * vec2(cos(th), sin(th)), km, sigP, lodT);
      }
      e /= float(uTaps);
    } else {
      e = emission(px, km, sigP, max(log2(max(fpView, 1e-4)), 0.0));
    }
    acc += e;
  }
  vec3 img = acc / float(nt);
  if (uMeter > 0.5) { float l = dot(img, vec3(0.2126, 0.7152, 0.0722)); outColor = vec4(sqrt(clamp(l * 4.0, 0.0, 1.0)), 0.0, 0.0, 1.0); return; }
  // room reflected in the glass: warm lamp up-left (fades at dawn) + cool window light
  vec3 Dn = normalize(Dc); vec3 Rf = vec3(Dn.xy, -Dn.z);
  float ca = dot(Rf, normalize(uLamp));
  float lamp = (exp((ca - 1.0) / 0.006) * 1.3 + exp((ca - 1.0) / 0.05) * 0.10) * (1.0 - 0.75 * uDawn);
  float base = 0.010 + pow(clamp(-Rf.y, 0.0, 1.0), 1.5) * 0.035 + 0.03 * uDawn;
  vec3 refl = vec3(lamp + base, lamp * 0.80 + base * 0.95, lamp * 0.55 + base * 0.9);
  float cw = dot(Rf, normalize(uWindow));
  refl += (exp((cw - 1.0) / 0.02) * 2.6 + exp((cw - 1.0) / 0.12) * 0.35) * uDawn * vec3(0.78, 0.9, 1.08);
  img += refl * 0.035;
  vec2 q = p - uOut * 0.5; float rr = dot(q, q) / dot(uOut * 0.5, uOut * 0.5);
  img *= 1.0 - 0.16 * rr;
  img *= vec3(0.965, 1.0, 1.05) * uExposure;
  if (uPhys > 0.5) {
    uvec2 ip = uvec2(p); uvec2 ic = uvec2(p / 3.0);
    vec3 sd = sqrt(max(img, 0.0) * 0.0009 * uGain + pow(0.0028 * uGain, 2.0));
    float nl = gauss(uvec3(ip, uFrame));
    vec3 nc = vec3(gauss(uvec3(ic, uFrame * 3u + 1u)), gauss(uvec3(ic, uFrame * 3u + 2u)), gauss(uvec3(ic, uFrame * 3u + 3u)));
    img += sd * (0.8 * nl + 0.35 * nc);
  }
  vec3 o = tone(max(img, 0.0));
  float lum = dot(o, vec3(0.2126, 0.7152, 0.0722));
  outColor = vec4(lum + (o - lum) * 0.92, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

export class Renderer {
  constructor(canvas, geom) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('浏览器不支持 WebGL2');
    this.gl = gl; this.canvas = canvas; this.g = geom;
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.prog = p;
    this.vao = gl.createVertexArray();
    this.u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); this.u[info.name] = gl.getUniformLocation(p, info.name); }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    const G = geom;
    this.tex = {
      desk: this._mk(G.PANEL_W, G.PANEL_H),
      win: this._mk(G.WIN_W, G.WIN_H),
      bar: this._mk(G.BAR[2], G.BAR[3]),
    };
    this.winRect = [G.WIN_X, G.WIN_Y + G.NOTCH, G.WIN_W, G.WIN_H];
    this.barRect = [G.BAR[0], G.BAR[1] + G.NOTCH, G.BAR[2], G.BAR[3]];
    // metering target
    this.mw = 64; this.mh = 36;
    this.mtex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.mtex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, this.mw, this.mh);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.mtex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.mbuf = new Uint8Array(this.mw * this.mh * 4);
    this.mwgt = new Float32Array(this.mw * this.mh); let ws = 0;
    for (let y = 0; y < this.mh; y++) for (let x = 0; x < this.mw; x++) {
      const w = Math.exp(-(((x + 0.5 - this.mw / 2) / (this.mw * 0.4375)) ** 2 + ((y + 0.5 - this.mh / 2) / (this.mh * 0.5)) ** 2));
      this.mwgt[y * this.mw + x] = w; ws += w;
    }
    this.mwsum = ws;
  }

  _mk(w, h) {
    const gl = this.gl, t = gl.createTexture();
    const levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.SRGB8_ALPHA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  upload(name, src) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex[name]);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  _uniforms(P, view, meter) {
    const gl = this.gl, u = this.u, G = this.g;
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    [['uDesk', 'desk', 0], ['uWin', 'win', 1], ['uBar', 'bar', 2]].forEach(([un, tn, i]) => {
      gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, this.tex[tn]); gl.uniform1i(u[un], i);
    });
    gl.uniform2f(u.uOut, 1920, 1080);
    gl.uniform2f(u.uView, view[0], view[1]);
    gl.uniform2f(u.uPanel, G.PANEL_W, G.PANEL_H);
    gl.uniform4fv(u.uWinRect, this.winRect);
    gl.uniform4fv(u.uBarRect, this.barRect);
    gl.uniform1f(u.uRadius, G.RADIUS);
    gl.uniform1f(u.uPP, P.PP);
    const a = P.pose0, b = P.pose1;
    gl.uniform3fv(u.uC0, a.C); gl.uniform3fv(u.uR0, a.right); gl.uniform3fv(u.uD0, a.down); gl.uniform3fv(u.uF0, a.fwd);
    gl.uniform3fv(u.uC1, b.C); gl.uniform3fv(u.uR1, b.right); gl.uniform3fv(u.uD1, b.down); gl.uniform3fv(u.uF1, b.fwd);
    gl.uniform1i(u.uNT, meter ? 1 : P.nt);
    gl.uniform1i(u.uTaps, meter ? 1 : (P.phys ? 8 : 1));
    gl.uniform1f(u.uFx, P.fx);
    gl.uniform1f(u.uFocus, P.focus);
    gl.uniform1f(u.uMacro, P.macro ? 1 : 0);
    gl.uniform1f(u.uExposure, P.exposure);
    gl.uniform1f(u.uDawn, P.dawn);
    gl.uniform1f(u.uGain, P.gain);
    gl.uniform1f(u.uPhys, meter ? 0 : (P.phys ? 1 : 0));
    gl.uniform1f(u.uDof, P.dof === false ? 0 : 1);
    gl.uniform1f(u.uMeter, meter ? 1 : 0);
    gl.uniform1ui(u.uFrame, (P.frame >>> 0) + 1);
    gl.uniform3fv(u.uLamp, P.lamp);
    gl.uniform3fv(u.uWindow, P.window || [0.16, -0.21, -0.96]);
  }

  meter(P) {
    const gl = this.gl;
    this._uniforms(P, [this.mw, this.mh], true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.mw, this.mh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, this.mw, this.mh, gl.RGBA, gl.UNSIGNED_BYTE, this.mbuf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let s = 0;
    for (let i = 0; i < this.mw * this.mh; i++) { const v = this.mbuf[i * 4] / 255; s += (v * v / 4) * this.mwgt[i]; }
    return s / this.mwsum;
  }

  draw(P) {
    const gl = this.gl, c = this.canvas;
    this._uniforms(P, [c.width, c.height], false);
    gl.viewport(0, 0, c.width, c.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
