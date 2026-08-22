# Umepay Gestión — Guía de instalación

App de gestión del estudio (trabajos, ingresos/gastos, presupuestos y balance entre socios), alojada en **GitHub Pages** y con los datos guardados en una **Google Sheet** compartida. Los dos socios editan en vivo, sin commits.

Tenés tres archivos:

- `index.html` — la app (va a GitHub).
- `umepay_apps_script.gs` — el backend (va a Google Sheets).
- `INSTRUCCIONES.md` — esta guía.

Hay que hacer dos cosas: **(A)** crear la base de datos en Google Sheets y **(B)** publicar la app en GitHub Pages. Una sola vez. Después se usa y listo.

---

## Parte A — Base de datos en Google Sheets (~10 min)

### 1. Crear la planilla
Entrá a [drive.google.com](https://drive.google.com) con **agrimensuraumepay@gmail.com**. Creá una hoja de cálculo nueva y nombrala **"Umepay - Gestión"**.

### 2. Pegar el código
En la planilla: menú **Extensiones → Apps Script**. Se abre el editor. Borrá todo lo que haya en `Código.gs` y pegá **todo el contenido** del archivo `umepay_apps_script.gs`. Guardá con **Ctrl + S**.

### 3. Crear las hojas y cargar los trabajos iniciales
Arriba del editor, en el selector de funciones, elegí **`inicializar`** y tocá **▶ Ejecutar**.

- La primera vez Google te pide permisos: **Revisar permisos → elegí la cuenta → Configuración avanzada → Ir a (no seguro) → Permitir**. Es normal, es tu propio script.
- Esto crea las hojas `trabajos`, `movimientos` y `presupuestos`, y carga los **12 trabajos** que ya tenías anotados.

### 4. Publicar como aplicación web
En el editor: **Implementar → Nueva implementación**.

- Engranaje (Tipo) → **Aplicación web**.
- **Ejecutar como:** Yo (agrimensuraumepay@gmail.com).
- **Quién tiene acceso:** **Cualquier usuario**. *(Es necesario para que la app pueda leer/escribir. La URL es larga y secreta; no la publiques.)*
- **Implementar** → autorizá de nuevo si lo pide.
- **Copiá la URL** que termina en `/exec`. La vas a usar en la Parte B, paso 4.

> Si más adelante cambiás el código `.gs`, tenés que hacer **Implementar → Gestionar implementaciones → editar (lápiz) → Versión: Nueva → Implementar**. Así la URL sigue siendo la misma.

---

## Parte B — Publicar la app en GitHub Pages (~10 min)

### 1. Crear el repositorio
Entrá a [github.com](https://github.com) (creá una cuenta gratis si no tenés). Botón **New repository**.

- Nombre: `umepay-gestion` (o el que quieras).
- **Público** (GitHub Pages gratis necesita repo público).
- Tildá **Add a README** y creá el repo.

### 2. Subir el index.html
Dentro del repo: **Add file → Upload files**. Arrastrá el archivo **`index.html`**. Abajo, **Commit changes**.

> Importante: el archivo tiene que llamarse exactamente `index.html` para que se abra solo.

### 3. Activar GitHub Pages
En el repo: **Settings → Pages** (menú izquierdo).

- **Source:** Deploy from a branch.
- **Branch:** `main` y carpeta `/ (root)` → **Save**.
- Esperá 1–2 minutos. Arriba aparece la URL pública, tipo:
  `https://TU-USUARIO.github.io/umepay-gestion/`

Esa es la dirección que abren vos y tu colega desde cualquier compu o celular.

### 4. Conectar la app con la planilla
Abrí esa URL. Andá a la pestaña **⚙ Configuración**. Pegá en el casillero la **URL `/exec`** que copiaste en la Parte A, paso 4. Tocá **Probar conexión**.

- Si dice "Conexión exitosa ✓" y aparecen los 12 trabajos: listo. 🎉
- La URL queda guardada en ese navegador. **Tu colega tiene que pegar la misma URL una vez** en su navegador (mandásela por privado).

---

## Parte C — Conectar el calendario con Google Calendar (~5 min)

Los eventos que cargás en la pestaña **Calendario** de la app se copian solos a un calendario de Google llamado **"Umepay - Estudio"**, así los ves en el celular. Es de ida nomás: de la app al calendario, no al revés.

### 1. Actualizar el código del script

1. Abrí la Google Sheet → **Extensiones → Apps Script**.
2. Clic en el código, **Ctrl+A** (selecciona todo) y **Ctrl+V** con el contenido nuevo de `umepay_apps_script.gs`.
3. **Ctrl+S** para guardar.

### 2. Darle permiso para usar el calendario

1. Arriba, en el desplegable de funciones (dice `doGet` o similar), elegí **`sincronizarTodo`**.
2. Clic en **▷ Ejecutar**.
3. Google pide permisos: **Revisar permisos** → elegí la cuenta del estudio → **Configuración avanzada** → **Ir a Umepay - Gestión (no seguro)** → **Permitir**.
   > La pantalla de "no seguro" aparece porque el script es tuyo y Google no lo verificó. Es normal.
4. Abajo, en el registro, va a decir cuántos eventos pasaron al calendario. Esta función copia también todos los eventos viejos.

### 3. Volver a publicar el script

1. **Implementar → Gestionar implementaciones**.
2. Clic en el **lápiz** (Editar) de la implementación que ya existe.
3. En **Versión** elegí **Nueva versión** → **Implementar**.
4. La URL `/exec` **no cambia**: no hay que tocar nada en la app.

### 4. Verlo en el celular

Abrí Google Calendar en el teléfono → menú (☰) → fijate que **"Umepay - Estudio"** esté tildado. Si no aparece todavía, bajá hasta la cuenta del estudio y activalo.

**Cómo se comporta:**
- Evento con hora → dura 1 hora.
- Evento sin hora → queda como "todo el día".
- El aviso lo elegís evento por evento, en **"Aviso en el celular"**: sin aviso, 5/10/30 minutos, 1/2/3 horas, el día anterior, 2 días o 1 semana antes. Dejándolo en **Automático** avisa el día antes y 1 hora antes (si es de todo el día, a las 9 de la mañana del día anterior).
- En los eventos de todo el día, los avisos de un día o más suenan a las 9 de la mañana, no a la medianoche.
- El campo **Lugar** va como ubicación del evento (el celular te ofrece el mapa).
- Si editás el evento en la app, se actualiza el mismo evento (no se duplica). Si lo borrás, se borra del calendario.
- Marcado como *Hecho* aparece con ✔ adelante; *No se hizo*, con ✘.

---

## Cómo se usa día a día

- **Trabajos:** ves cada trabajo como tarjeta con su estado y comentario. "↺ Estado" actualiza rápido el estado y deja una nota fechada. "✎ Editar" cambia todos los datos.
- **Ingresos / Gastos:** registrás cada cobro o gasto, quién lo hizo (Santiago / Julia) y en qué moneda.
- **Dashboard:** totales de ARS y USD, trabajos activos y el **balance entre socios** (quién le debe a quién para equilibrar gastos).
- **Presupuestos:** registro de los que enviás y su estado.

Todo se guarda solo en la Google Sheet. Cuando tu colega refresca, ve tus cambios.

---

## Preguntas frecuentes

**¿Es seguro?** Los datos están en tu Google Drive privado. La URL del script es secreta: cualquiera que la tenga puede leer/escribir, así que compartila solo entre ustedes y no la subas a GitHub.

**¿Puedo cambiar "Santiago" y "Julia"?** Sí, en `index.html` buscá esos nombres (están en los `<option>` del formulario de movimientos y en el dashboard) y reemplazalos. Volvé a subir el archivo a GitHub.

**¿Y si quiero ver la planilla directamente?** Abrís la Google Sheet normal: cada hoja (`trabajos`, `movimientos`, `presupuestos`) tiene los datos en columnas. Podés editar ahí también, pero es más cómodo desde la app.

**¿Pierdo el tablero anterior?** No. Aquel `tablero-trabajos.html` sigue funcionando aparte; estos 12 trabajos ya quedaron cargados acá, así que podés dejar de usarlo.
