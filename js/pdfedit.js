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
  return asBlob(await out.save());
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
  return asBlob(await out.save());
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
    salida.push({ blob: asBlob(await doc.save()), pageNumber: i + 1 });
    onProgress?.(i + 1, total);
  }
  return salida;
}

/** Número de páginas de un PDF. */
export async function pageCount(blob) {
  const PDFLib = await pdflib();
  return (await loadDoc(PDFLib, blob)).getPageCount();
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

/**
 * Dibuja anotaciones sobre un PDF y devuelve una copia nueva. Las coordenadas de
 * cada anotación son relativas (0–1) al alto/ancho de la página, con origen
 * arriba-izquierda (como en pantalla). Tipos: text, redact, highlight, draw.
 */
export async function applyAnnotations(blob, items) {
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
  return asBlob(await doc.save());
}
