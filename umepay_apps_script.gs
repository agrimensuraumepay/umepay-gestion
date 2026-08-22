/****************************************************************************
 *  UMEPAY — GESTIÓN DEL ESTUDIO
 *  Backend en Google Apps Script para la app "Umepay Gestión" (GitHub Pages)
 *
 *  Hojas que usa: "trabajos", "movimientos", "presupuestos", "compromisos",
 *  "apuntes". La app web (index.html) se conecta a este script vía fetch.
 *
 *  Los eventos del calendario (hoja "compromisos") además se copian al
 *  calendario de Google de esta cuenta, para verlos en el celular. Ver la
 *  sección CALENDARIO DE GOOGLE, más abajo.
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

var HOJAS = ['trabajos', 'movimientos', 'presupuestos', 'compromisos', 'apuntes'];

// Subcarpetas de Drive, creadas DENTRO de la carpeta donde vive la planilla
// (por ej. "AgriApp"). Así todo lo de la app queda junto al Sheet.
var CARPETA_COMPROBANTES = 'Comprobantes';
var CARPETA_PRESUPUESTOS = 'Presupuestos';
var CARPETA_APUNTES      = 'Normativas';

// Calendario de Google donde se copian los eventos de la hoja "compromisos".
// Se crea solo la primera vez, dentro de esta misma cuenta de Google, así los
// eventos aparecen en la app de Calendario del celular.
// Si querés que vayan al calendario principal, poné: var CALENDARIO_NOMBRE = '';
var CALENDARIO_NOMBRE = 'Umepay - Estudio';

// Orden y nombre de columnas de cada hoja (solo para que queden prolijas).
var COLUMNAS = {
  trabajos: ['id', 'cliente', 'tipo_trabajo', 'descripcion', 'estado',
             'comentario', 'fecha_estado', 'fecha_inicio', 'monto_ars',
             'monto_usd', 'presupuesto_ref', 'forma_cobro', 'created_at'],
  movimientos: ['id', 'tipo', 'fecha', 'descripcion', 'monto', 'moneda',
                'forma_pago', 'quien_pago', 'categoria', 'trabajo_id',
                'comprobante_url', 'comprobante_nombre', 'created_at'],
  presupuestos: ['id', 'cliente', 'fecha', 'tipo_trabajo', 'monto_ars',
                 'monto_usd', 'estado', 'trabajo_id', 'notas', 'created_at'],
  compromisos: ['id', 'titulo', 'fecha', 'hora', 'lugar', 'tipo',
                'trabajo_id', 'nota', 'estado', 'aviso_min', 'created_at', 'gcal_id'],
  apuntes: ['id', 'titulo', 'categoria', 'contenido', 'fuente',
            'archivo_url', 'archivo_nombre', 'created_at']
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
      case 'insert':
        out = withLock(function () { return insertRow(req.sheet, req.data); });
        if (req.sheet === 'compromisos') out.calendario = conCalendario(out.id);
        break;
      case 'update':
        out = withLock(function () { return updateRow(req.sheet, req.id, req.data); });
        if (req.sheet === 'compromisos') out.calendario = conCalendario(req.id);
        break;
      case 'delete':
        // El id del evento de Google hay que leerlo ANTES de borrar la fila.
        var gid = (req.sheet === 'compromisos') ? gcalIdDe(req.id) : '';
        out = withLock(function () { return deleteRow(req.sheet, req.id); });
        if (gid) borrarEventoCalendario(gid);
        break;
      case 'uploadComprobante':   out = uploadComprobante(req.data); break;
      case 'uploadArchivo':       out = uploadArchivo(req.data); break;
      case 'guardarPresupuesto':  out = guardarPresupuestoPDF(req.data); break;
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
  if (Object.prototype.toString.call(v) === '[object Date]') {
    // Las celdas de HORA llegan como fechas del año 1899 (formato interno de
    // Sheets). Se devuelven como "HH:mm" en la zona horaria de la planilla,
    // para que la app no muestre fechas raras tipo "1899-12-30T...".
    if (v.getFullYear() < 1970) {
      var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
      return Utilities.formatDate(v, tz, 'HH:mm');
    }
    return v.toISOString();
  }
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
 *  COMPROBANTES — guarda el archivo en una carpeta de Google Drive y
 *  devuelve el link para verlo desde la app.
 * ===================================================================== */
// Carpeta raíz de la app = la carpeta donde está guardada esta planilla (AgriApp).
function getCarpetaApp() {
  try {
    var ssId = SpreadsheetApp.getActiveSpreadsheet().getId();
    var parents = DriveApp.getFileById(ssId).getParents();
    if (parents.hasNext()) return parents.next();
  } catch (e) { /* sin acceso al padre: usamos la raíz */ }
  return DriveApp.getRootFolder();
}

// Devuelve (o crea si no existe) una subcarpeta con ese nombre dentro de "base".
function getSubcarpeta(base, nombre) {
  var it = base.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : base.createFolder(nombre);
}

function getCarpetaComprobantes() { return getSubcarpeta(getCarpetaApp(), CARPETA_COMPROBANTES); }
function getCarpetaPresupuestos() { return getSubcarpeta(getCarpetaApp(), CARPETA_PRESUPUESTOS); }
function getCarpetaApuntes()      { return getSubcarpeta(getCarpetaApp(), CARPETA_APUNTES); }

// Sube un archivo (PDF, imagen…) a la subcarpeta indicada por data.carpeta.
function uploadArchivo(data) {
  data = data || {};
  if (!data.base64 || !data.filename) throw new Error('Falta el archivo');
  var carpeta = data.carpeta === 'apuntes' ? getCarpetaApuntes() : getCarpetaComprobantes();
  var bytes = Utilities.base64Decode(data.base64);
  var blob = Utilities.newBlob(bytes, data.mimeType || 'application/octet-stream', data.filename);
  var file = carpeta.createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  return { ok: true, url: file.getUrl(), id: file.getId(), nombre: data.filename };
}

function uploadComprobante(data) {
  data = data || {};
  if (!data.base64 || !data.filename) throw new Error('Falta el archivo del comprobante');
  var bytes = Utilities.base64Decode(data.base64);
  var blob = Utilities.newBlob(bytes, data.mimeType || 'application/octet-stream', data.filename);
  var file = getCarpetaComprobantes().createFile(blob);
  // Link abrible por quien tenga el enlace (para verlo desde el celular sin loguearse).
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  return { ok: true, url: file.getUrl(), id: file.getId(), nombre: data.filename };
}

// Recibe el HTML del presupuesto, lo convierte a PDF y lo guarda en AgriApp/Presupuestos.
function guardarPresupuestoPDF(data) {
  data = data || {};
  if (!data.html) throw new Error('Falta el contenido del presupuesto');
  var nombre = (data.filename || 'Presupuesto').replace(/[\\\/:*?"<>|]/g, '-') + '.pdf';
  var htmlBlob = Utilities.newBlob(data.html, 'text/html', 'doc.html');
  var pdf = htmlBlob.getAs('application/pdf').setName(nombre);
  var file = getCarpetaPresupuestos().createFile(pdf);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  return { ok: true, url: file.getUrl(), id: file.getId(), nombre: nombre };
}

/* ========================================================================
 *  CALENDARIO DE GOOGLE
 *  Cada evento de la hoja "compromisos" se copia al calendario de esta misma
 *  cuenta, para verlo desde el celular. Es de ida nomás: la app manda al
 *  calendario, no al revés.
 *
 *  Si algo falla (por ejemplo, todavía no se dio el permiso al calendario),
 *  el evento igual queda guardado en la planilla: el error se devuelve como
 *  aviso pero no rompe el guardado.
 * ===================================================================== */
function getCalendario() {
  if (!CALENDARIO_NOMBRE) return CalendarApp.getDefaultCalendar();

  var props = PropertiesService.getScriptProperties();
  var guardado = props.getProperty('calendario_id');
  if (guardado) {
    var c = CalendarApp.getCalendarById(guardado);
    if (c) return c;
  }
  var encontrados = CalendarApp.getCalendarsByName(CALENDARIO_NOMBRE);
  var cal = encontrados.length ? encontrados[0]
    : CalendarApp.createCalendar(CALENDARIO_NOMBRE, {
        summary: 'Eventos cargados desde la app Umepay Gestion',
        color: CalendarApp.Color.GREEN
      });
  props.setProperty('calendario_id', cal.getId());
  return cal;
}

// Busca una fila por id y la devuelve con sus valores crudos (fechas como Date).
function buscarFila(name, id) {
  var sh = getSheet(name);
  var headers = getHeaders(sh);
  var idCol = headers.indexOf('id');
  var lastRow = sh.getLastRow();
  if (idCol < 0 || lastRow < 2) return null;
  var values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][idCol]) === String(id)) {
      var obj = {};
      headers.forEach(function (h, j) { if (h) obj[h] = values[i][j]; });
      return { obj: obj, fila: i + 2, headers: headers, sh: sh };
    }
  }
  return null;
}

function tzApp() {
  return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
}

// La celda de fecha puede venir como Date o como texto "2026-08-22".
function fechaISO(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, tzApp(), 'yyyy-MM-dd');
  }
  return String(v).slice(0, 10);
}

// La celda de hora suele venir como Date del año 1899 (formato interno de Sheets).
function horaHHMM(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, tzApp(), 'HH:mm');
  }
  var m = String(v).match(/(\d{1,2}):(\d{2})/);
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : '';
}

function descripcionEvento(c) {
  var lin = [];
  if (c.tipo) lin.push(String(c.tipo));
  if (c.trabajo_id) {
    var t = buscarFila('trabajos', c.trabajo_id);
    if (t) {
      var quien = [t.obj.cliente, t.obj.descripcion].filter(function (x) { return String(x || ''); });
      lin.push('Trabajo: ' + quien.join(' — '));
    }
  }
  if (c.nota) { lin.push(''); lin.push(String(c.nota)); }
  lin.push('');
  lin.push('— Cargado desde la app Umepay Gestion');
  return lin.join('\n');
}

/* Aviso (notificación en el celular). Lo elige la app en el campo
 * "Aviso en el celular" y viaja en la columna "aviso_min":
 *    ''    → automático: el día antes y 1 hora antes (todo el día: 9 de la
 *            mañana del día anterior)
 *    '-1'  → sin aviso
 *    otro  → minutos antes del evento (60 = 1 hora, 1440 = el día anterior…)
 * En los eventos de todo el día, los avisos de un día o más se corren para
 * que suenen a las 9 de la mañana y no a la medianoche. */
function ponerAvisos(ev, c, todoElDia) {
  var v = (c.aviso_min === undefined || c.aviso_min === null) ? '' : String(c.aviso_min).trim();
  try {
    ev.removeAllReminders();
    if (v === '') {
      if (todoElDia) ev.addPopupReminder(15 * 60);            // 9 hs del día anterior
      else { ev.addPopupReminder(24 * 60); ev.addPopupReminder(60); }
      return;
    }
    var n = Number(v);
    if (!isFinite(n) || n < 0) return;                        // sin aviso
    if (todoElDia && n >= 1440) n = n - 9 * 60;               // que suene a las 9, no a las 0
    ev.addPopupReminder(Math.max(0, Math.round(n)));
  } catch (e) { /* si el calendario no deja poner el aviso, el evento igual queda */ }
}

// Crea o actualiza en el calendario el evento de un compromiso.
function sincronizarCompromiso(id) {
  var r = buscarFila('compromisos', id);
  if (!r) return { ok: false, motivo: 'No se encontró la fila' };

  var c = r.obj;
  var fecha = fechaISO(c.fecha);
  var titulo = String(c.titulo || '').trim();
  if (!fecha || !titulo) return { ok: false, motivo: 'Sin fecha o sin título' };

  var hora = horaHHMM(c.hora);
  var p = fecha.split('-');
  var todoElDia = !hora, inicio, fin;
  if (todoElDia) {
    inicio = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  } else {
    inicio = Utilities.parseDate(fecha + ' ' + hora, tzApp(), 'yyyy-MM-dd HH:mm');
    fin = new Date(inicio.getTime() + 60 * 60 * 1000); // 1 hora por defecto
  }

  var marca = c.estado === 'Hecho' ? '✔ ' : (c.estado === 'No se hizo' ? '✘ ' : '');
  var opciones = { location: String(c.lugar || ''), description: descripcionEvento(c) };

  var cal = getCalendario();
  var ev = null;
  var gid = String(c.gcal_id || '');
  if (gid) { try { ev = cal.getEventById(gid); } catch (e) { ev = null; } }

  if (ev) {
    ev.setTitle(marca + titulo);
    ev.setLocation(opciones.location);
    ev.setDescription(opciones.description);
    if (todoElDia) ev.setAllDayDate(inicio); else ev.setTime(inicio, fin);
  } else {
    ev = todoElDia ? cal.createAllDayEvent(marca + titulo, inicio, opciones)
                   : cal.createEvent(marca + titulo, inicio, fin, opciones);
  }

  ponerAvisos(ev, c, todoElDia);

  var nuevoId = ev.getId();
  if (nuevoId !== gid) {
    var headers = ensureColumns(r.sh, r.headers, ['gcal_id']);
    r.sh.getRange(r.fila, headers.indexOf('gcal_id') + 1).setValue(nuevoId);
  }
  return { ok: true, gcal_id: nuevoId };
}

// Igual que la anterior, pero nunca tira error: solo lo informa.
function conCalendario(id) {
  try { return sincronizarCompromiso(id); }
  catch (err) { return { ok: false, error: String(err && err.message ? err.message : err) }; }
}

function gcalIdDe(id) {
  try {
    var r = buscarFila('compromisos', id);
    return r ? String(r.obj.gcal_id || '') : '';
  } catch (e) { return ''; }
}

function borrarEventoCalendario(gid) {
  if (!gid) return;
  try {
    var ev = getCalendario().getEventById(String(gid));
    if (ev) ev.deleteEvent();
  } catch (e) { /* ya no existe o no hay permiso: no rompemos el borrado */ }
}

/* Pasa TODOS los eventos ya cargados al calendario.
 * Ejecutala a mano una vez desde el editor: además de copiar lo viejo, es la
 * que dispara el pedido de permiso para acceder al calendario. */
function sincronizarTodo() {
  var filas = getAll('compromisos').rows;
  var ok = 0, saltados = 0, errores = 0;
  filas.forEach(function (c) {
    try { if (sincronizarCompromiso(c.id).ok) ok++; else saltados++; }
    catch (e) { errores++; }
  });
  var msg = 'Eventos en el calendario: ' + ok +
            (saltados ? ' — sin fecha o sin título: ' + saltados : '') +
            (errores ? ' — con error: ' + errores : '');
  Logger.log(msg);
  return msg;
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
