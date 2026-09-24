# Escáner PDF (app web para iPhone)

Escanea documentos con la cámara, convierte imágenes en PDF de alta calidad y envíalos a otras apps.
Funciona en Safari, se instala en la pantalla de inicio y no necesita Mac, App Store ni conexión.
Todo el procesado se hace en el propio iPhone: las imágenes y los PDF no se suben a ningún servidor.

## Instalar en el iPhone
1. Abre la dirección de la app en **Safari**.
2. Pulsa **Compartir** (cuadrado con flecha) › **Añadir a pantalla de inicio**.
3. Ábrela desde el icono **Escáner PDF**: se ve a pantalla completa, como una app.

## Uso
- **Escanear**: haz la foto → la app detecta los bordes de la hoja (puedes ajustar las 4 esquinas con lupa) → pestaña **Resultado** para el filtro (Original, Mejorado, Grises, B/N) y el giro → **Listo** o **Listo y escanear otra**.
- **Imágenes**: elige varias fotos o archivos a la vez; se añaden como páginas.
- Toca una página para editarla o cambiarla de posición (‹ ›).
- **Calidad del PDF**: tamaño A4 / Carta / Oficio / ajustado a la imagen, márgenes y calidad (Máxima, Alta ≈300 ppp, Media, Compacta).
- **Compartir / Guardar**: abre la hoja de compartir de iOS → *Guardar en Archivos*, WhatsApp, Mail, Google Drive, Imprimir, etc.
- Botón de importar (arriba a la derecha): añade PDF que ya tengas en Archivos.

> Los PDF se guardan dentro de la app (almacenamiento del navegador). Para conservar una copia segura,
> usa **Compartir / Guardar › Guardar en Archivos** o envíalos a otra app.

## Archivos
```
index.html            Interfaz
styles.css            Estilos (modo claro y oscuro)
js/app.js             Pantallas y flujo
js/imaging.js         Detección de bordes, perspectiva, filtros y giros
js/pdf.js             Generador de PDF (JPEG incrustado sin recomprimir)
js/db.js              Almacenamiento local (IndexedDB)
sw.js                 Funcionamiento sin conexión (sube VERSION al publicar cambios)
manifest.webmanifest  Datos de instalación
icons/                Iconos
```
