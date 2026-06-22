/****************************************************************************
 *  UMEPAY — GESTIÓN DEL ESTUDIO
 *  Backend en Google Apps Script para la app "Umepay Gestión" (GitHub Pages)
 *
 *  Hojas que usa: "trabajos", "movimientos", "presupuestos"
 *  La app web (index.html) se conecta a este script vía fetch.
 *
 *  ── CÓMO USARLO (resumen, ver guía completa en INSTRUCCIONES.md) ──
 *  1. Pegá este código en la Google Sheet → Extensiones → Apps Script.
 *  2. Guardá (Ctrl+S).
 *  3. (Opcional) Ejecutá la función  inicializar  una vez para crear las
 *     hojas con sus columnas y cargar los 12 trabajos iniciales.
 *  4. Implementar → Nueva implementación → Aplicación web
 *        Ejecutar como: Yo
 *        Quién tiene acceso: Cualquier usuario
 *     Copiá la URL /exec y pegala en la pestaña "Configuración" de la app.
 ****************************************************************************/

var HOJAS = ['trabajos', 'movimientos', 'presupuestos'];

// Orden y nombre de columnas de cada hoja (solo para que queden prolijas).
var COLUMNAS = {
  trabajos: ['id', 'cliente', 'tipo_trabajo', 'descripcion', 'estado',
             'comentario', 'fecha_estado', 'fecha_inicio', 'monto_ars',
             'monto_usd', 'presupuesto_ref', 'forma_cobro', 'created_at'],
  movimientos: ['id', 'tipo', 'fecha', 'descripcion', 'monto', 'moneda',
                'forma_pago', 'quien_pago', 'categoria', 'trabajo_id', 'created_at'],
  presupuestos: ['id', 'cliente', 'fecha', 'tipo_trabajo', 'monto_ars',
                 'monto_usd', 'estado', 'trabajo_id', 'notas', 'created_at']
};

/* ========================================================================
 *  ENTRADAS HTTP
 * ===================================================================== */
function doGet(e) {
  return ruta((e && e.parameter) ? e.parameter : {});
}

function doPost(e) {
  var req = {};
  try {
    if (e && e.postData && e.postData.contents) {
      req = JSON.parse(e.postData.contents);
    }
  } catch (err) {
    return json({ error: 'No se pudo leer el cuerpo: ' + err });
  }
  return ruta(req);
}

function ruta(req) {
  try {
    var action = req.action;
    var out;
    switch (action) {
      case 'getAll':       out = getAll(req.sheet); break;
      case 'getDashboard': out = getDashboard(); break;
      case 'insert':       out = withLock(function () { return insertRow(req.sheet, req.data); }); break;
      case 'update':       out = withLock(function () { return updateRow(req.sheet, req.id, req.data); }); break;
      case 'delete':       out = withLock(function () { return deleteRow(req.sheet, req.id); }); break;
      default:             out = { error: 'Acción desconocida: ' + action };
    }
    return json(out);
  } catch (err) {
    return json({ error: String(err && err.message ? err.message : err) });
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Evita que dos guardados simultáneos pisen la planilla.
function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); }
  finally { lock.releaseLock(); }
}

/* ========================================================================
 *  HOJAS
 * ===================================================================== */
function getSheet(name) {
  if (HOJAS.indexOf(name) < 0) throw new Error('Hoja inválida: ' + name);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(COLUMNAS[name] || ['id', 'created_at']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function getHeaders(sh) {
  var lastCol = sh.getLastColumn();
  if (lastCol < 1) { sh.appendRow(['id', 'created_at']); return ['id', 'created_at']; }
  return sh.getRange(1, 1, 1, lastCol).getValues()[0];
}

// Agrega columnas nuevas si la app manda campos que todavía no existen.
function ensureColumns(sh, headers, keys) {
  keys.forEach(function (k) {
    if (headers.indexOf(k) < 0) {
      headers.push(k);
      sh.getRange(1, headers.length).setValue(k);
    }
  });
  return headers;
}

function cellToStr(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return v.toISOString();
  return String(v);
}

/* ========================================================================
 *  OPERACIONES CRUD
 * ===================================================================== */
function getAll(name) {
  var sh = getSheet(name);
  var headers = getHeaders(sh);
  var lastRow = sh.getLastRow();
  var rows = [];
  if (lastRow > 1) {
    var values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
    values.forEach(function (r) {
      var obj = {};
      headers.forEach(function (h, i) { if (h) obj[h] = cellToStr(r[i]); });
      if (obj.id) rows.push(obj);
    });
  }
  return { rows: rows };
}

function insertRow(name, data) {
  var sh = getSheet(name);
  var headers = getHeaders(sh);
  data = data || {};
  if (!data.id) data.id = 'id_' + new Date().getTime() + '_' + Math.floor(Math.random() * 100000);
  if (!data.created_at) data.created_at = new Date().toISOString();
  headers = ensureColumns(sh, headers, Object.keys(data));
  var row = headers.map(function (h) { return data[h] !== undefined ? data[h] : ''; });
  sh.appendRow(row);
  return { ok: true, id: data.id };
}

function updateRow(name, id, data) {
  var sh = getSheet(name);
  var headers = getHeaders(sh);
  data = data || {};
  headers = ensureColumns(sh, headers, Object.keys(data));
  var idCol = headers.indexOf('id');
  var lastRow = sh.getLastRow();
  if (idCol < 0 || lastRow < 2) throw new Error('No hay datos para actualizar');
  var ids = sh.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      var rowNum = i + 2;
      Object.keys(data).forEach(function (k) {
        var col = headers.indexOf(k);
        if (col >= 0) sh.getRange(rowNum, col + 1).setValue(data[k]);
      });
      return { ok: true, id: id };
    }
  }
  throw new Error('No se encontró el id: ' + id);
}

function deleteRow(name, id) {
  var sh = getSheet(name);
  var headers = getHeaders(sh);
  var idCol = headers.indexOf('id');
  var lastRow = sh.getLastRow();
  if (idCol < 0 || lastRow < 2) throw new Error('No hay datos para eliminar');
  var ids = sh.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      sh.deleteRow(i + 2);
      return { ok: true, id: id };
    }
  }
  throw new Error('No se encontró el id: ' + id);
}

function getDashboard() {
  // La app calcula el dashboard localmente; acá solo confirmamos la conexión.
  return { ok: true, ts: new Date().toISOString() };
}

/* ========================================================================
 *  INICIALIZACIÓN (ejecutar una sola vez, a mano, desde el editor)
 *  Crea las tres hojas con sus columnas y carga los 12 trabajos iniciales.
 * ===================================================================== */
function inicializar() {
  HOJAS.forEach(function (name) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
    }
    if (sh.getLastColumn() < 1 || sh.getLastRow() < 1) {
      sh.clear();
      sh.appendRow(COLUMNAS[name]);
      sh.setFrozenRows(1);
    }
  });
  // Borra la hoja "Hoja 1" / "Sheet1" vacía si quedó por defecto.
  ['Hoja 1', 'Hoja1', 'Sheet1'].forEach(function (n) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var s = ss.getSheetByName(n);
    if (s && ss.getSheets().length > 1) { try { ss.deleteSheet(s); } catch (e) {} }
  });

  cargarTrabajosIniciales();
}

function cargarTrabajosIniciales() {
  var sh = getSheet('trabajos');
  if (sh.getLastRow() > 1) return; // ya hay trabajos cargados, no duplica

  var seed = [
    { cliente: 'Mariana Mejías', tipo_trabajo: 'Mensura y subdivisión', estado: 'En curso',
      descripcion: 'División de lote en Siete Lomas y estados parcelarios en Capital Federal.',
      comentario: 'División de lote (Siete Lomas) + estados parcelarios (CABA).' },
    { cliente: 'Cande', tipo_trabajo: 'Otro', estado: 'En curso',
      descripcion: 'Trabajos en Capital Federal.',
      comentario: 'Definir detalles de los trabajos en CABA.' },
    { cliente: 'Silvino', tipo_trabajo: 'Mensura para posesión/usucapión', estado: 'En curso',
      descripcion: 'Plano de mensura para usucapión.',
      comentario: 'Arranca la semana próxima. Continuar el plano. Hablar para ir presentando y mensurar los próximos terrenos. Armar el presupuesto del próximo trabajo.' },
    { cliente: 'Cooperativa de agua', tipo_trabajo: 'Otro', estado: 'Esperando cliente',
      descripcion: 'Plano + aplicación.',
      comentario: 'Continuar con el plano y la aplicación. Esperando que Ricky vea la última versión y corrija si hay algún problema.' },
    { cliente: 'Plano de Bomberos', tipo_trabajo: 'Otro', estado: 'En curso',
      descripcion: 'Plano de bomberos.',
      comentario: 'Numerar las calles. No queda mucho más.' },
    { cliente: 'Molina', tipo_trabajo: 'Otro', estado: 'Esperando cliente',
      descripcion: 'Aplicación.',
      comentario: 'Reunión pendiente por la aplicación y Humegas.' },
    { cliente: 'Green Fruit', tipo_trabajo: 'Otro', estado: 'En curso',
      descripcion: 'Dashboards y tableros.',
      comentario: 'Continuar con los dashboards y los tableros.' },
    { cliente: 'Veramor', tipo_trabajo: 'Otro', estado: 'En curso',
      descripcion: 'Dashboards y tableros.',
      comentario: 'Continuar con los dashboards y los tableros.' },
    { cliente: 'Guillermo', tipo_trabajo: 'Mensura y subdivisión', estado: 'Esperando cliente',
      descripcion: 'Mensura y subdivisión en Yacanto.',
      comentario: 'Preguntar en municipalidad si es posible hacer mensura y subdivisión nada más. Vienen a Yacanto los primeros días de julio.' },
    { cliente: 'Herni', tipo_trabajo: 'Loteo', estado: 'En curso',
      descripcion: 'Lotes en Tres Ríos.',
      comentario: 'Loteo / lotes en Tres Ríos.' },
    { cliente: 'Estudio (interno)', tipo_trabajo: 'Otro', estado: 'Pausado',
      descripcion: 'Página de Agrimensura.',
      comentario: 'Personal: mejorar la página de Agrimensura.' },
    { cliente: 'Estudio (interno)', tipo_trabajo: 'Otro', estado: 'Pausado',
      descripcion: 'App de cálculo de presupuestos.',
      comentario: 'Personal: mejorar la app para calcular presupuestos de forma automática.' },
    { cliente: 'Estudio (interno)', tipo_trabajo: 'Otro', estado: 'En curso',
      descripcion: 'App de seguimiento de trabajos.',
      comentario: 'Personal: continuar la app de seguimiento de trabajos (ya comenzada).' }
  ];

  var ahora = new Date().toISOString();
  seed.forEach(function (t) {
    t.id = 'id_' + new Date().getTime() + '_' + Math.floor(Math.random() * 100000);
    t.created_at = ahora;
    t.fecha_estado = ahora;
    t.monto_ars = t.monto_ars || '';
    t.monto_usd = t.monto_usd || '';
    insertRow('trabajos', t);
    Utilities.sleep(2); // ids únicos por timestamp
  });
}
