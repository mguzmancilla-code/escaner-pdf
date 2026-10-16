// Procesado de imagen: detección de bordes, corrección de perspectiva y filtros.
// Todo se hace en el dispositivo con <canvas>; nada sale del iPhone.

// Safari en iOS no permite lienzos de más de ~16,7 millones de píxeles.
const MAX_AREA = 16_000_000;
const MAX_SIDE = 4096;

export const FULL_FRAME = [[0, 0], [1, 0], [1, 1], [0, 1]];

export function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** En iOS la memoria de un canvas solo se libera al reducirlo a 0×0. */
export function releaseCanvas(canvas) {
  canvas.width = 0;
  canvas.height = 0;
}

export async function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('No se pudo leer la imagen.');
  }
  return img;
}

export function releaseImage(img) {
  if (img?.src?.startsWith('blob:')) URL.revokeObjectURL(img.src);
}

export function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo codificar la imagen (memoria insuficiente).'))),
      'image/jpeg',
      quality,
    );
  });
}

function sizeOf(source) {
  return [source.naturalWidth || source.width, source.naturalHeight || source.height];
}

/** Reduce en pasos de 1/2 para evitar el efecto "dientes de sierra". */
export function downscale(source, maxSide) {
  const [w, h] = sizeOf(source);
  const k = Math.min(1, maxSide / Math.max(w, h), Math.sqrt(MAX_AREA / (w * h)));
  const tw = Math.max(1, Math.round(w * k));
  const th = Math.max(1, Math.round(h * k));

  let current = source;
  let [cw, ch] = [w, h];
  while (cw > tw * 2) {
    cw = Math.round(cw / 2);
    ch = Math.round(ch / 2);
    const step = createCanvas(cw, ch);
    drawSmooth(step, current);
    if (current !== source) releaseCanvas(current);
    current = step;
  }
  const out = createCanvas(tw, th);
  drawSmooth(out, current);
  if (current !== source) releaseCanvas(current);
  return out;
}

function drawSmooth(target, source) {
  const ctx = target.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, target.width, target.height);
}

/** Redimensiona un JPEG. Devuelve también el tamaño final en píxeles. */
export async function resizeJpeg(blob, maxSide, quality) {
  const img = await loadImage(blob);
  try {
    const canvas = downscale(img, maxSide);
    const { width, height } = canvas;
    const out = await canvasToBlob(canvas, quality);
    releaseCanvas(canvas);
    return { blob: out, width, height };
  } finally {
    releaseImage(img);
  }
}

// ---------------------------------------------------------------------------
// Detección automática del documento
// ---------------------------------------------------------------------------

/**
 * Busca la hoja de papel (la zona clara más grande) y devuelve sus 4 esquinas
 * normalizadas [0‒1] en orden: sup-izq, sup-der, inf-der, inf-izq.
 * Devuelve null si no encuentra nada convincente.
 */
export function detectCorners(img) {
  const [W, H] = sizeOf(img);
  const s = 360 / Math.max(W, H);
  const w = Math.max(16, Math.round(W * s));
  const h = Math.max(16, Math.round(H * s));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  releaseCanvas(canvas);

  const n = w * h;
  const gray = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    gray[i] = px[j] * 0.299 + px[j + 1] * 0.587 + px[j + 2] * 0.114;
  }

  // Desenfoque 5×5 para que las letras no partan la hoja en trozos.
  const blurred = boxBlur(gray, w, h, 2);

  // Umbral de Otsu: separa "papel" de "fondo".
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[blurred[i] | 0]++;
  const threshold = otsu(hist, n);

  // Componente conexa clara más grande.
  const comp = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let best = -1;
  let bestSize = 0;
  let label = 0;
  for (let start = 0; start < n; start++) {
    if (comp[start] !== -1 || blurred[start] <= threshold) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    comp[start] = label;
    while (head < tail) {
      const p = queue[head++];
      const x = p % w;
      const neighbors = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
      for (const q of neighbors) {
        if (q >= 0 && q < n && comp[q] === -1 && blurred[q] > threshold) {
          comp[q] = label;
          queue[tail++] = q;
        }
      }
    }
    if (tail > bestSize) {
      bestSize = tail;
      best = label;
    }
    label++;
  }

  const fraction = bestSize / n;
  if (best < 0 || fraction < 0.12 || fraction > 0.97) return null;

  // Esquinas = puntos extremos en las diagonales.
  let tl = [0, 0, Infinity];
  let br = [0, 0, -Infinity];
  let tr = [0, 0, -Infinity];
  let bl = [0, 0, Infinity];
  for (let p = 0; p < n; p++) {
    if (comp[p] !== best) continue;
    const x = p % w;
    const y = (p - x) / w;
    const sum = x + y;
    const diff = x - y;
    if (sum < tl[2]) tl = [x, y, sum];
    if (sum > br[2]) br = [x, y, sum];
    if (diff > tr[2]) tr = [x, y, diff];
    if (diff < bl[2]) bl = [x, y, diff];
  }
  const corners = [tl, tr, br, bl].map(([x, y]) => [
    clamp((x + 0.5) / w, 0, 1),
    clamp((y + 0.5) / h, 0, 1),
  ]);
  return quadArea(corners) > 0.1 ? corners : null;
}

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) {
        sum += src[y * w + k];
        count++;
      }
      tmp[y * w + x] = sum / count;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) {
        sum += tmp[k * w + x];
        count++;
      }
      out[y * w + x] = sum / count;
    }
  }
  return out;
}

function otsu(hist, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

function quadArea(pts) {
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % 4];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function isFullFrame(corners) {
  return corners.every(([x, y], i) => Math.abs(x - FULL_FRAME[i][0]) < 1e-3 && Math.abs(y - FULL_FRAME[i][1]) < 1e-3);
}

// ---------------------------------------------------------------------------
// Renderizado de la página: recorte + perspectiva + filtro + giro
// ---------------------------------------------------------------------------

/**
 * @param {HTMLImageElement} img imagen original
 * @param {{corners:number[][], rotation:number, filter:string, adjust?:object}} page
 * @param {number} maxSide lado máximo del resultado (para vistas previas rápidas)
 * @returns {HTMLCanvasElement}
 */
export function renderPage(img, { corners, rotation, filter, adjust }, maxSide = MAX_SIDE) {
  const [W, H] = sizeOf(img);
  const scale = Math.min(1, Math.min(MAX_SIDE, maxSide) / Math.max(W, H), Math.sqrt(MAX_AREA / (W * H)));
  const sw = Math.max(1, Math.round(W * scale));
  const sh = Math.max(1, Math.round(H * scale));
  const src = createCanvas(sw, sh);
  const sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(img, 0, 0, sw, sh);

  let canvas;
  if (isFullFrame(corners) && filter === 'original' && !hasAdjust(adjust)) {
    canvas = src;
  } else {
    let data = sctx.getImageData(0, 0, sw, sh);
    if (!isFullFrame(corners)) {
      data = warpPerspective(data, corners.map(([x, y]) => [x * sw, y * sh]));
    }
    releaseCanvas(src);
    applyFilter(data, filter);
    applyAdjust(data, adjust);
    canvas = createCanvas(data.width, data.height);
    canvas.getContext('2d').putImageData(data, 0, 0);
  }
  return rotation ? rotate(canvas, rotation) : canvas;
}

function rotate(canvas, quarterTurns) {
  const { width: w, height: h } = canvas;
  const out = quarterTurns % 2 ? createCanvas(h, w) : createCanvas(w, h);
  const ctx = out.getContext('2d');
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((quarterTurns * Math.PI) / 2);
  ctx.drawImage(canvas, -w / 2, -h / 2);
  releaseCanvas(canvas);
  return out;
}

/** Homografía del cuadrado unidad al cuadrilátero (Heckbert, 1989). */
function squareToQuad([[x0, y0], [x1, y1], [x2, y2], [x3, y3]]) {
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    return { a: x1 - x0, b: x3 - x0, c: x0, d: y1 - y0, e: y3 - y0, f: y0, g: 0, h: 0 };
  }
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const h = (dx1 * dy3 - dx3 * dy1) / den;
  return {
    a: x1 - x0 + g * x1,
    b: x3 - x0 + h * x3,
    c: x0,
    d: y1 - y0 + g * y1,
    e: y3 - y0 + h * y3,
    f: y0,
    g,
    h,
  };
}

function warpPerspective(src, quad) {
  const [p0, p1, p2, p3] = quad;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let ow = Math.max(dist(p0, p1), dist(p3, p2));
  let oh = Math.max(dist(p0, p3), dist(p1, p2));
  const k = Math.min(1, Math.sqrt(MAX_AREA / (ow * oh)), MAX_SIDE / Math.max(ow, oh));
  ow = Math.max(1, Math.round(ow * k));
  oh = Math.max(1, Math.round(oh * k));

  const m = squareToQuad(quad);
  const out = new ImageData(ow, oh);
  const sd = src.data;
  const od = out.data;
  const sw = src.width;
  const sh = src.height;
  const maxX = sw - 1;
  const maxY = sh - 1;

  let o = 0;
  for (let v = 0; v < oh; v++) {
    const t = (v + 0.5) / oh;
    const nx = m.b * t + m.c;
    const ny = m.e * t + m.f;
    const nd = m.h * t + 1;
    for (let u = 0; u < ow; u++, o += 4) {
      const s = (u + 0.5) / ow;
      const den = m.g * s + nd;
      let x = (m.a * s + nx) / den - 0.5;
      let y = (m.d * s + ny) / den - 0.5;
      x = x < 0 ? 0 : x > maxX ? maxX : x;
      y = y < 0 ? 0 : y > maxY ? maxY : y;
      const x0 = x | 0;
      const y0 = y | 0;
      const fx = x - x0;
      const fy = y - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = x0 < maxX ? i00 + 4 : i00;
      const i01 = y0 < maxY ? i00 + sw * 4 : i00;
      const i11 = x0 < maxX ? i01 + 4 : i01;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      od[o] = sd[i00] * w00 + sd[i10] * w10 + sd[i01] * w01 + sd[i11] * w11;
      od[o + 1] = sd[i00 + 1] * w00 + sd[i10 + 1] * w10 + sd[i01 + 1] * w01 + sd[i11 + 1] * w11;
      od[o + 2] = sd[i00 + 2] * w00 + sd[i10 + 2] * w10 + sd[i01 + 2] * w01 + sd[i11 + 2] * w11;
      od[o + 3] = 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ajustes manuales: brillo, contraste, saturación y nitidez (-100…100; nitidez 0…100)
// ---------------------------------------------------------------------------

export const NO_ADJUST = Object.freeze({ brillo: 0, contraste: 0, saturacion: 0, nitidez: 0 });

export const hasAdjust = (a) => Boolean(a && (a.brillo || a.contraste || a.saturacion || a.nitidez));

/** Aplica los ajustes sobre los píxeles (después del filtro). */
function applyAdjust(imageData, adjust) {
  if (!hasAdjust(adjust)) return;
  const { data: d, width: w, height: h } = imageData;
  const { brillo = 0, contraste = 0, saturacion = 0, nitidez = 0 } = adjust;
  if (brillo || contraste) {
    // Contraste alrededor del gris medio (×0,5 a ×2) y luego brillo (±80 niveles).
    const f = 2 ** (contraste / 100);
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = (v - 128) * f + 128 + brillo * 0.8;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = lut[d[i]];
      d[i + 1] = lut[d[i + 1]];
      d[i + 2] = lut[d[i + 2]];
    }
  }
  if (saturacion) {
    const k = 1 + saturacion / 100; // 0 = gris, 2 = el doble de color
    for (let i = 0; i < d.length; i += 4) {
      const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      d[i] = clamp(l + (d[i] - l) * k, 0, 255);
      d[i + 1] = clamp(l + (d[i + 1] - l) * k, 0, 255);
      d[i + 2] = clamp(l + (d[i + 2] - l) * k, 0, 255);
    }
  }
  if (nitidez > 0) sharpen(d, w, h, (nitidez / 100) * 1.6);
}

/**
 * Ajuste automático: estira el rango de brillo para que lo más oscuro quede
 * casi negro y lo más claro casi blanco (niveles automáticos), sin exagerar.
 */
export function autoAdjust(img, page) {
  const canvas = renderPage(img, { ...page, adjust: NO_ADJUST }, 500);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { data: d } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  releaseCanvas(canvas);
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < d.length; i += 16) {
    hist[(d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8]++;
    n++;
  }
  const percentil = (p) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) if ((acc += hist[v]) >= n * p) return v;
    return 255;
  };
  const bajo = percentil(0.01);
  const alto = percentil(0.99);
  const f = clamp(250 / Math.max(40, alto - bajo), 1, 1.5); // moderado: se puede subir a mano
  const contraste = Math.round(100 * Math.log2(f));
  const medio = (bajo + alto) / 2;
  const brillo = clamp(Math.round((-(medio - 128) * f) / 0.8), -40, 40);
  return { brillo, contraste, saturacion: page.filter === 'original' || page.filter === 'sharp' ? 10 : 0, nitidez: 25 };
}

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

export const FILTERS = [
  { id: 'original', label: 'Original' },
  { id: 'sharp', label: 'Nítido' },
  { id: 'grayscale', label: 'Grises' },
  { id: 'bw', label: 'Blanco y negro' },
];

// Curva de alto contraste para «Blanco y negro»: lleva el fondo del papel a
// blanco y el texto a negro, con una transición suave para no romper los
// trazos finos (números, acentos). Precalculada como tabla de 256 valores.
const BW_CURVE = (() => {
  const lut = new Uint8ClampedArray(256);
  const center = 178;
  const slope = 0.075;
  for (let v = 0; v < 256; v++) lut[v] = 255 / (1 + Math.exp(-slope * (v - center)));
  return lut;
})();

/**
 * Realce de nitidez (unsharp mask) sobre la luminancia, modificando los píxeles
 * en el sitio. Hace legible el texto fino sin alterar los colores. Usa una
 * ventana deslizante de pocas filas: la memoria no depende del alto de la foto.
 */
function sharpen(d, w, h, amount) {
  const r = clamp(Math.round(Math.max(w, h) / 2200), 1, 2);
  const win = 2 * r + 1;
  const rawLuma = Array.from({ length: win }, () => new Float32Array(w));
  const blurH = Array.from({ length: win }, () => new Float32Array(w));

  // Carga una fila: calcula su luminancia y su desenfoque horizontal (box).
  const loadRow = (y) => {
    const slot = y % win;
    const raw = rawLuma[slot];
    const bh = blurH[slot];
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
      raw[x] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    }
    let sum = 0;
    for (let x = 0; x <= r && x < w; x++) sum += raw[x];
    let count = Math.min(r + 1, w);
    for (let x = 0; x < w; x++) {
      bh[x] = sum / count;
      const add = x + r + 1;
      const rem = x - r;
      if (add < w) { sum += raw[add]; count++; }
      if (rem >= 0) { sum -= raw[rem]; count--; }
    }
  };

  for (let y = 0; y < r && y < h; y++) loadRow(y);

  for (let y = 0; y < h; y++) {
    if (y + r < h) loadRow(y + r);
    const raw = rawLuma[y % win];
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
      let sum = 0;
      let count = 0;
      for (let k = -r; k <= r; k++) {
        const yy = y + k;
        if (yy < 0 || yy >= h) continue;
        sum += blurH[yy % win][x];
        count++;
      }
      const detail = amount * (raw[x] - sum / count); // diferencia con el desenfoque
      d[i] = clamp(d[i] + detail, 0, 255);
      d[i + 1] = clamp(d[i + 1] + detail, 0, 255);
      d[i + 2] = clamp(d[i + 2] + detail, 0, 255);
    }
  }
}

/**
 * Estima la iluminación del papel (percentil 90 de brillo por celdas) para
 * poder "blanquear" el fondo y eliminar sombras sin quemar el texto.
 */
function backgroundMap(d, w, h) {
  const cell = Math.max(8, Math.round(Math.max(w, h) / 48));
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  let grid = new Float32Array(gw * gh);
  const hist = new Uint32Array(64);

  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      hist.fill(0);
      let total = 0;
      const x0 = gx * cell;
      const x1 = Math.min(w, x0 + cell);
      const y1 = Math.min(h, gy * cell + cell);
      for (let y = gy * cell; y < y1; y += 2) {
        for (let x = x0, i = (y * w + x0) * 4; x < x1; x += 2, i += 8) {
          hist[(d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 10]++;
          total++;
        }
      }
      const target = total * 0.9;
      let acc = 0;
      let bin = 63;
      for (let b = 0; b < 64; b++) {
        acc += hist[b];
        if (acc >= target) {
          bin = b;
          break;
        }
      }
      grid[gy * gw + gx] = bin * 4 + 2;
    }
  }

  grid = neighborhood(grid, gw, gh, Math.max);
  grid = neighborhood(grid, gw, gh, null);
  grid = neighborhood(grid, gw, gh, null);
  return { grid, gw, gh, cell };
}

/** Filtro 3×3: máximo (si se pasa Math.max) o media. */
function neighborhood(grid, gw, gh, reducer) {
  const out = new Float32Array(grid.length);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      let acc = reducer ? -Infinity : 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
          const v = grid[yy * gw + xx];
          acc = reducer ? reducer(acc, v) : acc + v;
          count++;
        }
      }
      out[y * gw + x] = reducer ? acc : acc / count;
    }
  }
  return out;
}

function applyFilter(imageData, filter) {
  if (filter === 'original') return;
  const { data: d, width: w, height: h } = imageData;
  const { grid, gw, gh, cell } = backgroundMap(d, w, h);

  const gx0 = new Int32Array(w);
  const gx1 = new Int32Array(w);
  const tx = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const f = clamp((x + 0.5) / cell - 0.5, 0, gw - 1);
    gx0[x] = f | 0;
    gx1[x] = Math.min(gx0[x] + 1, gw - 1);
    tx[x] = f - gx0[x];
  }
  const row = new Float32Array(gw);

  for (let y = 0; y < h; y++) {
    const f = clamp((y + 0.5) / cell - 0.5, 0, gh - 1);
    const gy0 = f | 0;
    const gy1 = Math.min(gy0 + 1, gh - 1);
    const ty = f - gy0;
    for (let g = 0; g < gw; g++) row[g] = grid[gy0 * gw + g] * (1 - ty) + grid[gy1 * gw + g] * ty;

    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
      const bg = Math.max(80, row[gx0[x]] * (1 - tx[x]) + row[gx1[x]] * tx[x]);
      const k = 255 / bg; // normaliza el fondo del papel a blanco y quita sombras
      const r = d[i] * k;
      const g = d[i + 1] * k;
      const b = d[i + 2] * k;
      if (filter === 'sharp') {
        // Papel blanco, colores algo más vivos y texto más marcado (la nitidez va después).
        const l = r * 0.299 + g * 0.587 + b * 0.114;
        d[i] = (l + (r - l) * 1.25 - 128) * 1.18 + 128;
        d[i + 1] = (l + (g - l) * 1.25 - 128) * 1.18 + 128;
        d[i + 2] = (l + (b - l) * 1.25 - 128) * 1.18 + 128;
      } else {
        // Grises y Blanco y negro: se normaliza a gris; el contraste duro del B/N
        // se aplica al final, después de realzar la nitidez.
        const l = r * 0.299 + g * 0.587 + b * 0.114;
        d[i] = d[i + 1] = d[i + 2] = filter === 'grayscale' ? (l - 20) * 1.14 : l;
      }
    }
  }

  // Realce de nitidez: el paso que más mejora la legibilidad del texto fino.
  if (filter === 'sharp') sharpen(d, w, h, 0.9);
  else if (filter === 'grayscale') sharpen(d, w, h, 0.8);
  else if (filter === 'bw') {
    sharpen(d, w, h, 1.1);
    for (let i = 0; i < d.length; i += 4) {
      const v = BW_CURVE[clamp(d[i], 0, 255) | 0];
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
}
