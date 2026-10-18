import { deleteDoc, listDocs, saveDoc } from './db.js';
import {
  FILTERS,
  FULL_FRAME,
  NO_ADJUST,
  autoAdjust,
  canvasToBlob,
  detectCorners,
  hasAdjust,
  downscale,
  loadImage,
  releaseCanvas,
  releaseImage,
  renderPage,
  resizeJpeg,
} from './imaging.js';
import { PAGE_SIZES, buildPdf } from './pdf.js';
import { cvReady, detectDocument, loadCV } from './opencv.js';

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
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  cloud: '<path d="M7 18h10.5a4.5 4.5 0 0 0 .6-8.96A6 6 0 0 0 6.34 10.1 4 4 0 0 0 7 18z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  plusCircle: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  combine: '<rect x="3" y="4" width="11" height="14" rx="1.5"/><path d="M17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-2"/>',
  pages: '<rect x="4" y="4" width="10" height="14" rx="1.5"/><path d="M8 7h2M8 10h2"/><rect x="10" y="8" width="10" height="12" rx="1.5" fill="var(--surface)"/>',
  extract: '<rect x="4" y="3" width="12" height="16" rx="1.5"/><path d="M19 13v6a1 1 0 0 1-1 1h-6M15 17l5-5M20 12v4M20 12h-4"/>',
  split: '<path d="M12 4v16M7 8H5a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2M17 8h2a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2"/>',
  insert: '<rect x="3" y="4" width="10" height="16" rx="1.5"/><path d="M18 9v8M22 13h-8"/>',
  drag: '<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>',
  check: '<path d="M5 13l4 4L19 7"/>',
  cursor: '<path d="M5 3l6 16 2.3-6.7L20 10z"/>',
  textT: '<path d="M5 5h14M12 5v14M9 19h6"/>',
  marker: '<path d="M4 20h16M6 16l8-8 4 4-8 8H6z"/>',
  redactbox: '<rect x="4" y="6" width="16" height="12" rx="1" fill="currentColor"/>',
  signature: '<path d="M4 17c3 0 3-10 6-10s0 10 3 10 2-6 4-6 2 2 3 2"/>',
  stamp: '<rect x="5" y="14" width="14" height="6" rx="1"/><path d="M12 14V9M9 4h6a2 2 0 0 1 2 2c0 2-2 2-2 3H9c0-1-2-1-2-3a2 2 0 0 1 2-2z"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9l-5.3 2.7 1-5.8-4.2-4.1 5.9-.9z"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  folderPlus: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 10v6M9 13h6"/>',
  upload: '<path d="M7 18h10.5a4.5 4.5 0 0 0 .6-8.96A6 6 0 0 0 6.34 10.1 4 4 0 0 0 7 18zM12 16v-5M9.5 13.5 12 11l2.5 2.5"/>',
  files: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};

const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const $ = (id) => document.getElementById(id);
const el = {};
for (const id of [
  'library', 'libraryTitle', 'libSide', 'search', 'crumbs', 'uploadBanner', 'uploadBannerText', 'uploadBannerBtn',
  'folderList', 'docList', 'emptyState', 'emptyTitle', 'emptyText', 'scanBtn', 'imagesBtn', 'importPdfBtn',
  'cloudBadge', 'storageBox', 'profileBtn', 'newFolderTop', 'libHeading', 'libCount', 'folderHead', 'folderHeadCount',
  'docHead', 'docHeadTitle', 'docHeadCount', 'dropZone', 'favHead', 'favHeadCount', 'favList', 'favBtn',
  'editor', 'editorCancel', 'editorCreate', 'docName', 'destHint', 'pageCount', 'pageGrid', 'pagesHint', 'moveBtn',
  'addCameraBtn', 'addImagesBtn', 'pageSize', 'quality', 'margins', 'filterAll', 'qualityHint',
  'pageEditor', 'peCancel', 'peDone', 'peTitle', 'peTabs', 'peStage', 'cropBox', 'cropImg', 'cropSvg',
  'adjustToggle', 'adjustAuto', 'adjustReset', 'adjustAll', 'adjustPanel',
  'previewImg', 'peSpinner', 'loupe', 'cropControls', 'filterControls', 'filterSeg', 'autoBtn', 'fullBtn',
  'peDelete', 'peRotL', 'peRotR', 'peMoveL', 'peMoveR', 'peNextWrap', 'peNext',
  'viewer', 'viewerBack', 'viewerTitle', 'viewerPages', 'shareBtn', 'downloadBtn', 'deleteBtn', 'toolsBtn',
  'combine', 'combCancel', 'combDo', 'combOrder', 'combList', 'combImport',
  'organize', 'orgCancel', 'orgTitle', 'orgSave', 'orgHint', 'orgGrid', 'orgActions',
  'annotate', 'annCancel', 'annSave', 'annTools', 'annHint', 'annPages',
  'busy', 'busyText', 'busySpinner', 'busyBar', 'busyBarFill', 'busySub', 'busyStop', 'toast',
  'cameraInput', 'imagesInput', 'pdfInput', 'folderInput', 'mixedInput',
]) el[id] = $(id);

const state = {
  docs: [],
  current: null, // documento abierto en el visor
  draft: null, // { pages: [] } del PDF en edición
  pe: null, // sesión del editor de página
  user: null, // usuario de Supabase con sesión iniciada
  folders: [], // carpetas de la nube
  folderId: null, // carpeta abierta en «Mis PDF» (null = raíz)
  view: 'all', // 'all' = por carpetas, 'recent' = todos los documentos por fecha
};

// Colores de las tarjetas de carpeta (se asignan de forma estable por id).
const FOLDER_COLORS = ['#1d6fe8', '#30a46c', '#6e56cf', '#f76b15', '#12a594', '#22c3e6', '#e5484d', '#d6409f'];
function folderColor(id) {
  // Carpetas principales: un color distinto para cada una (por orden alfabético).
  const raiz = state.folders.filter((f) => !f.carpeta_padre_id).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const i = raiz.findIndex((f) => f.id === id);
  if (i >= 0) return FOLDER_COLORS[i % FOLDER_COLORS.length];
  let h = 2166136261; // subcarpetas: color estable según su id (FNV-1a)
  for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return FOLDER_COLORS[(h >>> 0) % FOLDER_COLORS.length];
}

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

/**
 * Indicador de espera. Con `fraction` (0–1) muestra una barra de progreso en
 * lugar del círculo girando; `sub` es una línea secundaria (p. ej. «Página 2 de 5»).
 */
function busy(message, { fraction = null, sub = '' } = {}) {
  el.busy.hidden = !message;
  if (!message) return;
  el.busyText.textContent = message;
  const bar = fraction != null;
  el.busySpinner.hidden = bar;
  el.busyBar.hidden = !bar;
  el.busySub.textContent = sub;
  if (bar) el.busyBarFill.style.width = `${Math.round(clamp01(fraction) * 100)}%`;
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// iPhone/iPad: el lector de PDF nativo no funciona dentro de la página, así que
// allí se renderiza con pdf.js; en computador se usa el lector nativo (<embed>).
const isIOS = () =>
  /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));

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

const SYNC_LABELS = {
  pendiente: 'Pendiente de subir',
  subiendo: 'Subiendo…',
  subido: 'En la nube',
  error: 'Error al subir: se reintentará',
};

const signedIn = () => Boolean(state.user && cloud);

/** Documentos visibles: los locales sin dueño y los de la cuenta con sesión iniciada. */
const visibleDocs = () => state.docs.filter((doc) => !doc.userId || doc.userId === state.user?.id);

function renderLibrary() {
  const query = el.search.value.trim().toLowerCase();
  const inCloud = signedIn();
  const searching = Boolean(query);
  const recent = state.view === 'recent' && !searching;
  const fav = state.view === 'fav' && !searching;
  const flat = recent || fav; // vistas sin carpetas: todos los documentos juntos
  const folderId = inCloud && !flat ? state.folderId : null;
  const allDocs = visibleDocs();
  const favoritos = allDocs.filter((doc) => doc.favorito).sort((a, b) => a.name.localeCompare(b.name, 'es'));

  const docs = fav
    ? favoritos
    : allDocs
        .filter((doc) => {
          if (searching) return doc.name.toLowerCase().includes(query);
          if (recent || !inCloud) return true;
          return (doc.carpetaId ?? null) === folderId;
        })
        .sort((a, b) => b.created - a.created);
  const folders = !inCloud || flat
    ? []
    : state.folders
        .filter((f) => (searching ? f.nombre.toLowerCase().includes(query) : (f.carpeta_padre_id ?? null) === folderId))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  // Títulos y ruta de carpetas
  const path = inCloud && !flat ? folderPath(folderId) : [];
  el.libraryTitle.textContent = recent ? 'Recientes' : fav ? 'Favoritos' : path.at(-1)?.nombre ?? 'Mis PDF';
  el.libHeading.textContent = searching
    ? 'Resultados de búsqueda'
    : recent
      ? 'Documentos recientes'
      : fav
        ? 'Favoritos'
        : path.length
          ? path.at(-1).nombre
          : 'Mis carpetas y documentos';
  const partes = [];
  if (folders.length) partes.push(folders.length === 1 ? '1 carpeta' : `${folders.length} carpetas`);
  partes.push(docs.length === 1 ? '1 archivo' : `${docs.length} archivos`);
  el.libCount.textContent = partes.join(', ');

  el.crumbs.hidden = !path.length || searching;
  el.crumbs.replaceChildren(
    ...[{ id: null, nombre: 'Mis PDF' }, ...path].flatMap((folder, i, list) => {
      const crumb = document.createElement(i === list.length - 1 ? 'span' : 'button');
      crumb.textContent = folder.nombre;
      if (crumb.tagName === 'BUTTON') crumb.addEventListener('click', () => openFolder(folder.id));
      return i ? [Object.assign(document.createElement('span'), { textContent: '›', className: 'sep' }), crumb] : [crumb];
    }),
  );

  // Aviso para subir los PDF que solo están en este dispositivo
  const localOnly = inCloud ? allDocs.filter((doc) => !doc.userId).length : 0;
  el.uploadBanner.hidden = !localOnly;
  el.uploadBannerText.textContent =
    localOnly === 1 ? '1 PDF está solo en este dispositivo.' : `${localOnly} PDF están solo en este dispositivo.`;

  // Acceso rápido a favoritos al inicio (en el teléfono es la forma de llegar a ellos)
  const favRapido = !searching && !flat && !folderId && favoritos.length > 0;
  el.favHead.hidden = !favRapido;
  el.favHeadCount.textContent = favoritos.length === 1 ? '1 favorito' : `${favoritos.length} favoritos`;
  el.favList.replaceChildren(...(favRapido ? favoritos.map(favChip) : []));

  el.folderHead.hidden = !folders.length;
  el.folderHeadCount.textContent = folders.length === 1 ? '1 carpeta' : `${folders.length} carpetas`;
  el.folderList.replaceChildren(...folders.map(folderCard));

  el.docHead.hidden = !docs.length;
  el.docHeadTitle.textContent = searching
    ? 'Archivos encontrados'
    : recent
      ? 'Por fecha'
      : fav
        ? 'Documentos importantes'
        : 'Archivos';
  el.docHeadCount.textContent = docs.length === 1 ? '1 archivo' : `${docs.length} archivos`;
  el.docList.replaceChildren(...docs.map((doc) => docRow(doc, (searching || flat) && inCloud)));

  el.newFolderTop.hidden = !inCloud || flat;
  const empty = !docs.length && !folders.length;
  renderLibSide();
  el.emptyState.hidden = !empty;
  if (searching) {
    el.emptyTitle.textContent = 'Sin resultados';
    el.emptyText.textContent = 'No hay documentos ni carpetas con ese nombre.';
  } else if (fav) {
    el.emptyTitle.textContent = 'Aún no tienes favoritos';
    el.emptyText.textContent =
      'Toca la estrella ☆ de un documento (o «Agregar a favoritos» en su menú ⋯) para tenerlo siempre a mano aquí.';
  } else if (folderId) {
    el.emptyTitle.textContent = 'Carpeta vacía';
    el.emptyText.textContent = 'Escanea, agrega imágenes o arrastra PDF estando aquí para guardarlos en esta carpeta.';
  } else {
    el.emptyTitle.textContent = 'Aún no hay PDF';
    el.emptyText.textContent = 'Escanea un documento con la cámara o convierte imágenes de tu galería en un PDF de alta calidad.';
  }
}

/** Tarjeta compacta de un favorito (acceso rápido al inicio de la biblioteca). */
function favChip(doc) {
  const li = document.createElement('li');
  const url = thumbUrl(doc);
  li.innerHTML = `
    <button class="fav-chip">
      ${url ? `<img class="fav-thumb" alt="" src="${url}">` : `<span class="fav-thumb">${icon('doc')}</span>`}
      <span class="fav-meta"><span class="fav-name"></span><small></small></span>
      <span class="fav-star">${icon('star')}</span>
    </button>`;
  li.querySelector('.fav-name').textContent = doc.name;
  li.querySelector('small').textContent = `${pagesText(doc.pageCount)} · ${formatSize(doc.size)}`;
  li.querySelector('.fav-chip').addEventListener('click', () => openViewer(doc));
  return li;
}

/** Estrella del visor: llena si el documento abierto es favorito. */
function renderViewerFav() {
  const on = Boolean(state.current?.favorito);
  el.favBtn.classList.toggle('on', on);
  el.favBtn.setAttribute('aria-label', on ? 'Quitar de favoritos' : 'Agregar a favoritos');
  el.favBtn.title = on ? 'Quitar de favoritos' : 'Agregar a favoritos';
}

/** Agrega o quita un documento de Favoritos (local al instante; luego en la nube). */
async function toggleFavorite(doc) {
  const favorito = !doc.favorito;
  const actualizado = await updateDoc(doc.id, { favorito });
  renderLibrary();
  if (state.current?.id === doc.id) renderViewerFav();
  toast(favorito ? '★ Agregado a favoritos' : 'Quitado de favoritos');
  if (signedIn() && actualizado?.userId && actualizado.sync === 'subido') {
    try {
      await cloud.setFavorite(doc.id, favorito);
    } catch (error) {
      toast(`Favorito guardado solo en este dispositivo. ${error.message}`);
    }
  }
}

/** Fecha corta y relativa: «Hoy, 10:45», «Ayer, 18:20», «hace 4 días» o la fecha. */
function relDate(ts) {
  const d = new Date(ts);
  const hoy = new Date();
  const dias = Math.round((new Date(hoy.toDateString()) - new Date(d.toDateString())) / 86_400_000);
  const hora = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  if (dias <= 0) return `Hoy, ${hora}`;
  if (dias === 1) return `Ayer, ${hora}`;
  if (dias < 7) return `hace ${dias} días`;
  if (dias < 30) return dias < 14 ? 'hace 1 semana' : `hace ${Math.floor(dias / 7)} semanas`;
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Iniciales para el avatar del perfil (nombre si existe; si no, el correo). */
function initials(user) {
  const nombre = user.user_metadata?.full_name || user.user_metadata?.name;
  if (nombre) return nombre.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  return user.email.split('@')[0].replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?';
}

const STORAGE_LIMIT = 1024 ** 3; // 1 GB: almacenamiento del plan gratuito de Supabase

/** Menú lateral de la biblioteca (visible en computador): acciones, navegación, carpetas, perfil. */
function renderLibSide() {
  const inCloud = signedIn();
  const docs = visibleDocs();
  const nodes = [];

  const boton = ({ icon: ic, label, run, active, count, dot, cls = 'side-item' }) => {
    const b = document.createElement('button');
    b.className = `${cls}${active ? ' active' : ''}`;
    b.innerHTML = `${dot ? `<span class="side-dot" style="--dot:${dot}"></span>` : icon(ic)}<span class="side-label"></span>${
      count != null ? `<span class="side-count">${count}</span>` : ''
    }`;
    b.querySelector('.side-label').textContent = label;
    b.addEventListener('click', run);
    return b;
  };
  const titulo = (texto, extra) => {
    const p = document.createElement('div');
    p.className = 'side-heading';
    p.innerHTML = '<span></span>';
    p.firstChild.textContent = texto;
    if (extra) p.append(extra);
    return p;
  };

  nodes.push(
    boton({
      icon: 'camera',
      label: 'Escanear documento',
      cls: 'side-scan',
      run: () => {
        newDraft();
        el.cameraInput.click();
      },
    }),
  );

  nodes.push(titulo('Herramientas PDF'));
  nodes.push(boton({ icon: 'docImport', label: 'Importar PDF', run: () => el.pdfInput.click() }));
  nodes.push(boton({ icon: 'files', label: 'Importar todo (CamScanner)', run: importMenu }));
  nodes.push(boton({ icon: 'combine', label: 'Combinar PDF', run: openCombine }));
  if (inCloud) {
    const pendientes = pendingOcrDocs();
    if (pendientes.length) {
      nodes.push(boton({ icon: 'search', label: 'OCR de pendientes', count: pendientes.length, run: () => ocrBatch(pendingOcrDocs()) }));
    }
  }
  nodes.push(
    boton({
      icon: 'photo',
      label: 'Imágenes a PDF',
      run: () => {
        newDraft();
        el.imagesInput.click();
      },
    }),
  );

  nodes.push(titulo('Navegación'));
  nodes.push(
    boton({
      icon: 'files',
      label: 'Todos los archivos',
      count: docs.length,
      active: state.view === 'all' && !state.folderId,
      run: () => {
        state.view = 'all';
        openFolder(null);
      },
    }),
  );
  nodes.push(
    boton({
      icon: 'clock',
      label: 'Recientes',
      active: state.view === 'recent',
      run: () => {
        state.view = 'recent';
        el.search.value = '';
        renderLibrary();
        el.library.querySelector('.scroll').scrollTop = 0;
      },
    }),
  );

  nodes.push(
    boton({
      icon: 'star',
      label: 'Favoritos',
      count: docs.filter((d) => d.favorito).length,
      active: state.view === 'fav',
      run: () => {
        state.view = 'fav';
        el.search.value = '';
        renderLibrary();
        el.library.querySelector('.scroll').scrollTop = 0;
      },
    }),
  );

  if (inCloud) {
    const mas = document.createElement('button');
    mas.className = 'side-heading-btn';
    mas.setAttribute('aria-label', 'Nueva carpeta');
    mas.innerHTML = icon('folderPlus');
    mas.addEventListener('click', newFolder);
    nodes.push(titulo('Mis carpetas', mas));
    const raiz = state.folders
      .filter((f) => !f.carpeta_padre_id)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    const abiertas = new Set(folderPath(state.folderId).map((f) => f.id));
    for (const f of raiz) {
      nodes.push(
        boton({
          dot: folderColor(f.id),
          label: f.nombre,
          count: docs.filter((d) => d.carpetaId === f.id).length,
          active: state.view === 'all' && abiertas.has(f.id),
          run: () => {
            state.view = 'all';
            openFolder(f.id);
          },
        }),
      );
    }
    if (!raiz.length) {
      const vacio = document.createElement('p');
      vacio.className = 'side-empty';
      vacio.textContent = 'Aún no tienes carpetas.';
      nodes.push(vacio);
    }
  }
  el.libSide.replaceChildren(...nodes);

  // Insignia «Nube», almacenamiento y perfil
  el.cloudBadge.hidden = !inCloud;
  el.storageBox.hidden = !inCloud;
  if (inCloud) {
    const usado = docs.filter((d) => d.userId).reduce((s, d) => s + (d.size || 0), 0);
    const pct = Math.min(100, (usado / STORAGE_LIMIT) * 100);
    el.storageBox.innerHTML = `
      <div class="storage-row"><span>Almacenamiento</span><strong>${formatSize(usado)} / 1 GB</strong></div>
      <div class="storage-bar"><span style="width:${Math.max(pct, 1).toFixed(1)}%"></span></div>
      <div class="storage-row small"><span>${pct < 1 ? '< 1' : Math.round(pct)}% utilizado</span></div>`;
  }
  const user = state.user;
  if (user) {
    const nombre = user.user_metadata?.full_name || user.user_metadata?.name || user.email.split('@')[0];
    el.profileBtn.innerHTML = `
      <span class="avatar">${initials(user)}</span>
      <span class="profile-meta"><strong></strong><small></small></span>
      ${icon('settings')}`;
    el.profileBtn.querySelector('strong').textContent = nombre;
    el.profileBtn.querySelector('small').textContent = user.email;
    el.profileBtn.setAttribute('aria-label', `Cuenta: ${user.email}`);
  } else {
    el.profileBtn.innerHTML = `
      <span class="avatar guest">${icon('user')}</span>
      <span class="profile-meta"><strong>Iniciar sesión</strong><small>Guarda tus PDF en la nube</small></span>`;
    el.profileBtn.setAttribute('aria-label', 'Iniciar sesión');
  }
}

function docRow(doc, showFolder) {
  const li = document.createElement('li');
  const url = thumbUrl(doc);
  li.innerHTML = `
    <div class="doc-row" role="button" tabindex="0">
      ${url ? `<img class="thumb" alt="" src="${url}">` : `<span class="thumb pdf-thumb">${icon('doc')}<b>PDF</b></span>`}
      <span class="meta">
        <span class="name-line"><span class="name"></span></span>
        <span class="sub"></span>
        <span class="date"></span>
      </span>
      <span class="row-actions">
        <button class="icon-btn star-btn${doc.favorito ? ' on' : ''}" aria-label="${doc.favorito ? 'Quitar de favoritos' : 'Agregar a favoritos'}" title="${doc.favorito ? 'Quitar de favoritos' : 'Agregar a favoritos'}" data-fav>${icon('star')}</button>
        <button class="row-btn view-btn" data-open>${icon('expand')}<span>Visualizar</span></button>
        <button class="icon-btn" aria-label="Compartir" data-share>${icon('share')}</button>
        <button class="icon-btn desk-only" aria-label="Descargar" data-download>${icon('download')}</button>
      </span>
    </div>`;
  li.querySelector('.name').textContent = doc.name;
  if (signedIn() && doc.estadoOcr === 'pendiente') {
    li.querySelector('.name-line').insertAdjacentHTML('beforeend', '<span class="tag warn">OCR pendiente</span>');
  }
  const sub = [];
  if (showFolder) sub.push(folderLabel(doc.carpetaId));
  sub.push(pagesText(doc.pageCount), formatSize(doc.size));
  li.querySelector('.sub').textContent = sub.join(' · ');
  const details = [relDate(doc.created)];
  if (signedIn() && SYNC_LABELS[doc.sync] && doc.userId) details.push(SYNC_LABELS[doc.sync]);
  const date = li.querySelector('.date');
  date.textContent = details.join(' · ');
  date.classList.toggle('error', doc.sync === 'error');
  li.querySelector('.doc-row').addEventListener('click', (event) => {
    if (event.target.closest('[data-fav]')) {
      toggleFavorite(doc);
    } else if (event.target.closest('[data-share]')) {
      if (doc.pdf) sharePdf(doc);
      else openViewer(doc); // hay que descargarlo antes de poder compartirlo
    } else if (event.target.closest('[data-download]')) {
      if (doc.pdf) downloadPdf(doc);
      else openViewer(doc);
    } else {
      openViewer(doc);
    }
  });
  li.querySelector('.doc-row').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') openViewer(doc);
  });
  return li;
}

/** Tarjeta de carpeta (cuadrícula en computador, lista compacta en el teléfono). */
function folderCard(folder) {
  const li = document.createElement('li');
  const suyos = visibleDocs().filter((doc) => doc.carpetaId === folder.id);
  const subfolders = state.folders.filter((f) => f.carpeta_padre_id === folder.id).length;
  const parts = [suyos.length === 1 ? '1 documento' : `${suyos.length} documentos`];
  if (subfolders) parts.push(subfolders === 1 ? '1 subcarpeta' : `${subfolders} subcarpetas`);
  const ultimo = suyos.reduce((m, d) => Math.max(m, d.created || 0), 0);
  li.innerHTML = `
    <div class="folder-card" role="button" tabindex="0" style="--fc:${folderColor(folder.id)}">
      <span class="fc-top">
        <span class="fc-icon">${icon('folder')}</span>
        <button class="icon-btn fc-more" aria-label="Opciones de la carpeta" data-more>${icon('more')}</button>
      </span>
      <span class="fc-name"></span>
      <span class="fc-sub">${parts.join(' · ')}</span>
      <span class="fc-foot">${ultimo ? `Último archivo: ${relDate(ultimo)}` : 'Sin archivos'}</span>
    </div>`;
  li.querySelector('.fc-name').textContent = folder.nombre;
  const card = li.querySelector('.folder-card');
  card.addEventListener('click', (event) => {
    if (event.target.closest('[data-more]')) folderMenu(folder);
    else openFolder(folder.id);
  });
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') openFolder(folder.id);
  });
  return li;
}

// ---------------------------------------------------------------------------
// Carpetas
// ---------------------------------------------------------------------------

function folderPath(id) {
  const path = [];
  let folder = state.folders.find((f) => f.id === id);
  while (folder) {
    path.unshift(folder);
    folder = state.folders.find((f) => f.id === folder.carpeta_padre_id);
  }
  return path;
}

const folderLabel = (id) => ['Mis PDF', ...folderPath(id).map((f) => f.nombre)].join(' › ');

/** Todas las carpetas en orden de árbol, con su profundidad. */
function folderTree() {
  const out = [];
  const walk = (parentId, depth) =>
    state.folders
      .filter((f) => (f.carpeta_padre_id ?? null) === parentId)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      .forEach((folder) => {
        out.push({ folder, depth });
        walk(folder.id, depth + 1);
      });
  walk(null, 0);
  return out;
}

function openFolder(id) {
  state.view = 'all';
  state.folderId = id;
  el.search.value = '';
  renderLibrary();
  el.library.querySelector('.scroll').scrollTop = 0;
}

async function runCloud(message, action) {
  busy(message);
  try {
    await action();
    await syncFromCloud();
  } catch (error) {
    toast(error.message);
  } finally {
    busy(null);
  }
}

function newFolder() {
  const nombre = prompt(`Nombre de la carpeta nueva en «${folderLabel(state.folderId)}»`)?.trim();
  if (!nombre) return;
  runCloud('Creando carpeta…', () => cloud.createFolder(nombre, state.folderId));
}

function folderMenu(folder) {
  const pendientes = pendingOcrDocs(folder.id);
  chooseAction(folder.nombre, [
    ...(pendientes.length
      ? [{ label: `Reconocer texto de pendientes (${pendientes.length})`, run: () => ocrBatch(pendingOcrDocs(folder.id), folder.nombre) }]
      : []),
    {
      label: 'Renombrar',
      run: () => {
        const nombre = prompt('Nuevo nombre de la carpeta', folder.nombre)?.trim();
        if (nombre && nombre !== folder.nombre) runCloud('Renombrando…', () => cloud.renameFolder(folder.id, nombre));
      },
    },
    {
      label: 'Eliminar carpeta',
      danger: true,
      run: () => {
        const ok = confirm(
          `¿Eliminar la carpeta «${folder.nombre}» y sus subcarpetas?\n\n` +
            'Los documentos que contienen NO se borran: pasan a «Mis PDF».',
        );
        if (ok) runCloud('Eliminando carpeta…', () => cloud.deleteFolder(folder.id));
      },
    },
  ]);
}

/**
 * Menú de opciones que sube desde abajo. Cada acción se ejecuta dentro del
 * mismo toque, así iOS permite abrir selectores de archivos desde ella.
 */
function chooseAction(title, options, onCancel) {
  const sheet = document.createElement('div');
  sheet.className = 'action-sheet';
  sheet.innerHTML = '<div class="action-card"><p class="action-title"></p><div class="action-list"></div></div>';
  sheet.querySelector('.action-title').textContent = title;
  const close = (cancelled) => {
    sheet.remove();
    if (cancelled) onCancel?.();
  };
  for (const option of options) {
    const button = document.createElement('button');
    const classes = ['action-item'];
    if (option.danger) classes.push('danger');
    if (option.current) classes.push('current'); // deshabilitada, marca «(actual)»
    if (option.selected) classes.push('selected'); // resaltada pero elegible
    button.className = classes.join(' ');
    button.textContent = option.label;
    if (option.depth) button.style.paddingLeft = `${16 + option.depth * 18}px`;
    button.disabled = Boolean(option.current);
    button.addEventListener('click', () => {
      close(false);
      option.run();
    });
    sheet.querySelector('.action-list').append(button);
  }
  const cancel = document.createElement('button');
  cancel.className = 'action-cancel';
  cancel.textContent = 'Cancelar';
  cancel.addEventListener('click', () => close(true));
  sheet.append(cancel);
  sheet.addEventListener('click', (event) => event.target === sheet && close(true));
  document.body.append(sheet);
}

const CANCELADO = Symbol('cancelado');

/** Menú para elegir una carpeta de destino. Resuelve con el id, null (raíz) o CANCELADO. */
function chooseFolder(title, currentId) {
  return new Promise((resolve) => {
    const options = [
      { label: 'Mis PDF', selected: currentId == null, run: () => resolve(null) },
      ...folderTree().map(({ folder, depth }) => ({
        label: folder.nombre,
        depth: depth + 1,
        selected: folder.id === currentId,
        run: () => resolve(folder.id),
      })),
    ];
    chooseAction(title, options, () => resolve(CANCELADO));
  });
}

function addMenu() {
  const options = [];
  if (signedIn()) options.push({ label: 'Nueva carpeta', run: newFolder });
  options.push({ label: 'Importar PDF', run: () => el.pdfInput.click() });
  options.push({ label: 'Importar todo: PDF e imágenes (CamScanner)', run: importMenu });
  options.push({ label: 'Combinar PDF', run: openCombine });
  const pendientes = signedIn() ? pendingOcrDocs() : [];
  if (pendientes.length) {
    options.push({ label: `Reconocer texto de todos los pendientes (${pendientes.length})`, run: () => ocrBatch(pendingOcrDocs()) });
  }
  chooseAction(signedIn() ? `Agregar en «${folderLabel(state.folderId)}»` : 'Agregar', options);
}

// ---------------------------------------------------------------------------
// Nube: subida en cola y sincronización con Supabase
// ---------------------------------------------------------------------------

let cloud = null; // módulo js/cloud.js; se carga junto con la cuenta
let docsLoaded = Promise.resolve();

/** Aplica cambios a un documento local y los guarda en el iPhone. */
async function updateDoc(id, changes) {
  const index = state.docs.findIndex((doc) => doc.id === id);
  if (index < 0) return null;
  const updated = { ...state.docs[index], ...changes };
  state.docs[index] = updated;
  if (state.current?.id === id) state.current = updated;
  if ('thumb' in changes && thumbUrls.has(id)) {
    URL.revokeObjectURL(thumbUrls.get(id));
    thumbUrls.delete(id);
  }
  await saveDoc(updated);
  return updated;
}

async function removeLocalDoc(id) {
  await deleteDoc(id);
  state.docs = state.docs.filter((doc) => doc.id !== id);
  if (thumbUrls.has(id)) URL.revokeObjectURL(thumbUrls.get(id));
  thumbUrls.delete(id);
  if (state.current?.id === id) {
    closeViewerImages();
    state.current = null;
    if (!el.viewer.hidden) show('library');
  }
}

/** Dueño, estado y carpeta de un documento nuevo, según haya sesión iniciada o no. */
function newDocOwnership() {
  return signedIn()
    ? { userId: state.user.id, sync: 'pendiente', carpetaId: state.folderId }
    : { sync: 'local', carpetaId: null };
}

let syncing = null;
/** Trae carpetas y documentos de la nube y los combina con los del iPhone. */
function syncFromCloud() {
  if (!signedIn() || !navigator.onLine) return Promise.resolve();
  syncing ??= (async () => {
    try {
      await docsLoaded;
      const user = state.user;
      const [folders, remote] = await Promise.all([cloud.fetchFolders(), cloud.fetchDocuments()]);
      if (state.user?.id !== user.id) return;
      state.folders = folders;
      if (state.folderId && !folders.some((f) => f.id === state.folderId)) state.folderId = null;

      const seen = new Set();
      for (const row of remote) {
        seen.add(row.id);
        const fields = {
          name: row.nombre,
          carpetaId: row.carpeta_id,
          origen: row.origen,
          estadoOcr: row.estado_ocr,
          favorito: row.favorito ?? state.docs.find((d) => d.id === row.id)?.favorito ?? false,
          pageCount: row.paginas ?? 0,
          size: row.version?.tamano_bytes ?? 0,
          remotePath: row.version?.storage_path ?? null,
          thumbPath: row.miniatura_path,
          created: Date.parse(row.created_at),
          userId: user.id,
          sync: 'subido',
        };
        const local = state.docs.find((doc) => doc.id === row.id);
        if (!local) {
          const doc = { id: row.id, pdf: null, thumb: null, previews: null, ...fields };
          state.docs.push(doc);
          await saveDoc(doc);
        } else if (local.sync !== 'subiendo' && Object.keys(fields).some((key) => local[key] !== fields[key])) {
          // Si cambió la versión (fase 5), la copia local del PDF deja de servir.
          const stale = local.remotePath && fields.remotePath !== local.remotePath ? { pdf: null, previews: null } : {};
          await updateDoc(row.id, { ...fields, ...stale });
        }
      }
      // Documentos borrados desde otro dispositivo
      for (const doc of [...state.docs]) {
        if (doc.userId === user.id && doc.sync === 'subido' && !seen.has(doc.id)) await removeLocalDoc(doc.id);
      }
      renderLibrary();
      downloadMissingThumbs();
    } catch (error) {
      console.warn('Sincronización pendiente:', error.message);
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

let downloadingThumbs = false;
async function downloadMissingThumbs() {
  if (downloadingThumbs) return;
  downloadingThumbs = true;
  try {
    for (const doc of visibleDocs().filter((d) => d.thumbPath && !d.thumb)) {
      if (!signedIn() || !navigator.onLine) break;
      try {
        await updateDoc(doc.id, { thumb: await cloud.downloadFile(doc.thumbPath) });
        renderLibrary();
      } catch {
        /* se reintenta en la próxima sincronización */
      }
    }
  } finally {
    downloadingThumbs = false;
  }
}

let uploading = false;
/** Sube, de a uno, los PDF pendientes. Sin conexión se detiene y reintenta después. */
async function processQueue() {
  if (uploading || !signedIn() || !navigator.onLine) return;
  uploading = true;
  try {
    await docsLoaded;
    const user = state.user;
    const queue = state.docs.filter(
      (doc) => doc.userId === user.id && ['pendiente', 'subiendo', 'error'].includes(doc.sync) && doc.pdf,
    );
    for (const { id } of queue) {
      if (state.user?.id !== user.id) break;
      const doc = await updateDoc(id, { sync: 'subiendo' });
      if (!doc) continue;
      renderLibrary();
      try {
        const { remotePath, thumbPath } = await cloud.uploadDocument(doc);
        await updateDoc(id, { sync: 'subido', remotePath, thumbPath, syncError: null });
      } catch (error) {
        await updateDoc(id, { sync: 'error', syncError: error.message });
        if (!navigator.onLine) break;
      }
      renderLibrary();
    }
  } finally {
    uploading = false;
  }
}

function syncNow() {
  syncFromCloud().then(processQueue);
}

// ---------------------------------------------------------------------------
// Herramientas de PDF: guardar un PDF nuevo (reutilizado por varias herramientas)
// ---------------------------------------------------------------------------

/** Guarda un PDF resultante como documento nuevo (local o en la nube según sesión). */
async function saveNewPdf(blob, name) {
  let pageCount = 0;
  let thumb = null;
  let textoOcr = null;
  try {
    const pdftext = await import('./pdftext.js');
    const info = await pdftext.prepareImport(blob);
    pageCount = info.pageCount;
    thumb = info.thumb;
    if (info.text.replace(/\s/g, '').length >= Math.max(16, info.pageCount * 8)) textoOcr = info.text;
  } catch {
    try {
      const edit = await import('./pdfedit.js');
      pageCount = await edit.pageCount(blob);
    } catch {
      /* se queda en 0 */
    }
  }
  const doc = {
    id: uid(),
    name: sanitizeName(name) || 'Documento',
    created: Date.now(),
    size: blob.size,
    pageCount,
    pdf: blob,
    thumb,
    previews: null,
    origen: 'app',
    textoOcr,
    estadoOcr: textoOcr ? 'completado' : 'pendiente',
    ...newDocOwnership(),
  };
  await saveDoc(doc);
  navigator.storage?.persist?.();
  state.docs.push(doc);
  return doc;
}

// ---------------------------------------------------------------------------
// Herramienta: Combinar PDF
// ---------------------------------------------------------------------------

const combine = { order: [], extra: new Map() }; // order: ids elegidos; extra: PDF importados solo para combinar

function openCombine() {
  combine.order = [];
  combine.extra.clear();
  renderCombine();
  el.combine.hidden = false;
}

function closeCombine() {
  combine.extra.clear();
  el.combine.hidden = true;
}

function combineCandidates() {
  // PDF de la biblioteca visibles, más los importados temporalmente para esta combinación.
  const propios = visibleDocs().map((doc) => ({ id: doc.id, name: doc.name, pageCount: doc.pageCount, doc }));
  const extra = [...combine.extra.entries()].map(([id, e]) => ({ id, name: e.name, pageCount: e.pageCount, extra: true }));
  return [...extra, ...propios];
}

function renderCombine() {
  const candidatos = combineCandidates();
  const porId = new Map(candidatos.map((c) => [c.id, c]));

  el.combOrder.replaceChildren(
    ...combine.order.map((id, i) => {
      const c = porId.get(id);
      const li = document.createElement('li');
      li.innerHTML = `<span class="comb-num">${i + 1}</span><span class="comb-name"></span>`;
      li.querySelector('.comb-name').textContent = c ? c.name : '(no disponible)';
      return li;
    }),
  );
  el.combOrder.hidden = combine.order.length === 0;

  el.combList.replaceChildren(
    ...candidatos.map((c) => {
      const pos = combine.order.indexOf(c.id);
      const li = document.createElement('li');
      li.innerHTML = `
        <button class="doc-row">
          <span class="thumb comb-check">${pos >= 0 ? `<b>${pos + 1}</b>` : icon('doc')}</span>
          <span class="meta"><span class="name"></span><span class="sub">${pagesText(c.pageCount)}${c.extra ? ' · recién agregado' : ''}</span></span>
        </button>`;
      li.querySelector('.name').textContent = c.name;
      li.querySelector('.doc-row').classList.toggle('selected-row', pos >= 0);
      li.querySelector('.doc-row').addEventListener('click', () => {
        const at = combine.order.indexOf(c.id);
        if (at >= 0) combine.order.splice(at, 1);
        else combine.order.push(c.id);
        renderCombine();
      });
      return li;
    }),
  );
  el.combDo.disabled = combine.order.length < 2;
}

async function runCombine() {
  if (combine.order.length < 2) return;
  const porId = new Map(combineCandidates().map((c) => [c.id, c]));
  busy('Combinando PDF…', { fraction: 0 });
  try {
    const edit = await import('./pdfedit.js');
    const blobs = [];
    for (const id of combine.order) {
      const c = porId.get(id);
      if (!c) continue;
      if (c.extra) blobs.push(combine.extra.get(id).blob);
      else blobs.push(await pdfBlobOf(c.doc));
    }
    const merged = await edit.mergePdfs(blobs, (n, t) => busy('Combinando PDF…', { fraction: n / t, sub: `Archivo ${n} de ${t}` }));
    busy('Guardando…', { fraction: 1 });
    const doc = await saveNewPdf(merged, `Combinado ${combine.order.length} PDF`);
    closeCombine();
    renderLibrary();
    processQueue();
    openViewer(doc);
    toast('PDF combinado creado.');
  } catch (error) {
    toast(`No se pudo combinar: ${error.message}`);
  } finally {
    busy(null);
  }
}

/** Agrega PDF importados desde Archivos a la combinación en curso. */
async function addToCombine(files) {
  busy('Leyendo PDF…');
  try {
    const edit = await import('./pdfedit.js');
    for (const file of files) {
      const buffer = await file.arrayBuffer();
      if (new TextDecoder('latin1').decode(buffer.slice(0, 4)) !== '%PDF') {
        toast(`«${file.name}» no es un PDF válido.`);
        continue;
      }
      const blob = new Blob([buffer], { type: 'application/pdf' });
      const id = `extra-${uid()}`;
      let pageCount = 0;
      try {
        pageCount = await edit.pageCount(blob);
      } catch {
        /* se deja en 0 */
      }
      combine.extra.set(id, { name: sanitizeName(file.name) || 'PDF', blob, pageCount });
      combine.order.push(id);
    }
    renderCombine();
  } catch (error) {
    toast(error.message);
  } finally {
    busy(null);
  }
}

/** Devuelve el PDF de un documento, descargándolo de la nube si solo está allí. */
async function pdfBlobOf(doc) {
  if (doc.pdf) return doc.pdf;
  if (signedIn() && doc.remotePath) {
    const blob = await cloud.downloadFile(doc.remotePath);
    await updateDoc(doc.id, { pdf: blob });
    return blob;
  }
  throw new Error(`«${doc.name}» no está disponible sin conexión.`);
}

// ---------------------------------------------------------------------------
// Herramienta: Organizar páginas
// ---------------------------------------------------------------------------

let org = null; // { docName, sources, pages, selected, nextSource, drag }

async function openOrganize(doc) {
  busy('Abriendo páginas…', { fraction: 0 });
  try {
    const blob = await pdfBlobOf(doc);
    const pdftext = await import('./pdftext.js');
    const thumbs = await pdftext.renderPdfPages(blob, 500, (n, t) =>
      busy('Abriendo páginas…', { fraction: n / t, sub: `Página ${n} de ${t}` }),
    );
    org = {
      docName: doc.name,
      sources: { 0: blob },
      nextSource: 1,
      selected: new Set(),
      drag: null,
      pages: thumbs.map((thumbBlob, index) => ({
        source: '0',
        index,
        rotate: 0,
        url: URL.createObjectURL(thumbBlob),
      })),
    };
    renderOrganize();
    el.organize.hidden = false;
  } catch (error) {
    toast(error.message);
  } finally {
    busy(null);
  }
}

function closeOrganize() {
  org?.pages.forEach((p) => URL.revokeObjectURL(p.url));
  org = null;
  el.organize.hidden = true;
}

function renderOrganize() {
  el.orgTitle.textContent = `${org.pages.length} ${org.pages.length === 1 ? 'página' : 'páginas'}`;
  el.orgHint.textContent = org.selected.size
    ? `${org.selected.size} seleccionada(s)`
    : 'Toca para seleccionar. Arrastra ⠿ para reordenar.';

  el.orgGrid.replaceChildren(
    ...org.pages.map((page, i) => {
      const card = document.createElement('div');
      card.className = `org-card${org.selected.has(i) ? ' selected' : ''}`;
      card.dataset.i = i;
      card.innerHTML = `
        <div class="org-thumb" style="transform: rotate(${page.rotate}deg)"><img alt="" src="${page.url}"></div>
        <span class="org-num">${i + 1}</span>
        <span class="org-check">${icon('check')}</span>
        <span class="org-handle" data-handle>${icon('drag')}</span>`;
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-handle]')) return;
        if (org.selected.has(i)) org.selected.delete(i);
        else org.selected.add(i);
        renderOrganize();
      });
      card.querySelector('[data-handle]').addEventListener('pointerdown', (e) => startDrag(e, i));
      return card;
    }),
  );
  renderOrgActions();
}

function renderOrgActions() {
  const sel = org.selected.size;
  const botones = sel
    ? [
        { icon: 'rotateLeft', label: 'Girar', run: () => rotateSelected(-90) },
        { icon: 'rotateRight', label: 'Girar', run: () => rotateSelected(90) },
        { icon: 'extract', label: 'Extraer', run: extractSelected },
        { icon: 'trash', label: 'Eliminar', danger: true, run: deleteSelected },
      ]
    : [
        { icon: 'insert', label: 'Insertar', run: insertPages },
        { icon: 'split', label: 'Dividir', run: splitCurrent },
      ];
  el.orgActions.replaceChildren(
    ...botones.map((b) => {
      const button = document.createElement('button');
      button.className = `org-action${b.danger ? ' danger' : ''}`;
      button.innerHTML = `${icon(b.icon)}<span>${b.label}</span>`;
      button.addEventListener('click', b.run);
      return button;
    }),
  );
}

function rotateSelected(delta) {
  for (const i of org.selected) org.pages[i].rotate = (((org.pages[i].rotate + delta) % 360) + 360) % 360;
  renderOrganize();
}

function deleteSelected() {
  if (org.selected.size === org.pages.length) return toast('No puedes eliminar todas las páginas.');
  const quedan = org.pages.filter((_, i) => !org.selected.has(i));
  org.pages.filter((_, i) => org.selected.has(i)).forEach((p) => URL.revokeObjectURL(p.url));
  org.pages = quedan;
  org.selected.clear();
  renderOrganize();
}

async function extractSelected() {
  const indices = [...org.selected].sort((a, b) => a - b);
  busy('Extrayendo páginas…');
  try {
    const edit = await import('./pdfedit.js');
    const blob = await edit.composePages(org.sources, indices.map((i) => ({ source: org.pages[i].source, index: org.pages[i].index, rotate: org.pages[i].rotate })));
    const doc = await saveNewPdf(blob, `${org.docName} (extracto)`);
    closeOrganize();
    renderLibrary();
    processQueue();
    openViewer(doc);
    toast(indices.length === 1 ? 'Página extraída a un PDF nuevo.' : `${indices.length} páginas extraídas a un PDF nuevo.`);
  } catch (error) {
    toast(`No se pudo extraer: ${error.message}`);
  } finally {
    busy(null);
  }
}

function insertPages() {
  chooseAction('Insertar páginas desde…', [
    {
      label: 'Escanear con la cámara',
      run: () => {
        preloadCV();
        org.insertImages = 'camera';
        el.cameraInput.click();
      },
    },
    {
      label: 'Fotos / Archivos',
      run: () => {
        org.insertImages = 'image';
        el.imagesInput.click();
      },
    },
    {
      label: 'Otro PDF',
      run: () => {
        org.inserting = true;
        el.pdfInput.click();
      },
    },
  ]);
}

/** Convierte imágenes (fotos o escaneos) en páginas PDF y las inserta en la organización. */
async function insertImageFiles(files, fromCamera) {
  busy('Agregando páginas…', { fraction: 0 });
  try {
    const pdftext = await import('./pdftext.js');
    for (const [idx, file] of [...files].entries()) {
      busy('Agregando páginas…', { fraction: idx / files.length, sub: `Imagen ${idx + 1} de ${files.length}` });
      const img = await loadImage(file);
      // En cámara: detecta bordes y aplica el filtro nítido; en fotos, se usa la imagen completa.
      const corners = fromCamera ? (await findCorners(img)) ?? FULL_FRAME : FULL_FRAME.map((p) => [...p]);
      const canvas = renderPage(img, { corners, rotation: 0, filter: fromCamera ? 'sharp' : 'original' });
      const w = canvas.width;
      const h = canvas.height;
      const jpeg = await canvasToBlob(canvas, 0.9);
      releaseCanvas(canvas);
      releaseImage(img);
      const pageBlob = buildPdf([{ jpeg, width: w, height: h }], { pageSize: 'fit', title: 'página' });
      const sourceId = String(org.nextSource++);
      org.sources[sourceId] = pageBlob;
      const thumbs = await pdftext.renderPdfPages(pageBlob, 500);
      thumbs.forEach((tb, i) => org.pages.push({ source: sourceId, index: i, rotate: 0, url: URL.createObjectURL(tb) }));
    }
    renderOrganize();
  } catch (error) {
    toast(`No se pudieron agregar páginas: ${error.message}`);
  } finally {
    busy(null);
  }
}

async function insertFromFiles(files) {
  busy('Agregando páginas…', { fraction: 0 });
  try {
    const pdftext = await import('./pdftext.js');
    for (const file of files) {
      const buffer = await file.arrayBuffer();
      if (new TextDecoder('latin1').decode(buffer.slice(0, 4)) !== '%PDF') continue;
      const blob = new Blob([buffer], { type: 'application/pdf' });
      const sourceId = String(org.nextSource++);
      org.sources[sourceId] = blob;
      const thumbs = await pdftext.renderPdfPages(blob, 500, (n, t) =>
        busy('Agregando páginas…', { fraction: n / t, sub: `${file.name} · página ${n} de ${t}` }),
      );
      thumbs.forEach((thumbBlob, index) =>
        org.pages.push({ source: sourceId, index, rotate: 0, url: URL.createObjectURL(thumbBlob) }),
      );
    }
    renderOrganize();
  } catch (error) {
    toast(`No se pudieron agregar páginas: ${error.message}`);
  } finally {
    busy(null);
  }
}

async function splitCurrent() {
  if (!confirm(`¿Dividir en ${org.pages.length} PDF, uno por cada página?`)) return;
  busy('Dividiendo…', { fraction: 0 });
  try {
    const edit = await import('./pdfedit.js');
    // Primero se arma el PDF con el orden y giros actuales, luego se divide.
    const compuesto = await edit.composePages(
      org.sources,
      org.pages.map((p) => ({ source: p.source, index: p.index, rotate: p.rotate })),
    );
    const partes = await edit.splitPdf(compuesto, (n, t) => busy('Dividiendo…', { fraction: n / t, sub: `Página ${n} de ${t}` }));
    const base = org.docName;
    for (const [i, parte] of partes.entries()) {
      busy('Guardando…', { fraction: (i + 1) / partes.length, sub: `${i + 1} de ${partes.length}` });
      await saveNewPdf(parte.blob, `${base} — página ${parte.pageNumber}`);
    }
    closeOrganize();
    renderLibrary();
    processQueue();
    show('library');
    toast(`Dividido en ${partes.length} PDF.`);
  } catch (error) {
    toast(`No se pudo dividir: ${error.message}`);
  } finally {
    busy(null);
  }
}

async function saveOrganized() {
  busy('Guardando cambios…');
  try {
    const edit = await import('./pdfedit.js');
    const blob = await edit.composePages(
      org.sources,
      org.pages.map((p) => ({ source: p.source, index: p.index, rotate: p.rotate })),
    );
    const doc = await saveNewPdf(blob, `${org.docName} (editado)`);
    closeOrganize();
    renderLibrary();
    processQueue();
    openViewer(doc);
    toast('PDF guardado como copia nueva.');
  } catch (error) {
    toast(`No se pudo guardar: ${error.message}`);
  } finally {
    busy(null);
  }
}

// Reordenar arrastrando el tirador ⠿.
function startDrag(event, from) {
  event.preventDefault();
  const card = event.target.closest('.org-card');
  card.setPointerCapture(event.pointerId);
  org.drag = { from, pointerId: event.pointerId, card };
  card.classList.add('dragging');
  const move = (e) => onDragMove(e);
  const up = (e) => {
    card.releasePointerCapture(e.pointerId);
    card.removeEventListener('pointermove', move);
    card.removeEventListener('pointerup', up);
    card.removeEventListener('pointercancel', up);
    finishDrag();
  };
  card.addEventListener('pointermove', move);
  card.addEventListener('pointerup', up);
  card.addEventListener('pointercancel', up);
}

function onDragMove(event) {
  if (!org?.drag) return;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.org-card');
  if (!target) return;
  const to = Number(target.dataset.i);
  if (Number.isNaN(to) || to === org.drag.from) return;
  const [moved] = org.pages.splice(org.drag.from, 1);
  org.pages.splice(to, 0, moved);
  // Mantener la selección pegada a las páginas movidas es complejo: se limpia.
  org.selected.clear();
  org.drag.from = to;
  renderOrganize();
  org.drag.card = el.orgGrid.querySelector(`.org-card[data-i="${to}"]`);
  org.drag.card?.classList.add('dragging');
}

function finishDrag() {
  org.drag = null;
  el.orgGrid.querySelectorAll('.dragging').forEach((c) => c.classList.remove('dragging'));
  renderOrganize();
}

/** Menú «Más» del visor: anotar, organizar páginas, renombrar. */
function toolsMenu() {
  const doc = state.current;
  const opciones = [
    { label: doc.favorito ? '★ Quitar de favoritos' : '☆ Agregar a favoritos', run: () => toggleFavorite(doc) },
    { label: 'Anotar / firmar', run: () => openAnnotate(doc) },
  ];
  if (signedIn() && doc.userId && ['pendiente', 'error'].includes(doc.sync)) {
    opciones.push({
      label: 'Subir a la nube ahora',
      run: () => {
        if (!navigator.onLine) return toast('Sin conexión. Se subirá cuando tengas internet.');
        toast('Subiendo a la nube…');
        syncNow();
      },
    });
  }
  if (signedIn() && doc.estadoOcr === 'pendiente') {
    opciones.push({ label: 'Reconocer texto (OCR)', run: () => runOcrOn(doc) });
  }
  opciones.push(
    { label: 'Organizar páginas', run: () => openOrganize(doc) },
    { label: 'Exportar a imagen', run: () => exportToImages(doc) },
    { label: 'Convertir a Word / Excel / PPT', run: () => convertMenu(doc) },
    { label: 'Renombrar', run: renameCurrent },
  );
  chooseAction(doc.name, opciones);
}

async function runOcrOn(doc) {
  busy('Reconociendo texto…');
  try {
    const blob = await pdfBlobOf(doc);
    const res = await cloud.runOcr(blob);
    await updateDoc(doc.id, { textoOcr: res.texto, estadoOcr: 'completado' });
    if (inCloud(doc)) await cloud.setOcr(doc.id, res.texto, 'completado');
    renderLibrary();
    busy(null);
    toast('Texto reconocido. El documento ya es buscable por su contenido.');
    const sugerido = sanitizeName(res.nombre_sugerido || '');
    if (sugerido && sugerido !== doc.name && confirm(`¿Renombrar el documento como «${sugerido}»?`)) {
      if (inCloud(doc)) await cloud.renameDocument(doc.id, sugerido);
      await updateDoc(doc.id, { name: sugerido });
      if (state.current?.id === doc.id) el.viewerTitle.textContent = sugerido;
      renderLibrary();
    }
  } catch (error) {
    busy(null);
    toast(`No se pudo reconocer el texto: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// OCR de todos los pendientes (de una carpeta o de toda la biblioteca)
// ---------------------------------------------------------------------------

const OCR_MAX_BYTES = 20 * 1024 * 1024; // más grande no cabe en una llamada a la función de OCR

/** Documentos con OCR pendiente; con carpetaId, solo esa carpeta y sus subcarpetas. */
function pendingOcrDocs(carpetaId) {
  const docs = visibleDocs().filter((doc) => doc.estadoOcr === 'pendiente');
  if (carpetaId === undefined) return docs;
  const ids = new Set([carpetaId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of state.folders) {
      if (ids.has(f.carpeta_padre_id) && !ids.has(f.id)) {
        ids.add(f.id);
        grew = true;
      }
    }
  }
  return docs.filter((doc) => ids.has(doc.carpetaId ?? null));
}

/** Nombres que no dicen nada del contenido («CamScanner 01-02-2024…», «Escaneo…», «IMG_1234»). */
const GENERIC_NAME = /^(camscanner|escaneo|scan|documento|doc|img|image|imagen|foto|photo|nuevo documento|new document)(?=[\s._-]|\d|$)|^[\d\s._-]+$/i;

let ocrStop = false;

async function ocrBatch(docs, donde) {
  if (!signedIn()) return toast('Inicia sesión para usar el OCR.');
  if (!navigator.onLine) return toast('Necesitas conexión a internet para el OCR.');
  if (!docs.length) return toast('No hay documentos con OCR pendiente.');

  const renombrar = await new Promise((resolve) => {
    chooseAction(
      `Reconocer texto de ${plural(docs.length, 'documento', 'documentos')}${donde ? ` en «${donde}»` : ''}`,
      [
        { label: 'Reconocer texto y renombrar los de nombre genérico', run: () => resolve(true) },
        { label: 'Solo reconocer texto (no cambiar nombres)', run: () => resolve(false) },
      ],
      () => resolve(null),
    );
  });
  if (renombrar == null) return;

  ocrStop = false;
  el.busyStop.hidden = false;
  let lock = null;
  try {
    lock = await navigator.wakeLock?.request('screen'); // que la pantalla no se apague a medio proceso
  } catch {
    /* opcional */
  }

  let listos = 0;
  let renombrados = 0;
  let seguidos = 0; // errores consecutivos: si son varios, el servicio no está respondiendo
  const errores = [];
  try {
    for (const [i, original] of docs.entries()) {
      if (ocrStop) break;
      const doc = state.docs.find((d) => d.id === original.id);
      if (!doc || doc.estadoOcr !== 'pendiente') continue;
      busy(`Reconociendo texto… ${i + 1} de ${docs.length}`, { fraction: i / docs.length, sub: doc.name });
      try {
        const blob = await pdfBlobOf(doc);
        if (blob.size > OCR_MAX_BYTES) throw new Error('es muy grande para el OCR (máx. 20 MB)');
        const res = await cloud.runOcr(blob);
        await updateDoc(doc.id, { textoOcr: res.texto, estadoOcr: 'completado' });
        if (inCloud(doc)) await cloud.setOcr(doc.id, res.texto, 'completado');
        const sugerido = sanitizeName(res.nombre_sugerido || '').slice(0, 120);
        if (renombrar && sugerido && GENERIC_NAME.test(doc.name) && sugerido !== doc.name) {
          if (inCloud(doc)) await cloud.renameDocument(doc.id, sugerido);
          await updateDoc(doc.id, { name: sugerido });
          renombrados++;
        }
        listos++;
        seguidos = 0;
      } catch (error) {
        errores.push(`«${doc.name}»: ${error.message}`);
        if (++seguidos >= 3) {
          errores.push('Se detuvo tras 3 errores seguidos. Revisa tu conexión o el servicio de OCR e inténtalo de nuevo.');
          break;
        }
      }
      if (i % 5 === 4) renderLibrary();
    }
  } finally {
    el.busyStop.hidden = true;
    busy(null);
    lock?.release?.().catch(() => {});
    renderLibrary();
  }

  const partes = [`Texto reconocido en ${plural(listos, 'documento', 'documentos')}`];
  if (renombrados) partes.push(`${renombrados} ${renombrados === 1 ? 'renombrado' : 'renombrados'}`);
  if (ocrStop) partes.push('detenido');
  toast(partes.join(' · '));
  if (errores.length) {
    const lista = errores.slice(0, 15).join('\n') + (errores.length > 15 ? '\n…' : '');
    setTimeout(() => alert(`Quedaron pendientes:\n\n${lista}`), 300);
  }
}

// ---------------------------------------------------------------------------
// Compartir o descargar un archivo generado (computador: descarga; iPhone: compartir)
// ---------------------------------------------------------------------------

async function shareOrDownload(file) {
  // En iPhone conviene la hoja de compartir; en computador, descargar directo.
  if (isIOS() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---------------------------------------------------------------------------
// Exportar a imagen (PNG / JPEG)
// ---------------------------------------------------------------------------

function exportToImages(doc) {
  chooseAction(`Exportar «${doc.name}» a imagen`, [
    { label: 'PNG (mejor calidad)', run: () => doExportImages(doc, 'image/png') },
    { label: 'JPEG (más liviano)', run: () => doExportImages(doc, 'image/jpeg') },
  ]);
}

// ---------------------------------------------------------------------------
// Convertir a Word / Excel / PowerPoint
// ---------------------------------------------------------------------------

const HIFI_TIPOS = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function convertMenu(doc) {
  const opciones = [
    { label: 'Word (.docx) · texto editable', run: () => toWord(doc) },
    { label: 'Excel (.xlsx) · texto por filas', run: () => toExcel(doc) },
    { label: 'PowerPoint (.pptx) · páginas como imagen', run: () => toPptx(doc) },
  ];
  if (signedIn()) {
    opciones.push(
      { label: 'Word fiel · diseño idéntico (nube)', run: () => toHiFi(doc, 'docx') },
      { label: 'Excel fiel · diseño idéntico (nube)', run: () => toHiFi(doc, 'xlsx') },
      { label: 'PowerPoint fiel · diseño idéntico (nube)', run: () => toHiFi(doc, 'pptx') },
    );
  }
  chooseAction(`Convertir «${doc.name}»`, opciones);
}

async function toHiFi(doc, formato) {
  busy('Convirtiendo en la nube…');
  try {
    const blob = await pdfBlobOf(doc);
    if (blob.size > 12 * 1024 * 1024) {
      return toast('El PDF es muy grande para la conversión en la nube (máx. ~12 MB).');
    }
    const out = await cloud.convertHiFi(blob, formato);
    await shareOrDownload(new File([out], `${sanitizeName(doc.name)}.${formato}`, { type: HIFI_TIPOS[formato] }));
    toast('Conversión lista.');
  } catch (error) {
    toast(`No se pudo convertir: ${error.message}`);
  } finally {
    busy(null);
  }
}

async function toWord(doc) {
  busy('Convirtiendo a Word…', { fraction: 0 });
  try {
    const blob = await pdfBlobOf(doc);
    const pdftext = await import('./pdftext.js');
    const office = await import('./office.js');
    const lineas = await pdftext.extractLines(blob, (n, t) => busy('Convirtiendo a Word…', { fraction: n / t, sub: `Página ${n} de ${t}` }));
    if (!lineas.some((l) => l.trim())) {
      return toast('Este PDF no tiene texto (es un escaneo). Para Word necesita primero OCR.');
    }
    const docx = await office.textToDocx(lineas);
    await shareOrDownload(new File([docx], `${sanitizeName(doc.name)}.docx`, { type: docx.type }));
    toast('Word (.docx) listo. Es el texto editable; el diseño puede variar.');
  } catch (error) {
    toast(`No se pudo convertir: ${error.message}`);
  } finally {
    busy(null);
  }
}

async function toExcel(doc) {
  busy('Convirtiendo a Excel…', { fraction: 0 });
  try {
    const blob = await pdfBlobOf(doc);
    const pdftext = await import('./pdftext.js');
    const office = await import('./office.js');
    const lineas = await pdftext.extractLines(blob, (n, t) => busy('Convirtiendo a Excel…', { fraction: n / t, sub: `Página ${n} de ${t}` }));
    if (!lineas.some((l) => l.trim())) {
      return toast('Este PDF no tiene texto (es un escaneo). Para Excel necesita primero OCR.');
    }
    // Cada línea es una fila; si hay varios espacios seguidos, se separan en columnas.
    const rows = lineas.map((l) => (l.trim() ? l.split(/\s{2,}/) : ['']));
    const xlsx = await office.rowsToXlsx(rows);
    await shareOrDownload(new File([xlsx], `${sanitizeName(doc.name)}.xlsx`, { type: xlsx.type }));
    toast('Excel (.xlsx) listo. Revisa las columnas; puedes ajustarlas en Excel.');
  } catch (error) {
    toast(`No se pudo convertir: ${error.message}`);
  } finally {
    busy(null);
  }
}

async function toPptx(doc) {
  busy('Convirtiendo a PowerPoint…', { fraction: 0 });
  try {
    const blob = await pdfBlobOf(doc);
    const pdftext = await import('./pdftext.js');
    const office = await import('./office.js');
    const imgs = await pdftext.renderPdfToImages(blob, { type: 'image/jpeg', maxSide: 1600 }, (n, t) =>
      busy('Convirtiendo a PowerPoint…', { fraction: n / t, sub: `Página ${n} de ${t}` }),
    );
    busy('Armando presentación…', { fraction: 1 });
    const pages = [];
    for (const im of imgs) pages.push({ bytes: new Uint8Array(await im.blob.arrayBuffer()), ext: im.ext, width: im.width, height: im.height });
    const pptx = await office.imagesToPptx(pages);
    await shareOrDownload(new File([pptx], `${sanitizeName(doc.name)}.pptx`, { type: pptx.type }));
    toast('PowerPoint (.pptx) listo: cada página es una diapositiva.');
  } catch (error) {
    toast(`No se pudo convertir: ${error.message}`);
  } finally {
    busy(null);
  }
}

async function doExportImages(doc, type) {
  busy('Generando imágenes…', { fraction: 0 });
  try {
    const blob = await pdfBlobOf(doc);
    const pdftext = await import('./pdftext.js');
    const imgs = await pdftext.renderPdfToImages(blob, { type }, (n, t) =>
      busy('Generando imágenes…', { fraction: n / t, sub: `Página ${n} de ${t}` }),
    );
    const base = sanitizeName(doc.name);
    if (imgs.length === 1) {
      await shareOrDownload(new File([imgs[0].blob], `${base}.${imgs[0].ext}`, { type }));
    } else {
      busy('Empaquetando…', { fraction: 1 });
      const { zipSync } = await import('./vendor/fflate.js');
      const files = {};
      for (let i = 0; i < imgs.length; i++) {
        files[`${base}-${String(i + 1).padStart(2, '0')}.${imgs[i].ext}`] = new Uint8Array(await imgs[i].blob.arrayBuffer());
      }
      const zip = zipSync(files, { level: 0 }); // las imágenes ya están comprimidas
      await shareOrDownload(new File([zip], `${base} (imágenes).zip`, { type: 'application/zip' }));
    }
    toast(imgs.length === 1 ? 'Imagen lista.' : `${imgs.length} imágenes listas (ZIP).`);
  } catch (error) {
    toast(`No se pudo exportar: ${error.message}`);
  } finally {
    busy(null);
  }
}

// ---------------------------------------------------------------------------
// Herramienta: Anotar / firmar
// ---------------------------------------------------------------------------

const ANN_TOOLS = [
  { id: 'select', icon: 'cursor', label: 'Mover' },
  { id: 'text', icon: 'textT', label: 'Texto' },
  { id: 'redact', icon: 'redactbox', label: 'Tapar' },
  { id: 'highlight', icon: 'marker', label: 'Resaltar' },
  { id: 'draw', icon: 'signature', label: 'Firmar' },
  { id: 'stamp', icon: 'stamp', label: 'Timbre' },
];
const ANN_HINTS = {
  select: 'Toca una anotación para seleccionarla; arrástrala para moverla.',
  text: 'Toca donde quieras escribir.',
  redact: 'Arrastra para tapar un área (recuadro opaco).',
  highlight: 'Arrastra para resaltar (color translúcido).',
  draw: 'Arrastra para firmar o dibujar a mano alzada. También puedes importar una firma.',
  stamp: 'Toca donde quieras poner el timbre con tus datos y un folio.',
};

function generarFolio() {
  const d = new Date();
  const p = (v) => String(v).padStart(2, '0');
  const fecha = `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${fecha}-${rnd}`;
}

function fechaLegible(d) {
  const p = (v) => String(v).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

let ann = null; // { doc, sourceBlob, pages, items, tool, color, selected, draft, drag }

async function openAnnotate(doc) {
  busy('Abriendo documento…', { fraction: 0 });
  try {
    const blob = await pdfBlobOf(doc);
    const pdftext = await import('./pdftext.js');
    const pages = await pdftext.renderPdfPagesDetailed(blob, 1600, (n, t) =>
      busy('Abriendo documento…', { fraction: n / t, sub: `Página ${n} de ${t}` }),
    );
    ann = {
      doc,
      sourceBlob: blob,
      pages: pages.map((p) => ({ width: p.width, height: p.height, rotation: p.rotation, url: URL.createObjectURL(p.blob) })),
      items: [],
      tool: 'select',
      color: '#e5332a',
      textSize: 0.025,
      selected: null,
      draft: null,
      drag: null,
      nextId: 1,
    };
    renderAnnTools();
    renderAnnPages();
    el.annotate.hidden = false;
  } catch (error) {
    toast(error.message);
  } finally {
    busy(null);
  }
}

function closeAnnotate() {
  ann?.pages.forEach((p) => URL.revokeObjectURL(p.url));
  ann = null;
  el.annotate.hidden = true;
}

const ANN_COLORS = ['#ffffff', '#e5332a', '#1a4fd6', '#111111', '#2e7d32', '#ffe600', '#37d67a', '#2ccce4', '#ff6bb5', '#ff8c00'];

function setAnnColor(value) {
  ann.color = value;
  const it = ann.selected && ann.items.find((i) => i.id === ann.selected);
  if (it) it.color = value;
  renderAnnTools();
  markAnnSelected();
}

function setAnnTextSize(value) {
  ann.textSize = value;
  const it = ann.selected && ann.items.find((i) => i.id === ann.selected && i.type === 'text');
  if (it) it.size = value;
  renderAnnTools();
  markAnnSelected();
}

function renderAnnTools() {
  const tools = ANN_TOOLS.map((t) => {
    const b = document.createElement('button');
    b.className = `ann-tool${ann.tool === t.id ? ' active' : ''}`;
    b.innerHTML = `${icon(t.icon)}<span>${t.label}</span>`;
    b.addEventListener('click', () => {
      ann.tool = t.id;
      ann.selected = null;
      renderAnnTools();
      markAnnSelected();
    });
    return b;
  });

  const sep = () => Object.assign(document.createElement('span'), { className: 'ann-sep' });

  // Paleta de colores (chips) + selector personalizado.
  const palette = document.createElement('div');
  palette.className = 'ann-palette';
  for (const c of ANN_COLORS) {
    const chip = document.createElement('button');
    chip.className = `ann-chip${c === ann.color ? ' active' : ''}`;
    chip.style.background = c;
    chip.title = c;
    chip.addEventListener('click', () => setAnnColor(c));
    palette.append(chip);
  }
  const custom = document.createElement('input');
  custom.type = 'color';
  custom.className = 'ann-color';
  custom.value = ann.color;
  custom.title = 'Otro color';
  custom.addEventListener('input', () => setAnnColor(custom.value));
  palette.append(custom);

  const extras = [];
  // Tamaño de letra (al escribir texto o con un texto seleccionado).
  const selText = ann.selected && ann.items.find((i) => i.id === ann.selected && i.type === 'text');
  if (ann.tool === 'text' || selText) {
    const sizes = document.createElement('div');
    sizes.className = 'ann-sizes';
    for (const [label, value] of [['A', 0.016], ['A', 0.025], ['A', 0.038], ['A', 0.055]]) {
      const b = document.createElement('button');
      const current = selText ? selText.size : ann.textSize;
      b.className = `ann-size${Math.abs(current - value) < 0.004 ? ' active' : ''}`;
      b.textContent = label;
      b.style.fontSize = `${10 + value * 260}px`;
      b.title = `Tamaño ${Math.round(value * 1000)}`;
      b.addEventListener('click', () => setAnnTextSize(value));
      sizes.append(b);
    }
    extras.push(sizes);
  }
  // Importar una imagen de firma (p. ej. PNG con fondo transparente) y reutilizar guardadas.
  if (ann.tool === 'draw') {
    const imp = document.createElement('button');
    imp.className = 'ann-tool';
    imp.innerHTML = `${icon('download')}<span>Importar firma</span>`;
    imp.addEventListener('click', importSignature);
    extras.push(imp);
    const guard = document.createElement('button');
    guard.className = 'ann-tool';
    guard.innerHTML = `${icon('signature')}<span>Firmas guardadas</span>`;
    guard.addEventListener('click', firmasGuardadasMenu);
    extras.push(guard);
  }
  if (ann.selected) {
    const del = document.createElement('button');
    del.className = 'ann-tool danger';
    del.innerHTML = `${icon('trash')}<span>Borrar</span>`;
    del.addEventListener('click', deleteAnnSelected);
    extras.push(del);
  }

  el.annTools.replaceChildren(...tools, sep(), palette, ...(extras.length ? [sep(), ...extras] : []));
  el.annHint.textContent = ANN_HINTS[ann.tool];
}

// Firmas guardadas (en este navegador) para reutilizarlas.
const getFirmas = () => storage.get('firmas', []);
const saveFirmas = (lista) => storage.set('firmas', lista.slice(0, 12));

/** Coloca una firma (imagen PNG) sobre la primera página, centrada abajo. */
async function addSignatureItem(dataUrl) {
  const img = await loadImageEl(dataUrl);
  const page = ann.pages[0];
  const ar = img.width / img.height;
  const wr = 0.32;
  const hr = (wr * page.width) / ar / page.height;
  ann.items.push({ id: ann.nextId++, page: 0, type: 'image', xr: (1 - wr) / 2, yr: 0.8, wr, hr, dataUrl });
  ann.tool = 'select';
  renderAnnTools();
  renderAnnPages();
  toast('Firma agregada. Arrástrala a su lugar.');
}

async function importSignature() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    busy('Cargando firma…');
    let dataUrl;
    try {
      // Se normaliza a PNG (conserva la transparencia de las firmas recortadas).
      dataUrl = await imageToPng(file);
      await addSignatureItem(dataUrl);
    } catch (error) {
      toast(`No se pudo cargar la firma: ${error.message}`);
      return;
    } finally {
      busy(null);
    }
    if (!getFirmas().includes(dataUrl) && confirm('¿Guardar esta firma para reutilizarla más adelante?')) {
      saveFirmas([dataUrl, ...getFirmas()]);
    }
  });
  input.click();
}

/** Panel con las firmas guardadas: tocar para insertar, o borrar. */
function firmasGuardadasMenu() {
  const firmas = getFirmas();
  const sheet = document.createElement('div');
  sheet.className = 'action-sheet';
  const card = document.createElement('div');
  card.className = 'action-card firmas-card';
  card.innerHTML = '<p class="action-title">Firmas guardadas</p><div class="firmas-grid"></div>';
  const grid = card.querySelector('.firmas-grid');
  const close = () => sheet.remove();
  if (!firmas.length) {
    grid.innerHTML = '<p class="hint" style="padding:16px">Aún no tienes firmas guardadas. Usa «Importar firma» y acepta guardarla.</p>';
  }
  for (const dataUrl of firmas) {
    const item = document.createElement('div');
    item.className = 'firma-item';
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = 'Firma';
    img.addEventListener('click', () => {
      close();
      addSignatureItem(dataUrl);
    });
    const del = document.createElement('button');
    del.className = 'firma-del';
    del.innerHTML = icon('trash');
    del.title = 'Borrar';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      saveFirmas(getFirmas().filter((x) => x !== dataUrl));
      item.remove();
    });
    item.append(img, del);
    grid.append(item);
  }
  const cancel = document.createElement('button');
  cancel.className = 'action-cancel';
  cancel.textContent = 'Cerrar';
  cancel.addEventListener('click', close);
  sheet.append(card, cancel);
  sheet.addEventListener('click', (e) => e.target === sheet && close());
  document.body.append(sheet);
}

function imageToPng(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.onload = async () => {
      try {
        const img = await loadImageEl(reader.result);
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        reject(e);
      }
    };
    reader.readAsDataURL(file);
  });
}

function loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Imagen no válida.'));
    img.src = src;
  });
}

function renderAnnPages() {
  el.annPages.replaceChildren(
    ...ann.pages.map((page, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'ann-page';
      wrap.style.aspectRatio = `${page.width} / ${page.height}`;
      wrap.dataset.page = i;
      wrap.innerHTML = `<img alt="Página ${i + 1}" src="${page.url}"><div class="ann-layer"></div>`;
      wrap.querySelector('.ann-layer').style.cursor = ann.tool === 'select' ? 'default' : 'crosshair';
      wrap.addEventListener('pointerdown', (e) => annPointerDown(e, i, wrap));
      renderAnnItems(wrap.querySelector('.ann-layer'), i);
      return wrap;
    }),
  );
}

function renderAnnItems(layer, pageIndex) {
  layer.replaceChildren();
  for (const it of ann.items.filter((x) => x.page === pageIndex)) {
    let node;
    if (it.type === 'text') {
      node = document.createElement('div');
      node.className = 'ann-item ann-text';
      node.style.left = `${it.xr * 100}%`;
      node.style.top = `${it.yr * 100}%`;
      node.style.color = it.color;
      node.style.fontSize = `${it.size * 100}cqh`; // relativo a la altura de la página
      node.textContent = it.text;
    } else if (it.type === 'image') {
      node = document.createElement('div');
      node.className = 'ann-item ann-image';
      node.style.left = `${it.xr * 100}%`;
      node.style.top = `${it.yr * 100}%`;
      node.style.width = `${it.wr * 100}%`;
      node.style.height = `${it.hr * 100}%`;
      node.innerHTML = `<img alt="Firma" src="${it.dataUrl}">`;
    } else if (it.type === 'stamp') {
      node = document.createElement('div');
      node.className = 'ann-item ann-stamp';
      node.style.left = `${it.xr * 100}%`;
      node.style.top = `${it.yr * 100}%`;
      node.style.width = `${it.wr * 100}%`;
      node.style.height = `${it.hr * 100}%`;
      node.style.color = it.color;
      node.style.borderColor = it.color;
      node.style.fontSize = `${(it.hr / it.lines.length) * 62}cqh`;
      for (const [i, linea] of it.lines.entries()) {
        const row = document.createElement('div');
        row.className = i === 0 ? 'ann-stamp-line head' : 'ann-stamp-line';
        row.textContent = linea;
        node.append(row);
      }
    } else {
      node = document.createElement('div');
      node.className = `ann-item ann-${it.type}`;
      node.style.left = `${it.xr * 100}%`;
      node.style.top = `${it.yr * 100}%`;
      node.style.width = `${it.wr * 100}%`;
      node.style.height = `${it.hr * 100}%`;
      if (it.type === 'redact') node.style.background = it.color;
      if (it.type === 'highlight') node.style.background = it.color;
      if (it.type === 'draw') {
        // El contenedor es el recuadro que ocupa el trazo, así se puede
        // seleccionar y mover tocando sobre la firma.
        node.className = 'ann-item ann-draw';
        const xs = it.points.map((pt) => pt[0]);
        const ys = it.points.map((pt) => pt[1]);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const bw = Math.max(0.002, Math.max(...xs) - minX);
        const bh = Math.max(0.002, Math.max(...ys) - minY);
        node.style.left = `${minX * 100}%`;
        node.style.top = `${minY * 100}%`;
        node.style.width = `${bw * 100}%`;
        node.style.height = `${bh * 100}%`;
        const pts = it.points.map(([x, y]) => `${((x - minX) / bw) * 100},${((y - minY) / bh) * 100}`).join(' ');
        node.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${it.color}" stroke-width="0.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
      }
    }
    node.dataset.id = it.id;
    if (it.id === ann.selected) node.classList.add('selected');
    layer.append(node);
  }
}

/** Vuelve a pintar las capas (sin recrear las páginas) para reflejar la selección. */
function markAnnSelected() {
  el.annPages.querySelectorAll('.ann-page').forEach((wrap) => {
    renderAnnItems(wrap.querySelector('.ann-layer'), Number(wrap.dataset.page));
  });
}

function annRelative(event, wrap) {
  const r = wrap.getBoundingClientRect();
  return {
    xr: clamp01((event.clientX - r.left) / r.width),
    yr: clamp01((event.clientY - r.top) / r.height),
  };
}

let annDragHandlers = null;

function annPointerDown(event, pageIndex, wrap) {
  if (!ann) return;
  const hitNode = event.target.closest('.ann-item');

  if (ann.tool === 'select') {
    if (hitNode) {
      event.preventDefault();
      const id = Number(hitNode.dataset.id);
      ann.selected = id;
      const it = ann.items.find((i) => i.id === id);
      const start = annRelative(event, wrap);
      // Se guarda el nodo y se mueve directamente, sin recrearlo (recrearlo al
      // iniciar cancelaba el gesto). Las escuchas van en window, no en el nodo.
      ann.drag = { id, lastX: start.xr, lastY: start.yr, wrap, layer: wrap.querySelector('.ann-layer'), node: hitNode };
      wrap.querySelectorAll('.ann-item.selected').forEach((n) => n.classList.remove('selected'));
      hitNode.classList.add('selected');
      renderAnnTools();
      startAnnWindowDrag();
    } else if (ann.selected != null) {
      ann.selected = null;
      markAnnSelected();
      renderAnnTools();
    }
    return;
  }

  event.preventDefault();
  const p = annRelative(event, wrap);
  if (ann.tool === 'text') {
    const text = prompt('Texto a escribir:');
    if (text && text.trim()) {
      ann.items.push({ id: ann.nextId++, page: pageIndex, type: 'text', xr: p.xr, yr: p.yr, size: ann.textSize, color: ann.color, text: text.trim() });
      renderAnnPages();
    }
    return;
  }
  if (ann.tool === 'stamp') {
    const nombre = prompt('Nombre o texto del timbre:', 'Firmado por ');
    if (nombre && nombre.trim()) {
      const lines = [nombre.trim(), `Fecha: ${fechaLegible(new Date())}`, `Folio: ${generarFolio()}`];
      ann.items.push({
        id: ann.nextId++,
        page: pageIndex,
        type: 'stamp',
        xr: clamp01(p.xr - 0.17),
        yr: clamp01(p.yr - 0.055),
        wr: 0.34,
        hr: 0.11,
        color: ann.color,
        lines,
      });
      renderAnnPages();
    }
    return;
  }
  if (ann.tool === 'draw') {
    ann.draft = { id: ann.nextId++, page: pageIndex, type: 'draw', color: ann.color, points: [[p.xr, p.yr]], wrap };
  } else {
    ann.draft = { id: ann.nextId++, page: pageIndex, type: ann.tool, xr: p.xr, yr: p.yr, wr: 0, hr: 0, color: ann.color, startX: p.xr, startY: p.yr, wrap };
  }
  startAnnWindowDrag();
}

function startAnnWindowDrag() {
  if (annDragHandlers) return;
  const move = (e) => annPointerMove(e);
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    annDragHandlers = null;
    annPointerUp();
  };
  annDragHandlers = { move, up };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

function annPointerMove(event) {
  const ctx = ann?.drag || ann?.draft;
  if (!ctx) return;
  const p = annRelative(event, ctx.wrap);
  if (ann.drag) {
    const it = ann.items.find((i) => i.id === ann.drag.id);
    if (!it) return;
    const dx = p.xr - ann.drag.lastX;
    const dy = p.yr - ann.drag.lastY;
    ann.drag.lastX = p.xr;
    ann.drag.lastY = p.yr;
    if (it.type === 'draw') {
      it.points = it.points.map(([x, y]) => [clamp01(x + dx), clamp01(y + dy)]);
      renderAnnItems(ann.drag.layer, it.page);
      ann.drag.node = ann.drag.layer.querySelector(`.ann-item[data-id="${it.id}"]`);
    } else {
      it.xr = clamp01(it.xr + dx);
      it.yr = clamp01(it.yr + dy);
      if (ann.drag.node) {
        ann.drag.node.style.left = `${it.xr * 100}%`;
        ann.drag.node.style.top = `${it.yr * 100}%`;
      }
    }
    return;
  }
  if (ann.draft.type === 'draw') {
    ann.draft.points.push([p.xr, p.yr]);
  } else {
    ann.draft.xr = Math.min(ann.draft.startX, p.xr);
    ann.draft.yr = Math.min(ann.draft.startY, p.yr);
    ann.draft.wr = Math.abs(p.xr - ann.draft.startX);
    ann.draft.hr = Math.abs(p.yr - ann.draft.startY);
  }
  drawAnnDraft();
}

/** Dibuja el borrador en curso en la capa de su página. */
function drawAnnDraft() {
  const layer = el.annPages.querySelector(`.ann-page[data-page="${ann.draft.page}"] .ann-layer`);
  if (!layer) return;
  renderAnnItems(layer, ann.draft.page);
  const d = ann.draft;
  const node = document.createElement('div');
  if (d.type === 'draw') {
    node.className = 'ann-item ann-draw';
    node.style.cssText = 'left:0;top:0;width:100%;height:100%';
    const pts = d.points.map(([x, y]) => `${x * 100},${y * 100}`).join(' ');
    node.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${d.color}" stroke-width="0.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
  } else {
    node.className = `ann-item ann-${d.type}`;
    node.style.left = `${d.xr * 100}%`;
    node.style.top = `${d.yr * 100}%`;
    node.style.width = `${d.wr * 100}%`;
    node.style.height = `${d.hr * 100}%`;
    node.style.background = d.color;
  }
  layer.append(node);
}

function annPointerUp() {
  if (ann.drag) {
    ann.drag = null;
    markAnnSelected();
    return;
  }
  const d = ann.draft;
  ann.draft = null;
  if (!d) return;
  if (d.type === 'draw') {
    if (d.points.length > 1) ann.items.push({ id: d.id, page: d.page, type: 'draw', color: d.color, points: d.points });
  } else if (d.wr > 0.01 && d.hr > 0.01) {
    ann.items.push({ id: d.id, page: d.page, type: d.type, xr: d.xr, yr: d.yr, wr: d.wr, hr: d.hr, color: d.color });
  }
  renderAnnPages();
}

function deleteAnnSelected() {
  ann.items = ann.items.filter((i) => i.id !== ann.selected);
  ann.selected = null;
  renderAnnTools();
  renderAnnPages();
}

async function saveAnnotations() {
  if (!ann.items.length) return toast('No hay anotaciones que guardar.');
  busy('Guardando anotaciones…');
  try {
    const edit = await import('./pdfedit.js');
    const blob = await edit.applyAnnotations(ann.sourceBlob, ann.items);
    const doc = await saveNewPdf(blob, `${ann.doc.name} (anotado)`);
    closeAnnotate();
    renderLibrary();
    processQueue();
    openViewer(doc);
    toast('PDF anotado guardado como copia nueva.');
  } catch (error) {
    toast(`No se pudo guardar: ${error.message}`);
  } finally {
    busy(null);
  }
}

function uploadLocalDocs() {
  const docs = visibleDocs().filter((doc) => !doc.userId);
  const ok = confirm(
    `¿Subir ${docs.length === 1 ? 'el PDF' : `los ${docs.length} PDF`} de este iPhone a tu cuenta (${state.user.email})?\n\n` +
      'Quedarán en «Mis PDF» y podrás moverlos a carpetas.',
  );
  if (!ok) return;
  Promise.all(docs.map((doc) => updateDoc(doc.id, { userId: state.user.id, sync: 'pendiente', carpetaId: null })))
    .then(() => {
      renderLibrary();
      processQueue();
    });
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

async function openViewer(doc) {
  if (!doc.pdf) {
    // Documento que está solo en la nube: se descarga una vez y queda en el iPhone.
    if (!signedIn() || !doc.remotePath) return toast('Este PDF está en la nube. Inicia sesión para abrirlo.');
    busy('Descargando PDF…');
    try {
      doc = await updateDoc(doc.id, { pdf: await cloud.downloadFile(doc.remotePath) });
    } catch (error) {
      return toast(error.message);
    } finally {
      busy(null);
    }
  }
  state.current = doc;
  el.viewerTitle.textContent = doc.name;
  el.moveBtn.hidden = !(signedIn() && doc.userId);
  renderViewerFav();
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
  } else if (!isIOS()) {
    // En computador: el lector de PDF nativo del navegador muestra cualquier PDF
    // de forma fiable (algunos PDF no se renderizan bien con pdf.js).
    const url = URL.createObjectURL(doc.pdf);
    viewerUrls = [url];
    const embed = document.createElement('embed');
    embed.className = 'viewer-embed';
    embed.src = url;
    embed.type = 'application/pdf';
    el.viewerPages.replaceChildren(embed);
  } else {
    // En iPhone: se renderizan las páginas con pdf.js (el lector nativo no sirve en iframe).
    const blobs = await renderPdfPreviews(doc);
    if (blobs?.length) {
      viewerUrls = blobs.map((blob) => URL.createObjectURL(blob));
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
      // Respaldo si no se pudo renderizar.
      const url = URL.createObjectURL(doc.pdf);
      const thumb = doc.thumb ? URL.createObjectURL(doc.thumb) : null;
      viewerUrls = thumb ? [url, thumb] : [url];
      el.viewerPages.innerHTML = `
        <div class="viewer-note">
          ${thumb ? `<img class="viewer-thumb" alt="Primera página" src="${thumb}">` : ''}
          <p>${pagesText(doc.pageCount)} · ${formatSize(doc.size)}</p>
          <p>No se pudo generar la vista previa. Puedes abrir el PDF directamente.</p>
          <a class="btn" href="${url}" target="_blank" rel="noopener">${icon('doc')}Abrir PDF</a>
        </div>`;
    }
  }
  el.viewerPages.scrollTop = 0;
  show('viewer');
}

/** Genera (y cachea) las imágenes de las páginas de un PDF con pdf.js. */
async function renderPdfPreviews(doc) {
  busy('Abriendo documento…', { fraction: 0 });
  try {
    const pdftext = await import('./pdftext.js');
    const blobs = await pdftext.renderPdfPages(doc.pdf, 1400, (n, total) =>
      busy('Abriendo documento…', { fraction: n / total, sub: `Página ${n} de ${total}` }),
    );
    const updated = await updateDoc(doc.id, { previews: blobs });
    if (updated) state.current = updated;
    return blobs;
  } catch (error) {
    console.warn('No se pudo renderizar el PDF:', error.message);
    return null;
  } finally {
    busy(null);
  }
}

function closeViewerImages() {
  viewerUrls.forEach((url) => URL.revokeObjectURL(url));
  viewerUrls = [];
  el.viewerPages.replaceChildren();
}

const inCloud = (doc) => doc.sync === 'subido';

function waitIfUploading(doc) {
  if (doc.sync !== 'subiendo') return false;
  toast('Este PDF se está subiendo. Espera unos segundos y vuelve a intentarlo.');
  return true;
}

async function renameCurrent() {
  const doc = state.current;
  if (waitIfUploading(doc)) return;
  const name = sanitizeName(prompt('Nuevo nombre del PDF', doc.name) ?? '');
  if (!name || name === doc.name) return;
  try {
    if (inCloud(doc)) await cloud.renameDocument(doc.id, name);
    await updateDoc(doc.id, { name });
    el.viewerTitle.textContent = name;
    renderLibrary();
  } catch (error) {
    toast(`No se pudo renombrar: ${error.message}`);
  }
}

function moveCurrent() {
  const doc = state.current;
  if (waitIfUploading(doc)) return;
  const current = doc.carpetaId ?? null;
  const target = (id, label, depth = 0) => ({
    label,
    depth,
    current: id === current,
    run: () => moveDocTo(doc, id),
  });
  chooseAction(`Mover «${doc.name}» a…`, [
    target(null, 'Mis PDF'),
    ...folderTree().map(({ folder, depth }) => target(folder.id, folder.nombre, depth + 1)),
  ]);
}

async function moveDocTo(doc, carpetaId) {
  busy('Moviendo…');
  try {
    if (inCloud(doc)) await cloud.moveDocument(doc.id, carpetaId);
    await updateDoc(doc.id, { carpetaId });
    renderLibrary();
    toast(`Movido a «${folderLabel(carpetaId)}»`);
  } catch (error) {
    toast(`No se pudo mover: ${error.message}`);
  } finally {
    busy(null);
  }
}

async function deleteCurrent() {
  const doc = state.current;
  if (waitIfUploading(doc)) return;
  const question = inCloud(doc)
    ? `¿Eliminar «${doc.name}» de la nube y de este iPhone? Esta acción no se puede deshacer.`
    : `¿Eliminar «${doc.name}»? Esta acción no se puede deshacer.`;
  if (!confirm(question)) return;
  busy('Eliminando…');
  try {
    if (inCloud(doc)) await cloud.deleteDocument(doc.id);
    await removeLocalDoc(doc.id);
    renderLibrary();
    show('library');
  } catch (error) {
    toast(`No se pudo eliminar: ${error.message}`);
  } finally {
    busy(null);
  }
}

/**
 * Lee un PDF elegido por el usuario: páginas, miniatura y texto (si ya trae).
 * Devuelve null si el archivo no es un PDF.
 */
async function readPdfFile(file, pdftext, onPage) {
  const buffer = await file.arrayBuffer();
  if (new TextDecoder('latin1').decode(buffer.slice(0, 4)) !== '%PDF') return null;
  const blob = new Blob([buffer], { type: 'application/pdf' });

  let pageCount = 0;
  let textoOcr = null;
  let thumb = null;
  if (pdftext) {
    const info = await pdftext.prepareImport(blob, onPage);
    pageCount = info.pageCount;
    thumb = info.thumb;
    // Si el PDF ya trae texto real, queda listo para buscar; si no, pendiente de OCR.
    const util = info.text.replace(/\s/g, '').length;
    if (util >= Math.max(16, info.pageCount * 8)) textoOcr = info.text;
  } else {
    // Respaldo sin pdf.js: contar páginas de forma aproximada.
    const marks = new TextDecoder('latin1').decode(buffer).match(/\/Type\s*\/Page(?![a-zA-Z])/g);
    pageCount = marks ? marks.length : 1;
  }
  const esCamScanner = /CamScanner/i.test(new TextDecoder('latin1').decode(buffer.slice(0, 2048)));
  return { blob, pageCount, thumb, textoOcr, esCamScanner };
}

async function importPdfs(files) {
  // Elegir carpeta de destino (si hay sesión y existen carpetas).
  let destino = signedIn() ? state.folderId : null;
  if (signedIn() && state.folders.length) {
    destino = await chooseFolder(
      files.length === 1 ? 'Importar en…' : `Importar ${files.length} PDF en…`,
      state.folderId,
    );
    if (destino === CANCELADO) return;
  }

  let pdftext = null;
  try {
    pdftext = await import('./pdftext.js');
  } catch {
    // Sin pdf.js (p. ej. sin conexión la primera vez) se importa sin extraer texto.
  }

  const total = files.length;
  let imported = 0;
  let needOcr = 0;
  const errores = [];

  for (const [index, file] of [...files].entries()) {
    const head = total === 1 ? 'Importando PDF…' : `Importando ${index + 1} de ${total}…`;
    busy(head, { fraction: index / total, sub: file.name });
    try {
      const leido = await readPdfFile(file, pdftext, (n, tot) =>
        busy(head, { fraction: (index + n / tot) / total, sub: `${file.name} · página ${n} de ${tot}` }),
      );
      if (!leido) {
        errores.push(`«${file.name}» no es un PDF válido.`);
        continue;
      }
      const { blob, pageCount, thumb, textoOcr, esCamScanner } = leido;
      if (!textoOcr) needOcr++;
      const doc = {
        id: uid(),
        name: sanitizeName(file.name) || 'Documento',
        created: Date.now(),
        size: file.size,
        pageCount,
        pdf: blob,
        thumb,
        previews: null,
        origen: esCamScanner ? 'camscanner' : 'importado',
        textoOcr,
        estadoOcr: textoOcr ? 'completado' : 'pendiente',
        ...newDocOwnership(),
        carpetaId: destino,
      };
      await saveDoc(doc);
      state.docs.push(doc);
      imported++;
    } catch (error) {
      errores.push(`«${file.name}»: ${error.message}`);
    }
  }

  busy(null);
  renderLibrary();
  if (imported) {
    let msg = imported === 1 ? 'PDF importado' : `${imported} PDF importados`;
    if (needOcr) msg += needOcr === 1 ? ' · 1 sin texto (pendiente de OCR)' : ` · ${needOcr} sin texto (pendientes de OCR)`;
    toast(msg);
  }
  if (errores.length) toast(errores[0]);
  processQueue();
}

// ---------------------------------------------------------------------------
// Importación masiva (p. ej. lo exportado desde CamScanner): carpetas con PDF
// e imágenes de una sola vez, guardadas en «Documentos importados».
// ---------------------------------------------------------------------------

const IMPORT_FOLDER = 'Documentos importados';
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|heic|heif|tiff?)$/i;
const isPdfFile = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const isImageFile = (f) => f.type.startsWith('image/') || IMAGE_EXT.test(f.name);
const byName = (a, b) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });

/** Archivos de un <input>: cada uno con sus carpetas relativas (si se eligió una carpeta). */
function itemsFromInput(files) {
  return [...files].map((file) => ({ file, dirs: (file.webkitRelativePath || '').split('/').slice(0, -1) }));
}

/** Recorre lo soltado (archivos y carpetas completas, con subcarpetas). */
async function itemsFromEntries(entries) {
  const out = [];
  const walk = async (entry, dirs) => {
    if (entry.isFile) {
      out.push({ file: await new Promise((ok, fail) => entry.file(ok, fail)), dirs });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      // readEntries entrega por tandas (≈100): se repite hasta que vuelve vacío.
      for (;;) {
        const batch = await new Promise((ok, fail) => reader.readEntries(ok, fail));
        if (!batch.length) break;
        for (const child of batch) await walk(child, [...dirs, entry.name]);
      }
    }
  };
  for (const entry of entries) await walk(entry, []);
  return out;
}

/**
 * Separa el número de página del nombre: «Recibo_2.jpg» → { base: 'Recibo', n: 2 }.
 * Acepta «_2», «-2», « 2», « (2)», «_p2», «_page2», «_pag 2».
 */
function splitPageNumber(fileName) {
  const stem = fileName.replace(/\.[^.]+$/, '').trim();
  const m = stem.match(/^(.*?\S)(?:[\s_-]+(?:p(?:age|ag|ág|agina|ágina)?\.?\s*)?(\d{1,3})|\s*\((\d{1,3})\))$/i);
  if (!m) return { base: stem, n: null };
  return { base: m[1].replace(/[\s_-]+$/, ''), n: Number(m[2] ?? m[3]) };
}

/**
 * Agrupa las imágenes que son páginas de un mismo documento (misma carpeta y
 * mismo nombre base con números 1, 2, 3…). Si la numeración no es correlativa
 * (p. ej. «Boleta 05» y «Boleta 12»), cada imagen queda como documento propio.
 */
function groupImages(items) {
  const grupos = new Map();
  for (const item of items) {
    const { base, n } = splitPageNumber(item.file.name);
    const key = `${item.dirs.join('/')}\u0000${base.toLowerCase()}`;
    if (!grupos.has(key)) grupos.set(key, { base, dirs: item.dirs, pages: [] });
    grupos.get(key).pages.push({ ...item, n });
  }
  const out = [];
  for (const g of grupos.values()) {
    const numeradas = g.pages.filter((p) => p.n != null).sort((a, b) => a.n - b.n);
    const sinNumero = g.pages.filter((p) => p.n == null);
    const correlativas =
      numeradas.length > 0 &&
      numeradas[0].n <= 1 &&
      numeradas.every((p, i) => p.n === numeradas[0].n + i) &&
      sinNumero.length <= 1;
    if (g.pages.length > 1 && correlativas) {
      out.push({ kind: 'images', name: g.base, dirs: g.dirs, files: [...sinNumero, ...numeradas].map((p) => p.file) });
    } else {
      for (const p of g.pages) {
        out.push({ kind: 'images', name: sanitizeName(p.file.name.replace(/\.[^.]+$/, '')), dirs: p.dirs, files: [p.file] });
      }
    }
  }
  return out;
}

/** Busca la carpeta por nombre dentro de padreId; si no existe, la crea en la nube. */
async function ensureFolder(nombre, padreId) {
  const existe = state.folders.find(
    (f) => f.nombre.toLowerCase() === nombre.toLowerCase() && (f.carpeta_padre_id ?? null) === padreId,
  );
  if (existe) return existe.id;
  const nueva = await cloud.createFolder(nombre, padreId);
  state.folders.push(nueva);
  return nueva.id;
}

/** Une imágenes ya recortadas (como las de CamScanner) en un PDF, sin volver a procesarlas. */
async function pdfFromImages(files, name) {
  const { maxSide, jpeg } = QUALITIES.high;
  const pages = [];
  let thumb = null;
  for (const [i, file] of files.entries()) {
    const out = await resizeJpeg(file, maxSide, jpeg);
    pages.push({ jpeg: out.blob, width: out.width, height: out.height });
    if (i === 0) thumb = (await resizeJpeg(out.blob, 360, 0.8)).blob;
  }
  return { pdf: buildPdf(pages, { pageSize: 'fit', title: name }), pageCount: pages.length, thumb };
}

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

/**
 * Importa de una vez PDF e imágenes (con sus subcarpetas). Cada PDF queda como
 * documento; las imágenes se unen por documento y se convierten a PDF.
 * @param {{file: File, dirs: string[]}[]} items
 */
async function importBatch(items) {
  items = items.filter(({ file }) => !file.name.startsWith('.') && (isPdfFile(file) || isImageFile(file)));
  if (!items.length) {
    toast('No se encontraron PDF ni imágenes para importar.');
    return;
  }
  // La carpeta elegida (raíz común) no se repite; sus subcarpetas sí se conservan.
  while (items.every((it) => it.dirs.length && it.dirs[0] === items[0].dirs[0])) {
    items = items.map((it) => ({ ...it, dirs: it.dirs.slice(1) }));
  }
  items.forEach((it) => (it.dirs = it.dirs.map((d) => sanitizeName(d)).filter(Boolean)));

  const pdfItems = items.filter((it) => isPdfFile(it.file));
  const imageItems = items.filter((it) => !isPdfFile(it.file));
  const tasks = [
    ...pdfItems.map((it) => ({ kind: 'pdf', name: sanitizeName(it.file.name), dirs: it.dirs, files: [it.file] })),
    ...groupImages(imageItems),
  ].sort((a, b) => byName(a.dirs.join('/'), b.dirs.join('/')) || byName(a.name, b.name));
  const desdeImagenes = tasks.length - pdfItems.length;
  const conSubcarpetas = tasks.some((t) => t.dirs.length);

  const enNube = signedIn();
  if (enNube && !navigator.onLine) {
    toast('Necesitas conexión a internet para crear las carpetas de la importación.');
    return;
  }
  const lineas = [`Se importarán ${plural(tasks.length, 'documento', 'documentos')}:`];
  if (pdfItems.length) lineas.push(`• ${plural(pdfItems.length, 'PDF', 'PDF')}`);
  if (imageItems.length) {
    lineas.push(
      `• ${plural(desdeImagenes, 'PDF nuevo', 'PDF nuevos')} con ${plural(imageItems.length, 'imagen', 'imágenes')} ` +
        '(las páginas numeradas de un mismo documento se unen)',
    );
  }
  lineas.push(
    '',
    enNube
      ? `Quedarán en la carpeta «${IMPORT_FOLDER}»${conSubcarpetas ? ', con sus mismas subcarpetas,' : ''} y se subirán a la nube.`
      : `Quedarán solo en este equipo. Inicia sesión antes si quieres tenerlos en la carpeta «${IMPORT_FOLDER}» de la nube.`,
    '',
    '¿Continuar?',
  );
  if (!confirm(lineas.join('\n'))) return;

  let pdftext = null;
  try {
    pdftext = await import('./pdftext.js');
  } catch {
    // Sin pdf.js se importa igual, sin extraer texto.
  }

  const carpetas = new Map(); // ruta relativa → id de carpeta
  let raiz = null;
  const total = tasks.length;
  let imported = 0;
  let repetidos = 0;
  const errores = [];

  try {
    if (enNube) {
      busy('Preparando carpetas…');
      raiz = await ensureFolder(IMPORT_FOLDER, null);
    }
    for (const [index, task] of tasks.entries()) {
      const head = `Importando ${index + 1} de ${total}…`;
      const ruta = [...task.dirs, task.name].join(' / ');
      busy(head, { fraction: index / total, sub: ruta });
      try {
        let carpetaId = null;
        if (enNube) {
          carpetaId = raiz;
          for (const [i, dir] of task.dirs.entries()) {
            const key = task.dirs.slice(0, i + 1).join('/');
            if (!carpetas.has(key)) carpetas.set(key, await ensureFolder(dir, carpetaId));
            carpetaId = carpetas.get(key);
          }
        }
        const name = task.name || 'Documento';
        // Volver a importar la misma carpeta no duplica lo que ya está.
        if (visibleDocs().some((d) => d.name === name && (d.carpetaId ?? null) === carpetaId)) {
          repetidos++;
          continue;
        }

        let fields;
        if (task.kind === 'pdf') {
          const leido = await readPdfFile(task.files[0], pdftext, (n, tot) =>
            busy(head, { fraction: (index + n / tot) / total, sub: `${ruta} · página ${n} de ${tot}` }),
          );
          if (!leido) throw new Error('no es un PDF válido');
          fields = {
            size: leido.blob.size,
            pageCount: leido.pageCount,
            pdf: leido.blob,
            thumb: leido.thumb,
            origen: leido.esCamScanner ? 'camscanner' : 'importado',
            textoOcr: leido.textoOcr,
            estadoOcr: leido.textoOcr ? 'completado' : 'pendiente',
          };
        } else {
          const { pdf, pageCount, thumb } = await pdfFromImages(task.files, name);
          fields = { size: pdf.size, pageCount, pdf, thumb, origen: 'importado', textoOcr: null, estadoOcr: 'pendiente' };
        }
        const doc = { id: uid(), name, created: Date.now(), previews: null, ...fields, ...newDocOwnership(), carpetaId };
        await saveDoc(doc);
        state.docs.push(doc);
        imported++;
      } catch (error) {
        errores.push(`«${ruta}»: ${error.message}`);
      }
    }
  } catch (error) {
    errores.unshift(error.message); // p. ej. no se pudo crear la carpeta principal
  } finally {
    busy(null);
  }

  navigator.storage?.persist?.();
  if (raiz) openFolder(raiz);
  else renderLibrary();
  const partes = [`${plural(imported, 'documento importado', 'documentos importados')}`];
  if (repetidos) partes.push(`${repetidos} ya ${repetidos === 1 ? 'estaba' : 'estaban'}`);
  if (errores.length) partes.push(`${errores.length} con error`);
  toast(partes.join(' · '));
  if (errores.length) {
    console.warn('Errores de importación:', errores);
    const lista = errores.slice(0, 15).join('\n') + (errores.length > 15 ? '\n…' : '');
    const titulo = errores.length === 1 ? 'No se pudo importar 1 elemento' : `No se pudieron importar ${errores.length} elementos`;
    setTimeout(() => alert(`${titulo}:\n\n${lista}`), 300);
  }
  processQueue();
}

/** Menú para elegir qué importar de una vez. */
function importMenu() {
  const options = [
    { label: 'Elegir una carpeta completa (PDF e imágenes)', run: () => el.folderInput.click() },
    { label: 'Elegir archivos (PDF e imágenes)', run: () => el.mixedInput.click() },
  ];
  // En iPhone no se puede elegir una carpeta entera, solo archivos.
  if (isIOS()) options.shift();
  chooseAction(`Importar todo en «${IMPORT_FOLDER}»`, options);
}

// ---------------------------------------------------------------------------
// Nuevo PDF
// ---------------------------------------------------------------------------

/**
 * Detecta el documento en la foto: primero con OpenCV (más preciso con fondos
 * oscuros, sombras o bordes poco marcados) y, si no está disponible o no
 * encuentra nada, con el detector propio de la app.
 */
async function findCorners(img) {
  if (!cvReady()) busy('Preparando el detector de bordes (solo la primera vez)…');
  try {
    const corners = await detectDocument(img, { timeout: 15000 });
    if (corners) return corners;
  } catch (error) {
    console.warn('OpenCV no disponible; se usa el detector propio:', error.message);
    toast('Se usó el detector básico (el avanzado aún no estaba listo). Revisa los bordes.');
  } finally {
    busy('Detectando bordes…');
  }
  return detectCorners(img);
}

/** Empieza a descargar OpenCV en segundo plano (mientras se toma la foto). */
function preloadCV() {
  if (navigator.onLine !== false) loadCV().catch(() => {});
}

/** Al abrir la app, deja OpenCV listo en segundo plano (salvo con ahorro de datos). */
function preloadCVWhenIdle() {
  if (navigator.connection?.saveData) return;
  setTimeout(preloadCV, 4000);
}

function newDraft() {
  preloadCV();
  releaseDraft();
  state.draft = { pages: [], ownership: newDocOwnership() };
  el.docName.value = defaultName();
  el.destHint.textContent = signedIn()
    ? `Se guardará en «${folderLabel(state.folderId)}» y se subirá a la nube.`
    : 'Se guardará solo en este iPhone. Inicia sesión para guardarlo también en la nube.';
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
    : 'Todavía no hay páginas. Escanea con la cámara o agrega imágenes.';
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
    filter: fromCamera ? 'sharp' : 'original',
    adjust: { ...NO_ADJUST },
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
    page.corners = (await findCorners(img)) ?? FULL_FRAME;
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
    const doc = {
      id: uid(),
      name,
      created: Date.now(),
      size: pdf.size,
      pageCount: pages.length,
      pdf,
      thumb,
      previews,
      origen: 'app',
      estadoOcr: 'pendiente', // un escaneo es solo imagen: el texto lo sacará el OCR (fase 4)
      ...state.draft.ownership,
    };
    await saveDoc(doc);
    navigator.storage?.persist?.();
    state.docs.push(doc);
    releaseDraft();
    renderLibrary();
    openViewer(doc);
    toast(
      doc.userId
        ? 'PDF creado. Se está subiendo a la nube.'
        : 'PDF creado. Toca «Compartir / Guardar» para enviarlo a otra app.',
    );
    processQueue();
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
    adjust: { ...NO_ADJUST, ...page.adjust },
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
  el.adjustPanel.hidden = !hasAdjust(state.pe.adjust);
  renderAdjust();
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

/** Sincroniza los controles de ajuste con la página abierta. */
function renderAdjust() {
  const pe = state.pe;
  if (!pe) return;
  for (const input of el.adjustPanel.querySelectorAll('input[data-adjust]')) {
    const v = pe.adjust[input.dataset.adjust] ?? 0;
    input.value = v;
    input.nextElementSibling.textContent = v > 0 && input.min !== '0' ? `+${v}` : String(v);
  }
  const ajustado = hasAdjust(pe.adjust);
  el.adjustReset.hidden = !ajustado;
  el.adjustAll.hidden = !ajustado || (state.draft?.pages.length ?? 0) < 2;
  el.adjustToggle.setAttribute('aria-expanded', String(!el.adjustPanel.hidden));
  el.adjustToggle.classList.toggle('active', !el.adjustPanel.hidden);
}

let adjustTimer;
function adjustChanged() {
  renderAdjust();
  clearTimeout(adjustTimer);
  adjustTimer = setTimeout(updatePreview, 120); // espera a que el dedo se detenga un poco
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
  const key = JSON.stringify([pe.corners, pe.rotation, pe.filter, pe.adjust]);
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
  const { page, corners, rotation, filter, adjust, isNew } = state.pe;
  const changed =
    isNew ||
    JSON.stringify([corners, rotation, filter, adjust]) !==
      JSON.stringify([page.corners, page.rotation, page.filter, page.adjust ?? NO_ADJUST]);
  page.corners = corners;
  page.rotation = rotation;
  page.filter = filter;
  page.adjust = { ...adjust };
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
  el.importPdfBtn.addEventListener('click', addMenu);
  el.uploadBannerBtn.addEventListener('click', uploadLocalDocs);
  el.profileBtn.addEventListener('click', () => $('accountBtn').click());
  el.newFolderTop.addEventListener('click', newFolder);
  el.favBtn.addEventListener('click', () => state.current && toggleFavorite(state.current));
  el.dropZone.addEventListener('click', () => el.pdfInput.click());

  // Arrastrar y soltar (computador): PDF se importan; imágenes crean un PDF nuevo;
  // carpetas completas (o PDF junto con imágenes) van a «Documentos importados».
  let dragDepth = 0;
  const conArchivos = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');
  el.library.addEventListener('dragenter', (event) => {
    if (!conArchivos(event) || el.library.hidden) return;
    event.preventDefault();
    dragDepth++;
    el.library.classList.add('dragging');
  });
  el.library.addEventListener('dragover', (event) => {
    if (conArchivos(event)) event.preventDefault();
  });
  el.library.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) el.library.classList.remove('dragging');
  });
  el.library.addEventListener('drop', (event) => {
    if (!conArchivos(event)) return;
    event.preventDefault();
    dragDepth = 0;
    el.library.classList.remove('dragging');
    // Las entradas se leen ya: terminado el evento dejan de estar disponibles.
    const entries = [...event.dataTransfer.items].map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
    const files = [...event.dataTransfer.files];
    const pdfs = files.filter(isPdfFile);
    const imagenes = files.filter(isImageFile);
    if (entries.some((entry) => entry.isDirectory) || (pdfs.length && imagenes.length)) {
      (entries.length ? itemsFromEntries(entries) : Promise.resolve(itemsFromInput(files)))
        .then(importBatch)
        .catch((error) => toast(`No se pudo leer lo soltado: ${error.message}`));
    } else if (pdfs.length) importPdfs(pdfs);
    else if (imagenes.length) {
      newDraft();
      addFromLibrary(imagenes);
    } else toast('Solo se pueden soltar PDF o imágenes.');
  });

  // Entradas de archivo
  el.cameraInput.addEventListener('change', () => {
    const [file] = el.cameraInput.files;
    el.cameraInput.value = '';
    if (!file) return;
    if (org?.insertImages) {
      org.insertImages = null;
      insertImageFiles([file], true);
    } else if (state.draft) {
      addFromCamera(file);
    }
  });
  el.imagesInput.addEventListener('change', () => {
    const files = [...el.imagesInput.files];
    el.imagesInput.value = '';
    if (!files.length) return;
    if (org?.insertImages) {
      org.insertImages = null;
      insertImageFiles(files, false);
    } else if (state.draft) {
      addFromLibrary(files);
    }
  });
  el.pdfInput.addEventListener('change', () => {
    const files = [...el.pdfInput.files];
    el.pdfInput.value = '';
    if (!files.length) return;
    if (org?.inserting) {
      org.inserting = false;
      insertFromFiles(files);
    } else if (!el.combine.hidden) {
      addToCombine(files);
    } else {
      importPdfs(files);
    }
  });

  for (const input of [el.folderInput, el.mixedInput]) {
    input.addEventListener('change', () => {
      const items = itemsFromInput(input.files);
      input.value = '';
      if (items.length) importBatch(items);
    });
  }

  // Combinar PDF
  el.busyStop.addEventListener('click', () => {
    ocrStop = true;
    el.busyStop.hidden = true;
    el.busySub.textContent = 'Deteniendo al terminar el documento actual…';
  });
  el.combCancel.addEventListener('click', closeCombine);
  el.combDo.addEventListener('click', runCombine);
  el.combImport.addEventListener('click', () => el.pdfInput.click());

  // Organizar páginas
  el.orgCancel.addEventListener('click', () => {
    if (org?.pages.length && !confirm('¿Descartar los cambios de organización?')) return;
    closeOrganize();
  });
  el.orgSave.addEventListener('click', saveOrganized);

  // Anotar / firmar
  el.annCancel.addEventListener('click', () => {
    if (ann?.items.length && !confirm('¿Descartar las anotaciones?')) return;
    closeAnnotate();
  });
  el.annSave.addEventListener('click', saveAnnotations);

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
  el.autoBtn.addEventListener('click', async () => {
    busy('Detectando bordes…');
    const corners = await findCorners(state.pe.img).finally(() => busy(null));
    if (!corners) toast('No se encontraron bordes claros. Ajusta las esquinas a mano.');
    state.pe.corners = corners ?? FULL_FRAME.map((p) => [...p]);
    drawCrop();
  });
  el.adjustToggle.addEventListener('click', () => {
    el.adjustPanel.hidden = !el.adjustPanel.hidden;
    renderAdjust();
  });
  el.adjustPanel.addEventListener('input', (event) => {
    const key = event.target.dataset?.adjust;
    if (!key || !state.pe) return;
    state.pe.adjust = { ...state.pe.adjust, [key]: Number(event.target.value) };
    adjustChanged();
  });
  el.adjustAuto.addEventListener('click', () => {
    const pe = state.pe;
    if (!pe) return;
    try {
      pe.adjust = autoAdjust(pe.img, pe);
    } catch (error) {
      return toast(error.message);
    }
    el.adjustPanel.hidden = false;
    adjustChanged();
    toast('Ajuste automático aplicado. Puedes afinarlo con los controles.');
  });
  el.adjustReset.addEventListener('click', () => {
    if (!state.pe) return;
    state.pe.adjust = { ...NO_ADJUST };
    adjustChanged();
  });
  el.adjustAll.addEventListener('click', () => {
    const pe = state.pe;
    if (!pe || !state.draft) return;
    let n = 0;
    for (const page of state.draft.pages) {
      if (page === pe.page) continue;
      page.adjust = { ...pe.adjust };
      scheduleRender(page);
      n++;
    }
    toast(n === 1 ? 'Ajustes aplicados a 1 página más.' : `Ajustes aplicados a ${n} páginas más.`);
  });
  el.fullBtn.addEventListener('click', () => {
    state.pe.corners = FULL_FRAME.map((p) => [...p]);
    drawCrop();
  });
  window.addEventListener('resize', layoutCrop);

  // Al volver la conexión o al volver a la app: sincroniza y sube lo pendiente.
  let lastSync = 0;
  window.addEventListener('online', syncNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastSync > 20_000) {
      lastSync = Date.now();
      syncNow();
    }
  });

  // Visor
  el.viewerBack.addEventListener('click', () => {
    closeViewerImages();
    state.current = null;
    show('library');
  });
  el.shareBtn.addEventListener('click', () => sharePdf(state.current));
  el.downloadBtn.addEventListener('click', () => downloadPdf(state.current));
  el.toolsBtn.addEventListener('click', toolsMenu);
  el.moveBtn.addEventListener('click', moveCurrent);
  el.deleteBtn.addEventListener('click', deleteCurrent);

  // Aviso al salir con un documento a medias (solo en el navegador).
  window.addEventListener('beforeunload', (event) => {
    if (state.draft?.pages.length) event.preventDefault();
  });
}

// ---------------------------------------------------------------------------
// Cuenta (Supabase)
// Se carga aparte: si falla (por ejemplo, sin conexión la primera vez), el
// escaneo y la biblioteca local siguen funcionando igual.
// ---------------------------------------------------------------------------

async function setupAccount() {
  const ids = [
    'account', 'accountBtn', 'accountClose', 'authForm', 'authModes', 'authEmail', 'authPassword',
    'authPassword2', 'authHint', 'authError', 'authSubmit', 'accountInfo', 'accountEmail', 'signOutBtn',
  ];
  const ui = Object.fromEntries(ids.map((id) => [id, $(id)]));
  let mode = 'signin';

  const showError = (message) => {
    ui.authError.textContent = message;
    ui.authError.hidden = !message;
  };

  const setMode = (next) => {
    mode = next;
    for (const button of ui.authModes.children) button.classList.toggle('active', button.dataset.mode === mode);
    const signup = mode === 'signup';
    ui.authPassword2.hidden = !signup;
    ui.authPassword.autocomplete = signup ? 'new-password' : 'current-password';
    ui.authSubmit.textContent = signup ? 'Crear cuenta' : 'Entrar';
    ui.authHint.textContent = signup ? 'La contraseña debe tener al menos 8 caracteres.' : '';
    showError('');
  };

  ui.accountBtn.addEventListener('click', () => {
    showError('');
    ui.account.hidden = false;
  });
  ui.accountClose.addEventListener('click', () => (ui.account.hidden = true));
  ui.authModes.addEventListener('click', (event) => {
    const next = event.target.closest('button')?.dataset.mode;
    if (next) setMode(next);
  });

  let auth;
  try {
    auth = await import('./auth.js');
    cloud = await import('./cloud.js');
  } catch {
    ui.accountBtn.addEventListener('click', () => showError('No se pudo cargar la cuenta. Revisa tu conexión y vuelve a abrir la app.'));
    return;
  }

  auth.onUserChange((user) => {
    ui.accountBtn.classList.toggle('signed-in', Boolean(user));
    ui.accountBtn.setAttribute('aria-label', user ? `Cuenta: ${user.email}` : 'Cuenta (sin iniciar sesión)');
    ui.authForm.hidden = Boolean(user);
    ui.accountInfo.hidden = !user;
    ui.accountEmail.textContent = user?.email ?? '';
    $('profileName').value = user?.user_metadata?.full_name ?? '';

    const changed = state.user?.id !== user?.id;
    state.user = user;
    if (!changed) {
      renderLibSide(); // p. ej., cambió el nombre del perfil
      return;
    }
    state.folders = [];
    state.folderId = null;
    renderLibrary();
    if (user) syncNow();
  });

  $('profileNameSave').addEventListener('click', async () => {
    const nombre = $('profileName').value.trim();
    busy('Guardando nombre…');
    try {
      await auth.updateName(nombre);
      toast(nombre ? 'Nombre guardado' : 'Nombre quitado');
    } catch (error) {
      toast(error.message);
    } finally {
      busy(null);
    }
  });

  ui.authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = ui.authEmail.value.trim();
    const password = ui.authPassword.value;
    if (!email || !password) return showError('Escribe tu correo y tu contraseña.');
    if (mode === 'signup') {
      if (password.length < 8) return showError('La contraseña debe tener al menos 8 caracteres.');
      if (password !== ui.authPassword2.value) return showError('Las contraseñas no coinciden.');
    }
    showError('');
    ui.authSubmit.disabled = true;
    busy(mode === 'signup' ? 'Creando cuenta…' : 'Entrando…');
    try {
      if (mode === 'signup') {
        const ready = await auth.signUp(email, password);
        if (!ready) {
          showError('Cuenta creada. Revisa tu correo para confirmarla y luego usa «Entrar».');
          setMode('signin');
          return;
        }
      } else {
        await auth.signIn(email, password);
      }
      ui.authPassword.value = '';
      ui.authPassword2.value = '';
      ui.account.hidden = true;
      toast(mode === 'signup' ? 'Cuenta creada. Sesión iniciada.' : 'Sesión iniciada');
      setMode('signin');
    } catch (error) {
      showError(error.message);
    } finally {
      busy(null);
      ui.authSubmit.disabled = false;
    }
  });

  ui.signOutBtn.addEventListener('click', async () => {
    if (!confirm('¿Cerrar la sesión en este iPhone?')) return;
    try {
      await auth.signOut();
      toast('Sesión cerrada');
    } catch (error) {
      toast(error.message);
    }
  });
}

async function start() {
  setup();
  docsLoaded = listDocs()
    .then((docs) => (state.docs = docs))
    .catch((error) => toast(`No se pudo abrir el almacenamiento: ${error.message}`));
  setupAccount();
  await docsLoaded;
  renderLibrary();
  show('library');

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // En el teléfono (donde se escanea) se deja el detector avanzado listo de antemano.
  if (isIOS() || matchMedia('(pointer: coarse)').matches) preloadCVWhenIdle();
}

start();
