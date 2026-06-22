# Umepay Gestión

App de gestión del estudio de agrimensura **Umepay**: seguimiento de trabajos, ingresos/gastos, presupuestos y balance entre socios. Los datos se guardan en una **Google Sheet** compartida mediante Apps Script, así que los dos socios editan en vivo desde la misma app.

## Cómo está armado

- **`index.html`** — la app (una sola página). Se publica con GitHub Pages.
- **`umepay_apps_script.gs`** — copia de respaldo del backend que corre en Google Sheets (Extensiones → Apps Script). *El que está en producción es el que ya tenés deployado en tu planilla.*
- **`INSTRUCCIONES.md`** — guía completa de instalación y uso.

## Puesta en marcha rápida

1. Abrí la app publicada (la URL de GitHub Pages, tipo `https://USUARIO.github.io/umepay-gestion/`).
2. Andá a la pestaña **⚙ Configuración** y pegá la **URL `/exec`** de tu Apps Script.
3. Tocá **Probar conexión**. Listo: aparecen los trabajos y podés cargar/editar todo.

> La URL del Apps Script queda guardada en cada navegador. Cada socio la pega una sola vez.

## Uso diario

- **Trabajos:** tarjetas con estado y comentario; "↺ Estado" actualiza rápido, "✎ Editar" cambia todo.
- **Ingresos / Gastos:** cada cobro o gasto, quién lo hizo y en qué moneda.
- **Dashboard:** totales ARS/USD, trabajos activos y balance entre socios.
- **Presupuestos:** registro de los enviados y su estado.

Todo se guarda en la Google Sheet; al refrescar, cada uno ve los cambios del otro.
