/* ═════════════════════════════════════════════════════════════════════
 *  UMEPAY · facturacion-core.js
 *  Las cuentas de la facturación, en un solo lugar.
 *
 *  Lo cargan las dos páginas que las necesitan:
 *    · index.html        — la app del estudio
 *    · facturacion.html  — la vista de la contadora
 *  Así una corrección de fórmula vale para las dos y no se separan con el tiempo.
 *
 *  Cada página que lo carga tiene que darle:
 *    · DB            — objeto con trabajos, movimientos, facturas y config
 *    · el HTML       — con los mismos id (fc-semaforo, fc-tbody, los modales…)
 *    · los ayudantes — escHtml, fmtPlata, fmtFecha, toast, openModal, closeModal
 *    · fcPersistir(hoja, id, data) y fcEliminar(hoja, id) — cómo guarda esa
 *      página: la app va por el conector general, la vista de la contadora
 *      por el conector de facturación, que solo sabe escribir esto.
 * ════════════════════════════════════════════════════════════════════ */
// ════════════════════════════════════════════════════════════
// FACTURACIÓN
// Cada trabajo tiene dos números que acotan la factura:
// Lo que se factura de una obra es el HONORARIO MÍNIMO del arancel: sobre ese
// número se pagó el 18% a la Caja (es el total de la boleta de obra), así que
// es el único monto que queda respaldado. Al cliente se le cobra más, y esa
// diferencia no se factura.
// La contadora decide a nombre de quién sale cada factura y en qué momento,
// mirando el margen de cada monotributo.
// IMPORTANTE: acá no se mira la forma de pago. La plata se inyecta al banco
// cuando hace falta, así que una transferencia no se corresponde con el cobro
// de un cliente en particular.
// ════════════════════════════════════════════════════════════
const FC_APORTE = 0.18;                      // el aporte a la Caja es el 18% del mínimo
const FC_TITULARES = ['Julia', 'Santiago'];

function fcNum(v){ return parseFloat(String(v == null ? '' : v).replace(',', '.')) || 0; }

// Los parámetros (topes y cotización) viven en la hoja config, no en este
// navegador: así los ve cualquiera que abra la app o la vista de la contadora.
function cfgGet(clave){
  const f = DB.config.find(c => c.clave === clave);
  return f ? String(f.valor == null ? '' : f.valor) : '';
}
function fcCotiz(){ return fcNum(cfgGet('cotiz_usd')); }

// Un monto en pesos. Lo que está en dólares o USDT se pasa con la cotización de
// referencia; sin cotización cargada devuelve 0, antes que inventar un número.
function fcAPesos(monto, moneda){
  const v = fcNum(monto);
  if(!v) return 0;
  if((moneda || '$') === '$') return v;
  const c = fcCotiz();
  return c ? v * c : 0;
}
function fcAportesCaja(t){
  return DB.movimientos
    .filter(m => m.trabajo_id === t.id && m.tipo !== 'ingreso'
                 && m.categoria === 'Caja' && (m.moneda || '$') === '$')
    .reduce((a, b) => a + fcNum(b.monto), 0);
}
// El mínimo del arancel: el cargado a mano gana; si no hay, sale del aporte pagado
function fcMinimo(t){
  const cargado = fcNum(t.honorario_minimo);
  if(cargado > 0) return { valor: cargado, estimado: false };
  const ap = fcAportesCaja(t);
  return { valor: ap ? ap / FC_APORTE : 0, estimado: ap > 0 };
}
// Todo lo cobrado del trabajo, sin importar cómo entró
function fcCobrado(t){
  let ars = 0, ext = 0;
  DB.movimientos.forEach(m => {
    if(m.tipo !== 'ingreso' || m.trabajo_id !== t.id) return;
    if((m.moneda || '$') === '$') ars += fcNum(m.monto); else ext += fcNum(m.monto);
  });
  const c = fcCotiz();
  return { ars, ext, pesos: ars + (c ? ext * c : 0) };
}
/* Una fila de facturas SIN número de comprobante todavía no se emitió: es un
 * ingreso anotado para que la contadora diga a nombre de quién conviene que salga.
 * No cuenta como facturación hasta que tenga número. */
function fcEmitida(f){ return String(f.numero || '').trim() !== ''; }
function fcEmitidas(){ return DB.facturas.filter(fcEmitida); }
function fcPropuestas(){ return DB.facturas.filter(f => !fcEmitida(f)); }

function fcFacturadoDe(t){
  return fcEmitidas().filter(f => f.trabajo_id === t.id)
    .reduce((a, b) => a + fcAPesos(b.monto, b.moneda), 0);
}
// Lo anotado y todavía sin emitir, por titular
function fcPendiente12m(titular){
  return fcPropuestas()
    .filter(f => (f.titular || '') === titular)
    .reduce((a, b) => a + fcAPesos(b.monto, b.moneda), 0);
}
function fcCerrado(t){ return String(t.sin_facturar || '') === '1'; }
// La Caja divide la declaración en dos: facturación POR OBRAS (trabajos sobre
// obras, los que llevan aportes) y por OTRAS TAREAS. Un relevamiento, un croquis
// o un asesoramiento no son obra y no tienen honorario mínimo que respetar.
function fcTipoFiscal(t){
  const marcado = String(t.tipo_fiscal || '');
  if(marcado === 'obra' || marcado === 'otra') return marcado;
  // Sin marcar: si pagó aportes o tiene tasas previstas, es obra; si no, no se adivina
  if(fcAportesCaja(t) > 0 || fcNum(t.tasas_previstas) > 0) return 'obra';
  return '';
}
// Cuánto del trabajo falta cobrar, en porcentaje: le dice a la contadora cuánta
// plata más va a entrar de ese cliente, que es margen futuro para facturar.
function fcPorCobrar(t){
  const mAr = fcNum(t.monto_ars), mUs = fcNum(t.monto_usd), c = fcCobrado(t);
  if(mAr <= 0 && mUs <= 0) return null;                 // sin monto no hay porcentaje
  const cot = fcCotiz();
  if(mAr > 0 && mUs > 0 && !cot) return null;           // dos monedas sin cotización: no se mezcla
  const k = cot || 1;
  const total = mAr + mUs * k, cob = c.ars + c.ext * k;
  if(total <= 0) return null;
  return {
    pct: Math.max(0, Math.min(100, (total - cob) / total * 100)),
    ars: Math.max(0, mAr - c.ars), usd: Math.max(0, mUs - c.ext),
  };
}
// El monotributo se mide por los últimos 12 meses móviles, no por año calendario
function fcFacturado12m(titular){
  const d = new Date(); d.setMonth(d.getMonth() - 12);
  const desde = d.toISOString().slice(0, 10);
  return fcEmitidas()
    .filter(f => (f.titular || '') === titular && String(f.fecha || '').slice(0, 10) >= desde)
    .reduce((a, b) => a + fcAPesos(b.monto, b.moneda), 0);
}
function fcFilas(){
  return DB.trabajos.map(t => {
    const min = fcMinimo(t), cob = fcCobrado(t), fact = fcFacturadoDe(t);
    const cerrado = fcCerrado(t);
    // Por facturar: lo que queda del honorario mínimo sin comprobante emitido.
    // Si ya se facturó por encima del mínimo, no falta nada (y está bien así).
    return { t, min, cob, fact, cerrado, tipo: fcTipoFiscal(t), porCobrar: fcPorCobrar(t),
             falta: cerrado ? 0 : Math.max(0, min.valor - fact),
             sobra: Math.max(0, fact - min.valor) };
  }).filter(f => f.min.valor > 0 || f.cob.ars > 0 || f.cob.ext > 0 || f.fact > 0)
    .sort((a, b) => (a.cerrado - b.cerrado) || (b.falta - a.falta) || (b.disp - a.disp));
}

function ddjjCampos(f, t, tipo){
  const comi = (t && (t.razon_social || t.cliente)) || f.cliente || '';
  const tarea = f.concepto || (t && t.tipo_trabajo) || '';
  if(tipo !== 'obra') return { fecha: f.fecha, importe: f.monto, moneda: f.moneda || '$',
                               numero: [f.pto_venta, f.numero].filter(Boolean).join('-'),
                               titular: f.titular || '', tarea, falta: tarea ? [] : ['la tarea realizada'] };
  const falta = [];
  if(!comi) falta.push('el comitente');
  if(!(t && t.cuit)) falta.push('el CUIT del comitente');
  if(!(t && t.obra_domicilio)) falta.push('el domicilio de la obra');
  if(!(t && t.obra_localidad)) falta.push('la localidad');
  if(!(t && t.obra_expediente)) falta.push('el expediente o la nomenclatura');
  if(!tarea) falta.push('los trabajos efectuados');
  return { fecha: f.fecha, importe: f.monto, moneda: f.moneda || '$',
           numero: [f.pto_venta, f.numero].filter(Boolean).join('-'), titular: f.titular || '',
           comitente: comi, cuit: (t && t.cuit) || '',
           domicilio: (t && t.obra_domicilio) || '', localidad: (t && t.obra_localidad) || '',
           expediente: (t && t.obra_expediente) || '', tarea, falta };
}
function fcDeclaracion(desde, hasta){
  const obras = [], otras = [], sin = [];
  fcEmitidas().forEach(f => {
    const d = String(f.fecha || '').slice(0, 10);
    if(!d || (desde && d < desde) || (hasta && d > hasta)) return;
    const t = DB.trabajos.find(x => x.id === f.trabajo_id);
    // Una factura sin trabajo vinculado no puede ser «trabajo sobre obra»
    const tipo = t ? fcTipoFiscal(t) : 'otra';
    const fila = ddjjCampos(f, t, tipo);
    fila.cliente = f.cliente || '';
    if(tipo === 'obra') obras.push(fila);
    else if(tipo === 'otra') otras.push(fila);
    else { fila.trabajo = t ? (t.cliente || '') : ''; sin.push(fila); }
  });
  const suma = arr => arr.reduce((a, b) => a + fcAPesos(b.importe, b.moneda), 0);
  const porFecha = (a, b) => String(a.fecha || '').localeCompare(String(b.fecha || ''));
  obras.sort(porFecha); otras.sort(porFecha); sin.sort(porFecha);
  return { obras, otras, sin, totObras: suma(obras), totOtras: suma(otras), totSin: suma(sin) };
}

async function cfgSet(clave, valor){
  const f = DB.config.find(c => c.clave === clave);
  if(f) await fcPersistir('config', f.id, { valor: String(valor) });
  else  await fcPersistir('config', null, { clave, valor: String(valor) });
}

// El monotributo se recategoriza dos veces al año, en enero y en julio, y en
// cada corte se miran los últimos 12 meses facturados. Por eso acá nada cierra
// por mes: lo que importa es cómo llega el acumulado a la próxima fecha de corte.
function fcProximaRecat(){
  const h = new Date(), y = h.getFullYear();
  const corte = h.getMonth() < 6 ? new Date(y, 6, 1) : new Date(y + 1, 0, 1);
  const desde = new Date(corte); desde.setMonth(desde.getMonth() - 12);
  const mes = d => d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return { corte, desde, txt: mes(corte), periodo: mes(desde) + ' a ' + mes(new Date(corte.getTime() - 86400000)) };
}

function renderFacturacion(){
  const tb = document.getElementById('fc-tbody');
  if(!tb) return;
  const recat = document.getElementById('fc-recat');
  if(recat){
    const r = fcProximaRecat();
    recat.innerHTML = `Próxima recategorización: <b>${r.txt}</b>. Ahí se mira lo facturado de ${r.periodo}, `
      + 'que es lo que cuentan estas dos tarjetas. La fecha y el tope los confirma la contadora.';
  }
  // Parámetros, sin pisar lo que se está tipeando
  // sofi-url y sofi-clave solo existen en la app: en la vista de la contadora no
  [['fc-tope-julia', 'tope_julia'], ['fc-tope-santiago', 'tope_santiago'], ['fc-cotiz', 'cotiz_usd'],
   ['sofi-url', 'fact_url'], ['sofi-clave', 'fact_clave']]
    .forEach(([id, k]) => {
      const e = document.getElementById(id);
      if(e && document.activeElement !== e) e.value = cfgGet(k);
    });

  // Semáforo de los dos monotributos
  document.getElementById('fc-semaforo').innerHTML = FC_TITULARES.map(q => {
    const fac = fcFacturado12m(q), tope = fcNum(cfgGet('tope_' + q.toLowerCase()));
    const pend = fcPendiente12m(q);
    const pct = tope ? Math.min(100, fac / tope * 100) : 0;
    const pctP = tope ? Math.min(100 - pct, pend / tope * 100) : 0;
    const cls = !tope ? '' : (fac + pend > tope ? ' pasado' : ((fac + pend) / tope > 0.8 ? ' alerta' : ''));
    const queda = tope - fac - pend;
    return `<div class="fc-card">
      <div class="fc-card-top">
        <div><div class="fc-card-quien">${q}</div>
          <div class="fc-card-sub">facturado en los últimos 12 meses</div></div>
        <div class="fc-card-num">${fmtPlata(fac, '$')}</div>
      </div>
      <div class="fc-barra${cls}"><span style="width:${pct}%"></span><i style="width:${pctP}%"></i></div>
      <div class="fc-card-pie">
        <span>${tope ? 'Tope: ' + fmtPlata(tope, '$') : 'Sin tope cargado'}</span>
        <span>${tope ? (queda >= 0
            ? 'Queda <b>' + fmtPlata(queda, '$') + '</b>'
            : '<b class="fc-rojo">Pasado por ' + fmtPlata(-queda, '$') + '</b>')
          : 'Cargá el tope para ver el margen'}</span>
      </div>
      ${pend ? `<div class="fc-card-pend">+ ${fmtPlata(pend, '$')} anotado para decidir</div>` : ''}
    </div>`;
  }).join('');

  // Tabla de trabajos
  const filas = fcFilas();
  const tot = { min: 0, cob: 0, fact: 0, falta: 0, disp: 0 };
  filas.forEach(f => { if(!f.cerrado){ tot.min += f.min.valor; tot.cob += f.cob.pesos; } tot.fact += f.fact; tot.falta += f.falta; });
  tb.innerHTML = filas.length ? filas.map(f => {
    const t = f.t;
    const fiscal = (t.cuit || '').trim()
      ? `<div class="fc-fiscal">${escHtml(t.cuit)}${t.iva ? ' · ' + escHtml(t.iva) : ''}</div>`
      : `<button class="fc-falta-cuit" onclick="fcAbrirFiscal('${t.id}')" title="Cargar los datos para facturar">+ falta el CUIT</button>`;
    const chip = f.tipo === 'obra' ? '<span class="fc-chip obra">obra</span>'
      : (f.tipo === 'otra' ? '<span class="fc-chip otra">otra tarea</span>'
                           : '<span class="fc-chip sin">sin clasificar</span>');
    const pc = f.porCobrar;
    const pcTxt = !pc ? '—'
      : (pc.pct <= 0.5 ? '<span class="fc-ok">cobrado</span>'
        : `<b>${pc.pct.toFixed(0)}%</b><div class="fc-fiscal">`
          + [pc.ars ? fmtPlata(pc.ars, '$') : '', pc.usd ? fmtPlata(pc.usd, 'U$D') : ''].filter(Boolean).join(' + ')
          + '</div>');
    return `<tr class="${f.cerrado ? 'fc-apagado' : ''}">
      <td><div class="fc-cli">${escHtml(t.cliente || '(sin nombre)')}</div>${fiscal}</td>
      <td>${chip} ${escHtml(t.tipo_trabajo || '')}${f.cerrado ? '<div class="fc-fiscal">cerrado sin facturar</div>' : ''}
        ${t.facturacion_nota ? `<div class="fc-fiscal">${escHtml(t.facturacion_nota)}</div>` : ''}</td>
      <td style="text-align:right">${f.min.valor ? (f.min.estimado ? '<span class="fc-est">~</span> ' : '') + fmtPlata(f.min.valor, '$')
          : (f.tipo === 'otra' ? '<span class="fc-fiscal">no lleva aportes</span>' : '—')}</td>
      <td style="text-align:right">${pcTxt}</td>
      <td style="text-align:right">${f.fact ? fmtPlata(f.fact, '$') : '—'}</td>
      <td style="text-align:right">${f.falta > 0 ? '<span class="fc-rojo">' + fmtPlata(f.falta, '$') + '</span>'
          : (f.cerrado ? '—'
            : (f.min.valor ? '<span class="fc-ok">✓</span>' + (f.sobra ? `<div class="fc-fiscal">+${fmtPlata(f.sobra, '$')} sobre el mínimo</div>` : '')
              : '<span class="fc-fiscal">a convenir</span>'))}</td>
      <td style="white-space:nowrap">
        <button class="btn sm" onclick="fcNuevaFactura('${t.id}')" title="Cargar una factura de este trabajo">+ Factura</button>
        <button class="btn sm" onclick="fcAbrirFiscal('${t.id}')" title="Datos para facturar">✎</button>
      </td>
    </tr>`;
  }).join('') + `<tr class="fc-tot">
      <td colspan="2">Totales (sin los cerrados)</td>
      <td style="text-align:right">${fmtPlata(tot.min, '$')}</td>
      <td style="text-align:right"></td>
      <td style="text-align:right">${fmtPlata(tot.fact, '$')}</td>
      <td style="text-align:right">${tot.falta ? '<span class="fc-rojo">' + fmtPlata(tot.falta, '$') + '</span>' : '—'}</td><td></td>
    </tr>`
    : '<tr class="empty-row"><td colspan="7">Todavía no hay trabajos con cobros ni aportes cargados.</td></tr>';

  // Facturas emitidas
  const tbf = document.getElementById('fc-tbody-fact');
  const facs = fcEmitidas().sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
  tbf.innerHTML = facs.length ? facs.map(f => {
    const t = DB.trabajos.find(x => x.id === f.trabajo_id);
    const comp = [f.pto_venta, f.numero].filter(Boolean).join('-');
    return `<tr>
      <td>${f.fecha ? fmtFecha(f.fecha) : '—'}</td>
      <td>${comp ? escHtml(comp) : '—'}${f.concepto ? `<div class="fc-fiscal">${escHtml(f.concepto)}</div>` : ''}</td>
      <td>${escHtml(f.titular || '')}</td>
      <td>${escHtml(f.cliente || '')}</td>
      <td>${t ? escHtml(t.cliente + ' — ' + (t.tipo_trabajo || '')) : '<span class="fc-fiscal">sin vincular</span>'}</td>
      <td style="text-align:right">${fmtPlata(fcNum(f.monto), f.moneda || '$')}</td>
      <td><button class="btn sm" onclick="fcEditarFactura('${f.id}')">✎</button></td>
    </tr>`;
  }).join('') : '<tr class="empty-row"><td colspan="7">No hay facturas cargadas.</td></tr>';

  renderParaDecidir();
  renderDeclaracion();
}

// ── La declaración para la Caja ──────────────────────────────────
// El portal pide los comprobantes emitidos en un período, separados en dos
// pasos: los de trabajos sobre obras y los de otras tareas. Por cada obra
// pide ademas los datos del comitente y de la obra. Esto arma esas dos listas
// tal como van, y avisa de los datos que faltan antes de sentarse a cargarlas.
function renderDeclaracion(){
  const cont = document.getElementById('ddjj-cuerpo');
  if(!cont) return;
  const desde = document.getElementById('ddjj-desde').value;
  const hasta = document.getElementById('ddjj-hasta').value;
  const d = fcDeclaracion(desde, hasta);
  const faltantes = [...d.obras, ...d.otras].filter(f => f.falta.length);
  const celda = v => `<td>${escHtml(v || '')}</td>`;
  const imp = f => `<td style="text-align:right">${fmtPlata(fcNum(f.importe), f.moneda)}</td>`;

  let html = `<div class="ddjj-tot">
    <div>Facturación por obras<b>${fmtPlata(d.totObras, '$')}</b>${d.obras.length} comprobante${d.obras.length === 1 ? '' : 's'}</div>
    <div>Otras tareas<b>${fmtPlata(d.totOtras, '$')}</b>${d.otras.length} comprobante${d.otras.length === 1 ? '' : 's'}</div>
    <div>Total a declarar<b>${fmtPlata(d.totObras + d.totOtras, '$')}</b>el portal suma los dos pasos</div>
  </div>`;

  if(d.sin.length) html += `<div class="ddjj-aviso"><b>${d.sin.length} comprobante${d.sin.length === 1 ? '' : 's'} sin clasificar.</b>
    Hay facturas cuyo trabajo todavía no está marcado como obra o como otra tarea, así que no entran en ninguna de las dos listas:
    ${escHtml(d.sin.map(f => f.cliente || f.trabajo).join(', '))}. Marcalo con el ✎ en la tabla de arriba.</div>`;
  if(faltantes.length) html += `<div class="ddjj-aviso"><b>Faltan datos en ${faltantes.length} comprobante${faltantes.length === 1 ? '' : 's'}.</b>
    ${faltantes.slice(0, 6).map(f => escHtml((f.cliente || '') + ': ' + f.falta.join(', '))).join('<br>')}
    ${faltantes.length > 6 ? '<br>y ' + (faltantes.length - 6) + ' más…' : ''}</div>`;

  html += `<div class="ddjj-sub">Paso 4 · Facturación por obras</div>`;
  html += d.obras.length ? `<div class="table-wrap"><table>
    <thead><tr><th>Fecha</th><th style="text-align:right">Importe</th><th>Comitente</th><th>CUIT</th>
      <th>Domicilio</th><th>Localidad</th><th>Expediente / nomenclatura</th><th>Trabajos efectuados</th><th>N°</th><th>A nombre de</th></tr></thead>
    <tbody>${d.obras.map(f => `<tr>
      <td>${f.fecha ? fmtFecha(f.fecha) : ''}</td>${imp(f)}
      ${celda(f.comitente)}${f.cuit ? celda(f.cuit) : '<td class="ddjj-falta">falta</td>'}
      ${f.domicilio ? celda(f.domicilio) : '<td class="ddjj-falta">falta</td>'}
      ${f.localidad ? celda(f.localidad) : '<td class="ddjj-falta">falta</td>'}
      ${f.expediente ? celda(f.expediente) : '<td class="ddjj-falta">falta</td>'}
      ${celda(f.tarea)}${celda(f.numero)}${celda(f.titular)}</tr>`).join('')}</tbody></table></div>`
    : '<div class="sec-sub">Sin comprobantes de obras en este período.</div>';

  html += `<div class="ddjj-sub">Paso 5 · Otras tareas</div>`;
  html += d.otras.length ? `<div class="table-wrap"><table>
    <thead><tr><th>Fecha</th><th style="text-align:right">Importe</th><th>Tarea profesional realizada</th><th>Cliente</th><th>N°</th><th>A nombre de</th></tr></thead>
    <tbody>${d.otras.map(f => `<tr>
      <td>${f.fecha ? fmtFecha(f.fecha) : ''}</td>${imp(f)}
      ${f.tarea ? celda(f.tarea) : '<td class="ddjj-falta">falta</td>'}
      ${celda(f.cliente)}${celda(f.numero)}${celda(f.titular)}</tr>`).join('')}</tbody></table></div>`
    : '<div class="sec-sub">Sin comprobantes de otras tareas en este período.</div>';

  cont.innerHTML = html;
}
// Las dos listas en texto, separadas por tabulaciones: se pegan derecho en una planilla
function ddjjTexto(sep){
  const desde = document.getElementById('ddjj-desde').value;
  const hasta = document.getElementById('ddjj-hasta').value;
  const d = fcDeclaracion(desde, hasta);
  const q = v => {
    const t = String(v == null ? '' : v);
    return (sep === ',' && /[",;\n]/.test(t)) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  const L = [];
  L.push(['DECLARACIÓN PARA LA CAJA 8470 — del ' + (desde || '…') + ' al ' + (hasta || '…')].join(sep));
  L.push('');
  L.push('FACTURACIÓN POR OBRAS');
  L.push(['Fecha', 'Importe', 'Moneda', 'Comitente', 'CUIT', 'Domicilio', 'Localidad',
          'Expediente / nomenclatura', 'Trabajos efectuados', 'Número', 'A nombre de'].map(q).join(sep));
  d.obras.forEach(f => L.push([f.fecha, fcNum(f.importe), f.moneda, f.comitente, f.cuit, f.domicilio,
                               f.localidad, f.expediente, f.tarea, f.numero, f.titular].map(q).join(sep)));
  L.push(['', 'Total obras', fcNum(d.totObras)].map(q).join(sep));
  L.push('');
  L.push('OTRAS TAREAS');
  L.push(['Fecha', 'Importe', 'Moneda', 'Tarea profesional realizada', 'Cliente', 'Número', 'A nombre de'].map(q).join(sep));
  d.otras.forEach(f => L.push([f.fecha, fcNum(f.importe), f.moneda, f.tarea, f.cliente, f.numero, f.titular].map(q).join(sep)));
  L.push(['', 'Total otras tareas', fcNum(d.totOtras)].map(q).join(sep));
  L.push('');
  L.push(['', 'TOTAL DECLARADO', fcNum(d.totObras + d.totOtras)].map(q).join(sep));
  if(d.sin.length){
    L.push('');
    L.push('SIN CLASIFICAR — no entraron en ninguna lista');
    d.sin.forEach(f => L.push([f.fecha, fcNum(f.importe), f.moneda, f.cliente, f.numero].map(q).join(sep)));
  }
  return L.join('\n');
}
function ddjjCopiar(){
  const txt = ddjjTexto('\t');
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(() => toast('Copiado: pegalo en una planilla'),
                                            () => toast('No se pudo copiar', true));
  } else toast('Este navegador no deja copiar solo', true);
}
function ddjjBajar(){
  const desde = document.getElementById('ddjj-desde').value || 'inicio';
  const hasta = document.getElementById('ddjj-hasta').value || 'hoy';
  const blob = new Blob(['\ufeff' + ddjjTexto(',')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `DDJJ_Caja8470_${desde}_a_${hasta}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

async function fcGuardarParams(){
  const v = id => document.getElementById(id).value.trim();
  try{
    await cfgSet('tope_julia', v('fc-tope-julia'));
    await cfgSet('tope_santiago', v('fc-tope-santiago'));
    await cfgSet('cotiz_usd', v('fc-cotiz'));
    renderFacturacion();
  }catch(e){ toast('No se pudieron guardar los parámetros: ' + e.message, true); }
}

// ── Modal de una factura ──
function fcLlenarSelectTrabajos(){
  const sel = document.getElementById('fc-trabajo');
  // Con cuánto le falta facturar a cada uno: así una inyección se imputa donde sirve
  const ts = [...DB.trabajos].sort((a, b) =>
    String(a.cliente || '').localeCompare(String(b.cliente || ''), 'es', { sensitivity: 'base' }));
  sel.innerHTML = '<option value="">— Sin vincular —</option>' + ts.map(t => {
    const f = fcCerrado(t) ? 0 : Math.max(0, fcMinimo(t).valor - fcFacturadoDe(t));
    const falta = f > 0 ? ' — faltan ' + fmtPlata(f, '$') : '';
    return `<option value="${escHtml(t.id)}">${escHtml((t.cliente || '(sin nombre)') + ' — ' + (t.tipo_trabajo || '') + falta)}</option>`;
  }).join('');
}
function fcTrabajoElegido(){
  const t = DB.trabajos.find(x => x.id === document.getElementById('fc-trabajo').value);
  if(!t) return;
  const cli = document.getElementById('fc-cliente');
  if(!cli.value.trim()) cli.value = t.razon_social || t.cliente || '';
}
function fcNuevaFactura(trabajoId){
  fcLlenarSelectTrabajos();
  document.getElementById('fc-modal-titulo').textContent = 'Cargar factura';
  document.getElementById('fc-id').value = '';
  document.getElementById('fc-fecha').value = new Date().toISOString().slice(0, 10);
  document.getElementById('fc-titular').value = 'Julia';
  document.getElementById('fc-pv').value = cfgGet('pto_venta') || '';
  ['fc-numero', 'fc-monto', 'fc-concepto', 'fc-nota', 'fc-cliente'].forEach(i => document.getElementById(i).value = '');
  document.getElementById('fc-moneda').value = '$';
  document.getElementById('fc-trabajo').value = trabajoId || '';
  document.getElementById('fc-btn-borrar').style.display = 'none';
  if(trabajoId) fcTrabajoElegido();
  openModal('modal-factura');
}
function fcEditarFactura(id){
  const f = DB.facturas.find(x => x.id === id);
  if(!f) return;
  fcLlenarSelectTrabajos();
  document.getElementById('fc-modal-titulo').textContent = 'Editar factura';
  document.getElementById('fc-id').value = f.id;
  document.getElementById('fc-fecha').value = String(f.fecha || '').slice(0, 10);
  document.getElementById('fc-titular').value = f.titular || 'Julia';
  document.getElementById('fc-pv').value = f.pto_venta || '';
  document.getElementById('fc-numero').value = f.numero || '';
  document.getElementById('fc-trabajo').value = f.trabajo_id || '';
  document.getElementById('fc-cliente').value = f.cliente || '';
  document.getElementById('fc-moneda').value = f.moneda || '$';
  document.getElementById('fc-monto').value = f.monto || '';
  document.getElementById('fc-concepto').value = f.concepto || '';
  document.getElementById('fc-nota').value = f.nota || '';
  document.getElementById('fc-btn-borrar').style.display = '';
  openModal('modal-factura');
}
async function fcGuardarFactura(){
  const v = id => document.getElementById(id).value.trim();
  if(!v('fc-fecha')) return toast('Falta la fecha', true);
  if(!fcNum(v('fc-monto'))) return toast('Falta el monto', true);
  // El cliente puede faltar: una inyección propia no tiene cliente. Pero algo
  // tiene que decir, o después no se sabe de qué era.
  if(!v('fc-cliente') && !v('fc-concepto')) return toast('Poné al menos el cliente o el concepto', true);
  const data = {
    fecha: v('fc-fecha'), titular: v('fc-titular'), pto_venta: v('fc-pv'), numero: v('fc-numero'),
    trabajo_id: v('fc-trabajo'), cliente: v('fc-cliente'), moneda: v('fc-moneda'),
    monto: String(fcNum(v('fc-monto'))), concepto: v('fc-concepto'), nota: v('fc-nota'),
  };
  if(v('fc-pv')) await cfgSet('pto_venta', v('fc-pv'));   // el punto de venta se recuerda
  try{
    await fcPersistir('facturas', v('fc-id') || null, data);
    closeModal('modal-factura');
    renderFacturacion();
    toast('Factura guardada');
  }catch(e){ toast('No se pudo guardar: ' + e.message, true); }
}
async function fcBorrarFactura(){
  const id = document.getElementById('fc-id').value;
  if(!id) return;
  if(!confirm('¿Borrar esta factura del registro?')) return;
  try{
    await fcEliminar('facturas', id);
    closeModal('modal-factura');
    renderFacturacion();
    toast('Factura borrada');
  }catch(e){ toast('No se pudo borrar: ' + e.message, true); }
}

// ── Modal de datos para facturar ──
function fcAbrirFiscal(id){
  const t = DB.trabajos.find(x => x.id === id);
  if(!t) return;
  const min = fcMinimo(t), ap = fcAportesCaja(t);
  document.getElementById('fx-titulo').textContent = 'Datos para facturar — ' + (t.cliente || '');
  document.getElementById('fx-id').value = t.id;
  document.getElementById('fx-tipofiscal').value = ['obra','otra'].includes(String(t.tipo_fiscal||'')) ? t.tipo_fiscal : '';
  document.getElementById('fx-razon').value = t.razon_social || '';
  document.getElementById('fx-domicilio').value = t.obra_domicilio || '';
  document.getElementById('fx-localidad').value = t.obra_localidad || '';
  document.getElementById('fx-expediente').value = t.obra_expediente || '';
  document.getElementById('fx-cuit').value = t.cuit || '';
  document.getElementById('fx-iva').value = t.iva || '';
  document.getElementById('fx-minimo').value = fcNum(t.honorario_minimo) || '';
  document.getElementById('fx-sinfact').checked = fcCerrado(t);
  document.getElementById('fx-nota').value = t.facturacion_nota || '';
  document.getElementById('fx-minimo-hint').innerHTML = ap
    ? `Aporte de Caja pagado en este trabajo: <b>${fmtPlata(ap, '$')}</b> → mínimo <b>${fmtPlata(ap / FC_APORTE, '$')}</b> (÷ 0,18). `
      + `<a href="#" onclick="document.getElementById('fx-minimo').value=${Math.round(ap / FC_APORTE)};return false;">usar este número</a>. `
      + 'Si lo dejás vacío, la tabla usa esa misma cuenta.'
    : 'No hay aportes de Caja cargados en este trabajo, así que el mínimo no se puede deducir: cargálo a mano si corresponde.';
  openModal('modal-fiscal');
}
async function fcGuardarFiscal(){
  const v = id => document.getElementById(id).value.trim();
  const id = v('fx-id');
  const data = {
    tipo_fiscal: v('fx-tipofiscal'),
    obra_domicilio: v('fx-domicilio'), obra_localidad: v('fx-localidad'), obra_expediente: v('fx-expediente'),
    razon_social: v('fx-razon'), cuit: v('fx-cuit'), iva: v('fx-iva'),
    honorario_minimo: v('fx-minimo') ? String(fcNum(v('fx-minimo'))) : '',
    sin_facturar: document.getElementById('fx-sinfact').checked ? '1' : '',
    facturacion_nota: v('fx-nota'),
  };
  try{
    await fcPersistir('trabajos', id, data);
    closeModal('modal-fiscal');
    renderFacturacion();
    toast('Datos guardados');
  }catch(e){ toast('No se pudo guardar: ' + e.message, true); }
}

// ==============================
// DASHBOARD
// ==============================

// ── Ingresos para decidir con la contadora ───────────────────────────
// Plata que todavía no entró o que se va a inyectar al banco. Se anota acá antes
// de facturar, la contadora pone a nombre de quién conviene que salga, y cuando se
// emite el comprobante se le carga el número y pasa a ser una factura hecha.
function renderParaDecidir(){
  const tb = document.getElementById('fc-tbody-dec');
  if(!tb) return;
  const ps = fcPropuestas().sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')));
  tb.innerHTML = ps.length ? ps.map(f => {
    const t = DB.trabajos.find(x => x.id === f.trabajo_id);
    const quien = (f.titular || '').trim();
    return `<tr>
      <td>${f.fecha ? fmtFecha(f.fecha) : '—'}</td>
      <td>${escHtml(f.concepto || f.cliente || '(sin describir)')}
        ${t ? `<div class="fc-fiscal">${escHtml(t.cliente || '')}</div>` : ''}</td>
      <td style="text-align:right"><b>${fmtPlata(fcNum(f.monto), f.moneda || '$')}</b></td>
      <td>${quien ? `<span class="fc-chip obra">${escHtml(quien)}</span>` : '<span class="fc-chip sin">lo decide la contadora</span>'}</td>
      <td>${escHtml(f.nota || '')}</td>
      <td style="white-space:nowrap">
        <button class="btn sm" onclick="fcEditarFactura('${f.id}')">✎</button>
      </td>
    </tr>`;
  }).join('') : '<tr class="empty-row"><td colspan="6">No hay nada anotado. Con el botón de arriba se agrega un ingreso que todavía no se facturó.</td></tr>';
}
// Alta rápida de un ingreso a decidir: es una factura sin número
function fcNuevoPendiente(){
  fcNuevaFactura();
  document.getElementById('fc-modal-titulo').textContent = 'Ingreso para decidir';
  document.getElementById('fc-numero').value = '';
  document.getElementById('fc-titular').value = '';
  document.getElementById('fc-cliente').value = '';
}
