/**
 * Lightweight Material 3 color scheme generator.
 *
 * A direct port of the reference `@material/material-color-utilities` 0.4.0
 * (Apache-2.0, Copyright 2021 Google LLC), trimmed to only the pieces this
 * module needs. It includes:
 * - The full HCT core: CAM16 + HctSolver (the geometric Y-plane / RGB-cube
 *   bisection) + ViewingConditions + Hct + TonalPalette
 * - The full contrast machinery: ContrastCurve, ToneDeltaPair, Contrast
 *   (WCAG-style Y ratios), and DynamicColor with the 2021-spec resolution
 *   delegate (contrast curves, tone-delta pairs, awkward-zone handling,
 *   dual-background resolution)
 * - The 2021-spec Tonal Spot color definitions (ColorSpecDelegateImpl2021)
 *
 * Generated colors are pixel-identical to the reference library output at
 * every contrast level (standard / medium / high) for the TONAL_SPOT variant
 * on the phone platform (the library defaults). Palette constants: fixed
 * chroma 36 / 16 / 24 / 6 / 8 for primary, secondary, tertiary, neutral, and
 * neutral variant; error at hue 25, chroma 84.
 */

// ─── ARGB helpers ───────────────────────────────────────────────────────────

/** Convert `#RRGGBB` or `#AARRGGBB` → 32-bit ARGB integer. */
export function argbFromHex(hex: string): number {
  hex = hex.replace(/^#/, '');
  if (hex.length === 6) return parseInt(`ff${hex}`, 16);
  if (hex.length === 8) return parseInt(hex, 16);
  throw new Error(`Invalid hex color: ${hex}`);
}

/** Convert 32-bit ARGB integer → `#RRGGBB`. */
export function hexFromArgb(argb: number): string {
  return `#${(argb & 0xffffff).toString(16).padStart(6, '0').toUpperCase()}`;
}

// ─── Math utilities ─────────────────────────────────────────────────────────

/** 1 if num > 0, -1 if num < 0, and 0 if num = 0. */
function signum(num: number): number {
  if (num < 0) return -1;
  if (num === 0) return 0;
  return 1;
}

/** Linear interpolation: start if amount = 0, stop if amount = 1. */
function lerp(start: number, stop: number, amount: number): number {
  return (1.0 - amount) * start + amount * stop;
}

/** Clamp an integer between two integers. */
function clampInt(min: number, max: number, input: number): number {
  if (input < min) return min;
  if (input > max) return max;
  return input;
}

/** Clamp a double between two doubles. */
function clampDouble(min: number, max: number, input: number): number {
  if (input < min) return min;
  if (input > max) return max;
  return input;
}

/** Sanitize a degree measure to 0.0 <= degrees < 360.0. */
function sanitizeDegreesDouble(degrees: number): number {
  degrees = degrees % 360.0;
  if (degrees < 0) degrees = degrees + 360.0;
  return degrees;
}

/** Multiply a 1x3 row vector by a 3x3 matrix. */
function matrixMultiply(row: number[], matrix: number[][]): number[] {
  const a = row[0] * matrix[0][0] + row[1] * matrix[0][1] + row[2] * matrix[0][2];
  const b = row[0] * matrix[1][0] + row[1] * matrix[1][1] + row[2] * matrix[1][2];
  const c = row[0] * matrix[2][0] + row[1] * matrix[2][1] + row[2] * matrix[2][2];
  return [a, b, c];
}

// ─── Color utilities (sRGB / XYZ / Lab) ────────────────────────────────────

const SRGB_TO_XYZ = [
  [0.41233895, 0.35762064, 0.18051042],
  [0.2126, 0.7152, 0.0722],
  [0.01932141, 0.11916382, 0.95034478],
];
const XYZ_TO_SRGB = [
  [3.2413774792388685, -1.5376652402851851, -0.49885366846268053],
  [-0.9691452513005321, 1.8758853451067872, 0.04156585616912061],
  [0.05562093689691305, -0.20395524564742123, 1.0571799111220335],
];
const WHITE_POINT_D65 = [95.047, 100.0, 108.883];

/** Convert RGB components (0-255) to ARGB. */
function argbFromRgb(red: number, green: number, blue: number): number {
  return ((255 << 24) | ((red & 255) << 16) | ((green & 255) << 8) | (blue & 255)) >>> 0;
}

/** Convert linear RGB components (0-100 scale) to ARGB. */
function argbFromLinrgb(linrgb: number[]): number {
  const r = delinearized(linrgb[0]);
  const g = delinearized(linrgb[1]);
  const b = delinearized(linrgb[2]);
  return argbFromRgb(r, g, b);
}

function redFromArgb(argb: number): number {
  return (argb >> 16) & 255;
}
function greenFromArgb(argb: number): number {
  return (argb >> 8) & 255;
}
function blueFromArgb(argb: number): number {
  return argb & 255;
}

/** Convert XYZ (0-100 scale) to ARGB. */
function argbFromXyz(x: number, y: number, z: number): number {
  const matrix = XYZ_TO_SRGB;
  const linearR = matrix[0][0] * x + matrix[0][1] * y + matrix[0][2] * z;
  const linearG = matrix[1][0] * x + matrix[1][1] * y + matrix[1][2] * z;
  const linearB = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2] * z;
  const r = delinearized(linearR);
  const g = delinearized(linearG);
  const b = delinearized(linearB);
  return argbFromRgb(r, g, b);
}

/** Convert ARGB to XYZ (0-100 scale). */
function xyzFromArgb(argb: number): number[] {
  const r = linearized(redFromArgb(argb));
  const g = linearized(greenFromArgb(argb));
  const b = linearized(blueFromArgb(argb));
  return matrixMultiply([r, g, b], SRGB_TO_XYZ);
}

/** Convert L* to ARGB gray. */
function argbFromLstar(lstar: number): number {
  const y = yFromLstar(lstar);
  const component = delinearized(y);
  return argbFromRgb(component, component, component);
}

/** Compute L* of an ARGB color. */
function lstarFromArgb(argb: number): number {
  const y = xyzFromArgb(argb)[1];
  return 116.0 * labF(y / 100.0) - 16.0;
}

/** Convert L* to Y (0-100). */
function yFromLstar(lstar: number): number {
  return 100.0 * labInvf((lstar + 16.0) / 116.0);
}

/** Linearize an RGB component: 0-255 → 0-100. */
function linearized(rgbComponent: number): number {
  const normalized = rgbComponent / 255.0;
  if (normalized <= 0.040449936) {
    return (normalized / 12.92) * 100.0;
  }
  return ((normalized + 0.055) / 1.055) ** 2.4 * 100.0;
}

/** Delinearize an RGB component: 0-100 → 0-255. */
function delinearized(rgbComponent: number): number {
  const normalized = rgbComponent / 100.0;
  let delinearized = 0.0;
  if (normalized <= 0.0031308) {
    delinearized = normalized * 12.92;
  } else {
    delinearized = 1.055 * normalized ** (1.0 / 2.4) - 0.055;
  }
  return clampInt(0, 255, Math.round(delinearized * 255.0));
}

/** The standard white point; white on a sunny day. */
function whitePointD65(): number[] {
  return WHITE_POINT_D65;
}

function labF(t: number): number {
  const e = 216.0 / 24389.0;
  const kappa = 24389.0 / 27.0;
  if (t > e) {
    return t ** (1.0 / 3.0);
  }
  return (kappa * t + 16) / 116;
}

function labInvf(ft: number): number {
  const e = 216.0 / 24389.0;
  const kappa = 24389.0 / 27.0;
  const ft3 = ft * ft * ft;
  if (ft3 > e) {
    return ft3;
  }
  return (116 * ft - 16) / kappa;
}

/** L\* (CIELAB lightness) from a Y luminance (0..100). */
function lstarFromY(y: number): number {
  return labF(y / 100.0) * 116.0 - 16.0;
}

// ─── Viewing conditions ─────────────────────────────────────────────────────

/**
 * Viewing conditions for the CAM16 color appearance model. This class caches
 * the intermediate values that depend only on the environment, so colors can
 * be converted to and from CAM16 under consistent assumptions.
 */
export class ViewingConditions {
  static make(
    whitePoint: number[] = whitePointD65(),
    adaptingLuminance: number = ((200.0 / Math.PI) * yFromLstar(50.0)) / 100.0,
    backgroundLstar: number = 50.0,
    surround: number = 2.0,
    discountingIlluminant: boolean = false
  ): ViewingConditions {
    const xyz = whitePoint;
    const rW = xyz[0] * 0.401288 + xyz[1] * 0.650173 + xyz[2] * -0.051461;
    const gW = xyz[0] * -0.250268 + xyz[1] * 1.204414 + xyz[2] * 0.045854;
    const bW = xyz[0] * -0.002079 + xyz[1] * 0.048952 + xyz[2] * 0.953127;
    const f = 0.8 + surround / 10.0;
    const c = f >= 0.9 ? lerp(0.59, 0.69, (f - 0.9) * 10.0) : lerp(0.525, 0.59, (f - 0.8) * 10.0);
    let d = discountingIlluminant
      ? 1.0
      : f * (1.0 - (1.0 / 3.6) * Math.exp((-adaptingLuminance - 42.0) / 92.0));
    d = d > 1.0 ? 1.0 : d < 0.0 ? 0.0 : d;
    const nc = f;
    const rgbD = [
      d * (100.0 / rW) + 1.0 - d,
      d * (100.0 / gW) + 1.0 - d,
      d * (100.0 / bW) + 1.0 - d,
    ];
    const k = 1.0 / (5.0 * adaptingLuminance + 1.0);
    const k4 = k * k * k * k;
    const k4F = 1.0 - k4;
    const fl = k4 * adaptingLuminance + 0.1 * k4F * k4F * Math.cbrt(5.0 * adaptingLuminance);
    const n = yFromLstar(backgroundLstar) / whitePoint[1];
    const z = 1.48 + Math.sqrt(n);
    const nbb = 0.725 / n ** 0.2;
    const ncb = nbb;
    const rgbAFactors = [
      ((fl * rgbD[0] * rW) / 100.0) ** 0.42,
      ((fl * rgbD[1] * gW) / 100.0) ** 0.42,
      ((fl * rgbD[2] * bW) / 100.0) ** 0.42,
    ];
    const rgbA = [
      (400.0 * rgbAFactors[0]) / (rgbAFactors[0] + 27.13),
      (400.0 * rgbAFactors[1]) / (rgbAFactors[1] + 27.13),
      (400.0 * rgbAFactors[2]) / (rgbAFactors[2] + 27.13),
    ];
    const aw = (2.0 * rgbA[0] + rgbA[1] + 0.05 * rgbA[2]) * nbb;
    return new ViewingConditions(n, aw, nbb, ncb, c, nc, rgbD, fl, fl ** 0.25, z);
  }

  constructor(
    readonly n: number,
    readonly aw: number,
    readonly nbb: number,
    readonly ncb: number,
    readonly c: number,
    readonly nc: number,
    readonly rgbD: number[],
    readonly fl: number,
    readonly fLRoot: number,
    readonly z: number
  ) {}

  /** sRGB-like viewing conditions. */
  static DEFAULT: ViewingConditions = ViewingConditions.make();
}

// ─── CAM16 ──────────────────────────────────────────────────────────────────

/**
 * CAM16, a color appearance model. Colors are not just defined by their hex
 * code, but rather, a hex code and viewing conditions.
 */
export class Cam16 {
  constructor(
    readonly hue: number,
    readonly chroma: number,
    readonly j: number,
    readonly q: number,
    readonly m: number,
    readonly s: number,
    readonly jstar: number,
    readonly astar: number,
    readonly bstar: number
  ) {}

  /** Distance between two colors, in CAM16-UCS. */
  distance(other: Cam16): number {
    const dJ = this.jstar - other.jstar;
    const dA = this.astar - other.astar;
    const dB = this.bstar - other.bstar;
    const dEPrime = Math.sqrt(dJ * dJ + dA * dA + dB * dB);
    return 1.41 * dEPrime ** 0.63;
  }

  /** Convert an ARGB color to CAM16 under default viewing conditions. */
  static fromInt(argb: number): Cam16 {
    return Cam16.fromIntInViewingConditions(argb, ViewingConditions.DEFAULT);
  }

  static fromIntInViewingConditions(argb: number, viewingConditions: ViewingConditions): Cam16 {
    const red = (argb & 0x00ff0000) >> 16;
    const green = (argb & 0x0000ff00) >> 8;
    const blue = argb & 0x000000ff;
    const redL = linearized(red);
    const greenL = linearized(green);
    const blueL = linearized(blue);
    const x = 0.41233895 * redL + 0.35762064 * greenL + 0.18051042 * blueL;
    const y = 0.2126 * redL + 0.7152 * greenL + 0.0722 * blueL;
    const z = 0.01932141 * redL + 0.11916382 * greenL + 0.95034478 * blueL;
    const rC = 0.401288 * x + 0.650173 * y - 0.051461 * z;
    const gC = -0.250268 * x + 1.204414 * y + 0.045854 * z;
    const bC = -0.002079 * x + 0.048952 * y + 0.953127 * z;
    const rD = viewingConditions.rgbD[0] * rC;
    const gD = viewingConditions.rgbD[1] * gC;
    const bD = viewingConditions.rgbD[2] * bC;
    const rAF = ((viewingConditions.fl * Math.abs(rD)) / 100.0) ** 0.42;
    const gAF = ((viewingConditions.fl * Math.abs(gD)) / 100.0) ** 0.42;
    const bAF = ((viewingConditions.fl * Math.abs(bD)) / 100.0) ** 0.42;
    const rA = (signum(rD) * 400.0 * rAF) / (rAF + 27.13);
    const gA = (signum(gD) * 400.0 * gAF) / (gAF + 27.13);
    const bA = (signum(bD) * 400.0 * bAF) / (bAF + 27.13);
    const a = (11.0 * rA + -12.0 * gA + bA) / 11.0;
    const b = (rA + gA - 2.0 * bA) / 9.0;
    const u = (20.0 * rA + 20.0 * gA + 21.0 * bA) / 20.0;
    const p2 = (40.0 * rA + 20.0 * gA + bA) / 20.0;
    const atan2 = Math.atan2(b, a);
    const atanDegrees = (atan2 * 180.0) / Math.PI;
    const hue = sanitizeDegreesDouble(atanDegrees);
    const hueRadians = (hue * Math.PI) / 180.0;
    const ac = p2 * viewingConditions.nbb;
    const j = 100.0 * (ac / viewingConditions.aw) ** (viewingConditions.c * viewingConditions.z);
    const q =
      (4.0 / viewingConditions.c) *
      Math.sqrt(j / 100.0) *
      (viewingConditions.aw + 4.0) *
      viewingConditions.fLRoot;
    const huePrime = hue < 20.14 ? hue + 360 : hue;
    const eHue = 0.25 * (Math.cos((huePrime * Math.PI) / 180.0 + 2.0) + 3.8);
    const p1 = (50000.0 / 13.0) * eHue * viewingConditions.nc * viewingConditions.ncb;
    const t = (p1 * Math.sqrt(a * a + b * b)) / (u + 0.305);
    const alpha = t ** 0.9 * (1.64 - 0.29 ** viewingConditions.n) ** 0.73;
    const c = alpha * Math.sqrt(j / 100.0);
    const m = c * viewingConditions.fLRoot;
    const s = 50.0 * Math.sqrt((alpha * viewingConditions.c) / (viewingConditions.aw + 4.0));
    const jstar = ((1.0 + 100.0 * 0.007) * j) / (1.0 + 0.007 * j);
    const mstar = (1.0 / 0.0228) * Math.log(1.0 + 0.0228 * m);
    const astar = mstar * Math.cos(hueRadians);
    const bstar = mstar * Math.sin(hueRadians);
    return new Cam16(hue, c, j, q, m, s, jstar, astar, bstar);
  }

  /** Convert CAM16 to ARGB under default viewing conditions. */
  toInt(): number {
    return this.viewed(ViewingConditions.DEFAULT);
  }

  viewed(viewingConditions: ViewingConditions): number {
    const alpha =
      this.chroma === 0.0 || this.j === 0.0 ? 0.0 : this.chroma / Math.sqrt(this.j / 100.0);
    const t = (alpha / (1.64 - 0.29 ** viewingConditions.n) ** 0.73) ** (1.0 / 0.9);
    const hRad = (this.hue * Math.PI) / 180.0;
    const eHue = 0.25 * (Math.cos(hRad + 2.0) + 3.8);
    const ac =
      viewingConditions.aw * (this.j / 100.0) ** (1.0 / viewingConditions.c / viewingConditions.z);
    const p1 = eHue * (50000.0 / 13.0) * viewingConditions.nc * viewingConditions.ncb;
    const p2 = ac / viewingConditions.nbb;
    const hSin = Math.sin(hRad);
    const hCos = Math.cos(hRad);
    const gamma = (23.0 * (p2 + 0.305) * t) / (23.0 * p1 + 11.0 * t * hCos + 108.0 * t * hSin);
    const a = gamma * hCos;
    const b = gamma * hSin;
    const rA = (460.0 * p2 + 451.0 * a + 288.0 * b) / 1403.0;
    const gA = (460.0 * p2 - 891.0 * a - 261.0 * b) / 1403.0;
    const bA = (460.0 * p2 - 220.0 * a - 6300.0 * b) / 1403.0;
    const rCBase = Math.max(0, (27.13 * Math.abs(rA)) / (400.0 - Math.abs(rA)));
    const rC = signum(rA) * (100.0 / viewingConditions.fl) * rCBase ** (1.0 / 0.42);
    const gCBase = Math.max(0, (27.13 * Math.abs(gA)) / (400.0 - Math.abs(gA)));
    const gC = signum(gA) * (100.0 / viewingConditions.fl) * gCBase ** (1.0 / 0.42);
    const bCBase = Math.max(0, (27.13 * Math.abs(bA)) / (400.0 - Math.abs(bA)));
    const bC = signum(bA) * (100.0 / viewingConditions.fl) * bCBase ** (1.0 / 0.42);
    const rF = rC / viewingConditions.rgbD[0];
    const gF = gC / viewingConditions.rgbD[1];
    const bF = bC / viewingConditions.rgbD[2];
    const x = 1.86206786 * rF - 1.01125463 * gF + 0.14918677 * bF;
    const y = 0.38752654 * rF + 0.62144744 * gF - 0.00897398 * bF;
    const z = -0.0158415 * rF - 0.03412294 * gF + 1.04996444 * bF;
    return argbFromXyz(x, y, z);
  }
}

// ─── HCT solver ─────────────────────────────────────────────────────────────

/**
 * A class that solves the HCT equation: given hue, chroma, and L*, find the
 * sRGB color (maximizing chroma when the requested chroma is out of gamut).
 */
export namespace HctSolver {
  export const SCALED_DISCOUNT_FROM_LINRGB = [
    [0.001200833568784504, 0.002389694492170889, 0.0002795742885861124],
    [0.0005891086651375999, 0.0029785502573438758, 0.0003270666104008398],
    [0.00010146692491640572, 0.0005364214359186694, 0.0032979401770712076],
  ];
  export const LINRGB_FROM_SCALED_DISCOUNT = [
    [1373.2198709594231, -1100.4251190754821, -7.278681089101213],
    [-271.815969077903, 559.6580465940733, -32.46047482791194],
    [1.9622899599665666, -57.173814538844006, 308.7233197812385],
  ];
  export const Y_FROM_LINRGB = [0.2126, 0.7152, 0.0722];
  export const CRITICAL_PLANES = [
    0.015176349177441876, 0.045529047532325624, 0.07588174588720938, 0.10623444424209313,
    0.13658714259697685, 0.16693984095186062, 0.19729253930674434, 0.2276452376616281,
    0.2579979360165119, 0.28835063437139563, 0.3188300904430532, 0.350925934958123,
    0.3848314933096426, 0.42057480301049466, 0.458183274052838, 0.4976837250274023,
    0.5391024159806381, 0.5824650784040898, 0.6277969426914107, 0.6751227633498623,
    0.7244668422128921, 0.775853049866786, 0.829304845476233, 0.8848452951698498, 0.942497089126609,
    1.0022825574869039, 1.0642236851973577, 1.1283421258858297, 1.1946592148522128,
    1.2631959812511864, 1.3339731595349034, 1.407011200216447, 1.4823302800086415,
    1.5599503113873272, 1.6398909516233677, 1.7221716113234105, 1.8068114625156377,
    1.8938294463134073, 1.9832442801866852, 2.075074464868551, 2.1693382909216234,
    2.2660538449872063, 2.36523901573795, 2.4669114995532007, 2.5710888059345764,
    2.6777882626779785, 2.7870270208169257, 2.898822059350997, 3.0131901897720907,
    3.1301480604002863, 3.2497121605402226, 3.3718988244681087, 3.4967242352587946,
    3.624204428461639, 3.754355295633311, 3.887192587735158, 4.022731918402185, 4.160988767090289,
    4.301978482107941, 4.445716283538092, 4.592217266055746, 4.741496401646282, 4.893568542229298,
    5.048448422192488, 5.20615066083972, 5.3666897647573375, 5.5300801301023865, 5.696336044816294,
    5.865471690767354, 6.037501145825082, 6.212438385869475, 6.390297286737924, 6.571091626112461,
    6.7548350853498045, 6.941541251256611, 7.131223617812143, 7.323895587840543, 7.5195704746346665,
    7.7182615035334345, 7.919981813454504, 8.124744458384042, 8.332562408825165, 8.543448553206703,
    8.757415699253682, 8.974476575321063, 9.194643831691977, 9.417930041841839, 9.644347703669503,
    9.873909240696694, 10.106627003236781, 10.342513269534024, 10.58158024687427, 10.8238400726681,
    11.069304815507364, 11.317986476196008, 11.569896988756009, 11.825048221409341,
    12.083451977536606, 12.345119996613247, 12.610063955123938, 12.878295467455942,
    13.149826086772048, 13.42466730586372, 13.702830557985108, 13.984327217668513,
    14.269168601521828, 14.55736596900856, 14.848930523210871, 15.143873411576273,
    15.44220572664832, 15.743938506781891, 16.04908273684337, 16.35764934889634, 16.66964922287304,
    16.985093187232053, 17.30399201960269, 17.62635644741625, 17.95219714852476, 18.281524751807332,
    18.614349837764564, 18.95068293910138, 19.290534541298456, 19.633915083172692,
    19.98083495742689, 20.331304511189067, 20.685334046541502, 21.042933821039977,
    21.404114048223256, 21.76888489811322, 22.137256497705877, 22.50923893145328,
    22.884842241736916, 23.264076429332462, 23.6469514538663, 24.033477234264016, 24.42366364919083,
    24.817520537484558, 25.21505769858089, 25.61628489293138, 26.021211842414342,
    26.429848230738664, 26.842203703840827, 27.258287870275353, 27.678110301598522,
    28.10168053274597, 28.529008062403893, 28.96010235337422, 29.39497283293396, 29.83362889318845,
    30.276079891419332, 30.722335150426627, 31.172403958865512, 31.62629557157785,
    32.08401920991837, 32.54558406207592, 33.010999283389665, 33.4802739966603, 33.953417292456834,
    34.430438229418264, 34.911345834551085, 35.39614910352207, 35.88485700094671, 36.37747846067349,
    36.87402238606382, 37.37449765026789, 37.87891309649659, 38.38727753828926, 38.89959975977785,
    39.41588851594697, 39.93615253289054, 40.460400508064545, 40.98864111053629, 41.520882981230194,
    42.05713473317016, 42.597404951718396, 43.141702194811224, 43.6900349931913, 44.24241185063697,
    44.798841244188324, 45.35933162437017, 45.92389141541209, 46.49252901546552, 47.065252796817916,
    47.64207110610409, 48.22299226451468, 48.808024568002054, 49.3971762874833, 49.9904556690408,
    50.587870934119984, 51.189430279724725, 51.79514187861014, 52.40501387947288, 53.0190544071392,
    53.637271562750364, 54.259673423945976, 54.88626804504493, 55.517063457223934,
    56.15206766869424, 56.79128866487574, 57.43473440856916, 58.08241284012621, 58.734331877617365,
    59.39049941699807, 60.05092333227251, 60.715611475655585, 61.38457167773311, 62.057811747619894,
    62.7353394731159, 63.417162620860914, 64.10328893648692, 64.79372614476921, 65.48848194977529,
    66.18756403501224, 66.89098006357258, 67.59873767827808, 68.31084450182222, 69.02730813691093,
    69.74813616640164, 70.47333615344107, 71.20291564160104, 71.93688215501312, 72.67524319850172,
    73.41800625771542, 74.16517879925733, 74.9167682708136, 75.67278210128072, 76.43322770089146,
    77.1981124613393, 77.96744375590167, 78.74122893956174, 79.51947534912904, 80.30219030335869,
    81.08938110306934, 81.88105503125999, 82.67721935322541, 83.4778813166706, 84.28304815182372,
    85.09272707154808, 85.90692527145302, 86.72564993000343, 87.54890820862819, 88.3767072518277,
    89.2090541872801, 90.04595612594655, 90.88742016217518, 91.73345337380438, 92.58406282226491,
    93.43925555268066, 94.29903859396902, 95.16341895893969, 96.03240364439274, 96.9059996312159,
    97.78421388448044, 98.6670533535366, 99.55452497210776,
  ];

  /** Sanitizes a small enough angle in radians. */
  export function sanitizeRadians(angle: number): number {
    return (angle + Math.PI * 8) % (Math.PI * 2);
  }

  /** Delinearizes an RGB component: 0-100 → 0-255. */
  export function trueDelinearized(rgbComponent: number): number {
    const normalized = rgbComponent / 100.0;
    let delinearized = 0.0;
    if (normalized <= 0.0031308) {
      delinearized = normalized * 12.92;
    } else {
      delinearized = 1.055 * normalized ** (1.0 / 2.4) - 0.055;
    }
    return delinearized * 255.0;
  }

  export function chromaticAdaptation(component: number): number {
    const af = Math.abs(component) ** 0.42;
    return (signum(component) * 400.0 * af) / (af + 27.13);
  }

  /** Returns the hue of a linear RGB color in CAM16, in radians. */
  export function hueOf(linrgb: number[]): number {
    const scaledDiscount = matrixMultiply(linrgb, HctSolver.SCALED_DISCOUNT_FROM_LINRGB);
    const rA = HctSolver.chromaticAdaptation(scaledDiscount[0]);
    const gA = HctSolver.chromaticAdaptation(scaledDiscount[1]);
    const bA = HctSolver.chromaticAdaptation(scaledDiscount[2]);
    const a = (11.0 * rA + -12.0 * gA + bA) / 11.0;
    const b = (rA + gA - 2.0 * bA) / 9.0;
    return Math.atan2(b, a);
  }

  export function areInCyclicOrder(a: number, b: number, c: number): boolean {
    const deltaAB = HctSolver.sanitizeRadians(b - a);
    const deltaAC = HctSolver.sanitizeRadians(c - a);
    return deltaAB < deltaAC;
  }

  export function intercept(source: number, mid: number, target: number): number {
    return (mid - source) / (target - source);
  }

  export function lerpPoint(source: number[], t: number, target: number[]): number[] {
    return [
      source[0] + (target[0] - source[0]) * t,
      source[1] + (target[1] - source[1]) * t,
      source[2] + (target[2] - source[2]) * t,
    ];
  }

  /** Intersects a segment with a plane. */
  export function setCoordinate(
    source: number[],
    coordinate: number,
    target: number[],
    axis: number
  ): number[] {
    const t = HctSolver.intercept(source[axis], coordinate, target[axis]);
    return HctSolver.lerpPoint(source, t, target);
  }

  export function isBounded(x: number): boolean {
    return 0.0 <= x && x <= 100.0;
  }

  /** Returns the nth vertex of the intersection of the Y plane with the RGB cube. */
  export function nthVertex(y: number, n: number): number[] {
    const kR = HctSolver.Y_FROM_LINRGB[0];
    const kG = HctSolver.Y_FROM_LINRGB[1];
    const kB = HctSolver.Y_FROM_LINRGB[2];
    const coordA = n % 4 <= 1 ? 0.0 : 100.0;
    const coordB = n % 2 === 0 ? 0.0 : 100.0;
    if (n < 4) {
      const g = coordA;
      const b = coordB;
      const r = (y - g * kG - b * kB) / kR;
      if (HctSolver.isBounded(r)) {
        return [r, g, b];
      }
      return [-1.0, -1.0, -1.0];
    } else if (n < 8) {
      const b = coordA;
      const r = coordB;
      const g = (y - r * kR - b * kB) / kG;
      if (HctSolver.isBounded(g)) {
        return [r, g, b];
      }
      return [-1.0, -1.0, -1.0];
    } else {
      const r = coordA;
      const g = coordB;
      const b = (y - r * kR - g * kG) / kB;
      if (HctSolver.isBounded(b)) {
        return [r, g, b];
      }
      return [-1.0, -1.0, -1.0];
    }
  }

  /** Finds the segment containing the desired color on the Y plane. */
  export function bisectToSegment(y: number, targetHue: number): number[][] {
    let left = [-1.0, -1.0, -1.0];
    let right = left;
    let leftHue = 0.0;
    let rightHue = 0.0;
    let initialized = false;
    let uncut = true;
    for (let n = 0; n < 12; n++) {
      const mid = HctSolver.nthVertex(y, n);
      if (mid[0] < 0) {
        continue;
      }
      const midHue = HctSolver.hueOf(mid);
      if (!initialized) {
        left = mid;
        right = mid;
        leftHue = midHue;
        rightHue = midHue;
        initialized = true;
        continue;
      }
      if (uncut || HctSolver.areInCyclicOrder(leftHue, midHue, rightHue)) {
        uncut = false;
        if (HctSolver.areInCyclicOrder(leftHue, targetHue, midHue)) {
          right = mid;
          rightHue = midHue;
        } else {
          left = mid;
          leftHue = midHue;
        }
      }
    }
    return [left, right];
  }

  export function midpoint(a: number[], b: number[]): number[] {
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  }

  export function criticalPlaneBelow(x: number): number {
    return Math.floor(x - 0.5);
  }

  export function criticalPlaneAbove(x: number): number {
    return Math.ceil(x - 0.5);
  }

  /** Finds a color with the given Y and hue on the boundary of the cube. */
  export function bisectToLimit(y: number, targetHue: number): number[] {
    const segment = HctSolver.bisectToSegment(y, targetHue);
    let left = segment[0];
    let leftHue = HctSolver.hueOf(left);
    let right = segment[1];
    for (let axis = 0; axis < 3; axis++) {
      if (left[axis] !== right[axis]) {
        let lPlane = -1;
        let rPlane = 255;
        if (left[axis] < right[axis]) {
          lPlane = HctSolver.criticalPlaneBelow(HctSolver.trueDelinearized(left[axis]));
          rPlane = HctSolver.criticalPlaneAbove(HctSolver.trueDelinearized(right[axis]));
        } else {
          lPlane = HctSolver.criticalPlaneAbove(HctSolver.trueDelinearized(left[axis]));
          rPlane = HctSolver.criticalPlaneBelow(HctSolver.trueDelinearized(right[axis]));
        }
        for (let i = 0; i < 8; i++) {
          if (Math.abs(rPlane - lPlane) <= 1) {
            break;
          }
          const mPlane = Math.floor((lPlane + rPlane) / 2.0);
          const midPlaneCoordinate = HctSolver.CRITICAL_PLANES[mPlane];
          const mid = HctSolver.setCoordinate(left, midPlaneCoordinate, right, axis);
          const midHue = HctSolver.hueOf(mid);
          if (HctSolver.areInCyclicOrder(leftHue, targetHue, midHue)) {
            right = mid;
            rPlane = mPlane;
          } else {
            left = mid;
            leftHue = midHue;
            lPlane = mPlane;
          }
        }
      }
    }
    return HctSolver.midpoint(left, right);
  }

  export function inverseChromaticAdaptation(adapted: number): number {
    const adaptedAbs = Math.abs(adapted);
    const base = Math.max(0, (27.13 * adaptedAbs) / (400.0 - adaptedAbs));
    return signum(adapted) * base ** (1.0 / 0.42);
  }

  /** Finds a color with the given hue, chroma, and Y (relative luminance). */
  export function findResultByJ(hueRadians: number, chroma: number, y: number): number {
    let j = Math.sqrt(y) * 11.0;
    const viewingConditions = ViewingConditions.DEFAULT;
    const tInnerCoeff = 1 / (1.64 - 0.29 ** viewingConditions.n) ** 0.73;
    const eHue = 0.25 * (Math.cos(hueRadians + 2.0) + 3.8);
    const p1 = eHue * (50000.0 / 13.0) * viewingConditions.nc * viewingConditions.ncb;
    const hSin = Math.sin(hueRadians);
    const hCos = Math.cos(hueRadians);
    for (let iterationRound = 0; iterationRound < 5; iterationRound++) {
      const jNormalized = j / 100.0;
      const alpha = chroma === 0.0 || j === 0.0 ? 0.0 : chroma / Math.sqrt(jNormalized);
      const t = (alpha * tInnerCoeff) ** (1.0 / 0.9);
      const ac =
        viewingConditions.aw * jNormalized ** (1.0 / viewingConditions.c / viewingConditions.z);
      const p2 = ac / viewingConditions.nbb;
      const gamma = (23.0 * (p2 + 0.305) * t) / (23.0 * p1 + 11 * t * hCos + 108.0 * t * hSin);
      const a = gamma * hCos;
      const b = gamma * hSin;
      const rA = (460.0 * p2 + 451.0 * a + 288.0 * b) / 1403.0;
      const gA = (460.0 * p2 - 891.0 * a - 261.0 * b) / 1403.0;
      const bA = (460.0 * p2 - 220.0 * a - 6300.0 * b) / 1403.0;
      const rCScaled = HctSolver.inverseChromaticAdaptation(rA);
      const gCScaled = HctSolver.inverseChromaticAdaptation(gA);
      const bCScaled = HctSolver.inverseChromaticAdaptation(bA);
      const linrgb = matrixMultiply(
        [rCScaled, gCScaled, bCScaled],
        HctSolver.LINRGB_FROM_SCALED_DISCOUNT
      );
      if (linrgb[0] < 0 || linrgb[1] < 0 || linrgb[2] < 0) {
        return 0;
      }
      const kR = HctSolver.Y_FROM_LINRGB[0];
      const kG = HctSolver.Y_FROM_LINRGB[1];
      const kB = HctSolver.Y_FROM_LINRGB[2];
      const fnj = kR * linrgb[0] + kG * linrgb[1] + kB * linrgb[2];
      if (fnj <= 0) {
        return 0;
      }
      if (iterationRound === 4 || Math.abs(fnj - y) < 0.002) {
        if (linrgb[0] > 100.01 || linrgb[1] > 100.01 || linrgb[2] > 100.01) {
          return 0;
        }
        return argbFromLinrgb(linrgb);
      }
      j = j - ((fnj - y) * j) / (2 * fnj);
    }
    return 0;
  }

  /**
   * Finds an sRGB color with the given hue, chroma, and L*, if possible.
   * When the requested chroma is out of gamut, chroma is maximized instead.
   */
  export function solveToInt(hueDegrees: number, chroma: number, lstar: number): number {
    if (chroma < 0.0001 || lstar < 0.0001 || lstar > 99.9999) {
      return argbFromLstar(lstar);
    }
    hueDegrees = sanitizeDegreesDouble(hueDegrees);
    const hueRadians = (hueDegrees / 180) * Math.PI;
    const y = yFromLstar(lstar);
    const exactAnswer = HctSolver.findResultByJ(hueRadians, chroma, y);
    if (exactAnswer !== 0) {
      return exactAnswer;
    }
    const linrgb = HctSolver.bisectToLimit(y, hueRadians);
    return argbFromLinrgb(linrgb);
  }

  /** Finds an sRGB color with the given hue, chroma, and L*, as CAM16. */
  export function solveToCam(hueDegrees: number, chroma: number, lstar: number): Cam16 {
    return Cam16.fromInt(HctSolver.solveToInt(hueDegrees, chroma, lstar));
  }
}

// ─── HCT ────────────────────────────────────────────────────────────────────

/**
 * HCT, hue, chroma, and tone. A color system built using CAM16 hue and chroma,
 * and L* from L*a*b*. L* is linear to human perception, so a difference of 40
 * in tone guarantees a contrast ratio >= 3.0 and a difference of 50 guarantees
 * contrast ratio >= 4.5.
 */
export class Hct {
  private argb: number;
  private internalHue: number;
  private internalChroma: number;
  private internalTone: number;

  constructor(argb: number) {
    this.argb = argb;
    const cam = Cam16.fromInt(argb);
    this.internalHue = cam.hue;
    this.internalChroma = cam.chroma;
    this.internalTone = lstarFromArgb(argb);
  }

  /** Create HCT from hue, chroma, and tone (chroma may be reduced by gamut). */
  static from(hue: number, chroma: number, tone: number): Hct {
    return new Hct(HctSolver.solveToInt(hue, chroma, tone));
  }

  /** Create HCT from an ARGB color. */
  static fromInt(argb: number): Hct {
    return new Hct(argb);
  }

  /** ARGB representation of the color. */
  toInt(): number {
    return this.argb;
  }

  get hue(): number {
    return this.internalHue;
  }

  set hue(newHue: number) {
    this.setInternalState(HctSolver.solveToInt(newHue, this.internalChroma, this.internalTone));
  }

  get chroma(): number {
    return this.internalChroma;
  }

  set chroma(newChroma: number) {
    this.setInternalState(HctSolver.solveToInt(this.internalHue, newChroma, this.internalTone));
  }

  get tone(): number {
    return this.internalTone;
  }

  set tone(newTone: number) {
    this.setInternalState(HctSolver.solveToInt(this.internalHue, this.internalChroma, newTone));
  }

  setValue(propertyName: string, value: number) {
    (this as unknown as Record<string, number>)[propertyName] = value;
  }

  toString(): string {
    return `HCT(${this.hue.toFixed(0)}, ${this.chroma.toFixed(0)}, ${this.tone.toFixed(0)})`;
  }

  static isBlue(hue: number): boolean {
    return hue >= 250 && hue < 270;
  }

  static isYellow(hue: number): boolean {
    return hue >= 105 && hue < 125;
  }

  static isCyan(hue: number): boolean {
    return hue >= 170 && hue < 207;
  }

  private setInternalState(argb: number) {
    const cam = Cam16.fromInt(argb);
    this.internalHue = cam.hue;
    this.internalChroma = cam.chroma;
    this.internalTone = lstarFromArgb(argb);
    this.argb = argb;
  }
}

// ─── Tonal palette ──────────────────────────────────────────────────────────

/** A convenience class for retrieving colors constant in hue and chroma. */
export class TonalPalette {
  private cache: Map<number, number>;

  private constructor(
    readonly hue: number,
    readonly chroma: number
  ) {
    this.cache = new Map();
  }

  /** Create a TonalPalette from an ARGB color. */
  static fromInt(argb: number): TonalPalette {
    return TonalPalette.fromHct(Hct.fromInt(argb));
  }

  /** Create a TonalPalette from an HCT color. */
  static fromHct(hct: Hct): TonalPalette {
    return new TonalPalette(hct.hue, hct.chroma);
  }

  /** Create a TonalPalette from hue and chroma. */
  static fromHueAndChroma(hue: number, chroma: number): TonalPalette {
    return new TonalPalette(hue, chroma);
  }

  /** Get the ARGB color at the given tone. */
  tone(tone: number): number {
    let argb = this.cache.get(tone);
    if (argb === undefined) {
      if (tone === 99 && Hct.isYellow(this.hue)) {
        argb = this.averageArgb(this.tone(98), this.tone(100));
      } else {
        argb = Hct.from(this.hue, this.chroma, tone).toInt();
      }
      this.cache.set(tone, argb);
    }
    return argb;
  }

  /** Get the HCT color at the given tone. */
  getHct(tone: number): Hct {
    return Hct.from(this.hue, this.chroma, tone);
  }

  private averageArgb(argb1: number, argb2: number): number {
    const red1 = (argb1 >>> 16) & 0xff;
    const green1 = (argb1 >>> 8) & 0xff;
    const blue1 = argb1 & 0xff;
    const red2 = (argb2 >>> 16) & 0xff;
    const green2 = (argb2 >>> 8) & 0xff;
    const blue2 = argb2 & 0xff;
    const red = Math.round((red1 + red2) / 2);
    const green = Math.round((green1 + green2) / 2);
    const blue = Math.round((blue1 + blue2) / 2);
    return ((255 << 24) | ((red & 255) << 16) | ((green & 255) << 8) | (blue & 255)) >>> 0;
  }
}

// ─── Scheme: Tonal Spot ─────────────────────────────────────────────────────

/**
 * A value that changes with the contrast level.
 *
 * The four values correspond to contrast levels -1.0, 0.0, 0.5 and 1.0
 * (low, normal, medium, high), interpolated in between - ported verbatim from
 * @material/material-color-utilities 0.4.0 (dynamiccolor/contrast_curve.ts).
 */
export class ContrastCurve {
  constructor(
    public readonly low: number,
    public readonly normal: number,
    public readonly medium: number,
    public readonly high: number
  ) {}

  get(contrastLevel: number): number {
    if (contrastLevel <= -1.0) {
      return this.low;
    }
    if (contrastLevel < 0.0) {
      return lerp(this.low, this.normal, contrastLevel + 1);
    }
    if (contrastLevel < 0.5) {
      return lerp(this.normal, this.medium, contrastLevel / 0.5);
    }
    if (contrastLevel < 1.0) {
      return lerp(this.medium, this.high, (contrastLevel - 0.5) / 0.5);
    }
    return this.high;
  }
}

/**
 * Documents a constraint between two DynamicColors whose tones must have a
 * certain distance from each other (tonal distance, not WCAG contrast).
 * Ported verbatim from @material/material-color-utilities 0.4.0.
 */
export class ToneDeltaPair {
  readonly constraint: 'exact' | 'nearer' | 'farther';

  constructor(
    public readonly roleA: DynamicColor,
    public readonly roleB: DynamicColor,
    public readonly delta: number,
    public readonly polarity: 'nearer' | 'lighter' | 'darker',
    public readonly stayTogether: boolean,
    constraint?: 'exact' | 'nearer' | 'farther'
  ) {
    this.constraint = constraint ?? 'exact';
  }
}

/**
 * Contrast ratio math over HCT tones (WCAG-style Y-based ratios). Ported
 * verbatim from @material/material-color-utilities 0.4.0 (contrast/contrast.ts).
 */
export namespace Contrast {
  /** Contrast ratio between two tones, clamped to 0..100. Range 1..21. */
  export function ratioOfTones(toneA: number, toneB: number): number {
    toneA = clampDouble(0, 100, toneA);
    toneB = clampDouble(0, 100, toneB);
    return Contrast.ratioOfYs(yFromLstar(toneA), yFromLstar(toneB));
  }

  export function ratioOfYs(y1: number, y2: number): number {
    const lighter = y1 > y2 ? y1 : y2;
    const darker = lighter === y2 ? y1 : y2;
    return (lighter + 5.0) / (darker + 5.0);
  }

  /** Tone >= tone that ensures ratio; -1 if unachievable. */
  export function lighter(tone: number, ratio: number): number {
    if (tone < 0 || tone > 100) {
      return -1;
    }
    const darkY = yFromLstar(tone);
    const lightY = ratio * (darkY + 5.0) - 5.0;
    const realContrast = Contrast.ratioOfYs(lightY, darkY);
    const delta = Math.abs(realContrast - ratio);
    if (realContrast < ratio && delta > 0.04) {
      return -1;
    }
    // Darken slightly so gamut mapping can't drop below the ratio.
    const returnValue = lstarFromY(lightY) + 0.4;
    if (returnValue < 0 || returnValue > 100) {
      return -1;
    }
    return returnValue;
  }

  /** Tone <= tone that ensures ratio; -1 if unachievable. */
  export function darker(tone: number, ratio: number): number {
    if (tone < 0 || tone > 100) {
      return -1;
    }
    const lightY = yFromLstar(tone);
    const darkY = (lightY + 5.0) / ratio - 5.0;
    const realContrast = Contrast.ratioOfYs(lightY, darkY);
    const delta = Math.abs(realContrast - ratio);
    if (realContrast < ratio && delta > 0.04) {
      return -1;
    }
    const returnValue = lstarFromY(darkY) - 0.4;
    if (returnValue < 0 || returnValue > 100) {
      return -1;
    }
    return returnValue;
  }

  export function lighterUnsafe(tone: number, ratio: number): number {
    const lighterSafe = Contrast.lighter(tone, ratio);
    return lighterSafe < 0 ? 100 : lighterSafe;
  }

  export function darkerUnsafe(tone: number, ratio: number): number {
    const darkerSafe = Contrast.darker(tone, ratio);
    return darkerSafe < 0 ? 0 : darkerSafe;
  }
}

/**
 * A color that adjusts itself based on UI state (dark mode, contrast level)
 * provided by the DynamicScheme. Ported verbatim from
 * @material/material-color-utilities 0.4.0 (dynamiccolor/dynamic_color.ts),
 * restricted to the 2021-spec resolution delegate (ColorCalculationDelegateImpl
 * 2021) which is what TONAL_SPOT uses by default.
 */
export class DynamicColor {
  readonly name: string;
  readonly palette: (scheme: SchemeTonalSpot) => TonalPalette;
  readonly tone: (scheme: SchemeTonalSpot) => number;
  readonly isBackground: boolean;
  readonly chromaMultiplier: ((scheme: SchemeTonalSpot) => number) | undefined;
  readonly background: ((scheme: SchemeTonalSpot) => DynamicColor) | undefined;
  readonly secondBackground: ((scheme: SchemeTonalSpot) => DynamicColor) | undefined;
  readonly contrastCurve: ((scheme: SchemeTonalSpot) => ContrastCurve) | undefined;
  readonly toneDeltaPair: ((scheme: SchemeTonalSpot) => ToneDeltaPair) | undefined;

  private readonly hctCache = new Map<SchemeTonalSpot, Hct>();

  static fromPalette(args: {
    name?: string;
    palette: (scheme: SchemeTonalSpot) => TonalPalette;
    tone?: (scheme: SchemeTonalSpot) => number;
    isBackground?: boolean;
    chromaMultiplier?: (scheme: SchemeTonalSpot) => number;
    background?: (scheme: SchemeTonalSpot) => DynamicColor;
    secondBackground?: (scheme: SchemeTonalSpot) => DynamicColor;
    contrastCurve?: (scheme: SchemeTonalSpot) => ContrastCurve;
    toneDeltaPair?: (scheme: SchemeTonalSpot) => ToneDeltaPair;
  }): DynamicColor {
    return new DynamicColor(
      args.name ?? '',
      args.palette,
      args.tone ?? DynamicColor.getInitialToneFromBackground(args.background),
      args.isBackground ?? false,
      args.chromaMultiplier,
      args.background,
      args.secondBackground,
      args.contrastCurve,
      args.toneDeltaPair
    );
  }

  static getInitialToneFromBackground(
    background: ((scheme: SchemeTonalSpot) => DynamicColor) | undefined
  ): (scheme: SchemeTonalSpot) => number {
    if (background === undefined) {
      return () => 50;
    }
    return (s) => (background(s) ? background(s).getTone(s) : 50);
  }

  constructor(
    name: string,
    palette: (scheme: SchemeTonalSpot) => TonalPalette,
    tone: (scheme: SchemeTonalSpot) => number,
    isBackground: boolean,
    chromaMultiplier: ((scheme: SchemeTonalSpot) => number) | undefined,
    background: ((scheme: SchemeTonalSpot) => DynamicColor) | undefined,
    secondBackground: ((scheme: SchemeTonalSpot) => DynamicColor) | undefined,
    contrastCurve: ((scheme: SchemeTonalSpot) => ContrastCurve) | undefined,
    toneDeltaPair: ((scheme: SchemeTonalSpot) => ToneDeltaPair) | undefined
  ) {
    this.name = name;
    this.palette = palette;
    this.tone = tone;
    this.isBackground = isBackground;
    this.chromaMultiplier = chromaMultiplier;
    this.background = background;
    this.secondBackground = secondBackground;
    this.contrastCurve = contrastCurve;
    this.toneDeltaPair = toneDeltaPair;
    if (!background && secondBackground) {
      throw new Error(`Color ${name} has secondBackground defined, but background is not defined.`);
    }
    if (!background && contrastCurve) {
      throw new Error(`Color ${name} has contrastCurve defined, but background is not defined.`);
    }
    if (background && !contrastCurve) {
      throw new Error(`Color ${name} has background defined, but contrastCurve is not defined.`);
    }
  }

  /** Returns an ARGB integer (hex code). */
  getArgb(scheme: SchemeTonalSpot): number {
    return this.getHct(scheme).toInt();
  }

  /** Returns this color in the HCT color space under scheme's conditions. */
  getHct(scheme: SchemeTonalSpot): Hct {
    const cachedAnswer = this.hctCache.get(scheme);
    if (cachedAnswer != null) {
      return cachedAnswer;
    }
    // 2021-spec resolution: tone first, then resolve that tone on the palette.
    const tone = this.getTone(scheme);
    const answer = this.palette(scheme).getHct(tone);
    if (this.hctCache.size > 4) {
      this.hctCache.clear();
    }
    this.hctCache.set(scheme, answer);
    return answer;
  }

  /** Returns the tone this DynamicColor is under scheme's conditions. */
  getTone(scheme: SchemeTonalSpot): number {
    // ── ColorCalculationDelegateImpl2021.getTone ──
    const decreasingContrast = scheme.contrastLevel < 0;
    const toneDeltaPair = this.toneDeltaPair ? this.toneDeltaPair(scheme) : undefined;

    // Case 1: dual foreground, pair of colors with a tone-delta constraint.
    if (toneDeltaPair) {
      const roleA = toneDeltaPair.roleA;
      const roleB = toneDeltaPair.roleB;
      const delta = toneDeltaPair.delta;
      const polarity = toneDeltaPair.polarity;
      const stayTogether = toneDeltaPair.stayTogether;
      const aIsNearer =
        polarity === 'nearer' ||
        (polarity === 'lighter' && !scheme.isDark) ||
        (polarity === 'darker' && scheme.isDark);
      const nearer = aIsNearer ? roleA : roleB;
      const farther = aIsNearer ? roleB : roleA;
      const amNearer = this.name === nearer.name;
      const expansionDir = scheme.isDark ? 1 : -1;
      let nTone = nearer.tone(scheme);
      let fTone = farther.tone(scheme);
      // 1st round: solve to min for each, if background and contrast curves exist.
      if (this.background && nearer.contrastCurve && farther.contrastCurve) {
        const bg = this.background(scheme);
        const nContrastCurve = nearer.contrastCurve(scheme);
        const fContrastCurve = farther.contrastCurve(scheme);
        if (bg && nContrastCurve && fContrastCurve) {
          const bgTone = bg.getTone(scheme);
          const nContrast = nContrastCurve.get(scheme.contrastLevel);
          const fContrast = fContrastCurve.get(scheme.contrastLevel);
          // If a color is good enough, it is not adjusted.
          if (Contrast.ratioOfTones(bgTone, nTone) < nContrast) {
            nTone = DynamicColor.foregroundTone(bgTone, nContrast);
          }
          if (Contrast.ratioOfTones(bgTone, fTone) < fContrast) {
            fTone = DynamicColor.foregroundTone(bgTone, fContrast);
          }
          if (decreasingContrast) {
            // Decreasing contrast: adjust both to the bare minimum.
            nTone = DynamicColor.foregroundTone(bgTone, nContrast);
            fTone = DynamicColor.foregroundTone(bgTone, fContrast);
          }
        }
      }
      // 2nd round: expand farther to match delta, if contrast is not satisfied.
      if ((fTone - nTone) * expansionDir < delta) {
        fTone = clampDouble(0, 100, nTone + delta * expansionDir);
        if ((fTone - nTone) * expansionDir < delta) {
          // 3rd round: contract nearer to match delta.
          nTone = clampDouble(0, 100, fTone - delta * expansionDir);
        }
      }
      // Avoids the T50-59 awkward zone.
      if (50 <= nTone && nTone < 60) {
        // If `nearer` is in the awkward zone, move it away, together with `farther`.
        if (expansionDir > 0) {
          nTone = 60;
          fTone = Math.max(fTone, nTone + delta * expansionDir);
        } else {
          nTone = 49;
          fTone = Math.min(fTone, nTone + delta * expansionDir);
        }
      } else if (50 <= fTone && fTone < 60) {
        if (stayTogether) {
          // Fixes both, to avoid two colors on opposite sides of the awkward zone.
          if (expansionDir > 0) {
            nTone = 60;
            fTone = Math.max(fTone, nTone + delta * expansionDir);
          } else {
            nTone = 49;
            fTone = Math.min(fTone, nTone + delta * expansionDir);
          }
        } else {
          // Not required to stay together; fixes just one.
          if (expansionDir > 0) {
            fTone = 60;
          } else {
            fTone = 49;
          }
        }
      }
      // Returns `nTone` if this color is `nearer`, otherwise `fTone`.
      return amNearer ? nTone : fTone;
    }

    // Case 2: no contrast pair; just solve for itself.
    let answer = this.tone(scheme);
    if (
      this.background === undefined ||
      this.background(scheme) === undefined ||
      this.contrastCurve === undefined ||
      this.contrastCurve(scheme) === undefined
    ) {
      return answer; // No adjustment for colors with no background.
    }
    const bgTone = this.background(scheme).getTone(scheme);
    const desiredRatio = this.contrastCurve(scheme).get(scheme.contrastLevel);
    if (Contrast.ratioOfTones(bgTone, answer) < desiredRatio) {
      // Rough improvement.
      answer = DynamicColor.foregroundTone(bgTone, desiredRatio);
    }
    if (decreasingContrast) {
      answer = DynamicColor.foregroundTone(bgTone, desiredRatio);
    }
    if (this.isBackground && 50 <= answer && answer < 60) {
      // Must adjust away from the awkward zone.
      if (Contrast.ratioOfTones(49, bgTone) >= desiredRatio) {
        answer = 49;
      } else {
        answer = 60;
      }
    }
    if (this.secondBackground === undefined || this.secondBackground(scheme) === undefined) {
      return answer;
    }
    // Case 3: adjust for dual backgrounds.
    const [bg1, bg2] = [this.background, this.secondBackground];
    const [bgTone1, bgTone2] = [bg1(scheme).getTone(scheme), bg2(scheme).getTone(scheme)];
    const [upper, lower] = [Math.max(bgTone1, bgTone2), Math.min(bgTone1, bgTone2)];
    if (
      Contrast.ratioOfTones(upper, answer) >= desiredRatio &&
      Contrast.ratioOfTones(lower, answer) >= desiredRatio
    ) {
      return answer;
    }
    // The darkest light tone that satisfies the desired ratio, or -1.
    const lightOption = Contrast.lighter(upper, desiredRatio);
    // The lightest dark tone that satisfies the desired ratio, or -1.
    const darkOption = Contrast.darker(lower, desiredRatio);
    // Tones suitable for the foreground.
    const availables: number[] = [];
    if (lightOption !== -1) availables.push(lightOption);
    if (darkOption !== -1) availables.push(darkOption);
    const prefersLight =
      DynamicColor.tonePrefersLightForeground(bgTone1) ||
      DynamicColor.tonePrefersLightForeground(bgTone2);
    if (prefersLight) {
      return lightOption < 0 ? 100 : lightOption;
    }
    if (availables.length === 1) {
      return availables[0];
    }
    return darkOption < 0 ? 0 : darkOption;
  }

  /**
   * Given a background tone, finds a foreground tone that reaches a contrast
   * ratio as close to [ratio] as possible.
   */
  static foregroundTone(bgTone: number, ratio: number): number {
    const lighterTone = Contrast.lighterUnsafe(bgTone, ratio);
    const darkerTone = Contrast.darkerUnsafe(bgTone, ratio);
    const lighterRatio = Contrast.ratioOfTones(lighterTone, bgTone);
    const darkerRatio = Contrast.ratioOfTones(darkerTone, bgTone);
    const preferLighter = DynamicColor.tonePrefersLightForeground(bgTone);
    if (preferLighter) {
      // Handles the edge case where the initial contrast ratio is high and both
      // lighter/darker options fail to pass the requested ratio.
      const negligibleDifference =
        Math.abs(lighterRatio - darkerRatio) < 0.1 && lighterRatio < ratio && darkerRatio < ratio;
      return lighterRatio >= ratio || lighterRatio >= darkerRatio || negligibleDifference
        ? lighterTone
        : darkerTone;
    }
    return darkerRatio >= ratio || darkerRatio >= lighterRatio ? darkerTone : lighterTone;
  }

  /** People prefer white foregrounds on ~T60-70; T60 excluded here. */
  static tonePrefersLightForeground(tone: number): boolean {
    return Math.round(tone) < 60.0;
  }

  /** Whether [tone] can reach a 4.5 contrast ratio with a lighter color. */
  static toneAllowsLightForeground(tone: number): boolean {
    return Math.round(tone) <= 49.0;
  }

  /** Adjusts a tone so white has 4.5 contrast, if reasonably close. */
  static enableLightForeground(tone: number): number {
    if (
      DynamicColor.tonePrefersLightForeground(tone) &&
      !DynamicColor.toneAllowsLightForeground(tone)
    ) {
      return 49.0;
    }
    return tone;
  }
}

/**
 * The 2021-spec color definitions (the DynamicColor graph) for Tonal Spot.
 * Ported verbatim from @material/material-color-utilities 0.4.0
 * (dynamiccolor/color_spec_2021.ts), with the fidelity/monochrome branches
 * collapsed to their TONAL_SPOT values (this scheme's variant is fixed).
 */
export class ColorSpecDelegateImpl2021 {
  // Surfaces [S]
  background(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'background',
      palette: (s) => s.neutralPalette,
      tone: (s) => (s.isDark ? 6 : 98),
      isBackground: true,
    });
  }
  onBackground(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'on_background',
      palette: (s) => s.neutralPalette,
      tone: (s) => (s.isDark ? 90 : 10),
      background: () => this.background(),
      contrastCurve: () => new ContrastCurve(3, 3, 4.5, 7),
    });
  }
  surface(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'surface',
      palette: (s) => s.neutralPalette,
      tone: (s) => (s.isDark ? 6 : 98),
      isBackground: true,
    });
  }
  surfaceDim(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'surface_dim',
      palette: (s) => s.neutralPalette,
      tone: (s) => (s.isDark ? 6 : new ContrastCurve(87, 87, 80, 75).get(s.contrastLevel)),
      isBackground: true,
    });
  }
  surfaceBright(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'surface_bright',
      palette: (s) => s.neutralPalette,
      tone: (s) => (s.isDark ? new ContrastCurve(24, 24, 29, 34).get(s.contrastLevel) : 98),
      isBackground: true,
    });
  }
  surfaceContainerLowest(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'surface_container_lowest',
      palette: (s) => s.neutralPalette,
      tone: (s) => (s.isDark ? new ContrastCurve(4, 4, 2, 0).get(s.contrastLevel) : 100),
      isBackground: true,
    });
  }
  surfaceContainerLow(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'surface_container_low',
      palette: (s) => s.neutralPalette,
      tone: (s) =>
        s.isDark
          ? new ContrastCurve(10, 10, 11, 12).get(s.contrastLevel)
          : new ContrastCurve(96, 96, 96, 95).get(s.contrastLevel),
      isBackground: true,
    });
  }
  surfaceContainer(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'surface_container',
      palette: (s) => s.neutralPalette,
      tone: (s) =>
        s.isDark
          ? new ContrastCurve(12, 12, 16, 20).get(s.contrastLevel)
          : new ContrastCurve(94, 94, 92, 90).get(s.contrastLevel),
      isBackground: true,
    });
  }
  surfaceContainerHigh(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'surface_container_high',
      palette: (s) => s.neutralPalette,
      tone: (s) =>
        s.isDark
          ? new ContrastCurve(17, 17, 21, 25).get(s.contrastLevel)
          : new ContrastCurve(92, 92, 88, 85).get(s.contrastLevel),
      isBackground: true,
    });
  }
  surfaceContainerHighest(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'surface_container_highest',
      palette: (s) => s.neutralPalette,
      tone: (s) =>
        s.isDark
          ? new ContrastCurve(22, 22, 26, 30).get(s.contrastLevel)
          : new ContrastCurve(90, 90, 84, 80).get(s.contrastLevel),
      isBackground: true,
    });
  }
  onSurface(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'on_surface',
      palette: (s) => s.neutralPalette,
      tone: (s) => (s.isDark ? 90 : 10),
      background: (s) => this.highestSurface(s),
      contrastCurve: () => new ContrastCurve(4.5, 7, 11, 21),
    });
  }
  surfaceVariant(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'surface_variant',
      palette: (s) => s.neutralVariantPalette,
      tone: (s) => (s.isDark ? 30 : 90),
      isBackground: true,
    });
  }
  onSurfaceVariant(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'on_surface_variant',
      palette: (s) => s.neutralVariantPalette,
      tone: (s) => (s.isDark ? 80 : 30),
      background: (s) => this.highestSurface(s),
      contrastCurve: () => new ContrastCurve(3, 4.5, 7, 11),
    });
  }
  inverseSurface(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'inverse_surface',
      palette: (s) => s.neutralPalette,
      tone: (s) => (s.isDark ? 90 : 20),
      isBackground: true,
    });
  }
  inverseOnSurface(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'inverse_on_surface',
      palette: (s) => s.neutralPalette,
      tone: (s) => (s.isDark ? 20 : 95),
      background: () => this.inverseSurface(),
      contrastCurve: () => new ContrastCurve(4.5, 7, 11, 21),
    });
  }
  outline(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'outline',
      palette: (s) => s.neutralVariantPalette,
      tone: (s) => (s.isDark ? 60 : 50),
      background: (s) => this.highestSurface(s),
      contrastCurve: () => new ContrastCurve(1.5, 3, 4.5, 7),
    });
  }
  outlineVariant(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'outline_variant',
      palette: (s) => s.neutralVariantPalette,
      tone: (s) => (s.isDark ? 30 : 80),
      background: (s) => this.highestSurface(s),
      contrastCurve: () => new ContrastCurve(1, 1, 3, 4.5),
    });
  }
  shadow(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'shadow',
      palette: (s) => s.neutralPalette,
      tone: () => 0,
    });
  }
  scrim(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'scrim',
      palette: (s) => s.neutralPalette,
      tone: () => 0,
    });
  }
  surfaceTint(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'surface_tint',
      palette: (s) => s.primaryPalette,
      tone: (s) => (s.isDark ? 80 : 40),
      isBackground: true,
    });
  }

  // Primary [P]
  primary(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'primary',
      palette: (s) => s.primaryPalette,
      tone: (s) => (s.isDark ? 80 : 40),
      isBackground: true,
      background: (s) => this.highestSurface(s),
      contrastCurve: () => new ContrastCurve(3, 4.5, 7, 7),
      toneDeltaPair: () =>
        new ToneDeltaPair(this.primaryContainer(), this.primary(), 10, 'nearer', false),
    });
  }
  onPrimary(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'on_primary',
      palette: (s) => s.primaryPalette,
      tone: (s) => (s.isDark ? 20 : 100),
      background: () => this.primary(),
      contrastCurve: () => new ContrastCurve(4.5, 7, 11, 21),
    });
  }
  primaryContainer(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'primary_container',
      palette: (s) => s.primaryPalette,
      tone: (s) => (s.isDark ? 30 : 90),
      isBackground: true,
      background: (s) => this.highestSurface(s),
      contrastCurve: () => new ContrastCurve(1, 1, 3, 4.5),
      toneDeltaPair: () =>
        new ToneDeltaPair(this.primaryContainer(), this.primary(), 10, 'nearer', false),
    });
  }
  onPrimaryContainer(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'on_primary_container',
      palette: (s) => s.primaryPalette,
      tone: (s) => (s.isDark ? 90 : 30),
      background: () => this.primaryContainer(),
      contrastCurve: () => new ContrastCurve(3, 4.5, 7, 11),
    });
  }
  inversePrimary(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'inverse_primary',
      palette: (s) => s.primaryPalette,
      tone: (s) => (s.isDark ? 40 : 80),
      background: () => this.inverseSurface(),
      contrastCurve: () => new ContrastCurve(3, 4.5, 7, 7),
    });
  }

  // Secondary [Q]
  secondary(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'secondary',
      palette: (s) => s.secondaryPalette,
      tone: (s) => (s.isDark ? 80 : 40),
      isBackground: true,
      background: (s) => this.highestSurface(s),
      contrastCurve: () => new ContrastCurve(3, 4.5, 7, 7),
      toneDeltaPair: () =>
        new ToneDeltaPair(this.secondaryContainer(), this.secondary(), 10, 'nearer', false),
    });
  }
  onSecondary(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'on_secondary',
      palette: (s) => s.secondaryPalette,
      tone: (s) => (s.isDark ? 20 : 100),
      background: () => this.secondary(),
      contrastCurve: () => new ContrastCurve(4.5, 7, 11, 21),
    });
  }
  secondaryContainer(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'secondary_container',
      palette: (s) => s.secondaryPalette,
      tone: (s) => (s.isDark ? 30 : 90),
      isBackground: true,
      background: (s) => this.highestSurface(s),
      contrastCurve: () => new ContrastCurve(1, 1, 3, 4.5),
      toneDeltaPair: () =>
        new ToneDeltaPair(this.secondaryContainer(), this.secondary(), 10, 'nearer', false),
    });
  }
  onSecondaryContainer(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'on_secondary_container',
      palette: (s) => s.secondaryPalette,
      tone: (s) => (s.isDark ? 90 : 30),
      background: () => this.secondaryContainer(),
      contrastCurve: () => new ContrastCurve(3, 4.5, 7, 11),
    });
  }

  // Tertiary [T]
  tertiary(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'tertiary',
      palette: (s) => s.tertiaryPalette,
      tone: (s) => (s.isDark ? 80 : 40),
      isBackground: true,
      background: (s) => this.highestSurface(s),
      contrastCurve: () => new ContrastCurve(3, 4.5, 7, 7),
      toneDeltaPair: () =>
        new ToneDeltaPair(this.tertiaryContainer(), this.tertiary(), 10, 'nearer', false),
    });
  }
  onTertiary(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'on_tertiary',
      palette: (s) => s.tertiaryPalette,
      tone: (s) => (s.isDark ? 20 : 100),
      background: () => this.tertiary(),
      contrastCurve: () => new ContrastCurve(4.5, 7, 11, 21),
    });
  }
  tertiaryContainer(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'tertiary_container',
      palette: (s) => s.tertiaryPalette,
      tone: (s) => (s.isDark ? 30 : 90),
      isBackground: true,
      background: (s) => this.highestSurface(s),
      contrastCurve: () => new ContrastCurve(1, 1, 3, 4.5),
      toneDeltaPair: () =>
        new ToneDeltaPair(this.tertiaryContainer(), this.tertiary(), 10, 'nearer', false),
    });
  }
  onTertiaryContainer(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'on_tertiary_container',
      palette: (s) => s.tertiaryPalette,
      tone: (s) => (s.isDark ? 90 : 30),
      background: () => this.tertiaryContainer(),
      contrastCurve: () => new ContrastCurve(3, 4.5, 7, 11),
    });
  }

  // Error [E]
  error(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'error',
      palette: (s) => s.errorPalette,
      tone: (s) => (s.isDark ? 80 : 40),
      isBackground: true,
      background: (s) => this.highestSurface(s),
      contrastCurve: () => new ContrastCurve(3, 4.5, 7, 7),
      toneDeltaPair: () =>
        new ToneDeltaPair(this.errorContainer(), this.error(), 10, 'nearer', false),
    });
  }
  onError(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'on_error',
      palette: (s) => s.errorPalette,
      tone: (s) => (s.isDark ? 20 : 100),
      background: () => this.error(),
      contrastCurve: () => new ContrastCurve(4.5, 7, 11, 21),
    });
  }
  errorContainer(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'error_container',
      palette: (s) => s.errorPalette,
      tone: (s) => (s.isDark ? 30 : 90),
      isBackground: true,
      background: (s) => this.highestSurface(s),
      contrastCurve: () => new ContrastCurve(1, 1, 3, 4.5),
      toneDeltaPair: () =>
        new ToneDeltaPair(this.errorContainer(), this.error(), 10, 'nearer', false),
    });
  }
  onErrorContainer(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'on_error_container',
      palette: (s) => s.errorPalette,
      tone: (s) => (s.isDark ? 90 : 30),
      background: () => this.errorContainer(),
      contrastCurve: () => new ContrastCurve(3, 4.5, 7, 11),
    });
  }

  // Primary Fixed [PF]
  primaryFixed(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'primary_fixed',
      palette: (s) => s.primaryPalette,
      tone: () => 90.0,
      isBackground: true,
      background: (s) => this.highestSurface(s),
      contrastCurve: () => new ContrastCurve(1, 1, 3, 4.5),
      toneDeltaPair: () =>
        new ToneDeltaPair(this.primaryFixed(), this.primaryFixedDim(), 10, 'lighter', true),
    });
  }
  primaryFixedDim(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'primary_fixed_dim',
      palette: (s) => s.primaryPalette,
      tone: () => 80.0,
      isBackground: true,
      background: (s) => this.highestSurface(s),
      contrastCurve: () => new ContrastCurve(1, 1, 3, 4.5),
      toneDeltaPair: () =>
        new ToneDeltaPair(this.primaryFixed(), this.primaryFixedDim(), 10, 'lighter', true),
    });
  }
  onPrimaryFixed(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'on_primary_fixed',
      palette: (s) => s.primaryPalette,
      tone: () => 10.0,
      background: () => this.primaryFixedDim(),
      secondBackground: () => this.primaryFixed(),
      contrastCurve: () => new ContrastCurve(4.5, 7, 11, 21),
    });
  }
  onPrimaryFixedVariant(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'on_primary_fixed_variant',
      palette: (s) => s.primaryPalette,
      tone: () => 30.0,
      background: () => this.primaryFixedDim(),
      secondBackground: () => this.primaryFixed(),
      contrastCurve: () => new ContrastCurve(3, 4.5, 7, 11),
    });
  }

  // Secondary Fixed [QF]
  secondaryFixed(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'secondary_fixed',
      palette: (s) => s.secondaryPalette,
      tone: () => 90.0,
      isBackground: true,
      background: (s) => this.highestSurface(s),
      contrastCurve: () => new ContrastCurve(1, 1, 3, 4.5),
      toneDeltaPair: () =>
        new ToneDeltaPair(this.secondaryFixed(), this.secondaryFixedDim(), 10, 'lighter', true),
    });
  }
  secondaryFixedDim(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'secondary_fixed_dim',
      palette: (s) => s.secondaryPalette,
      tone: () => 80.0,
      isBackground: true,
      background: (s) => this.highestSurface(s),
      contrastCurve: () => new ContrastCurve(1, 1, 3, 4.5),
      toneDeltaPair: () =>
        new ToneDeltaPair(this.secondaryFixed(), this.secondaryFixedDim(), 10, 'lighter', true),
    });
  }
  onSecondaryFixed(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'on_secondary_fixed',
      palette: (s) => s.secondaryPalette,
      tone: () => 10.0,
      background: () => this.secondaryFixedDim(),
      secondBackground: () => this.secondaryFixed(),
      contrastCurve: () => new ContrastCurve(4.5, 7, 11, 21),
    });
  }
  onSecondaryFixedVariant(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'on_secondary_fixed_variant',
      palette: (s) => s.secondaryPalette,
      tone: () => 30.0,
      background: () => this.secondaryFixedDim(),
      secondBackground: () => this.secondaryFixed(),
      contrastCurve: () => new ContrastCurve(3, 4.5, 7, 11),
    });
  }

  // Tertiary Fixed [TF]
  tertiaryFixed(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'tertiary_fixed',
      palette: (s) => s.tertiaryPalette,
      tone: () => 90.0,
      isBackground: true,
      background: (s) => this.highestSurface(s),
      contrastCurve: () => new ContrastCurve(1, 1, 3, 4.5),
      toneDeltaPair: () =>
        new ToneDeltaPair(this.tertiaryFixed(), this.tertiaryFixedDim(), 10, 'lighter', true),
    });
  }
  tertiaryFixedDim(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'tertiary_fixed_dim',
      palette: (s) => s.tertiaryPalette,
      tone: () => 80.0,
      isBackground: true,
      background: (s) => this.highestSurface(s),
      contrastCurve: () => new ContrastCurve(1, 1, 3, 4.5),
      toneDeltaPair: () =>
        new ToneDeltaPair(this.tertiaryFixed(), this.tertiaryFixedDim(), 10, 'lighter', true),
    });
  }
  onTertiaryFixed(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'on_tertiary_fixed',
      palette: (s) => s.tertiaryPalette,
      tone: () => 10.0,
      background: () => this.tertiaryFixedDim(),
      secondBackground: () => this.tertiaryFixed(),
      contrastCurve: () => new ContrastCurve(4.5, 7, 11, 21),
    });
  }
  onTertiaryFixedVariant(): DynamicColor {
    return DynamicColor.fromPalette({
      name: 'on_tertiary_fixed_variant',
      palette: (s) => s.tertiaryPalette,
      tone: () => 30.0,
      background: () => this.tertiaryFixedDim(),
      secondBackground: () => this.tertiaryFixed(),
      contrastCurve: () => new ContrastCurve(3, 4.5, 7, 11),
    });
  }

  highestSurface(s: SchemeTonalSpot): DynamicColor {
    return s.isDark ? this.surfaceBright() : this.surfaceDim();
  }
}

/**
 * Material 3 Tonal Spot color scheme, pixel-exact against the reference
 * @material/material-color-utilities 0.4.0 library (2021 spec, phone platform):
 * - Palettes: fixed chroma 36/16/24/6/8 (primary/secondary/tertiary/neutral/
 *   neutral-variant), error hue 25 chroma 84
 * - Contrast levels resolve through the full DynamicColor contrast-curve +
 *   tone-delta machinery, so standard / medium / high contrast are all
 *   pixel-identical to the reference library.
 */
export class SchemeTonalSpot {
  readonly sourceColorArgb: number;
  readonly sourceColorHct: Hct;
  readonly isDark: boolean;
  readonly contrastLevel: number;
  readonly variant = 'TONAL_SPOT';
  readonly platform = 'phone';
  readonly specVersion = '2021';

  readonly primaryPalette: TonalPalette;
  readonly secondaryPalette: TonalPalette;
  readonly tertiaryPalette: TonalPalette;
  readonly neutralPalette: TonalPalette;
  readonly neutralVariantPalette: TonalPalette;
  readonly errorPalette: TonalPalette;

  readonly colors: MaterialDynamicColors;

  constructor(sourceColorArgb: number | Hct, isDark: boolean, contrastLevel: number = 0) {
    this.sourceColorHct =
      typeof sourceColorArgb === 'number' ? Hct.fromInt(sourceColorArgb) : sourceColorArgb;
    this.sourceColorArgb = this.sourceColorHct.toInt();
    this.isDark = isDark;
    this.contrastLevel = Math.max(-1, Math.min(1, contrastLevel));
    const h = this.sourceColorHct.hue;
    this.primaryPalette = TonalPalette.fromHueAndChroma(h, 36);
    this.secondaryPalette = TonalPalette.fromHueAndChroma(h, 16);
    this.tertiaryPalette = TonalPalette.fromHueAndChroma(sanitizeDegreesDouble(h + 60), 24);
    this.neutralPalette = TonalPalette.fromHueAndChroma(h, 6);
    this.neutralVariantPalette = TonalPalette.fromHueAndChroma(h, 8);
    this.errorPalette = TonalPalette.fromHueAndChroma(25, 84);
    this.colors = new MaterialDynamicColors();
  }

  getArgb(dynamicColor: DynamicColor): number {
    return dynamicColor.getArgb(this);
  }
  getHct(dynamicColor: DynamicColor): Hct {
    return dynamicColor.getHct(this);
  }
  getTone(dynamicColor: DynamicColor): number {
    return dynamicColor.getTone(this);
  }

  // ── Background / Surface ──
  get background(): number {
    return this.getArgb(this.colors.background());
  }
  get onBackground(): number {
    return this.getArgb(this.colors.onBackground());
  }
  get surface(): number {
    return this.getArgb(this.colors.surface());
  }
  get surfaceDim(): number {
    return this.getArgb(this.colors.surfaceDim());
  }
  get surfaceBright(): number {
    return this.getArgb(this.colors.surfaceBright());
  }
  get surfaceContainerLowest(): number {
    return this.getArgb(this.colors.surfaceContainerLowest());
  }
  get surfaceContainerLow(): number {
    return this.getArgb(this.colors.surfaceContainerLow());
  }
  get surfaceContainer(): number {
    return this.getArgb(this.colors.surfaceContainer());
  }
  get surfaceContainerHigh(): number {
    return this.getArgb(this.colors.surfaceContainerHigh());
  }
  get surfaceContainerHighest(): number {
    return this.getArgb(this.colors.surfaceContainerHighest());
  }
  get onSurface(): number {
    return this.getArgb(this.colors.onSurface());
  }
  get surfaceVariant(): number {
    return this.getArgb(this.colors.surfaceVariant());
  }
  get onSurfaceVariant(): number {
    return this.getArgb(this.colors.onSurfaceVariant());
  }
  get outline(): number {
    return this.getArgb(this.colors.outline());
  }
  get outlineVariant(): number {
    return this.getArgb(this.colors.outlineVariant());
  }
  get inverseSurface(): number {
    return this.getArgb(this.colors.inverseSurface());
  }
  get inverseOnSurface(): number {
    return this.getArgb(this.colors.inverseOnSurface());
  }
  get inversePrimary(): number {
    return this.getArgb(this.colors.inversePrimary());
  }
  get shadow(): number {
    return this.getArgb(this.colors.shadow());
  }
  get scrim(): number {
    return this.getArgb(this.colors.scrim());
  }

  // ── Primary ──
  get primary(): number {
    return this.getArgb(this.colors.primary());
  }
  get onPrimary(): number {
    return this.getArgb(this.colors.onPrimary());
  }
  get primaryContainer(): number {
    return this.getArgb(this.colors.primaryContainer());
  }
  get onPrimaryContainer(): number {
    return this.getArgb(this.colors.onPrimaryContainer());
  }
  get primaryFixed(): number {
    return this.getArgb(this.colors.primaryFixed());
  }
  get primaryFixedDim(): number {
    return this.getArgb(this.colors.primaryFixedDim());
  }
  get onPrimaryFixed(): number {
    return this.getArgb(this.colors.onPrimaryFixed());
  }
  get onPrimaryFixedVariant(): number {
    return this.getArgb(this.colors.onPrimaryFixedVariant());
  }

  // ── Secondary ──
  get secondary(): number {
    return this.getArgb(this.colors.secondary());
  }
  get onSecondary(): number {
    return this.getArgb(this.colors.onSecondary());
  }
  get secondaryContainer(): number {
    return this.getArgb(this.colors.secondaryContainer());
  }
  get onSecondaryContainer(): number {
    return this.getArgb(this.colors.onSecondaryContainer());
  }
  get secondaryFixed(): number {
    return this.getArgb(this.colors.secondaryFixed());
  }
  get secondaryFixedDim(): number {
    return this.getArgb(this.colors.secondaryFixedDim());
  }
  get onSecondaryFixed(): number {
    return this.getArgb(this.colors.onSecondaryFixed());
  }
  get onSecondaryFixedVariant(): number {
    return this.getArgb(this.colors.onSecondaryFixedVariant());
  }

  // ── Tertiary ──
  get tertiary(): number {
    return this.getArgb(this.colors.tertiary());
  }
  get onTertiary(): number {
    return this.getArgb(this.colors.onTertiary());
  }
  get tertiaryContainer(): number {
    return this.getArgb(this.colors.tertiaryContainer());
  }
  get onTertiaryContainer(): number {
    return this.getArgb(this.colors.onTertiaryContainer());
  }
  get tertiaryFixed(): number {
    return this.getArgb(this.colors.tertiaryFixed());
  }
  get tertiaryFixedDim(): number {
    return this.getArgb(this.colors.tertiaryFixedDim());
  }
  get onTertiaryFixed(): number {
    return this.getArgb(this.colors.onTertiaryFixed());
  }
  get onTertiaryFixedVariant(): number {
    return this.getArgb(this.colors.onTertiaryFixedVariant());
  }

  // ── Error ──
  get error(): number {
    return this.getArgb(this.colors.error());
  }
  get onError(): number {
    return this.getArgb(this.colors.onError());
  }
  get errorContainer(): number {
    return this.getArgb(this.colors.errorContainer());
  }
  get onErrorContainer(): number {
    return this.getArgb(this.colors.onErrorContainer());
  }
}

/** Alias matching the reference library's DynamicScheme type name. */
export type DynamicScheme = SchemeTonalSpot;

/**
 * Provides the same API surface as MaterialDynamicColors from the real library:
 * each method returns a DynamicColor resolved against the active scheme via
 * the 2021-spec color definitions (ColorSpecDelegateImpl2021).
 */
export class MaterialDynamicColors {
  static colorSpec: ColorSpecDelegateImpl2021;

  background() {
    return MaterialDynamicColors.colorSpec.background();
  }
  onBackground() {
    return MaterialDynamicColors.colorSpec.onBackground();
  }
  surface() {
    return MaterialDynamicColors.colorSpec.surface();
  }
  surfaceDim() {
    return MaterialDynamicColors.colorSpec.surfaceDim();
  }
  surfaceBright() {
    return MaterialDynamicColors.colorSpec.surfaceBright();
  }
  surfaceContainerLowest() {
    return MaterialDynamicColors.colorSpec.surfaceContainerLowest();
  }
  surfaceContainerLow() {
    return MaterialDynamicColors.colorSpec.surfaceContainerLow();
  }
  surfaceContainer() {
    return MaterialDynamicColors.colorSpec.surfaceContainer();
  }
  surfaceContainerHigh() {
    return MaterialDynamicColors.colorSpec.surfaceContainerHigh();
  }
  surfaceContainerHighest() {
    return MaterialDynamicColors.colorSpec.surfaceContainerHighest();
  }
  onSurface() {
    return MaterialDynamicColors.colorSpec.onSurface();
  }
  surfaceVariant() {
    return MaterialDynamicColors.colorSpec.surfaceVariant();
  }
  onSurfaceVariant() {
    return MaterialDynamicColors.colorSpec.onSurfaceVariant();
  }
  outline() {
    return MaterialDynamicColors.colorSpec.outline();
  }
  outlineVariant() {
    return MaterialDynamicColors.colorSpec.outlineVariant();
  }
  inverseSurface() {
    return MaterialDynamicColors.colorSpec.inverseSurface();
  }
  inverseOnSurface() {
    return MaterialDynamicColors.colorSpec.inverseOnSurface();
  }
  inversePrimary() {
    return MaterialDynamicColors.colorSpec.inversePrimary();
  }
  shadow() {
    return MaterialDynamicColors.colorSpec.shadow();
  }
  scrim() {
    return MaterialDynamicColors.colorSpec.scrim();
  }
  surfaceTint() {
    return MaterialDynamicColors.colorSpec.surfaceTint();
  }
  primary() {
    return MaterialDynamicColors.colorSpec.primary();
  }
  onPrimary() {
    return MaterialDynamicColors.colorSpec.onPrimary();
  }
  primaryContainer() {
    return MaterialDynamicColors.colorSpec.primaryContainer();
  }
  onPrimaryContainer() {
    return MaterialDynamicColors.colorSpec.onPrimaryContainer();
  }
  primaryFixed() {
    return MaterialDynamicColors.colorSpec.primaryFixed();
  }
  primaryFixedDim() {
    return MaterialDynamicColors.colorSpec.primaryFixedDim();
  }
  onPrimaryFixed() {
    return MaterialDynamicColors.colorSpec.onPrimaryFixed();
  }
  onPrimaryFixedVariant() {
    return MaterialDynamicColors.colorSpec.onPrimaryFixedVariant();
  }
  secondary() {
    return MaterialDynamicColors.colorSpec.secondary();
  }
  onSecondary() {
    return MaterialDynamicColors.colorSpec.onSecondary();
  }
  secondaryContainer() {
    return MaterialDynamicColors.colorSpec.secondaryContainer();
  }
  onSecondaryContainer() {
    return MaterialDynamicColors.colorSpec.onSecondaryContainer();
  }
  secondaryFixed() {
    return MaterialDynamicColors.colorSpec.secondaryFixed();
  }
  secondaryFixedDim() {
    return MaterialDynamicColors.colorSpec.secondaryFixedDim();
  }
  onSecondaryFixed() {
    return MaterialDynamicColors.colorSpec.onSecondaryFixed();
  }
  onSecondaryFixedVariant() {
    return MaterialDynamicColors.colorSpec.onSecondaryFixedVariant();
  }
  tertiary() {
    return MaterialDynamicColors.colorSpec.tertiary();
  }
  onTertiary() {
    return MaterialDynamicColors.colorSpec.onTertiary();
  }
  tertiaryContainer() {
    return MaterialDynamicColors.colorSpec.tertiaryContainer();
  }
  onTertiaryContainer() {
    return MaterialDynamicColors.colorSpec.onTertiaryContainer();
  }
  tertiaryFixed() {
    return MaterialDynamicColors.colorSpec.tertiaryFixed();
  }
  tertiaryFixedDim() {
    return MaterialDynamicColors.colorSpec.tertiaryFixedDim();
  }
  onTertiaryFixed() {
    return MaterialDynamicColors.colorSpec.onTertiaryFixed();
  }
  onTertiaryFixedVariant() {
    return MaterialDynamicColors.colorSpec.onTertiaryFixedVariant();
  }
  error() {
    return MaterialDynamicColors.colorSpec.error();
  }
  onError() {
    return MaterialDynamicColors.colorSpec.onError();
  }
  errorContainer() {
    return MaterialDynamicColors.colorSpec.errorContainer();
  }
  onErrorContainer() {
    return MaterialDynamicColors.colorSpec.onErrorContainer();
  }
}

MaterialDynamicColors.colorSpec = new ColorSpecDelegateImpl2021();

// ─── Module-level export for `import * as Material` pattern ─────────────────

export default {
  argbFromHex,
  hexFromArgb,
  Hct,
  SchemeTonalSpot,
  TonalPalette,
  MaterialDynamicColors,
  ContrastCurve,
  ToneDeltaPair,
  Contrast,
  DynamicColor,
};
