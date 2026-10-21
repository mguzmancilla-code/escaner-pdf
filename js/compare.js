// Comparación de dos PDF: diferencias de texto (palabra por palabra) y visuales
// (píxel a píxel por página). Todo en el navegador.

// ---------------------------------------------------------------------------
// Algoritmo de diferencias de Myers (el mismo de «git diff»)
// ---------------------------------------------------------------------------

/**
 * Devuelve las operaciones para pasar de `a` a `b`: ['=', i, j], ['-', i, null]
 * o ['+', null, j]. Devuelve null si hay más de `maxD` diferencias.
 */
export function myers(a, b, maxD = 3000) {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  let fin = -1;
  for (let d = 0; d <= max && fin < 0; d++) {
    if (d > maxD) return null;
    trace.push(v.slice(off - d - 1, off + d + 2)); // estado previo, ventana k ∈ [-d-1, d+1]
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        fin = d;
        break;
      }
    }
  }
  const ops = [];
  let x = n;
  let y = m;
  for (let d = fin; d > 0; d--) {
    const w = trace[d];
    const get = (k) => w[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && get(k - 1) < get(k + 1)) ? k + 1 : k - 1;
    const prevX = get(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) ops.push(['=', --x, --y]);
    if (x === prevX) ops.push(['+', null, --y]);
    else ops.push(['-', --x, null]);
  }
  while (x > 0 && y > 0) ops.push(['=', --x, --y]);
  return ops.reverse();
}

/** Agrupa operaciones seguidas distintas de «=» en bloques de cambio. */
function hunks(ops) {
  const out = [];
  let actual = null;
  for (const [t, i, j] of ops) {
    if (t === '=') {
      actual = null;
      continue;
    }
    if (!actual) out.push((actual = { a: [], b: [] }));
    if (t === '-') actual.a.push(i);
    else actual.b.push(j);
  }
  return out;
}

const norm = (w) => w.normalize('NFC');

/** Convierte cadenas en enteros para comparar rápido. */
function hasher() {
  const map = new Map();
  return (s) => {
    let h = map.get(s);
    if (h === undefined) map.set(s, (h = map.size));
    return h;
  };
}

// ---------------------------------------------------------------------------
// Comparación de texto
// ---------------------------------------------------------------------------

/**
 * Compara el texto de dos documentos (líneas con palabras, como las de
 * pdftext.extractWords). Devuelve la lista de cambios y un resumen.
 * Cada cambio: { tipo: 'cambio'|'agregado'|'eliminado', antes, despues, paginaA, paginaB,
 *               palabrasB (para marcar), ancla (palabra de B junto a una eliminación) }.
 */
export function compareText(A, B) {
  const h = hasher();
  const clave = (line) => h(line.words.map((x) => norm(x.w)).join(' '));
  const lineOps = myers(A.lines.map(clave), B.lines.map(clave), 4000);
  if (!lineOps) return { demasiado: true, cambios: [] };

  const cambios = [];
  const bloques = hunks(lineOps);
  // Línea de B que sigue a cada línea eliminada (para anclar lo eliminado).
  const siguienteB = new Map();
  let pos = 0;
  for (const [t, i, j] of lineOps) {
    if (t === '=') pos = j + 1;
    if (t === '-') siguienteB.set(i, pos);
    if (t === '+') pos = j + 1;
  }

  for (const blq of bloques) {
    const wa = blq.a.flatMap((i) => A.lines[i].words);
    const wb = blq.b.flatMap((j) => B.lines[j].words);
    const anclaLinea = blq.b.length ? blq.b[0] : siguienteB.get(blq.a[0]);
    const anclaDefecto = B.lines[anclaLinea]?.words[0] ?? B.lines[anclaLinea - 1]?.words.at(-1) ?? null;

    let wordOps = null;
    if (wa.length && wb.length && wa.length * wb.length < 4e7) {
      const hw = hasher();
      wordOps = myers(wa.map((x) => hw(norm(x.w))), wb.map((x) => hw(norm(x.w))), 2500);
    }
    if (!wordOps) {
      cambios.push(armar(wa, wb, anclaDefecto));
      continue;
    }
    // Dentro del bloque, cada grupo de palabras distintas es un cambio.
    let ultimaPalabraB = null;
    const grupos = [];
    let g = null;
    for (const [t, i, j] of wordOps) {
      if (t === '=') {
        if (g) g.siguiente = wb[j];
        g = null;
        ultimaPalabraB = wb[j];
        continue;
      }
      if (!g) grupos.push((g = { a: [], b: [], previa: ultimaPalabraB, siguiente: null }));
      if (t === '-') g.a.push(wa[i]);
      else {
        g.b.push(wb[j]);
        ultimaPalabraB = wb[j];
      }
    }
    for (const gr of grupos) cambios.push(armar(gr.a, gr.b, gr.siguiente ?? gr.previa ?? anclaDefecto));
  }

  const resumen = { cambio: 0, agregado: 0, eliminado: 0 };
  for (const c of cambios) resumen[c.tipo]++;
  return { cambios, resumen };
}

function armar(wa, wb, ancla) {
  const texto = (ws) => ws.map((x) => x.w).join(' ');
  return {
    tipo: wa.length && wb.length ? 'cambio' : wb.length ? 'agregado' : 'eliminado',
    antes: texto(wa),
    despues: texto(wb),
    paginaA: wa[0]?.page ?? null,
    paginaB: wb[0]?.page ?? ancla?.page ?? null,
    palabrasB: wb,
    ancla: wb.length ? null : ancla,
  };
}

/** Líneas a partir de texto plano (p. ej. del OCR), sin posiciones. */
export function linesFromPlainText(texto) {
  return {
    pages: [],
    lines: texto
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => ({ page: -1, words: l.split(/\s+/).map((w) => ({ w, page: -1 })) })),
  };
}

// ---------------------------------------------------------------------------
// Comparación visual (página por página)
// ---------------------------------------------------------------------------

async function toImageData(blob, w, h) {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const data = ctx.getImageData(0, 0, w, h).data;
  canvas.width = 0;
  return data;
}

/**
 * Compara dos imágenes de página y devuelve las zonas distintas (rectángulos
 * relativos 0–1) y el porcentaje de la página que cambió.
 */
export async function diffImages(blobA, blobB, { size = 900, celda = 9, umbral = 28 } = {}) {
  const bmpB = await createImageBitmap(blobB);
  const k = size / Math.max(bmpB.width, bmpB.height);
  const w = Math.round(bmpB.width * k);
  const h = Math.round(bmpB.height * k);
  bmpB.close?.();
  const [a, b] = await Promise.all([toImageData(blobA, w, h), toImageData(blobB, w, h)]);

  const cols = Math.ceil(w / celda);
  const rows = Math.ceil(h / celda);
  const marca = new Uint8Array(cols * rows);
  let marcadas = 0;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let distintos = 0;
      let total = 0;
      for (let y = cy * celda; y < Math.min(h, (cy + 1) * celda); y++) {
        for (let x = cx * celda; x < Math.min(w, (cx + 1) * celda); x++) {
          const p = (y * w + x) * 4;
          const ga = a[p] * 0.299 + a[p + 1] * 0.587 + a[p + 2] * 0.114;
          const gb = b[p] * 0.299 + b[p + 1] * 0.587 + b[p + 2] * 0.114;
          if (Math.abs(ga - gb) > umbral) distintos++;
          total++;
        }
      }
      if (distintos / total > 0.06) {
        marca[cy * cols + cx] = 1;
        marcadas++;
      }
    }
  }

  // Une celdas vecinas (con un margen de 1 celda) en rectángulos.
  const visto = new Uint8Array(cols * rows);
  const rects = [];
  for (let i = 0; i < marca.length; i++) {
    if (!marca[i] || visto[i]) continue;
    let [x0, y0, x1, y1] = [i % cols, Math.floor(i / cols), i % cols, Math.floor(i / cols)];
    const pila = [i];
    visto[i] = 1;
    while (pila.length) {
      const c = pila.pop();
      const cx = c % cols;
      const cy = Math.floor(c / cols);
      x0 = Math.min(x0, cx);
      x1 = Math.max(x1, cx);
      y0 = Math.min(y0, cy);
      y1 = Math.max(y1, cy);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const nIdx = ny * cols + nx;
          if (marca[nIdx] && !visto[nIdx]) {
            visto[nIdx] = 1;
            pila.push(nIdx);
          }
        }
      }
    }
    rects.push({
      x: (x0 * celda) / w,
      y: (y0 * celda) / h,
      w: ((x1 - x0 + 1) * celda) / w,
      h: ((y1 - y0 + 1) * celda) / h,
    });
  }
  return { rects, porcentaje: (marcadas / marca.length) * 100 };
}
