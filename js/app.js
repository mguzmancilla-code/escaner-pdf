import { deleteDoc, listDocs, saveDoc } from './db.js';
import {
  FILTERS,
  FULL_FRAME,
  canvasToBlob,
  detectCorners,
  downscale,
  loadImage,
  releaseCanvas,
  releaseImage,
  renderPage,
  resizeJpeg,
} from './imaging.js';
import { PAGE_SIZES, buildPdf } from './pdf.js';

const QUALITIES = {
  maximum: { label: 'Máxima', maxSide: Infinity, jpeg: 0.95, hint: 'Resolución original sin reducir. Archivos más grandes.' },
  high: { label: 'Alta', maxSide: 3508, jpeg: 0.88, hint: 'Hasta ~300 ppp en A4. Nítido para imprimir y leer.' },
  medium: { label: 'Media', maxSide: 2200, jpeg: 0.75, hint: 'Hasta ~190 ppp. Buen equilibrio para enviar por correo.' },
  compact: { label: 'Compacta', maxSide: 1600, jpeg: 0.6, hint: 'Hasta ~135 ppp. Archivos pequeños para mensajería.' },
};

const ICONS = {
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  photo: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5-9 9"/>',
  share: '<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11H5v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9h-1"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 20h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  rotateLeft: '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5"/>',
  rotateRight: '<path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5"/>',
  chevronLeft: '<path d="M15 18l-6-6 6-6"/>',
  chevronRight: '<path d="M9 18l6-6-6-6"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/>',
  doc: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/>',
  docImport: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M12 11v6M9 14l3 3 3-3"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
};

const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const $ = (id) => document.getElementById(id);
const el = {};
for (const id of [
  'library', 'search', 'docList', 'emptyState', 'scanBtn', 'imagesBtn', 'importPdfBtn',
  'editor', 'editorCancel', 'editorCreate', 'docName', 'pageCount', 'pageGrid', 'pagesHint',
  'addCameraBtn', 'addImagesBtn', 'pageSize', 'quality', 'margins', 'filterAll', 'qualityHint',
  'pageEditor', 'peCancel', 'peDone', 'peTitle', 'peTabs', 'peStage', 'cropBox', 'cropImg', 'cropSvg',
  'previewImg', 'peSpinner', 'loupe', 'cropControls', 'filterControls', 'filterSeg', 'autoBtn', 'fullBtn',
  'peDelete', 'peRotL', 'peRotR', 'peMoveL', 'peMoveR', 'peNextWrap', 'peNext',
  'viewer', 'viewerBack', 'viewerTitle', 'viewerRename', 'viewerPages', 'shareBtn', 'downloadBtn', 'deleteBtn',
  'busy', 'busyText', 'toast', 'cameraInput', 'imagesInput', 'pdfInput',
]) el[id] = $(id);

const state = {
  docs: [],
  current: null, // documento abierto en el visor
  draft: null, // { pages: [] } del PDF en edición
  pe: null, // sesión del editor de página
};

const thumbUrls = new Map(); // id de documento → URL de la miniatura
let viewerUrls = [];

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
// Deja pintar un fotograma (p. ej. el indicador de carga) antes de un cálculo pesado.
// El setTimeout de respaldo evita quedarse colgado si la página no se está pintando.
const nextFrame = () =>
  new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
    setTimeout(resolve, 100);
  });
const sizeFormat = new Intl.NumberFormat('es', { maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${sizeFormat.format(bytes / 1024)} KB`;
  return `${sizeFormat.format(bytes / 1024 / 1024)} MB`;
}

const pagesText = (count) => (count === 1 ? '1 página' : `${count} páginas`);

function defaultName() {
  const d = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `Escaneo ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
}

function sanitizeName(name) {
  return name.replace(/[\\/:*?"<>|%]+/g, '-').replace(/\.pdf$/i, '').trim();
}

let toastTimer;
function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), 2800);
}

function busy(message) {
  el.busy.hidden = !message;
  if (message) el.busyText.textContent = message;
}

function show(screen) {
  for (const name of ['library', 'editor', 'viewer']) el[name].hidden = name !== screen;
}

const storage = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* modo privado: no pasa nada */
    }
  },
};

// ---------------------------------------------------------------------------
// Biblioteca
// ---------------------------------------------------------------------------

function thumbUrl(doc) {
  if (!doc.thumb) return null;
  if (!thumbUrls.has(doc.id)) thumbUrls.set(doc.id, URL.createObjectURL(doc.thumb));
  return thumbUrls.get(doc.id);
}

function renderLibrary() {
  const query = el.search.value.trim().toLowerCase();
  const docs = state.docs
    .filter((doc) => doc.name.toLowerCase().includes(query))
    .sort((a, b) => b.created - a.created);

  el.docList.replaceChildren(
    ...docs.map((doc) => {
      const li = document.createElement('li');
      const url = thumbUrl(doc);
      li.innerHTML = `
        <button class="doc-row">
          ${url ? `<img class="thumb" alt="" src="${url}">` : `<span class="thumb">${icon('doc')}</span>`}
          <span class="meta">
            <span class="name"></span>
            <span class="sub">${pagesText(doc.pageCount)} · ${formatSize(doc.size)}</span>
            <span class="date">${dateFormat.format(doc.created)}</span>
          </span>
          <span class="icon-btn" role="button" aria-label="Compartir" data-share>${icon('share')}</span>
        </button>`;
      li.querySelector('.name').textContent = doc.name;
      li.querySelector('.doc-row').addEventListener('click', (event) => {
        if (event.target.closest('[data-share]')) sharePdf(doc);
        else openViewer(doc);
      });
      return li;
    }),
  );
  el.emptyState.hidden = state.docs.length > 0;
  el.search.hidden = state.docs.length === 0;
}

// ---------------------------------------------------------------------------
// Visor, compartir y descargar
// ---------------------------------------------------------------------------

function fileFor(doc) {
  return new File([doc.pdf], `${doc.name}.pdf`, { type: 'application/pdf' });
}

/**
 * Abre la hoja de compartir de iOS: "Guardar en Archivos", WhatsApp, Mail,
 * Drive, Imprimir… Se llama sin await previo para conservar el gesto del usuario.
 */
function sharePdf(doc) {
  const file = fileFor(doc);
  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title: doc.name }).catch((error) => {
      if (error.name !== 'AbortError') toast('No se pudo compartir el PDF.');
    });
  } else {
    downloadPdf(doc);
  }
}

function downloadPdf(doc) {
  const url = URL.createObjectURL(doc.pdf);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${doc.name}.pdf`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function openViewer(doc) {
  state.current = doc;
  el.viewerTitle.textContent = doc.name;
  closeViewerImages();
  if (doc.previews?.length) {
    viewerUrls = doc.previews.map((blob) => URL.createObjectURL(blob));
    el.viewerPages.replaceChildren(
      ...viewerUrls.map((url, i) => {
        const img = document.createElement('img');
        img.src = url;
        img.alt = `Página ${i + 1}`;
        img.loading = 'lazy';
        return img;
      }),
    );
  } else {
    // PDF importado: no tenemos imágenes de las páginas.
    const url = URL.createObjectURL(doc.pdf);
    viewerUrls = [url];
    el.viewerPages.innerHTML = `
      <div class="viewer-note">
        <p>${pagesText(doc.pageCount)} · ${formatSize(doc.size)}</p>
        <p>La vista previa no está disponible para PDF importados.</p>
        <a class="btn" href="${url}" target="_blank" rel="noopener">${icon('doc')}Abrir PDF</a>
      </div>`;
  }
  el.viewerPages.scrollTop = 0;
  show('viewer');
}

function closeViewerImages() {
  viewerUrls.forEach((url) => URL.revokeObjectURL(url));
  viewerUrls = [];
  el.viewerPages.replaceChildren();
}

async function renameCurrent() {
  const doc = state.current;
  const name = sanitizeName(prompt('Nuevo nombre del PDF', doc.name) ?? '');
  if (!name || name === doc.name) return;
  const updated = { ...doc, name };
  try {
    await saveDoc(updated);
    state.docs = state.docs.map((d) => (d.id === doc.id ? updated : d));
    state.current = updated;
    el.viewerTitle.textContent = name;
    renderLibrary();
  } catch (error) {
    toast(`No se pudo renombrar: ${error.message}`);
  }
}

async function deleteCurrent() {
  const doc = state.current;
  if (!confirm(`¿Eliminar «${doc.name}»? Esta acción no se puede deshacer.`)) return;
  try {
    await deleteDoc(doc.id);
    state.docs = state.docs.filter((d) => d.id !== doc.id);
    if (thumbUrls.has(doc.id)) URL.revokeObjectURL(thumbUrls.get(doc.id));
    thumbUrls.delete(doc.id);
    closeViewerImages();
    state.current = null;
    renderLibrary();
    show('library');
  } catch (error) {
    toast(`No se pudo eliminar: ${error.message}`);
  }
}

async function importPdfs(files) {
  let imported = 0;
  busy('Importando PDF…');
  try {
    for (const file of files) {
      const buffer = await file.arrayBuffer();
      const text = new TextDecoder('latin1').decode(buffer);
      if (!text.startsWith('%PDF')) {
        toast(`«${file.name}» no es un PDF válido.`);
        continue;
      }
      const pageCount = (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length || 1;
      const doc = {
        id: uid(),
        name: sanitizeName(file.name) || 'Documento',
        created: Date.now(),
        size: file.size,
        pageCount,
        pdf: new Blob([buffer], { type: 'application/pdf' }),
        thumb: null,
        previews: null,
      };
      await saveDoc(doc);
      state.docs.push(doc);
      imported++;
    }
  } catch (error) {
    toast(`No se pudo importar: ${error.message}`);
  } finally {
    busy(null);
  }
  renderLibrary();
  if (imported) toast(imported === 1 ? 'PDF importado' : `${imported} PDF importados`);
}

// ---------------------------------------------------------------------------
// Nuevo PDF
// ---------------------------------------------------------------------------

function newDraft() {
  releaseDraft();
  state.draft = { pages: [] };
  el.docName.value = defaultName();
  renderEditor();
  show('editor');
}

function releaseDraft() {
  state.draft?.pages.forEach((page) => page.thumbUrl && URL.revokeObjectURL(page.thumbUrl));
  state.draft = null;
}

function renderEditor() {
  const pages = state.draft?.pages ?? [];
  el.pageGrid.replaceChildren(
    ...pages.map((page, i) => {
      const card = document.createElement('button');
      card.className = 'page-card';
      card.setAttribute('aria-label', `Editar página ${i + 1}`);
      card.innerHTML = page.thumbUrl ? `<img alt="" src="${page.thumbUrl}">` : '<div class="spinner"></div>';
      card.insertAdjacentHTML('beforeend', `<span class="num">${i + 1}</span>`);
      card.addEventListener('click', () => openPageEditor(i));
      return card;
    }),
  );
  el.pageCount.textContent = pages.length ? `(${pages.length})` : '';
  el.pagesHint.textContent = pages.length
    ? 'Toca una página para ajustar bordes, filtro, giro u orden.'
    : 'Todavía no hay páginas. Escanea con la cámara o añade imágenes.';
  el.editorCreate.disabled = pages.length === 0;
}

function currentSettings() {
  return { pageSize: el.pageSize.value, quality: el.quality.value, margins: el.margins.checked };
}

function saveSettings() {
  storage.set('settings', currentSettings());
  el.qualityHint.textContent = QUALITIES[el.quality.value].hint;
}

function makePage(file, fromCamera) {
  return {
    id: uid(),
    file,
    corners: FULL_FRAME,
    rotation: 0,
    filter: fromCamera ? 'enhanced' : 'original',
    processed: null,
    width: 0,
    height: 0,
    thumbUrl: null,
    version: 0,
    removed: false,
  };
}

async function addFromCamera(file) {
  busy('Detectando bordes…');
  const page = makePage(file, true);
  try {
    const img = await loadImage(file);
    page.corners = detectCorners(img) ?? FULL_FRAME;
    releaseImage(img);
  } catch (error) {
    busy(null);
    toast(error.message);
    return;
  }
  busy(null);
  state.draft.pages.push(page);
  renderEditor();
  openPageEditor(state.draft.pages.length - 1, { isNew: true, fromCamera: true });
}

function addFromLibrary(files) {
  for (const file of files) {
    const page = makePage(file, false);
    state.draft.pages.push(page);
    scheduleRender(page);
  }
  renderEditor();
}

// Las páginas se procesan de una en una en segundo plano para no agotar la memoria.
let renderQueue = Promise.resolve();

function scheduleRender(page) {
  page.version++;
  const version = page.version;
  if (page.thumbUrl) URL.revokeObjectURL(page.thumbUrl);
  page.thumbUrl = null;
  page.processed = null;
  renderQueue = renderQueue.then(() => renderFinal(page, version)).catch((error) => {
    toast(`Error al procesar una página: ${error.message}`);
  });
}

async function renderFinal(page, version) {
  if (page.removed || page.version !== version) return;
  const img = await loadImage(page.file);
  let canvas;
  try {
    await nextFrame();
    canvas = renderPage(img, page);
    const processed = await canvasToBlob(canvas, 0.95);
    const thumb = downscale(canvas, 360);
    const thumbBlob = await canvasToBlob(thumb, 0.8);
    releaseCanvas(thumb);
    if (page.version !== version) return;
    page.processed = processed;
    page.width = canvas.width;
    page.height = canvas.height;
    page.thumbUrl = URL.createObjectURL(thumbBlob);
  } finally {
    if (canvas) releaseCanvas(canvas);
    releaseImage(img);
  }
  renderEditor();
}

async function waitForPages() {
  const pages = state.draft.pages;
  while (pages.some((page) => !page.processed)) {
    const pending = renderQueue;
    await pending;
    if (pending === renderQueue && pages.some((page) => !page.processed)) {
      // Una página falló: se reintenta.
      pages.filter((page) => !page.processed).forEach(scheduleRender);
      await renderQueue;
      if (pages.some((page) => !page.processed)) throw new Error('Alguna página no se pudo procesar.');
    }
  }
}

async function createPdf() {
  const pages = state.draft.pages;
  if (!pages.length) return;
  const settings = currentSettings();
  const quality = QUALITIES[settings.quality];
  const name = sanitizeName(el.docName.value) || defaultName();

  busy('Procesando páginas…');
  try {
    await waitForPages();
    const pdfPages = [];
    const previews = [];
    let thumb = null;
    for (const [i, page] of pages.entries()) {
      busy(`Creando PDF… página ${i + 1} de ${pages.length}`);
      if (settings.quality === 'maximum') {
        pdfPages.push({ jpeg: page.processed, width: page.width, height: page.height });
      } else {
        const out = await resizeJpeg(page.processed, quality.maxSide, quality.jpeg);
        pdfPages.push({ jpeg: out.blob, width: out.width, height: out.height });
      }
      previews.push((await resizeJpeg(page.processed, 1400, 0.8)).blob);
      if (i === 0) thumb = (await resizeJpeg(page.processed, 360, 0.8)).blob;
    }
    const pdf = buildPdf(pdfPages, { pageSize: settings.pageSize, margins: settings.margins, title: name });
    const doc = { id: uid(), name, created: Date.now(), size: pdf.size, pageCount: pages.length, pdf, thumb, previews };
    await saveDoc(doc);
    navigator.storage?.persist?.();
    state.docs.push(doc);
    releaseDraft();
    renderLibrary();
    openViewer(doc);
    toast('PDF creado. Pulsa «Compartir / Guardar» para enviarlo a otra app.');
  } catch (error) {
    toast(`No se pudo crear el PDF: ${error.message}`);
  } finally {
    busy(null);
  }
}

function cancelDraft() {
  if (state.draft?.pages.length && !confirm('¿Descartar este documento y sus páginas?')) return;
  state.draft?.pages.forEach((page) => (page.removed = true));
  releaseDraft();
  show('library');
}

// ---------------------------------------------------------------------------
// Editor de página: bordes, filtro, giro y orden
// ---------------------------------------------------------------------------

async function openPageEditor(index, { isNew = false, fromCamera = false } = {}) {
  const page = state.draft.pages[index];
  busy('Abriendo página…');
  let img;
  try {
    img = await loadImage(page.file);
  } catch (error) {
    toast(error.message);
    return;
  } finally {
    busy(null);
  }
  state.pe = {
    page,
    img,
    corners: page.corners.map((p) => [...p]),
    rotation: page.rotation,
    filter: page.filter,
    isNew,
    fromCamera,
    tab: 'crop',
    previewKey: null,
    previewUrl: null,
    drag: null,
  };
  el.cropImg.src = img.src;
  el.loupe.style.backgroundImage = `url("${img.src}")`;
  el.peNextWrap.hidden = !fromCamera;
  el.pageEditor.hidden = false;
  updatePeTitle();
  setTab('crop');
  renderFilterSeg();
  await nextFrame();
  layoutCrop();
}

function updatePeTitle() {
  const pages = state.draft.pages;
  const index = pages.indexOf(state.pe.page);
  el.peTitle.textContent = `Página ${index + 1} de ${pages.length}`;
  el.peMoveL.disabled = index <= 0;
  el.peMoveR.disabled = index >= pages.length - 1;
}

function setTab(tab) {
  const pe = state.pe;
  pe.tab = tab;
  for (const button of el.peTabs.children) button.classList.toggle('active', button.dataset.tab === tab);
  el.cropBox.hidden = tab !== 'crop';
  el.cropControls.hidden = tab !== 'crop';
  el.previewImg.hidden = tab !== 'result' || !pe.previewUrl;
  el.filterControls.hidden = tab !== 'result';
  if (tab === 'crop') layoutCrop();
  else updatePreview();
}

function renderFilterSeg() {
  el.filterSeg.replaceChildren(
    ...FILTERS.map((filter) => {
      const button = document.createElement('button');
      button.textContent = filter.label;
      button.classList.toggle('active', filter.id === state.pe.filter);
      button.addEventListener('click', () => {
        state.pe.filter = filter.id;
        renderFilterSeg();
        updatePreview();
      });
      return button;
    }),
  );
}

function layoutCrop() {
  const pe = state.pe;
  if (!pe || pe.tab !== 'crop') return;
  const stage = el.peStage.getBoundingClientRect();
  const pad = 28;
  const k = Math.min((stage.width - pad * 2) / pe.img.naturalWidth, (stage.height - pad * 2) / pe.img.naturalHeight);
  const w = Math.max(1, Math.round(pe.img.naturalWidth * k));
  const h = Math.max(1, Math.round(pe.img.naturalHeight * k));
  el.cropBox.style.width = `${w}px`;
  el.cropBox.style.height = `${h}px`;
  el.cropSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  pe.box = { w, h };
  drawCrop();
}

function drawCrop() {
  const { w, h } = state.pe.box;
  const pts = state.pe.corners.map(([x, y]) => [x * w, y * h]);
  const path = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
  el.cropSvg.innerHTML = `
    <path class="crop-shade" fill-rule="evenodd" d="M0 0H${w}V${h}H0Z ${path}Z"/>
    <path class="crop-edge" d="${path}Z"/>
    ${pts.map(([x, y]) => `<circle class="crop-handle" cx="${x}" cy="${y}" r="12"/>`).join('')}`;
}

function cropPoint(event) {
  const rect = el.cropBox.getBoundingClientRect();
  return { rect, x: event.clientX - rect.left, y: event.clientY - rect.top };
}

el.cropBox.addEventListener('pointerdown', (event) => {
  const pe = state.pe;
  if (!pe) return;
  const { rect, x, y } = cropPoint(event);
  let best = -1;
  let bestDistance = 56;
  pe.corners.forEach(([cx, cy], i) => {
    const distance = Math.hypot(cx * rect.width - x, cy * rect.height - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  });
  if (best < 0) return;
  event.preventDefault();
  el.cropBox.setPointerCapture(event.pointerId);
  const [cx, cy] = pe.corners[best];
  pe.drag = { index: best, dx: cx * rect.width - x, dy: cy * rect.height - y };
  moveCorner(event);
});

el.cropBox.addEventListener('pointermove', (event) => {
  if (state.pe?.drag) moveCorner(event);
});

for (const type of ['pointerup', 'pointercancel']) {
  el.cropBox.addEventListener(type, () => {
    if (!state.pe) return;
    state.pe.drag = null;
    el.loupe.hidden = true;
  });
}

function moveCorner(event) {
  const pe = state.pe;
  const { rect, x, y } = cropPoint(event);
  const px = Math.min(rect.width, Math.max(0, x + pe.drag.dx));
  const py = Math.min(rect.height, Math.max(0, y + pe.drag.dy));
  pe.corners[pe.drag.index] = [px / rect.width, py / rect.height];
  drawCrop();

  // Lupa por encima del dedo para colocar la esquina con precisión.
  const zoom = 2.5;
  const size = 120;
  const above = rect.top + py - size - 50;
  el.loupe.style.left = `${rect.left + px - size / 2}px`;
  el.loupe.style.top = `${above > 8 ? above : rect.top + py + 50}px`;
  el.loupe.style.backgroundSize = `${rect.width * zoom}px ${rect.height * zoom}px`;
  el.loupe.style.backgroundPosition = `${size / 2 - px * zoom}px ${size / 2 - py * zoom}px`;
  el.loupe.hidden = false;
}

let previewToken = 0;
async function updatePreview() {
  const pe = state.pe;
  if (!pe || pe.tab !== 'result') return;
  const key = JSON.stringify([pe.corners, pe.rotation, pe.filter]);
  if (key === pe.previewKey) {
    el.previewImg.hidden = false;
    return;
  }
  const token = ++previewToken;
  el.peSpinner.hidden = false;
  await nextFrame();
  if (token !== previewToken || state.pe !== pe) return;
  try {
    const canvas = renderPage(pe.img, pe, 1400);
    const blob = await canvasToBlob(canvas, 0.85);
    releaseCanvas(canvas);
    if (token !== previewToken || state.pe !== pe) return;
    if (pe.previewUrl) URL.revokeObjectURL(pe.previewUrl);
    pe.previewUrl = URL.createObjectURL(blob);
    pe.previewKey = key;
    el.previewImg.src = pe.previewUrl;
    el.previewImg.hidden = pe.tab !== 'result';
  } catch (error) {
    toast(error.message);
  } finally {
    if (token === previewToken) el.peSpinner.hidden = true;
  }
}

function closePageEditor() {
  const pe = state.pe;
  if (!pe) return;
  previewToken++;
  releaseImage(pe.img);
  if (pe.previewUrl) URL.revokeObjectURL(pe.previewUrl);
  el.cropImg.removeAttribute('src');
  el.previewImg.removeAttribute('src');
  el.loupe.style.backgroundImage = '';
  el.loupe.hidden = true;
  el.peSpinner.hidden = true;
  el.pageEditor.hidden = true;
  state.pe = null;
}

/** Guarda los cambios de la página y la procesa en segundo plano. */
function commitPage() {
  const { page, corners, rotation, filter, isNew } = state.pe;
  const changed =
    isNew ||
    JSON.stringify([corners, rotation, filter]) !== JSON.stringify([page.corners, page.rotation, page.filter]);
  page.corners = corners;
  page.rotation = rotation;
  page.filter = filter;
  if (changed) scheduleRender(page);
  closePageEditor();
  renderEditor();
}

function removePage(page) {
  page.removed = true;
  if (page.thumbUrl) URL.revokeObjectURL(page.thumbUrl);
  state.draft.pages = state.draft.pages.filter((p) => p !== page);
}

function movePage(delta) {
  const pages = state.draft.pages;
  const from = pages.indexOf(state.pe.page);
  const to = from + delta;
  if (to < 0 || to >= pages.length) return;
  [pages[from], pages[to]] = [pages[to], pages[from]];
  updatePeTitle();
  renderEditor();
}

function rotatePage(delta) {
  state.pe.rotation = (state.pe.rotation + delta + 4) % 4;
  if (state.pe.tab === 'result') updatePreview();
  else setTab('result');
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

function fillSelect(select, options, value) {
  select.replaceChildren(
    ...options.map(([id, label]) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = label;
      return option;
    }),
  );
  select.value = value;
}

function setup() {
  document.querySelectorAll('[data-icon]').forEach((node) => node.insertAdjacentHTML('afterbegin', icon(node.dataset.icon)));

  const saved = storage.get('settings', {});
  fillSelect(el.pageSize, Object.entries(PAGE_SIZES).map(([id, s]) => [id, s.label]), PAGE_SIZES[saved.pageSize] ? saved.pageSize : 'a4');
  fillSelect(el.quality, Object.entries(QUALITIES).map(([id, q]) => [id, q.label]), QUALITIES[saved.quality] ? saved.quality : 'high');
  fillSelect(el.filterAll, [['', 'Elegir…'], ...FILTERS.map((f) => [f.id, f.label])], '');
  el.margins.checked = !!saved.margins;
  el.qualityHint.textContent = QUALITIES[el.quality.value].hint;
  for (const input of [el.pageSize, el.quality, el.margins]) input.addEventListener('change', saveSettings);

  // Biblioteca
  el.search.addEventListener('input', renderLibrary);
  el.scanBtn.addEventListener('click', () => {
    newDraft();
    el.cameraInput.click();
  });
  el.imagesBtn.addEventListener('click', () => {
    newDraft();
    el.imagesInput.click();
  });
  el.importPdfBtn.addEventListener('click', () => el.pdfInput.click());

  // Entradas de archivo
  el.cameraInput.addEventListener('change', () => {
    const [file] = el.cameraInput.files;
    el.cameraInput.value = '';
    if (file && state.draft) addFromCamera(file);
  });
  el.imagesInput.addEventListener('change', () => {
    const files = [...el.imagesInput.files];
    el.imagesInput.value = '';
    if (files.length && state.draft) addFromLibrary(files);
  });
  el.pdfInput.addEventListener('change', () => {
    const files = [...el.pdfInput.files];
    el.pdfInput.value = '';
    if (files.length) importPdfs(files);
  });

  // Nuevo PDF
  el.editorCancel.addEventListener('click', cancelDraft);
  el.editorCreate.addEventListener('click', createPdf);
  el.addCameraBtn.addEventListener('click', () => el.cameraInput.click());
  el.addImagesBtn.addEventListener('click', () => el.imagesInput.click());
  el.docName.addEventListener('keydown', (event) => event.key === 'Enter' && el.docName.blur());
  el.filterAll.addEventListener('change', () => {
    const filter = el.filterAll.value;
    el.filterAll.value = '';
    if (!filter || !state.draft) return;
    for (const page of state.draft.pages) {
      if (page.filter === filter) continue;
      page.filter = filter;
      scheduleRender(page);
    }
    renderEditor();
  });

  // Editor de página
  el.peTabs.addEventListener('click', (event) => {
    const tab = event.target.closest('button')?.dataset.tab;
    if (tab && state.pe) setTab(tab);
  });
  el.peCancel.addEventListener('click', () => {
    const { page, isNew } = state.pe;
    closePageEditor();
    if (isNew) removePage(page);
    renderEditor();
  });
  el.peDone.addEventListener('click', commitPage);
  el.peNext.addEventListener('click', () => {
    commitPage();
    el.cameraInput.click(); // en el mismo gesto, para que iOS permita abrir la cámara
  });
  el.peDelete.addEventListener('click', () => {
    if (!confirm('¿Eliminar esta página?')) return;
    const { page } = state.pe;
    closePageEditor();
    removePage(page);
    renderEditor();
  });
  el.peRotL.addEventListener('click', () => rotatePage(-1));
  el.peRotR.addEventListener('click', () => rotatePage(1));
  el.peMoveL.addEventListener('click', () => movePage(-1));
  el.peMoveR.addEventListener('click', () => movePage(1));
  el.autoBtn.addEventListener('click', () => {
    const corners = detectCorners(state.pe.img);
    if (!corners) toast('No se encontraron bordes claros. Ajusta las esquinas a mano.');
    state.pe.corners = corners ?? FULL_FRAME.map((p) => [...p]);
    drawCrop();
  });
  el.fullBtn.addEventListener('click', () => {
    state.pe.corners = FULL_FRAME.map((p) => [...p]);
    drawCrop();
  });
  window.addEventListener('resize', layoutCrop);

  // Visor
  el.viewerBack.addEventListener('click', () => {
    closeViewerImages();
    state.current = null;
    show('library');
  });
  el.shareBtn.addEventListener('click', () => sharePdf(state.current));
  el.downloadBtn.addEventListener('click', () => downloadPdf(state.current));
  el.viewerRename.addEventListener('click', renameCurrent);
  el.deleteBtn.addEventListener('click', deleteCurrent);

  // Aviso al salir con un documento a medias (solo en el navegador).
  window.addEventListener('beforeunload', (event) => {
    if (state.draft?.pages.length) event.preventDefault();
  });
}

async function start() {
  setup();
  try {
    state.docs = await listDocs();
  } catch (error) {
    toast(`No se pudo abrir el almacenamiento: ${error.message}`);
  }
  renderLibrary();
  show('library');

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start();
