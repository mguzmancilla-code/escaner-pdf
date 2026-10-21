// Sellos dinámicos personalizados: diseño (estilo, color, contenido, fuente,
// tamaño) y vista previa en SVG. «Dinámico» = la fecha y la identidad se
// completan en el momento de timbrar. El dibujo en el PDF está en pdfedit.js.

export const ESTILOS = [
  { id: 'texto', label: 'Solo texto' },
  { id: 'recuadro', label: 'Recuadro' },
  { id: 'flecha-izq', label: 'Flecha a la izquierda' },
  { id: 'flecha-der', label: 'Flecha a la derecha' },
  { id: 'ovalo', label: 'Óvalo' },
];

export const COLORES = ['#e5484d', '#30a46c', '#3b6fe0', '#5b5b66'];

export const FECHAS = [
  { id: 'ninguna', label: 'Ninguno' },
  { id: 'fecha', label: '21-10-2026' },
  { id: 'fecha-hora', label: '21-10-2026 10:30' },
  { id: 'larga', label: '21 de octubre de 2026' },
  { id: 'larga-hora', label: '21 de octubre de 2026, 10:30' },
];

export const IDENTIDADES = [
  { id: 'ninguna', label: 'Ninguno' },
  { id: 'nombre', label: 'Mi nombre' },
  { id: 'correo', label: 'Mi correo' },
  { id: 'nombre-correo', label: 'Nombre y correo' },
];

export const FUENTES = [
  { id: 'Helvetica', label: 'Sans (Helvetica)', css: 'Helvetica, Arial, sans-serif' },
  { id: 'Times', label: 'Serif (Times)', css: '"Times New Roman", Times, serif' },
  { id: 'Courier', label: 'Mono (Courier)', css: '"Courier New", Courier, monospace' },
];

export const TAMANOS = ['auto', 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36];

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export const MM = 72 / 25.4; // puntos PDF por milímetro

export function nuevoSello(extra = {}) {
  return {
    id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    nombre: 'Sello nuevo',
    categoria: '',
    texto: 'Texto aquí',
    estilo: 'recuadro',
    color: COLORES[0],
    soloBordes: false,
    fecha: 'ninguna',
    identidad: 'ninguna',
    fuente: 'Helvetica',
    tamano: 'auto',
    vertical: false,
    anchoMm: 52,
    altoMm: 16,
    ...extra,
  };
}

/** Sellos de ejemplo para empezar (se pueden editar o borrar). */
export function sellosIniciales() {
  return [
    nuevoSello({ nombre: 'Recibido', categoria: 'Estándar', texto: 'RECIBIDO', color: '#30a46c', fecha: 'fecha-hora', identidad: 'nombre', anchoMm: 56, altoMm: 18 }),
    nuevoSello({ nombre: 'Aprobado', categoria: 'Estándar', texto: 'APROBADO', color: '#3b6fe0', fecha: 'fecha', identidad: 'nombre', anchoMm: 56, altoMm: 18 }),
    nuevoSello({ nombre: 'Pagado', categoria: 'Estándar', texto: 'PAGADO', color: '#30a46c', estilo: 'ovalo', fecha: 'fecha', anchoMm: 46, altoMm: 22 }),
    nuevoSello({ nombre: 'Confidencial', categoria: 'Estándar', texto: 'CONFIDENCIAL', color: '#e5484d', anchoMm: 60, altoMm: 14 }),
    nuevoSello({ nombre: 'Copia', categoria: 'Estándar', texto: 'COPIA', color: '#5b5b66', estilo: 'texto', anchoMm: 36, altoMm: 14 }),
  ];
}

function textoFecha(tipo, d) {
  const p = (v) => String(v).padStart(2, '0');
  const corta = `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
  const hora = `${p(d.getHours())}:${p(d.getMinutes())}`;
  const larga = `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
  return { fecha: corta, 'fecha-hora': `${corta} ${hora}`, larga, 'larga-hora': `${larga}, ${hora}` }[tipo] ?? '';
}

function textoIdentidad(tipo, { nombre = '', correo = '' }) {
  if (tipo === 'nombre') return nombre || correo;
  if (tipo === 'correo') return correo;
  if (tipo === 'nombre-correo') return [nombre, correo].filter(Boolean).join(' · ');
  return '';
}

/** Líneas del sello con los datos del momento: [texto principal, detalle opcional]. */
export function lineasSello(s, datos = {}, fecha = new Date()) {
  const id = textoIdentidad(s.identidad, datos);
  const f = textoFecha(s.fecha, fecha);
  const detalle = [id, f].filter(Boolean).join(', ');
  return detalle ? [s.texto || ' ', detalle] : [s.texto || ' '];
}

/** Ancho aproximado de un texto (en unidades del tamaño de letra). */
export function anchoTexto(texto, fuente, negrita = false) {
  if (fuente === 'Courier') return texto.length * 0.6;
  let w = 0;
  for (const ch of texto) {
    if (/[ilI.,:;'!|]/.test(ch)) w += 0.28;
    else if (/[mwMW@]/.test(ch)) w += 0.86;
    else if (/[A-ZÁÉÍÓÚÑ0-9]/.test(ch)) w += 0.68;
    else if (ch === ' ') w += 0.28;
    else w += 0.55;
  }
  return w * (negrita ? 1.06 : 1) * (fuente === 'Times' ? 0.92 : 1);
}

/**
 * Geometría común (vista previa y PDF), en puntos, para un sello horizontal de
 * w × h: zona útil para el texto y tamaño de cada línea.
 */
export function disenoSello(s, lineas, w, h) {
  const borde = s.estilo === 'texto' ? 0 : Math.max(0.8, Math.min(w, h) * 0.06);
  const punta = s.estilo.startsWith('flecha') ? h * 0.32 : 0;
  const padX = s.estilo === 'ovalo' ? w * 0.14 : borde + h * 0.14;
  const padY = s.estilo === 'ovalo' ? h * 0.16 : borde + h * 0.1;
  const x0 = padX + (s.estilo === 'flecha-izq' ? punta : 0);
  const x1 = w - padX - (s.estilo === 'flecha-der' ? punta : 0);
  const util = { x0, x1, y0: padY, y1: h - padY };
  const anchoUtil = Math.max(1, x1 - x0);
  const altoUtil = Math.max(1, util.y1 - util.y0);
  const dos = lineas.length > 1;
  const partes = dos ? [0.64, 0.36] : [1];
  const tamanos = lineas.map((ln, i) => {
    const porAlto = altoUtil * partes[i] * 0.86;
    const porAncho = anchoUtil / Math.max(0.5, anchoTexto(ln, s.fuente, i === 0));
    const auto = Math.min(porAlto, porAncho);
    if (s.tamano === 'auto' || i > 0) return i > 0 && s.tamano !== 'auto' ? Math.min(auto, s.tamano * 0.5) : auto;
    return Math.min(s.tamano, porAncho); // un tamaño fijo nunca desborda el sello
  });
  // Posición vertical (línea base) de cada línea, centradas en la zona útil.
  const altoTotal = tamanos.reduce((a, t) => a + t * 1.08, 0);
  let y = util.y0 + (altoUtil - altoTotal) / 2;
  const bases = tamanos.map((t) => {
    y += t * 1.08;
    return y - t * 0.22; // de arriba hacia abajo
  });
  return { borde, punta, util, tamanos, bases };
}

/** Contorno del sello como «path» SVG (coordenadas con origen arriba-izquierda). */
export function contornoSello(s, w, h, b) {
  const m = b / 2;
  if (s.estilo === 'recuadro') {
    const r = Math.min(h * 0.18, w * 0.18);
    return `M${m + r},${m} H${w - m - r} Q${w - m},${m} ${w - m},${m + r} V${h - m - r} Q${w - m},${h - m} ${w - m - r},${h - m} H${m + r} Q${m},${h - m} ${m},${h - m - r} V${m + r} Q${m},${m} ${m + r},${m} Z`;
  }
  const p = h * 0.32;
  if (s.estilo === 'flecha-izq') return `M${m + p},${m} H${w - m} V${h - m} H${m + p} L${m},${h / 2} Z`;
  if (s.estilo === 'flecha-der') return `M${m},${m} H${w - m - p} L${w - m},${h / 2} L${w - m - p},${h - m} H${m} Z`;
  if (s.estilo === 'ovalo') {
    const rx = w / 2 - m;
    const ry = h / 2 - m;
    return `M${m},${h / 2} A${rx},${ry} 0 1,0 ${w - m},${h / 2} A${rx},${ry} 0 1,0 ${m},${h / 2} Z`;
  }
  return '';
}

const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

/** Vista previa del sello en SVG (respeta la orientación vertical). */
export function svgSello(s, lineas) {
  const w = s.anchoMm * MM;
  const h = s.altoMm * MM;
  const d = disenoSello(s, lineas, w, h);
  const fuente = FUENTES.find((f) => f.id === s.fuente)?.css ?? FUENTES[0].css;
  const centro = (d.util.x0 + d.util.x1) / 2;
  const camino = contornoSello(s, w, h, d.borde);
  const forma = camino
    ? `<path d="${camino}" fill="${s.soloBordes ? 'none' : s.color}" fill-opacity="${s.soloBordes ? 0 : 0.12}" stroke="${s.color}" stroke-width="${d.borde}" stroke-linejoin="round"/>`
    : '';
  const textos = lineas
    .map(
      (ln, i) =>
        `<text x="${centro}" y="${d.bases[i]}" font-family='${fuente}' font-weight="${i === 0 ? 700 : 400}" font-size="${d.tamanos[i]}" fill="${s.color}" text-anchor="middle">${esc(ln)}</text>`,
    )
    .join('');
  const [vw, vh] = s.vertical ? [h, w] : [w, h];
  const giro = s.vertical ? ` transform="translate(${h} 0) rotate(90)"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="xMidYMid meet"><g${giro}>${forma}${textos}</g></svg>`;
}
