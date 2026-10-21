// Edición de PDF con pdf-lib: combinar, reorganizar páginas y dividir.
// pdf-lib se carga bajo demanda y queda en la caché de la app.

let lib = null;

async function pdflib() {
  if (!lib) lib = await import('./vendor/pdf-lib.esm.min.js');
  return lib;
}

async function loadDoc(PDFLib, blob) {
  const buffer = blob instanceof Blob ? await blob.arrayBuffer() : blob;
  return PDFLib.PDFDocument.load(buffer, { ignoreEncryption: true });
}

const asBlob = (bytes) => new Blob([bytes], { type: 'application/pdf' });

/** Combina varios PDF, en el orden dado, en uno solo. */
export async function mergePdfs(blobs, onProgress) {
  const PDFLib = await pdflib();
  const out = await PDFLib.PDFDocument.create();
  for (const [i, blob] of blobs.entries()) {
    const src = await loadDoc(PDFLib, blob);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((page) => out.addPage(page));
    onProgress?.(i + 1, blobs.length);
  }
  return asBlob(await out.save({ useObjectStreams: false }));
}

/**
 * Reconstruye un PDF a partir de una secuencia de páginas tomadas de uno o
 * varios PDF de origen. Cubre reordenar, eliminar, extraer, girar e insertar.
 * @param {Object<string, Blob>} sources  id de origen → PDF
 * @param {{source: string, index: number, rotate?: number}[]} pages  orden final
 */
export async function composePages(sources, pages) {
  const PDFLib = await pdflib();
  const out = await PDFLib.PDFDocument.create();

  // Carga cada origen una vez y copia de golpe las páginas que se usan de él.
  const copied = {};
  const usados = {};
  for (const p of pages) (usados[p.source] ??= new Set()).add(p.index);
  for (const [id, set] of Object.entries(usados)) {
    const indices = [...set];
    const doc = await loadDoc(PDFLib, sources[id]);
    const copiadas = await out.copyPages(doc, indices);
    copied[id] = new Map(indices.map((idx, i) => [idx, copiadas[i]]));
  }

  for (const p of pages) {
    const page = copied[p.source].get(p.index);
    if (p.rotate) {
      const actual = page.getRotation().angle;
      page.setRotation(PDFLib.degrees((((actual + p.rotate) % 360) + 360) % 360));
    }
    out.addPage(page);
  }
  return asBlob(await out.save({ useObjectStreams: false }));
}

/** Divide un PDF en un archivo por página. Devuelve [{ blob, pageNumber }]. */
export async function splitPdf(blob, onProgress) {
  const PDFLib = await pdflib();
  const src = await loadDoc(PDFLib, blob);
  const total = src.getPageCount();
  const salida = [];
  for (let i = 0; i < total; i++) {
    const doc = await PDFLib.PDFDocument.create();
    const [page] = await doc.copyPages(src, [i]);
    doc.addPage(page);
    salida.push({ blob: asBlob(await doc.save({ useObjectStreams: false })), pageNumber: i + 1 });
    onProgress?.(i + 1, total);
  }
  return salida;
}

/** Número de páginas de un PDF. */
export async function pageCount(blob) {
  const PDFLib = await pdflib();
  return (await loadDoc(PDFLib, blob)).getPageCount();
}

/** Reescribe la estructura del PDF (sin cambiar el contenido visible). Ayuda a
 *  que conversores externos que se caen con ciertos PDF puedan procesarlo. */
export async function normalize(blob) {
  const PDFLib = await pdflib();
  const doc = await loadDoc(PDFLib, blob);
  doc.setProducer('AgneScan');
  return asBlob(await doc.save({ useObjectStreams: false }));
}

/**
 * Convierte un punto relativo de la vista (ur, vr) ∈ [0,1], con origen
 * arriba-izquierda, a coordenadas PDF (puntos, origen abajo-izquierda) en una
 * página de MediaBox W×H con rotación `rot` (0/90/180/270).
 */
function viewToPdf(ur, vr, W, H, rot) {
  const rot90 = rot === 90 || rot === 270;
  const dx = ur * (rot90 ? H : W); // píxeles de vista desde la izquierda
  const dy = vr * (rot90 ? W : H); // píxeles de vista desde arriba
  switch (rot) {
    case 90:
      return [dy, dx];
    case 180:
      return [W - dx, dy];
    case 270:
      return [W - dy, H - dx];
    default:
      return [dx, H - dy];
  }
}

const hexToRgb = (PDFLib, hex) => {
  const n = parseInt(hex.slice(1), 16);
  return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

// WinAnsi (Helvetica) no soporta todos los caracteres: se normaliza la
// puntuación tipográfica común y el resto se sustituye por «?».
const winAnsi = (texto) =>
  (texto || '')
    .replace(/[–—]/g, '-')
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/…/g, '...')
    .replace(/[^\x00-\xFF]/g, '?');

// ---------------------------------------------------------------------------
// Comentarios PDF reales (anotaciones): se ven en el panel de comentarios de
// Adobe, Edge, Chrome o Vista Previa, y se pueden editar o borrar allí.
// Cada uno lleva su apariencia (/AP) para verse igual en todos los lectores.
// ---------------------------------------------------------------------------

export const COMMENT_TYPES = new Set(['note', 'highlight', 'underline', 'strike', 'pen', 'rect']);

const SUBTYPE = { note: 'Text', highlight: 'Highlight', underline: 'Underline', strike: 'StrikeOut', pen: 'Ink', rect: 'Square' };

const num = (v) => (Math.round(v * 1000) / 1000).toString();

function pdfDate(d = new Date()) {
  const p = (v) => String(v).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${sign}${p(Math.floor(a / 60))}'${p(a % 60)}'`;
}

function rgbArray(hex) {
  const h = (hex || '#000000').replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
}

/** Crea el comentario `it` en la página. `toPdf` pasa de coordenadas de vista (0–1) a puntos PDF. */
function addComment(PDFLib, doc, page, it, { toPdf, vista, author }) {
  const { PDFName, PDFHexString, PDFString } = PDFLib;
  const ctx = doc.context;
  const [r, g, b] = rgbArray(it.color);
  const color = `${num(r)} ${num(g)} ${num(b)}`;

  let rect;
  let content;
  let opacity = 1;
  const extra = {};

  // Esquinas del área marcada, en el orden que piden QuadPoints:
  // arriba-izquierda, arriba-derecha, abajo-izquierda, abajo-derecha (de la vista).
  const quad = () => {
    const pts = [
      toPdf(it.xr, it.yr),
      toPdf(it.xr + it.wr, it.yr),
      toPdf(it.xr, it.yr + it.hr),
      toPdf(it.xr + it.wr, it.yr + it.hr),
    ];
    return pts;
  };
  const bbox = (pts, pad = 0) => {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
  };

  if (it.type === 'highlight' || it.type === 'underline' || it.type === 'strike') {
    const q = quad();
    const [tl, tr, bl, br] = q;
    rect = bbox(q, 1);
    extra.QuadPoints = q.flat();
    if (it.type === 'highlight') {
      opacity = 0.4;
      content = `${color} rg ${num(tl[0])} ${num(tl[1])} m ${num(tr[0])} ${num(tr[1])} l ${num(br[0])} ${num(br[1])} l ${num(bl[0])} ${num(bl[1])} l h f`;
    } else {
      // Línea a lo largo del área: abajo (subrayado) o al medio (tachado).
      const t = it.type === 'underline' ? 0.92 : 0.5;
      const lerp = (p, q2, k) => [p[0] + (q2[0] - p[0]) * k, p[1] + (q2[1] - p[1]) * k];
      const a = lerp(tl, bl, t);
      const z = lerp(tr, br, t);
      const alto = Math.hypot(bl[0] - tl[0], bl[1] - tl[1]);
      const w = Math.max(0.8, Math.min(2.5, alto * 0.07));
      content = `${color} RG ${num(w)} w 1 J ${num(a[0])} ${num(a[1])} m ${num(z[0])} ${num(z[1])} l S`;
    }
  } else if (it.type === 'pen') {
    const pts = it.points.map(([x, y]) => toPdf(x, y));
    const w = Math.max(0.5, (it.thickness || 0.004) * vista.h);
    rect = bbox(pts, w);
    extra.InkList = [pts.flat()];
    extra.BS = { W: w, S: 'S' };
    const path = pts.map((p, i) => `${num(p[0])} ${num(p[1])} ${i ? 'l' : 'm'}`).join(' ');
    content = `${color} RG ${num(w)} w 1 J 1 j ${path} S`;
  } else if (it.type === 'rect') {
    const q = quad();
    const w = Math.max(0.5, (it.thickness || 0.004) * vista.h);
    rect = bbox(q, w / 2);
    extra.BS = { W: w, S: 'S' };
    const [tl, tr, bl, br] = q;
    content = `${color} RG ${num(w)} w 1 j ${num(tl[0])} ${num(tl[1])} m ${num(tr[0])} ${num(tr[1])} l ${num(br[0])} ${num(br[1])} l ${num(bl[0])} ${num(bl[1])} l h S`;
  } else if (it.type === 'note') {
    // Ícono de nota de 22 pt (globo de texto) con la esquina superior izquierda en el punto tocado.
    const [x, y] = toPdf(it.xr, it.yr);
    const s = 22;
    rect = [x, y - s, x + s, y];
    extra.Name = 'Comment';
    extra.Open = false;
    const x0 = x + 1;
    const y0 = y - s + 5;
    content =
      `${color} rg 0.25 0.25 0.25 RG 0.8 w ${num(x0)} ${num(y0)} 20 16 re B ` +
      `${num(x0 + 4)} ${num(y0)} m ${num(x0 + 3)} ${num(y0 - 4)} l ${num(x0 + 9)} ${num(y0)} l f ` +
      `1 1 1 RG 1.2 w ${num(x0 + 4)} ${num(y0 + 11)} m ${num(x0 + 16)} ${num(y0 + 11)} l ` +
      `${num(x0 + 4)} ${num(y0 + 7.5)} m ${num(x0 + 16)} ${num(y0 + 7.5)} l ${num(x0 + 4)} ${num(y0 + 4)} m ${num(x0 + 12)} ${num(y0 + 4)} l S`;
  } else return;

  // Apariencia: formulario con BBox = Rect (así se dibuja en coordenadas de página).
  const resources = opacity < 1 ? { ExtGState: { G0: { CA: opacity, ca: opacity, BM: 'Multiply' } } } : {};
  const ap = ctx.stream(`q ${opacity < 1 ? '/G0 gs ' : ''}${content} Q`, {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: rect,
    Resources: resources,
  });
  const apRef = ctx.register(ap);

  const dict = ctx.obj({
    Type: 'Annot',
    Subtype: SUBTYPE[it.type],
    Rect: rect,
    C: [r, g, b],
    F: 4, // imprimible
    ...(opacity < 1 ? { CA: opacity } : {}),
    ...extra,
    AP: { N: apRef },
    P: page.ref,
  });
  dict.set(PDFName.of('M'), PDFString.of(pdfDate()));
  dict.set(PDFName.of('CreationDate'), PDFString.of(pdfDate()));
  dict.set(PDFName.of('NM'), PDFString.of(`agnescan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`));
  if (author) dict.set(PDFName.of('T'), PDFHexString.fromText(author));
  if (it.comment || it.text) dict.set(PDFName.of('Contents'), PDFHexString.fromText(it.comment || it.text));
  const ref = ctx.register(dict);

  let annots = page.node.Annots();
  if (!annots) {
    annots = ctx.obj([]);
    page.node.set(PDFName.of('Annots'), annots);
  }
  annots.push(ref);
}

/**
 * Dibuja anotaciones sobre un PDF y devuelve una copia nueva. Las coordenadas de
 * cada anotación son relativas (0–1) al alto/ancho de la página, con origen
 * arriba-izquierda (como en pantalla). Se dibujan en la página: text, redact, image,
 * stamp y draw (firma). Los de COMMENT_TYPES quedan como comentarios editables.
 */
export async function applyAnnotations(blob, items, { author = '' } = {}) {
  const PDFLib = await pdflib();
  const doc = await loadDoc(PDFLib, blob);
  const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  const pages = doc.getPages();

  for (const it of items) {
    const page = pages[it.page];
    if (!page) continue;
    const { width: W, height: H } = page.getSize();
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const color = hexToRgb(PDFLib, it.color || '#000000');
    // Convierte un punto relativo de la vista (origen arriba-izquierda) a puntos
    // PDF (origen abajo-izquierda), teniendo en cuenta la rotación de la página.
    const toPdf = (ur, vr) => viewToPdf(ur, vr, W, H, rot);
    // La dimensión "corta" de la vista según la orientación (para alto de texto).
    const vista = rot === 90 || rot === 270 ? { w: H, h: W } : { w: W, h: H };

    // Resaltar, subrayar, tachar, notas, lápiz y recuadros: comentarios reales.
    if (COMMENT_TYPES.has(it.type)) {
      addComment(PDFLib, doc, page, it, { toPdf, vista, author });
      continue;
    }

    if (it.type === 'redact' || it.type === 'highlight') {
      const [x0, y0] = toPdf(it.xr, it.yr);
      const [x1, y1] = toPdf(it.xr + it.wr, it.yr + it.hr);
      page.drawRectangle({
        x: Math.min(x0, x1),
        y: Math.min(y0, y1),
        width: Math.abs(x1 - x0),
        height: Math.abs(y1 - y0),
        color,
        opacity: it.type === 'highlight' ? 0.35 : 1,
      });
    } else if (it.type === 'text') {
      const size = (it.size || 0.02) * vista.h;
      // La baseline queda `size` por debajo del borde superior de la caja.
      const baselineV = it.yr + size / vista.h;
      const [x, y] = toPdf(it.xr, baselineV);
      page.drawText(winAnsi(it.text), {
        x,
        y,
        size,
        font,
        color,
        lineHeight: size * 1.25,
        rotate: PDFLib.degrees(rot), // para que el texto se lea derecho en páginas giradas
      });
    } else if (it.type === 'stamp') {
      const [sx0, sy0] = toPdf(it.xr, it.yr);
      const [sx1, sy1] = toPdf(it.xr + it.wr, it.yr + it.hr);
      const x = Math.min(sx0, sx1);
      const y = Math.min(sy0, sy1);
      const w = Math.abs(sx1 - sx0);
      const h = Math.abs(sy1 - sy0);
      page.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        color: PDFLib.rgb(1, 1, 1),
        opacity: 0.85,
        borderColor: color,
        borderWidth: Math.max(0.8, Math.min(w, h) * 0.03),
        borderOpacity: 1,
      });
      const lines = it.lines.map(winAnsi);
      const pad = Math.min(w, h) * 0.12;
      const innerW = w - 2 * pad;
      const rowH = (h - 2 * pad) / lines.length;
      let size = rowH * 0.72;
      for (const ln of lines) {
        while (size > 3 && font.widthOfTextAtSize(ln, size) > innerW) size -= 0.5;
      }
      // Para páginas giradas, cada línea se coloca por su esquina en coords de vista.
      lines.forEach((ln, i) => {
        const vy = it.yr + (pad + i * rowH + (rowH - size) / 2 + size) / vista.h;
        const vx = it.xr + pad / vista.w;
        const [lx, ly] = toPdf(vx, vy);
        page.drawText(ln, { x: lx, y: ly, size, font, color, rotate: PDFLib.degrees(rot) });
      });
    } else if (it.type === 'image' && it.dataUrl) {
      const bytes = Uint8Array.from(atob(it.dataUrl.split(',')[1]), (c) => c.charCodeAt(0));
      const embedded = it.dataUrl.startsWith('data:image/png')
        ? await doc.embedPng(bytes)
        : await doc.embedJpg(bytes);
      const [x0, y0] = toPdf(it.xr, it.yr);
      const [x1, y1] = toPdf(it.xr + it.wr, it.yr + it.hr);
      // Para páginas giradas, drawImage ancla en una esquina y rota; se elige la
      // esquina correcta según la rotación para que quede donde se ve en pantalla.
      const anchors = {
        0: [Math.min(x0, x1), Math.min(y0, y1)],
        90: [x0, y0],
        180: [Math.max(x0, x1), Math.max(y0, y1)],
        270: [x1, y1],
      };
      const [ax, ay] = anchors[rot] || anchors[0];
      page.drawImage(embedded, {
        x: ax,
        y: ay,
        width: it.wr * (rot === 90 || rot === 270 ? H : W),
        height: it.hr * (rot === 90 || rot === 270 ? W : H),
        rotate: PDFLib.degrees(rot),
      });
    } else if (it.type === 'draw' && it.points?.length > 1) {
      const thickness = (it.thickness || 0.004) * vista.h;
      for (let i = 1; i < it.points.length; i++) {
        const [ax, ay] = toPdf(it.points[i - 1][0], it.points[i - 1][1]);
        const [bx, by] = toPdf(it.points[i][0], it.points[i][1]);
        page.drawLine({
          start: { x: ax, y: ay },
          end: { x: bx, y: by },
          thickness,
          color,
          lineCap: PDFLib.LineCapStyle.Round,
        });
      }
    }
  }
  return asBlob(await doc.save({ useObjectStreams: false }));
}
