// Lectura de PDF con pdf.js: extracción de texto y render de páginas a imagen.
// pdf.js se carga bajo demanda (la primera vez que se importa o se abre un PDF)
// y queda en la caché de la app para funcionar luego sin conexión.

let pdfjs = null;

async function lib() {
  if (!pdfjs) {
    pdfjs = await import('./vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  }
  return pdfjs;
}

async function openPdf(data) {
  const api = await lib();
  const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
  return api.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false, // más seguro y suficiente para leer/renderizar
    disableAutoFetch: true,
    // Fuentes estándar (Helvetica, Times, etc.) para PDF que no las incrustan:
    // sin esto, algunos PDF reales se renderizan en blanco.
    standardFontDataUrl: new URL('./vendor/pdfjs/standard_fonts/', import.meta.url).href,
  }).promise;
}

/**
 * Dibuja una página de pdf.js en un JPEG, con fondo blanco. Usa OffscreenCanvas
 * cuando está disponible: no bloquea la interfaz y sigue funcionando aunque la
 * app esté en segundo plano. Si no, usa un canvas normal.
 */
async function pageToBlob(page, maxSide, quality, type = 'image/jpeg') {
  return (await pageToImage(page, maxSide, quality, type)).blob;
}

/** Como pageToBlob, pero devuelve también el tamaño en píxeles de la imagen. */
async function pageToImage(page, maxSide, quality, type = 'image/jpeg') {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxSide / Math.max(base.width, base.height), 4);
  const viewport = page.getViewport({ scale });
  const w = Math.max(1, Math.ceil(viewport.width));
  const h = Math.max(1, Math.ceil(viewport.height));
  const offscreen = typeof OffscreenCanvas !== 'undefined';
  const canvas = offscreen ? new OffscreenCanvas(w, h) : document.createElement('canvas');
  if (!offscreen) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  if (type !== 'image/png') {
    // JPEG no tiene transparencia: se pone fondo blanco (PNG lo conserva).
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
  }
  await page.render({ canvasContext: ctx, viewport }).promise;
  const blob = offscreen
    ? await canvas.convertToBlob({ type, quality })
    : await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  if (!offscreen) {
    canvas.width = 0; // libera memoria en iOS
    canvas.height = 0;
  }
  return { blob, width: w, height: h };
}

/**
 * Convierte cada página del PDF en una imagen (PNG o JPEG) de alta resolución.
 * @returns {{blob: Blob, ext: string}[]}
 */
export async function renderPdfToImages(data, { type = 'image/png', maxSide = 2200 } = {}, onPage) {
  const doc = await openPdf(data);
  const ext = type === 'image/png' ? 'png' : 'jpg';
  const salida = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 }); // tamaño en puntos PDF
      salida.push({ blob: await pageToBlob(page, maxSide, 0.92, type), ext, width: vp.width, height: vp.height });
      page.cleanup();
      onPage?.(n, doc.numPages);
    }
  } finally {
    await doc.destroy();
  }
  return salida;
}

/**
 * Extrae el texto del PDF agrupando por líneas (según la posición vertical),
 * para que al convertir a Word/Excel quede mejor estructurado.
 * @returns {string[]} una entrada por línea; línea vacía separa páginas.
 */
export async function extractLines(data, onPage) {
  const doc = await openPdf(data);
  const lineas = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const grupos = new Map(); // Y redondeado → items
      for (const item of content.items) {
        if (!item.str) continue;
        const y = Math.round(item.transform[5] / 3) * 3; // tolerancia de 3 pt
        (grupos.get(y) || grupos.set(y, []).get(y)).push(item);
      }
      const ys = [...grupos.keys()].sort((a, b) => b - a); // de arriba hacia abajo
      for (const y of ys) {
        const texto = grupos
          .get(y)
          .sort((a, b) => a.transform[4] - b.transform[4])
          .map((i) => i.str)
          .join('')
          .replace(/\s+/g, ' ')
          .trim();
        if (texto) lineas.push(texto);
      }
      if (n < doc.numPages) lineas.push('');
      page.cleanup();
      onPage?.(n, doc.numPages);
    }
  } finally {
    await doc.destroy();
  }
  return lineas;
}

/**
 * Prepara un PDF para importarlo: cuenta páginas, extrae el texto y genera la
 * miniatura de la primera página. onPage(n, total) informa el avance.
 */
export async function prepareImport(data, onPage) {
  const doc = await openPdf(data);
  const pageCount = doc.numPages;
  let text = '';
  let thumb = null;
  try {
    for (let n = 1; n <= pageCount; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      text += content.items.map((item) => item.str).join(' ') + '\n';
      if (n === 1) {
        // La miniatura es opcional: si una página no se puede dibujar, se importa igual.
        try {
          thumb = await pageToBlob(page, 360, 0.75);
        } catch {
          thumb = null;
        }
      }
      page.cleanup();
      onPage?.(n, pageCount);
    }
  } finally {
    await doc.destroy();
  }
  return { pageCount, text: text.replace(/[ \t]+/g, ' ').trim(), thumb };
}

/** Renderiza todas las páginas de un PDF a JPEG (para el visor). */
export async function renderPdfPages(data, maxSide = 1400, onPage) {
  const doc = await openPdf(data);
  const blobs = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      blobs.push(await pageToBlob(page, maxSide, 0.82));
      page.cleanup();
      onPage?.(n, doc.numPages);
    }
  } finally {
    await doc.destroy();
  }
  return blobs;
}

/**
 * Como renderPdfPages, pero además devuelve el tamaño real de cada página en
 * puntos PDF y su rotación (para colocar anotaciones con precisión).
 * @returns {{blob: Blob, width: number, height: number, rotation: number}[]}
 */
export async function renderPdfPagesDetailed(data, maxSide = 1400, onPage) {
  const doc = await openPdf(data);
  const salida = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 }); // 1 unidad CSS = 1 punto PDF
      salida.push({
        blob: await pageToBlob(page, maxSide, 0.82),
        width: vp.width,
        height: vp.height,
        rotation: (page.rotate % 360 + 360) % 360,
      });
      page.cleanup();
      onPage?.(n, doc.numPages);
    }
  } finally {
    await doc.destroy();
  }
  return salida;
}

/** Número de páginas de un PDF. */
export async function countPages(data) {
  const doc = await openPdf(data);
  const n = doc.numPages;
  await doc.destroy();
  return n;
}

/**
 * Renderiza las páginas «desde»‒«hasta» (1 = primera) a JPEG, con su tamaño en
 * píxeles, listas para armar un PDF de imágenes (p. ej. para el OCR por tramos).
 * @returns {{jpeg: Blob, width: number, height: number}[]}
 */
export async function renderPageRange(data, desde, hasta, maxSide = 2000, quality = 0.85) {
  const doc = await openPdf(data);
  const salida = [];
  try {
    for (let n = desde; n <= Math.min(hasta, doc.numPages); n++) {
      const page = await doc.getPage(n);
      const { blob, width, height } = await pageToImage(page, maxSide, quality);
      salida.push({ jpeg: blob, width, height });
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return salida;
}

/**
 * Extrae las palabras de cada página con su posición (en puntos PDF, origen
 * abajo-izquierda), agrupadas por línea de lectura. Sirve para comparar PDF y
 * marcar las diferencias en su lugar exacto.
 * @returns {{ pages: {width: number, height: number}[], lines: {page: number, words: {w: string, page: number, x0: number, y0: number, x1: number, y1: number}[]}[] }}
 */
export async function extractWords(data, onPage) {
  const doc = await openPdf(data);
  const pages = [];
  const lines = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      pages.push({ width: vp.width, height: vp.height });
      const content = await page.getTextContent();
      const grupos = new Map(); // Y redondeado → palabras
      for (const item of content.items) {
        if (!item.str?.trim()) continue;
        const [a, b, , , e, f] = item.transform;
        const alto = Math.hypot(a, b) || item.height || 10;
        const largo = item.str.length;
        // Cada palabra se ubica en proporción a su posición dentro del fragmento.
        for (const m of item.str.matchAll(/\S+/g)) {
          const x0 = e + (item.width * m.index) / largo;
          const x1 = e + (item.width * (m.index + m[0].length)) / largo;
          const y = Math.round(f / 3) * 3;
          if (!grupos.has(y)) grupos.set(y, []);
          grupos.get(y).push({ w: m[0], page: n - 1, x0, x1, y0: f - alto * 0.22, y1: f + alto * 0.9 });
        }
      }
      for (const y of [...grupos.keys()].sort((p, q) => q - p)) {
        lines.push({ page: n - 1, words: grupos.get(y).sort((p, q) => p.x0 - q.x0) });
      }
      page.cleanup();
      onPage?.(n, doc.numPages);
    }
  } finally {
    await doc.destroy();
  }
  return { pages, lines };
}
