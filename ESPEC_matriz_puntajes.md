# Matriz de puntajes catastral — módulo para umepay-gestion

Especificación para construir el módulo. Escrita el 30-10-2026 desde otra conversación,
para no mezclar contextos. Todo lo que está acá es lo que hace falta saber: no hay que
volver a leer la normativa.

---

## 1. Qué es y para qué

Cuando se declaran mejoras en un trámite de Catastro de Córdoba (PDT), por **cada bloque
constructivo** hay que completar una **matriz de puntajes**: una grilla donde se tilda la
calidad de cada ítem constructivo (fachada, techos, pisos, baños…). La suma de los puntos
da el **puntaje del bloque**, que es lo que determina su valuación fiscal.

Hoy esa matriz sólo existe **dentro de la PDT**, en el escritorio. El problema: los datos
se relevan **en el campo** y después hay que acordarse de todo al volver.

**Lo que hace falta:** poder completar la matriz en la tablet, en el campo, sin internet,
y después volcarla a la PDT.

---

## 2. Dónde encaja en la app

La app ya resuelve casi toda la infraestructura:

| Lo que hace falta | Lo que ya existe |
|---|---|
| Pantalla nueva | pestañas en `index.html` (`data-tab` + `showTab()`) — hoy: dashboard, trabajos, movimientos, presupuestos, apuntes, setup |
| Guardar los datos | Apps Script con CRUD genérico `getAll/insert/update/delete` + `ensureColumns` sobre la Sheet "Umepay - Gestión" (Drive → AgriApp) |
| Vincular al trabajo | hoja `trabajos`, que ya tiene los trabajos cargados |
| Funcionar instalada | `manifest.webmanifest` + `sw.js` (PWA ya instalable) |

**Pestaña nueva:** `data-tab="matrices"`, con el mismo patrón que las demás.

**Hoja nueva** en la Sheet, sugerida `matrices`. Una fila por matriz completada:

```
id · trabajo_id · bloque · codigo_matriz · marcas · puntaje · fecha · nota · created_at
```

`marcas` guardado como JSON compacto (`"0|0|3,1|1|0,…"` o un objeto), así no hay que crear
una columna por casilla. El `ensureColumns` del backend crea las columnas solo, así que
**no hace falta redeploy del `.gs`** salvo que se agregue una acción nueva.

**Vínculo con trabajos:** `trabajo_id` apunta a la hoja `trabajos`. Un trabajo puede tener
varias matrices (una por bloque). En la ficha del trabajo conviene mostrar las matrices
cargadas con su puntaje.

---

## 3. Las reglas (R.N. 2/2025, punto 7.3.6)

Esto es lo que el formulario de la PDT no explica y hay que replicar:

- Por cada ítem se marca la tipología que corresponde al bloque.
- **Un ítem puede pedir más de una marca.** El formulario lo muestra como varias filas de
  casillas bajo el mismo ítem. Las marcas pueden ir en la misma categoría o en distintas,
  según las tipologías dominantes.
- **Matrices de 5 columnas** (categorías 1 a 5): **8 · 6 · 4 · 2 · 1** puntos.
- **Matrices de 4 columnas** (categorías 2 a 5): **6 · 4 · 2 · 1** puntos.
- **Toda matriz debe tener exactamente 16 marcas.** Ni una más ni una menos.
- El puntaje del bloque es la suma de los puntos de las celdas marcadas.
- Rango posible: **16 a 128 puntos**. Una **vivienda estándar de categoría media = 64**
  (puntos 4.3 y 4.4 de la misma norma).
- **Semicubiertos** vinculados funcionalmente a un bloque cubierto (aleros, galerías,
  quinchos sin cerramiento lateral): **10 puntos menos** que el bloque principal, siempre
  que mantengan equivalencia constructiva (punto 7.3.7). Un quincho independiente o un
  cobertizo aislado lleva su propia matriz.

### Puntajes por defecto (punto 7.3.8)

Útiles para comparar contra lo que el SIT ya tiene cargado por teledetección:

| Caso | Puntos |
|---|---|
| Vivienda rural principal | 70 |
| Vivienda rural complementaria | 60 |
| Vivienda urbana hasta 200 m² | 64 |
| Vivienda urbana 201 a 400 m² | 86 |
| Vivienda urbana de más de 400 m² | según matriz |
| Tinglados y cobertizos | 20 |
| Depósitos o galpones | 32 |
| Quinchos cerrados | 32 |
| Quinchos abiertos | 20 |
| Locales comerciales | 50 |

### Puntaje promedio ponderado (punto 7.3.9)

Cuando hay varios bloques en una parcela:

```
PPP = (P₁ × SupCub₁ + P₂ × SupCub₂ + … + Pₙ × SupCubₙ) / SupCubTotal
```

Vale la pena calcularlo en la app: es el número que resume la parcela entera.

---

## 4. Las cuatro matrices

Los códigos y la descripción son los que muestra el desplegable de la PDT. La estructura
(ítems y cantidad de marcas) está tomada de las capturas del formulario real, no de la
norma, así que **coincide exactamente con lo que hay que cargar después**.

### E5 — Vivienda, hoteles, comercios y oficinas (R.N. 5/2014 A.III)
Categorías **1 a 5** → 8 · 6 · 4 · 2 · 1

| # | Ítem | Marcas |
|---|---|---|
| 01 | Fachada | 1 |
| 02 | Techos | 1 |
| 03 | Cielorraso | 1 |
| 04 | Muros internos | 2 |
| 05 | Pisos | 2 |
| 06 | Baños | 2 |
| 07 | Cocina | 2 |
| 08 | Instalaciones | 2 |
| 09 | Carpintería | 2 |
| 10 | Placares | 1 |

### E6 — Industria y Galpones (R.N. 5/2014 A.IV)
Categorías **2 a 5** → 6 · 4 · 2 · 1 · **no tiene categoría 1**

| # | Ítem | Marcas |
|---|---|---|
| 01 | Fachada | 1 |
| 02 | Estructura | 2 |
| 03 | Terminaciones internas | 2 |
| 04 | Pisos | 2 |
| 05 | Cielorraso | 1 |
| 06 | Baños | 1 |
| 07 | Instalaciones | 3 |
| 08 | Carpintería | 2 |
| 09 | Cocina | 2 |

### E7 — Estaciones de servicio (R.N. 5/2014 A.V)
Categorías **2 a 5** → 6 · 4 · 2 · 1

| # | Ítem | Marcas |
|---|---|---|
| 01 | Fachada | 1 |
| 02 | Estructura | 2 |
| 03 | Cubierta | 2 |
| 04 | Cielorraso | 1 |
| 05 | Terminaciones internas | 1 |
| 06 | Pisos | 2 |
| 07 | Baños | 2 |
| 08 | Instalaciones generales | 2 |
| 09 | Instalaciones especiales | 2 |
| 10 | Carpintería | 1 |

### E8 — Superficies Comunes, Edificios PH en altura (R.N. 5/2014 A.VI)
Categorías **1 a 5** → 8 · 6 · 4 · 2 · 1

| # | Ítem | Marcas |
|---|---|---|
| 01 | Fachada | 1 |
| 02 | Techos | 1 |
| 03 | Cielorraso | 1 |
| 04 | Muros internos | 2 |
| 05 | Pisos | 2 |
| 06 | Instalaciones | 3 |
| 07 | Carpintería | 2 |
| 08 | Estructura | 1 |
| 09 | Ascensores | 1 |
| 10 | Servicios especiales | 2 |

Las cuatro suman 16 marcas. Está verificado.

> La norma trae una quinta matriz, **7.3.4 Cocheras, garages y playas de estacionamiento**,
> que no aparece en el desplegable de la PDT. Se deja afuera.

---

## 5. El archivo de datos

**`matrices_puntajes_catastro.json`**, en la raíz del repo, al lado de este documento.

```jsonc
{
  "fuente": "R.N. 2/2025 … punto 7.3",
  "puntaje_min": 16, "puntaje_max": 128, "vivienda_media": 64,
  "matrices": [
    {
      "codigo": "E5",
      "descripcion": "Vivienda, hoteles, comercios y oficinas R.N. 5/2014 A.III",
      "articulo_rn2_2025": "7.3.1",
      "categorias": [1,2,3,4,5],
      "puntos": [8,6,4,2,1],
      "marcas_totales": 16,
      "items": [
        { "n": 1, "nombre": "Fachada", "marcas": 1,
          "opciones": { "1": ["Revestimiento total de mármol o granito natural", …],
                        "2": [...], "3": [...], "4": [...], "5": [...] },
          "opciones_cargadas": true }
      ]
    }
  ]
}
```

Las **opciones** son los textos de cada celda: lo que describe cada nivel de calidad
("Revoque texturado, salpricrete", "Chapa de fibrocemento", "Grifería línea base con
mezclador"…). Salieron de extraer las tablas del PDF de la R.N. 2/2025.

**Estado de carga:**

| Matriz | Opciones |
|---|---|
| E5 | completas, verificadas |
| E6 | falta el ítem **Cocina** |
| E7 | faltan **Cielorraso, Pisos, Baños, Instalaciones generales, Carpintería** |
| E8 | faltan **Carpintería, Estructura, Ascensores, Servicios especiales** |

Cada ítem trae `opciones_cargadas: true/false`. **La estructura de las cuatro matrices está
completa y es correcta** — lo que falta son textos descriptivos de algunas celdas. La app
debe funcionar igual con un ítem sin opciones: muestra las categorías con las casillas
desnudas y el usuario marca por criterio propio.

Para completar lo que falta: `RN_2-2025_Normas_Tecnicas_Catastrales.pdf`, páginas 25 a 36
(en `C:\Users\julia\claude\tramitacion-planos`).

---

## 6. Requisitos

**Offline de verdad.** Se usa en el campo, donde no hay señal. Esto es lo único que la
infraestructura actual no cubre: hoy el guardado va directo a Apps Script por POST, y el
`sw.js` deja pasar los POST sin tocarlos.

- La matriz se completa y se guarda **local primero** (IndexedDB o localStorage), siempre.
- Lo pendiente de subir se encola y se sincroniza cuando vuelve la conexión, con un
  indicador visible de qué está sin sincronizar.
- Agregar `matrices_puntajes_catastro.json` a la lista `ASSETS` del `sw.js` y subir la
  versión del caché (`umepay-v3` → `v4`), para que el archivo esté disponible sin red.
- Que la lista de trabajos quede cacheada, para poder elegir a qué trabajo pertenece la
  matriz estando sin señal.

**Descargable.** Un botón que baje lo completado. Acá sí funciona `<a download>` con un
blob, porque es la PWA propia en GitHub Pages y no un sandbox. Formatos útiles: **texto**
para pegar en la PDT, y **CSV o JSON** para archivar junto al trabajo.

**Pensada para tablet al sol y con una mano.** Targets de 44 px como mínimo, contraste
alto, nada de hover, y el total siempre visible sin scrollear.

---

## 7. Pantallas

**Lista.** Las matrices cargadas, agrupadas por trabajo: bloque, código, puntaje, estado
de sincronización. Botón para una nueva.

**Edición.** Elegir trabajo (de la hoja `trabajos`), escribir el bloque (ej. "1 · casa
79,04 m²") y el código de matriz. Después los ítems, cada uno con sus categorías y las
opciones como casillas.

Durante la carga, siempre a la vista:

- **marcas / 16** — con aviso claro si faltan o sobran
- **puntaje acumulado**
- **diferencia contra 64**, que es la referencia de vivienda media

Por ítem conviene mostrar cuántas marcas lleva contra cuántas pide, porque es el error
más fácil de cometer.

**Resumen.** El texto para volcar a la PDT: por ítem, qué categoría se marcó y con qué
texto, y abajo el total. Con botón de copiar y de descargar.

---

## 8. Validaciones

- No dejar cerrar una matriz con distinto de 16 marcas (avisar, no bloquear el guardado
  parcial — en el campo se completa a medias y se termina después).
- Avisar si un ítem tiene más marcas de las que pide.
- Avisar si el puntaje se va de 16-128: significa que hay un error de conteo.
- Al elegir E6 o E7, recordar que **no tienen categoría 1**.

---

## 9. Prototipo que ya existe

Hay una versión web de una sola pantalla, publicada como artefacto, que ya implementa el
tildado, el conteo de 16 marcas, el cálculo del puntaje y el resumen copiable:

**https://claude.ai/artifact/YQ7k2FgjC2uJRJ5yig6bmq**

Sirve para ver el comportamiento buscado. **No sirve como base de código**: usa un mapeo
de códigos viejo (anterior a las capturas del formulario) y guarda sólo en localStorage,
sin vínculo con los trabajos ni descarga. La estructura buena es la de este documento y la
del JSON.
