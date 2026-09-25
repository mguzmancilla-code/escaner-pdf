# Escáner PDF (app web para iPhone)

Escanea documentos con la cámara, convierte imágenes en PDF de alta calidad y envíalos a otras apps.
Funciona en Safari, se instala en la pantalla de inicio y no necesita Mac ni App Store.
El escaneo y el procesado de imágenes se hacen en el propio iPhone. Si inicias sesión, tus PDF se guardan
además en tu biblioteca privada en la nube (Supabase), organizados en carpetas.

## Instalar en el iPhone
1. Abre la dirección de la app en **Safari**.
2. Toca **Compartir** (cuadrado con flecha) › **Agregar a inicio** (o **Agregar a pantalla de inicio**, según la versión de iOS).
3. Ábrela desde el icono **Escáner PDF**: se ve a pantalla completa, como una app.

## Uso
- **Escanear**: haz la foto → la app detecta los bordes de la hoja (puedes ajustar las 4 esquinas con lupa) → pestaña **Resultado** para el filtro (Original, Mejorado, Grises, B/N) y el giro → **Listo** o **Listo y escanear otra**.
- **Imágenes**: elige varias fotos o archivos a la vez; se agregan como páginas.
- Toca una página para editarla o cambiarla de posición (‹ ›).
- **Calidad del PDF**: tamaño A4 / Carta / Oficio / ajustado a la imagen, márgenes y calidad (Máxima, Alta ≈300 ppp, Media, Compacta).
- **Compartir / Guardar**: abre la hoja de compartir de iOS → *Guardar en Archivos*, WhatsApp, Mail, Google Drive, Imprimir, etc.
- Botón **+** (arriba a la derecha): **Nueva carpeta** o **Importar PDF** que ya tengas en Archivos.
- **Cuenta** (ícono de persona, arriba a la izquierda): entra con tu correo y contraseña para usar la nube.
- **Carpetas**: toca una carpeta para entrar; el botón **⋯** permite renombrarla o eliminarla
  (sus documentos no se borran: pasan a «Mis PDF»). En el visor, el botón de carpeta **mueve** el PDF.
- **Sin conexión**: puedes seguir escaneando; los PDF quedan pendientes y se suben solos al volver la conexión.

> Sin sesión iniciada, los PDF quedan solo dentro de la app en este iPhone. Con sesión, también quedan en la nube.

## Archivos
```
index.html            Interfaz
styles.css            Estilos (modo claro y oscuro)
js/app.js             Pantallas y flujo
js/imaging.js         Detección de bordes, perspectiva, filtros y giros
js/pdf.js             Generador de PDF (JPEG incrustado sin recomprimir)
js/db.js              Almacenamiento local (IndexedDB)
js/auth.js            Cuenta: inicio de sesión con Supabase
js/cloud.js           Biblioteca en la nube: carpetas, subida, descarga
js/config.js          URL y clave pública del proyecto de Supabase
js/vendor/supabase.js Librería supabase-js (incluida para funcionar sin conexión)
supabase/migrations/  Migraciones SQL (se ejecutan en el SQL Editor de Supabase)
sw.js                 Funcionamiento sin conexión (sube VERSION al publicar cambios)
manifest.webmanifest  Datos de instalación
icons/                Iconos
```
