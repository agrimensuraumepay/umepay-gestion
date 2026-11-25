/**
 * ═══════════════════════════════════════════════════════════════════════
 *  UMEPAY · CONECTOR DE FACTURACIÓN (la vista de la contadora)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  Este script es APARTE del conector de la app, a propósito. Tiene su propia
 *  URL y solo sabe hacer dos cosas:
 *
 *    · LEER los datos que hacen falta para decidir qué facturar
 *    · ESCRIBIR las facturas, los datos fiscales de un trabajo y los topes
 *
 *  No puede leer la caja, ni los movimientos sin trabajo (los gastos del
 *  estudio y los personales), ni los apuntes, ni los presupuestos, ni las
 *  descripciones de los movimientos, ni la bitácora de los trabajos. Si el
 *  link se le pierde o lo reenvía, nadie llega a nada de eso.
 *
 *  ───────────────────────────────────────────────────────────────────────
 *  CÓMO SE INSTALA (una sola vez)
 *
 *  ⚠ VA EN UN PROYECTO APARTE, no adentro del proyecto de la planilla.
 *  En Apps Script todos los archivos de un proyecto comparten las mismas
 *  funciones: si este archivo convive con el conector de la app, los dos
 *  doGet se pisan y uno de los dos deja de andar.
 *
 *  1. Ir a script.google.com → «Proyecto nuevo» (no desde la planilla).
 *  2. Ponerle nombre arriba: «Umepay facturación».
 *  3. Borrar el function myFunction() de ejemplo y pegar TODO este archivo.
 *  4. Cambiar la CLAVE de abajo por una inventada (letras y números, sin
 *     espacios, sin acentos). No es la contraseña de nadie: es la llave
 *     del link. Ctrl+S.
 *  5. Implementar → Nueva implementación → Tipo: Aplicación web
 *       · Ejecutar como: Yo
 *       · Quién tiene acceso: Cualquier persona
 *     Implementar → va a pedir permisos la primera vez (es para que pueda
 *     abrir la planilla): Revisar permisos → elegir la cuenta → Avanzado →
 *     Ir a Umepay facturación → Permitir. Copiar la URL que termina en /exec.
 *  6. En la app, pestaña Facturación → «Compartir con la contadora»:
 *     pegar esa URL y la clave, y copiar el link que arma. Ese link es el
 *     que se le manda a la contadora.
 *
 *  Si este archivo ya quedó pegado adentro del proyecto de la planilla, hay
 *  que BORRARLO de ahí (⋮ al lado del nombre del archivo → Eliminar) y volver
 *  a implementar el conector de la app, que mientras tanto quedó pisado.
 *
 *  Para cambiar la clave más adelante: se edita acá, Ctrl+S, y después
 *  Implementar → Gestionar implementaciones → lápiz → Nueva versión. La URL
 *  no cambia, pero los links viejos dejan de funcionar.
 * ═══════════════════════════════════════════════════════════════════════
 */

var CLAVE = 'CAMBIAR-ESTA-CLAVE';

/* La planilla de gestión. Al ser un proyecto aparte hay que abrirla: se busca
 * por nombre en el Drive de la cuenta. Si alguna vez se renombra, o si hay dos
 * archivos con el mismo nombre, se pone acá el ID (lo que va entre /d/ y /edit
 * en la dirección de la planilla) y se usa ese. */
var PLANILLA_NOMBRE = 'Umepay - Gestión';
var PLANILLA_ID = '';

function planilla() {
  if (PLANILLA_ID) return SpreadsheetApp.openById(PLANILLA_ID);
  var it = DriveApp.getFilesByName(PLANILLA_NOMBRE);
  if (!it.hasNext()) {
    throw new Error('No encontré la planilla «' + PLANILLA_NOMBRE + '» en el Drive de esta cuenta. '
      + 'Revisá el nombre, o poné el PLANILLA_ID en el script.');
  }
  var f = it.next();
  if (it.hasNext()) {
    throw new Error('Hay más de un archivo llamado «' + PLANILLA_NOMBRE + '». '
      + 'Poné el PLANILLA_ID en el script para que no haya duda.');
  }
  return SpreadsheetApp.open(f);
}

/* Lo único que sale de cada hoja. Todo lo que no esté en estas listas no se
 * devuelve, aunque exista en la planilla. */
var CAMPOS_TRABAJOS = ['id', 'cliente', 'tipo_trabajo', 'estado', 'monto_ars', 'monto_usd',
  'tasas_previstas', 'tipo_fiscal', 'razon_social', 'cuit', 'iva', 'honorario_minimo',
  'obra_domicilio', 'obra_localidad', 'obra_expediente', 'sin_facturar', 'facturacion_nota'];

/* De los movimientos solo lo que hace falta para las cuentas: cuánto entró de
 * cada trabajo y cuánto se pagó de aportes. Sin descripción y sin los que no
 * están vinculados a un trabajo. */
var CAMPOS_MOVS = ['id', 'fecha', 'tipo', 'monto', 'moneda', 'categoria', 'trabajo_id'];

/* Lo que la vista puede escribir en un trabajo: nada más que esto. */
var CAMPOS_TRABAJO_EDITABLES = ['tipo_fiscal', 'razon_social', 'cuit', 'iva', 'honorario_minimo',
  'obra_domicilio', 'obra_localidad', 'obra_expediente', 'sin_facturar', 'facturacion_nota'];

var CAMPOS_FACTURA = ['fecha', 'titular', 'pto_venta', 'numero', 'trabajo_id', 'cliente',
  'moneda', 'monto', 'concepto', 'nota'];

var CLAVES_CONFIG = ['tope_julia', 'tope_santiago', 'cotiz_usd', 'pto_venta'];

var NUMERICOS = ['monto', 'monto_ars', 'monto_usd', 'honorario_minimo', 'tasas_previstas'];

// ── Entradas ──────────────────────────────────────────────────────────

function doGet(e) {
  try {
    autorizar(e);
    return json({
      ok: true,
      trabajos: leer('trabajos', CAMPOS_TRABAJOS),
      movimientos: soloConTrabajo(leer('movimientos', CAMPOS_MOVS)),
      facturas: leer('facturas', null),
      // De config salen solo los parámetros de la vista: la URL y la clave
      // del propio link no se devuelven, aunque estén guardados ahí.
      config: leer('config', null).filter(function (c) { return CLAVES_CONFIG.indexOf(c.clave) >= 0; }),
      leido: new Date().toISOString()
    });
  } catch (err) {
    return json({ error: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    autorizar({ parameter: { k: d.k } });
    switch (d.action) {
      case 'factura_guardar': return json(guardarFactura(d));
      case 'factura_borrar':  return json(borrarFactura(d));
      case 'trabajo_fiscal':  return json(guardarFiscal(d));
      case 'config_set':      return json(guardarConfig(d));
      default: throw new Error('Acción desconocida: ' + d.action);
    }
  } catch (err) {
    return json({ error: String(err.message || err) });
  }
}

function autorizar(e) {
  var k = (e && e.parameter && e.parameter.k) || '';
  if (CLAVE === 'CAMBIAR-ESTA-CLAVE') throw new Error('Falta poner una clave en el script de facturación.');
  if (k !== CLAVE) throw new Error('Link sin clave o con la clave equivocada.');
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ── Lectura ───────────────────────────────────────────────────────────

/* Las columnas con las que nacen las hojas propias de facturación. Las mismas
 * que usa el conector de la app, así las dos leen y escriben lo mismo. */
var COLUMNAS_NUEVAS = {
  facturas: ['id', 'fecha', 'titular', 'pto_venta', 'numero', 'trabajo_id', 'cliente',
             'moneda', 'monto', 'concepto', 'nota', 'created_at'],
  config: ['id', 'clave', 'valor']
};

function hoja(nombre) {
  var ss = planilla();
  var sh = ss.getSheetByName(nombre);
  if (sh) return sh;
  // facturas y config son de esta vista: si faltan, se crean acá mismo
  if (COLUMNAS_NUEVAS[nombre]) {
    sh = ss.insertSheet(nombre);
    sh.appendRow(COLUMNAS_NUEVAS[nombre]);
    sh.setFrozenRows(1);
    return sh;
  }
  throw new Error('No existe la hoja «' + nombre + '» en la planilla.');
}

function leer(nombre, campos) {
  var sh = planilla().getSheetByName(nombre);
  if (!sh) return [];                                  // hoja todavía sin crear: lista vacía
  var datos = sh.getDataRange().getValues();
  if (datos.length < 2) return [];
  var headers = datos[0].map(function (h) { return String(h).trim(); });
  var filas = [];
  for (var i = 1; i < datos.length; i++) {
    var fila = {}, vacia = true;
    for (var c = 0; c < headers.length; c++) {
      var h = headers[c];
      if (!h || (campos && campos.indexOf(h) < 0)) continue;
      var v = datos[i][c];
      if (v instanceof Date) v = v.toISOString();
      else v = String(v === null || v === undefined ? '' : v);
      if (v !== '') vacia = false;
      fila[h] = v;
    }
    if (!vacia) filas.push(fila);
  }
  return filas;
}

// Los movimientos sin trabajo vinculado son gastos del estudio o personales:
// no tienen nada que ver con la facturación y no salen de acá.
function soloConTrabajo(filas) {
  return filas.filter(function (m) { return String(m.trabajo_id || '').trim() !== ''; });
}

// ── Escritura ─────────────────────────────────────────────────────────

function columnas(sh) {
  var ancho = sh.getLastColumn();
  if (!ancho) return [];
  return sh.getRange(1, 1, 1, ancho).getValues()[0].map(function (h) { return String(h).trim(); });
}

function asegurarColumnas(sh, headers, claves) {
  var faltan = claves.filter(function (k) { return headers.indexOf(k) < 0; });
  if (!faltan.length) return headers;
  sh.getRange(1, headers.length + 1, 1, faltan.length).setValues([faltan]);
  return headers.concat(faltan);
}

// Un monto tiene que entrar como NÚMERO: si entra como texto, Google Sheets
// interpreta «6.3» como una fecha y destruye el dato.
function valorCelda(clave, v) {
  if (NUMERICOS.indexOf(clave) < 0) return v;
  if (typeof v === 'number') return v;
  var t = String(v === null || v === undefined ? '' : v).trim();
  if (!t) return '';
  if (/^-?\d{1,3}(\.\d{3})*,\d+$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+,\d+$/.test(t)) t = t.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return v;
  var n = Number(t);
  return isNaN(n) ? v : n;
}

function escribir(sh, fila, headers, data, permitidos) {
  Object.keys(data).forEach(function (k) {
    if (permitidos.indexOf(k) < 0) return;             // campo no permitido: se ignora
    var col = headers.indexOf(k);
    if (col < 0) return;
    var v = valorCelda(k, data[k]);
    var rango = sh.getRange(fila, col + 1);
    if (typeof v === 'number') rango.setNumberFormat('0.##########');
    rango.setValue(v);
  });
}

function buscarFila(sh, headers, id) {
  var colId = headers.indexOf('id');
  if (colId < 0) throw new Error('La hoja no tiene columna id');
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][colId]) === String(id)) return i + 1;
  }
  return 0;
}

function guardarFactura(d) {
  var data = d.data || {};
  if (!data.fecha) throw new Error('Falta la fecha');
  if (!fcNumero(data.monto)) throw new Error('Falta el monto');
  var sh = hoja('facturas');
  var headers = asegurarColumnas(sh, columnas(sh), ['id', 'created_at'].concat(CAMPOS_FACTURA));
  if (d.id) {
    var fila = buscarFila(sh, headers, d.id);
    if (!fila) throw new Error('No encontré esa factura');
    escribir(sh, fila, headers, data, CAMPOS_FACTURA);
    return { ok: true, id: d.id };
  }
  var id = 'fc_' + new Date().getTime() + '_' + Math.floor(Math.random() * 90000 + 10000);
  var row = headers.map(function (h) {
    if (h === 'id') return id;
    if (h === 'created_at') return new Date().toISOString();
    return CAMPOS_FACTURA.indexOf(h) >= 0 && data[h] !== undefined ? valorCelda(h, data[h]) : '';
  });
  sh.appendRow(row);
  var nueva = sh.getLastRow();
  headers.forEach(function (h, i) {
    if (NUMERICOS.indexOf(h) >= 0 && typeof row[i] === 'number') {
      sh.getRange(nueva, i + 1).setNumberFormat('0.##########');
    }
  });
  return { ok: true, id: id };
}

function borrarFactura(d) {
  var sh = hoja('facturas');
  var headers = columnas(sh);
  var fila = buscarFila(sh, headers, d.id);
  if (!fila) throw new Error('No encontré esa factura');
  sh.deleteRow(fila);
  return { ok: true, id: d.id };
}

function guardarFiscal(d) {
  var sh = hoja('trabajos');
  var headers = asegurarColumnas(sh, columnas(sh), CAMPOS_TRABAJO_EDITABLES);
  var fila = buscarFila(sh, headers, d.id);
  if (!fila) throw new Error('No encontré ese trabajo');
  escribir(sh, fila, headers, d.data || {}, CAMPOS_TRABAJO_EDITABLES);
  return { ok: true, id: d.id };
}

function guardarConfig(d) {
  if (CLAVES_CONFIG.indexOf(d.clave) < 0) throw new Error('Parámetro no permitido: ' + d.clave);
  var sh = hoja('config');
  var headers = asegurarColumnas(sh, columnas(sh), ['id', 'clave', 'valor']);
  var vals = sh.getDataRange().getValues();
  var colC = headers.indexOf('clave'), colV = headers.indexOf('valor');
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][colC]) === String(d.clave)) {
      sh.getRange(i + 1, colV + 1).setValue(String(d.valor));
      return { ok: true };
    }
  }
  var row = headers.map(function (h) {
    if (h === 'id') return 'cf_' + new Date().getTime();
    if (h === 'clave') return d.clave;
    if (h === 'valor') return String(d.valor);
    return '';
  });
  sh.appendRow(row);
  return { ok: true };
}

function fcNumero(v) {
  var n = parseFloat(String(v === null || v === undefined ? '' : v).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}
