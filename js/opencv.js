// Detección del documento con OpenCV.js (WebAssembly).
// La librería pesa ~10 MB: se descarga solo cuando hace falta (al empezar a
// escanear), queda guardada para usarse sin conexión y, si no está lista a
// tiempo, la app usa su detector propio (imaging.detectCorners).

const MAX = 640; // lado mayor de la imagen de trabajo (suficiente y rápido)

let carga = null;

/** Carga OpenCV.js una sola vez. Devuelve { cv } (envuelto: el módulo es «thenable»). */
export function loadCV() {
  carga ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('./vendor/opencv/opencv.js', import.meta.url).href;
    script.async = true;
    script.onerror = () => {
      carga = null; // se reintenta la próxima vez (p. ej., sin conexión)
      reject(new Error('No se pudo cargar OpenCV.'));
    };
    script.onload = () => {
      const cv = window.cv;
      if (!cv) return reject(new Error('OpenCV no quedó disponible.'));
      if (cv.Mat) return resolve({ cv });
      if (typeof cv.then === 'function') {
        // Se resuelve con un objeto envoltorio: resolver con el módulo (que tiene
        // .then) haría que la promesa lo vuelva a esperar sin fin.
        cv.then((mod) => resolve({ cv: mod.Mat ? mod : window.cv }));
      } else {
        cv.onRuntimeInitialized = () => resolve({ cv });
      }
    };
    document.head.append(script);
  });
  return carga;
}

/** true si OpenCV ya está cargado (no espera). */
export const cvReady = () => Boolean(window.cv?.Mat);

/**
 * Busca la hoja/foto en la imagen y devuelve sus 4 esquinas normalizadas [0‒1]
 * (sup-izq, sup-der, inf-der, inf-izq), o null si no hay nada convincente.
 * Combina tres mapas: bordes por brillo (Canny), bordes por color (LAB, separa
 * p. ej. una franja negra de una mesa café) y zonas claras (Otsu).
 */
export async function detectDocument(img, { timeout = 8000 } = {}) {
  const { cv } = await Promise.race([
    loadCV(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('OpenCV tardó demasiado en cargar.')), timeout)),
  ]);

  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  const s = MAX / Math.max(W, H);
  const w = Math.max(16, Math.round(W * s));
  const h = Math.max(16, Math.round(H * s));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  canvas.width = 0; // libera memoria en iOS
  canvas.height = 0;

  const mats = [];
  const mat = (m) => (mats.push(m), m);
  try {
    const rgba = mat(cv.matFromImageData(imageData));
    const rgb = mat(new cv.Mat());
    cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
    const suave = mat(new cv.Mat());
    cv.GaussianBlur(rgb, suave, new cv.Size(5, 5), 0);
    const gris = mat(new cv.Mat());
    cv.cvtColor(suave, gris, cv.COLOR_RGB2GRAY);
    const k3 = mat(cv.Mat.ones(3, 3, cv.CV_8U));
    const ancla = new cv.Point(-1, -1);

    const mapas = [];
    // 1) Bordes por brillo
    const med = mediana(gris.data);
    const canny = mat(new cv.Mat());
    cv.Canny(gris, canny, Math.max(10, 0.5 * med), Math.min(255, 1.2 * med));
    cv.dilate(canny, canny, k3, ancla, 2);
    mapas.push(canny);
    // 2) Bordes por color (cada canal LAB)
    const lab = mat(new cv.Mat());
    cv.cvtColor(suave, lab, cv.COLOR_RGB2Lab);
    const canales = new cv.MatVector();
    cv.split(lab, canales);
    const color = mat(cv.Mat.zeros(h, w, cv.CV_8U));
    const tmp = mat(new cv.Mat());
    for (let i = 0; i < canales.size(); i++) {
      const ch = canales.get(i);
      const mc = mediana(ch.data);
      cv.Canny(ch, tmp, Math.max(8, 0.4 * mc), Math.min(255, 1.0 * mc));
      cv.bitwise_or(color, tmp, color);
      ch.delete();
    }
    canales.delete();
    cv.dilate(color, color, k3, ancla, 2);
    mapas.push(color);
    // 3) Zonas claras (umbral automático de Otsu) + cierre morfológico
    const otsu = mat(new cv.Mat());
    cv.threshold(gris, otsu, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    const k9 = mat(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9)));
    cv.morphologyEx(otsu, otsu, cv.MORPH_CLOSE, k9, ancla, 2);
    mapas.push(otsu);

    let mejor = null;
    for (const mapa of mapas) {
      for (const c of candidatos(cv, mapa, w, h)) if (!mejor || c.score > mejor.score) mejor = c;
    }
    if (!mejor) return null;
    return ordenar(mejor.quad).map(([x, y]) => [clamp01(x / w), clamp01(y / h)]);
  } finally {
    for (const m of mats) m.delete();
  }
}

/** Cuadriláteros candidatos en un mapa binario, con un puntaje (área × rectangularidad). */
function candidatos(cv, mapa, w, h) {
  const contornos = new cv.MatVector();
  const jerarquia = new cv.Mat();
  const salida = [];
  try {
    cv.findContours(mapa, contornos, jerarquia, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    const areaImg = w * h;
    const lista = [];
    for (let i = 0; i < contornos.size(); i++) {
      const c = contornos.get(i);
      lista.push({ i, area: cv.contourArea(c) });
      c.delete();
    }
    lista.sort((a, b) => b.area - a.area);
    const margen = 0.02 * Math.max(w, h);
    for (const { i } of lista.slice(0, 12)) {
      const c = contornos.get(i);
      const hull = new cv.Mat();
      const aprox = new cv.Mat();
      try {
        cv.convexHull(c, hull, false, true);
        const area = cv.contourArea(hull);
        if (area < 0.12 * areaImg || area > 0.985 * areaImg) continue;
        const peri = cv.arcLength(hull, true);
        let quad = null;
        for (const eps of [0.015, 0.02, 0.03, 0.045]) {
          cv.approxPolyDP(hull, aprox, eps * peri, true);
          if (aprox.rows === 4) {
            const d = aprox.data32S;
            quad = [[d[0], d[1]], [d[2], d[3]], [d[4], d[5]], [d[6], d[7]]];
            break;
          }
        }
        // Esquinas redondeadas o dobladas: el rectángulo (girado) mínimo que lo contiene.
        quad ??= rectanguloGirado(cv.minAreaRect(hull));
        // Si toca 3 o 4 bordes de la imagen es el encuadre, no la hoja.
        const pegados = quad.filter(([x, y]) => x < margen || y < margen || x > w - margen || y > h - margen).length;
        if (pegados >= 3) continue;
        const qa = areaPoligono(quad);
        const relleno = qa ? area / qa : 0;
        if (relleno < 0.85) continue;
        salida.push({ score: (qa / areaImg) * Math.min(1, relleno), quad });
      } finally {
        c.delete();
        hull.delete();
        aprox.delete();
      }
    }
  } finally {
    contornos.delete();
    jerarquia.delete();
  }
  return salida;
}

function rectanguloGirado({ center, size, angle }) {
  const a = (angle * Math.PI) / 180;
  const cos = Math.cos(a) / 2;
  const sin = Math.sin(a) / 2;
  const { width: rw, height: rh } = size;
  return [
    [center.x - rw * cos + rh * sin, center.y - rw * sin - rh * cos],
    [center.x + rw * cos + rh * sin, center.y + rw * sin - rh * cos],
    [center.x + rw * cos - rh * sin, center.y + rw * sin + rh * cos],
    [center.x - rw * cos - rh * sin, center.y - rw * sin + rh * cos],
  ];
}

/** Orden: sup-izq, sup-der, inf-der, inf-izq (por suma y diferencia de coordenadas). */
function ordenar(pts) {
  const porSuma = [...pts].sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  const porDif = [...pts].sort((a, b) => a[1] - a[0] - (b[1] - b[0]));
  return [porSuma[0], porDif[0], porSuma[3], porDif[3]];
}

function areaPoligono(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function mediana(datos) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < datos.length; i++) hist[datos[i]]++;
  let acum = 0;
  for (let v = 0; v < 256; v++) {
    acum += hist[v];
    if (acum >= datos.length / 2) return v;
  }
  return 128;
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
