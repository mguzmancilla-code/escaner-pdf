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
