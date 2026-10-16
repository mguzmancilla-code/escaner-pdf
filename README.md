# Escáner PDF (app web)

Escanea documentos con la cámara, convierte imágenes en PDF de alta calidad y envíalos a otras apps.
Funciona en Safari, se instala en la pantalla de inicio y no necesita Mac ni App Store.
Funciona en el iPhone (sobre todo para escanear) y en el navegador de un computador (para editar con
pantalla grande y ratón). Con sesión iniciada, tus PDF se guardan en tu biblioteca privada en la nube
(Supabase) y están disponibles en ambos lados.

## Instalar en el iPhone
1. Abre la dirección de la app en **Safari**.
2. Toca **Compartir** (cuadrado con flecha) › **Agregar a inicio** (o **Agregar a pantalla de inicio**, según la versión de iOS).
3. Ábrela desde el icono **Escáner PDF**: se ve a pantalla completa, como una app.

## Uso
- **Escanear**: haz la foto → la app detecta los bordes de la hoja (puedes ajustar las 4 esquinas con lupa) → pestaña **Resultado** para el filtro (Original, Nítido, Grises, Blanco y negro) y el giro → **Listo** o **Listo y escanear otra**.
- **Imágenes**: elige varias fotos o archivos a la vez; se agregan como páginas.
- Toca una página para editarla o cambiarla de posición (‹ ›).
- **Calidad del PDF**: tamaño A4 / Carta / Oficio / ajustado a la imagen, márgenes y calidad (Máxima, Alta ≈300 ppp, Media, Compacta).
- **Compartir / Guardar**: abre la hoja de compartir de iOS → *Guardar en Archivos*, WhatsApp, Mail, Google Drive, Imprimir, etc.
- Botón **+** (arriba a la derecha): **Nueva carpeta** o **Importar PDF** (varios a la vez) desde Archivos.
- **Importación masiva**: al importar, eliges la carpeta de destino y ves el progreso. De cada PDF se
  extrae el texto; los que no tienen texto (escaneos) quedan marcados como pendientes de OCR.
- **Cuenta** (ícono de persona, arriba a la izquierda): entra con tu correo y contraseña para usar la nube.
- **Carpetas**: toca una carpeta para entrar; el botón **⋯** permite renombrarla o eliminarla
  (sus documentos no se borran: pasan a «Mis PDF»). En el visor, el botón de carpeta **mueve** el PDF.
- **Combinar PDF** (menú **+**): une varios PDF de tu biblioteca (o importados) en uno, en el orden que elijas.
- **Organizar páginas** (visor › **⋯**): selecciona páginas para girar, eliminar o extraer a un PDF nuevo;
  arrastra ⠿ para reordenar; **Insertar** agrega páginas desde otro PDF, **fotos/archivos** o la **cámara**;
  **Dividir** crea un PDF por página.
- **Anotar / firmar** (visor › **⋯**): agregar texto, tapar (recuadro opaco), resaltar (translúcido),
  firmar a mano alzada o **importar una firma** (imagen PNG), y poner un **timbre** con tus datos y un
  folio único. Paleta de colores; mueve o borra cada anotación. Se guarda como copia nueva.
- **Exportar a imagen** (visor › **⋯**): cada página a PNG o JPEG (varias páginas salen en un ZIP).
- **Convertir** (visor › **⋯**): a Word (.docx, texto editable), Excel (.xlsx, texto por filas) o
  PowerPoint (.pptx, cada página como imagen). Word/Excel trasladan el texto, no el diseño exacto.
- **Computador (panel)**: menú lateral con Escanear, herramientas PDF, Todos los archivos, Recientes,
  tus carpetas (con colores), almacenamiento usado y **tu perfil** abajo (toca para ver la cuenta y poner
  tu nombre). Las carpetas se ven como tarjetas y puedes **arrastrar y soltar** PDF o imágenes.
- **Sin conexión**: puedes seguir escaneando; los PDF quedan pendientes y se suben solos al volver la conexión.

> Sin sesión iniciada, los PDF quedan solo dentro de la app en este iPhone. Con sesión, también quedan en la nube.

## Archivos
```
index.html            Interfaz
styles.css            Estilos (modo claro y oscuro)
js/app.js             Pantallas y flujo
js/imaging.js         Detección de bordes, perspectiva, filtros y giros
js/pdf.js             Generador de PDF (JPEG incrustado sin recomprimir)
js/pdftext.js         Lectura de PDF con pdf.js: texto y vista previa de páginas
js/pdfedit.js         Edición de PDF con pdf-lib: combinar, organizar, dividir
js/vendor/pdf-lib...   Librería pdf-lib (incluida para funcionar sin conexión)
js/vendor/pdfjs/      Librería pdf.js (incluida para funcionar sin conexión)
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
