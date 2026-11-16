'use strict';
/* ========= Utilidades ========= */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = n => (Number(n) || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const ESTADOS = { camino: 'En camino', stock: 'En stock', publicado: 'Publicado', vendido: 'Vendido' };
const CONDICIONES = ['Nuevo con etiqueta', 'Nuevo sin etiqueta', 'Muy bueno', 'Bueno', 'Satisfactorio'];
const ORIGENES = ['TikTok Shop (puja)', 'TikTok Shop (compra directa)', 'Vinted', 'Wallapop', 'Bala / lote', 'Tienda física', 'Otro'];

let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 3200);
}

/* ========= Almacenamiento (IndexedDB) ========= */
const STORE = 'items';
let _db;
function db() {
  if (_db) return _db;
  _db = new Promise((res, rej) => {
    const r = indexedDB.open('revendedor', 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return _db;
}
async function dbAll() {
  const d = await db();
  return new Promise((res, rej) => { const q = d.transaction(STORE).objectStore(STORE).getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
async function dbPut(it) {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(it); t.oncomplete = res; t.onerror = () => rej(t.error); });
}
async function dbDel(id) {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).delete(id); t.oncomplete = res; t.onerror = () => rej(t.error); });
}

async function dbGet(id) {
  const d = await db();
  return new Promise((res, rej) => { const q = d.transaction(STORE).objectStore(STORE).get(id); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
async function dbClear() {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).clear(); t.oncomplete = res; t.onerror = () => rej(t.error); });
}

/* ========= Ajustes ========= */
const DEF = { provider: 'gemini', apiKey: '', model: 'gemini-2.5-flash', margen: 100 };
function settings() { try { return { ...DEF, ...JSON.parse(localStorage.getItem('rv_settings') || '{}') }; } catch { return { ...DEF }; } }
function saveSettings(s) { localStorage.setItem('rv_settings', JSON.stringify(s)); }

/* ========= Estado ========= */
let items = [];
let tab = 'inv';
let filtro = 'todo';
let busca = '';
let calMes = new Date(); calMes.setDate(1);
let calSel = null;
let charts = [];
let formPhotos = [];

/* ========= Cálculos ========= */
const coste = i => num(i.buyPrice) + num(i.buyShip);
const beneficio = i => num(i.sellPrice) - num(i.sellFees) - coste(i);
const vendidas = () => items.filter(i => i.status === 'vendido' && !i.personal);
const negocio = () => items.filter(i => !i.personal);
const diasEntre = (a, b) => (a && b) ? Math.round((new Date(b) - new Date(a)) / 86400000) : null;

function agrupar(lista, keyFn) {
  const m = new Map();
  for (const i of lista) { const k = keyFn(i); if (!m.has(k)) m.set(k, []); m.get(k).push(i); }
  return [...m.entries()].map(([k, arr]) => {
    const n = arr.length;
    const c = arr.reduce((s, i) => s + coste(i), 0);
    const v = arr.reduce((s, i) => s + num(i.sellPrice), 0);
    const b = arr.reduce((s, i) => s + beneficio(i), 0);
    const dias = arr.map(i => diasEntre(i.dateBought, i.dateSold)).filter(d => d !== null && d >= 0);
    return { k, n, costeMedio: c / n, ventaMedia: v / n, benMedio: b / n, benTotal: b, roi: c > 0 ? (b / c) * 100 : 0, dias: dias.length ? dias.reduce((a, b2) => a + b2, 0) / dias.length : null };
  }).sort((a, b) => b.benMedio - a.benMedio);
}

/* ========= Fotos ========= */
function comprimir(file, max = 1100, q = 0.72) {
  return new Promise((res, rej) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}

/* ========= IA ========= */
function construirPrompt(ctx) {
  return `Eres un experto en vender ropa de segunda mano en Vinted España. Analiza las fotos de la prenda y devuelve SOLO un JSON válido (sin texto extra ni bloques de código) con estas claves:
{"titulo":"","descripcion":"","marca":"","categoria":"","talla":"","precio_orientativo":""}

Reglas:
- "titulo": máximo 60 caracteres, en español, con este orden aproximado: tipo de prenda + marca + color/rasgo clave + talla si se conoce.
- "descripcion": en español, tono natural y cercano, párrafos cortos. Incluye tipo de prenda, marca, color, material y talla solo si se ven o se indican. Menciona el estado con honestidad. Termina con una línea de envío/oferta amable y 3-5 hashtags útiles.
- No inventes medidas, materiales ni marcas que no se vean en las fotos. Si no estás seguro, omite el dato o déjalo en "".
- "precio_orientativo": rango aproximado en euros (por ejemplo "12-18 €") según marca, tipo y estado. Es solo una estimación general, no datos de mercado en tiempo real.

Datos que da el vendedor: marca="${ctx.brand || ''}", talla="${ctx.size || ''}", categoría="${ctx.category || ''}", estado="${ctx.condition || ''}".`;
}
function extraerJSON(txt) {
  const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
  if (a < 0 || b < 0) throw new Error('La IA no devolvió un formato válido. Inténtalo de nuevo.');
  return JSON.parse(txt.slice(a, b + 1));
}
async function generarConIA(fotos, ctx) {
  const s = settings();
  if (!s.apiKey) throw new Error('Falta la clave de API. Ponla en Ajustes.');
  if (!fotos.length) throw new Error('Añade al menos una foto.');
  const imgs = fotos.slice(0, 4).map(p => p.split(',')[1]);
  const prompt = construirPrompt(ctx);
  let txt;
  if (s.provider === 'gemini') {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.model)}:generateContent?key=${encodeURIComponent(s.apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, ...imgs.map(d => ({ inline_data: { mime_type: 'image/jpeg', data: d } }))] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.6 }
      })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message || `Error ${r.status} de la API de Gemini`);
    txt = j?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  } else {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': s.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({
        model: s.model, max_tokens: 1200,
        messages: [{ role: 'user', content: [...imgs.map(d => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: d } })), { type: 'text', text: prompt }] }]
      })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message || `Error ${r.status} de la API de Claude`);
    txt = j?.content?.map(p => p.text || '').join('') || '';
  }
  return extraerJSON(txt);
}

/* ========= Render principal ========= */
function destruirCharts() { charts.forEach(c => c.destroy()); charts = []; }

function pintarTop() {
  const stock = negocio().filter(i => i.status === 'stock' || i.status === 'publicado').length;
  const nube = sb ? ` · ☁ ${cloudUser ? (syncMsg || 'conectado') : 'sin sesión'}` : '';
  $('#topInfo').textContent = `${items.length} prendas · ${stock} a la venta${nube}`;
}

function render() {
  destruirCharts();
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $('#fab').classList.toggle('hidden', tab === 'set');
  pintarTop();
  const v = $('#view');
  if (tab === 'inv') v.innerHTML = vistaInventario();
  else if (tab === 'stats') { v.innerHTML = vistaStats(); pintarCharts(); }
  else if (tab === 'cal') v.innerHTML = vistaCalendario();
  else v.innerHTML = vistaAjustes();
}

/* ---- Inventario ---- */
function vistaInventario() {
  const q = busca.trim().toLowerCase();
  let lista = items.slice().sort((a, b) => (b.created || 0) - (a.created || 0));
  if (filtro !== 'todo') lista = lista.filter(i => i.status === filtro);
  if (q) lista = lista.filter(i => [i.title, i.brand, i.size, i.category, i.lot, i.origin].join(' ').toLowerCase().includes(q));
  const chips = [['todo', 'Todo'], ...Object.entries(ESTADOS)].map(([k, n]) => {
    const c = k === 'todo' ? items.length : items.filter(i => i.status === k).length;
    return `<button class="chip ${filtro === k ? 'on' : ''}" data-act="filtro" data-v="${k}">${n} (${c})</button>`;
  }).join('');
  const cards = lista.map(i => {
    const th = i.photos?.[0] ? `<img class="thumb" src="${i.photos[0]}" alt="">` : `<div class="thumb"></div>`;
    const precio = i.status === 'vendido'
      ? `Vendida ${eur(i.sellPrice)} · <span class="${beneficio(i) >= 0 ? 'pos' : 'neg'}">${beneficio(i) >= 0 ? '+' : ''}${eur(beneficio(i))}</span>`
      : `Coste ${eur(coste(i))}`;
    return `<div class="card item" data-act="edit" data-id="${i.id}">${th}<div style="min-width:0;flex:1">
      <div class="t">${esc(i.title || 'Sin título')}</div>
      <div class="m">${esc([i.brand, i.size && 'Talla ' + i.size, i.lot].filter(Boolean).join(' · '))}</div>
      <div class="m"><span class="badge ${i.status}">${ESTADOS[i.status]}</span>${i.personal ? ' <span class="badge">Personal</span>' : ''} · ${precio}</div></div></div>`;
  }).join('');
  return `<input type="search" id="busca" placeholder="Buscar por título, marca, talla, lote…" value="${esc(busca)}">
    <div class="chips">${chips}</div>
    ${cards || `<div class="card note">Aún no hay prendas aquí. Pulsa <b>+</b> para añadir la primera con fotos.</div>`}`;
}

/* ---- Estadísticas ---- */
function vistaStats() {
  const nb = negocio(), vd = vendidas();
  const invertido = nb.filter(i => i.status !== 'camino' || true).reduce((s, i) => s + coste(i), 0);
  const ingresos = vd.reduce((s, i) => s + num(i.sellPrice) - num(i.sellFees), 0);
  const costeVendidas = vd.reduce((s, i) => s + coste(i), 0);
  const benVendidas = ingresos - costeVendidas;
  const enStockCoste = nb.filter(i => i.status !== 'vendido').reduce((s, i) => s + coste(i), 0);
  const balance = ingresos - invertido;
  const roi = costeVendidas > 0 ? (benVendidas / costeVendidas) * 100 : 0;
  const kpi = (t, v, cls = '') => `<div class="kpi"><small>${t}</small><b class="${cls}">${v}</b></div>`;
  const filas = arr => arr.map(g => `<tr><td>${esc(g.k)}</td><td>${g.n}</td><td>${eur(g.costeMedio)}</td><td>${eur(g.ventaMedia)}</td><td class="${g.benMedio >= 0 ? 'pos' : 'neg'}">${eur(g.benMedio)}</td><td>${g.roi.toFixed(0)}%</td><td>${g.dias === null ? '–' : g.dias.toFixed(0)}</td></tr>`).join('');
  const cab = p => `<thead><tr><th>${p}</th><th>Vend.</th><th>Coste m.</th><th>Venta m.</th><th>Benef. m.</th><th>ROI</th><th>Días</th></tr></thead>`;
  const porMT = agrupar(vd, i => `${i.brand || 'Sin marca'} · ${i.size || '–'}`);
  const porMarca = agrupar(vd, i => i.brand || 'Sin marca');
  const porOrigen = agrupar(vd, i => i.origin || 'Sin origen');
  const porLote = agrupar(vd.filter(i => i.lot), i => i.lot);
  const tabla = (t, arr, p) => arr.length ? `<h3>${t}</h3><div class="card tw"><table>${cab(p)}<tbody>${filas(arr)}</tbody></table></div>` : '';
  return `<div class="grid4">
      ${kpi('Invertido', eur(invertido))}
      ${kpi('Ingresos (neto)', eur(ingresos))}
      ${kpi('Beneficio vendidas', eur(benVendidas), benVendidas >= 0 ? 'pos' : 'neg')}
      ${kpi('ROI vendidas', roi.toFixed(0) + '%', roi >= 0 ? 'pos' : 'neg')}
      ${kpi('Prendas vendidas', vd.length)}
      ${kpi('Dinero en stock', eur(enStockCoste))}
      ${kpi('Balance de caja', eur(balance), balance >= 0 ? 'pos' : 'neg')}
      ${kpi('Beneficio medio', vd.length ? eur(benVendidas / vd.length) : '–')}
    </div>
    <p class="note">Balance de caja = lo que has ingresado menos todo lo que has gastado (incluye prendas aún sin vender). Las prendas marcadas como "uso personal" no cuentan.</p>
    <h3>Gasto e ingresos por mes</h3><div class="card"><canvas id="chMes" height="220"></canvas></div>
    <h3>Balance acumulado</h3><div class="card"><canvas id="chAcum" height="200"></canvas></div>
    ${tabla('Qué marca y talla te salen más rentables', porMT, 'Marca · talla')}
    ${tabla('Por marca', porMarca, 'Marca')}
    ${tabla('Por origen de compra', porOrigen, 'Origen')}
    ${tabla('Por lote / bala', porLote, 'Lote')}
    ${vd.length ? '' : '<div class="card note">Cuando marques prendas como vendidas, aquí aparecerán las medias por marca, talla y origen.</div>'}
    <div class="row"><button class="btn primary" data-act="xlsx">Exportar a Excel</button></div>`;
}
function pintarCharts() {
  if (typeof Chart === 'undefined') return;
  const nb = negocio();
  const meses = new Map();
  const get = k => { if (!meses.has(k)) meses.set(k, { g: 0, i: 0 }); return meses.get(k); };
  nb.forEach(i => { if (i.dateBought) get(i.dateBought.slice(0, 7)).g += coste(i); });
  vendidas().forEach(i => { if (i.dateSold) get(i.dateSold.slice(0, 7)).i += num(i.sellPrice) - num(i.sellFees); });
  const keys = [...meses.keys()].sort();
  if (!keys.length) return;
  const labels = keys.map(k => { const [y, m] = k.split('-'); return MESES[+m - 1].slice(0, 3) + ' ' + y.slice(2); });
  const css = getComputedStyle(document.documentElement);
  const c1 = css.getPropertyValue('--bad').trim() || '#b42318', c2 = css.getPropertyValue('--good').trim() || '#15803d', ink = css.getPropertyValue('--muted').trim() || '#667380';
  const opt = { responsive: true, plugins: { legend: { labels: { color: ink } } }, scales: { x: { ticks: { color: ink } }, y: { ticks: { color: ink, callback: v => v + ' €' } } } };
  charts.push(new Chart($('#chMes'), { type: 'bar', data: { labels, datasets: [{ label: 'Gasto', data: keys.map(k => +meses.get(k).g.toFixed(2)), backgroundColor: c1 }, { label: 'Ingresos', data: keys.map(k => +meses.get(k).i.toFixed(2)), backgroundColor: c2 }] }, options: opt }));
  let acc = 0;
  const acum = keys.map(k => +(acc += meses.get(k).i - meses.get(k).g).toFixed(2));
  charts.push(new Chart($('#chAcum'), { type: 'line', data: { labels, datasets: [{ label: 'Balance acumulado', data: acum, borderColor: css.getPropertyValue('--accent').trim() || '#0f766e', tension: .25, fill: false }] }, options: opt }));
}

/* ---- Calendario ---- */
function vistaCalendario() {
  const y = calMes.getFullYear(), m = calMes.getMonth();
  const primero = new Date(y, m, 1), ultimo = new Date(y, m + 1, 0);
  const offset = (primero.getDay() + 6) % 7;
  const ventas = {};
  vendidas().forEach(i => { if (i.dateSold) (ventas[i.dateSold] ||= []).push(i); });
  let celdas = '';
  for (let k = 0; k < offset; k++) celdas += '<div class="d off"></div>';
  for (let d = 1; d <= ultimo.getDate(); d++) {
    const f = `${y}-${pad(m + 1)}-${pad(d)}`, v = ventas[f];
    celdas += `<div class="d ${v ? 'has' : ''} ${calSel === f ? 'sel' : ''}" data-act="dia" data-f="${f}">${d}${v ? `<b>${v.length} · ${eur(v.reduce((s, i) => s + num(i.sellPrice), 0))}</b>` : ''}</div>`;
  }
  const delMes = vendidas().filter(i => i.dateSold && i.dateSold.startsWith(`${y}-${pad(m + 1)}`));
  const tot = delMes.reduce((s, i) => s + num(i.sellPrice), 0), ben = delMes.reduce((s, i) => s + beneficio(i), 0);
  const detalle = calSel && ventas[calSel] ? `<h3>Ventas del ${calSel.split('-').reverse().join('/')}</h3>` + ventas[calSel].map(i => `<div class="card item" data-act="edit" data-id="${i.id}">${i.photos?.[0] ? `<img class="thumb" src="${i.photos[0]}" alt="">` : '<div class="thumb"></div>'}<div style="min-width:0;flex:1"><div class="t">${esc(i.title || 'Sin título')}</div><div class="m">${eur(i.sellPrice)} · <span class="${beneficio(i) >= 0 ? 'pos' : 'neg'}">${eur(beneficio(i))}</span></div></div></div>`).join('') : '';
  return `<div class="row" style="justify-content:space-between;align-items:center;margin:0 0 10px">
      <button class="btn" data-act="mes" data-v="-1">‹</button><b>${MESES[m]} ${y}</b><button class="btn" data-act="mes" data-v="1">›</button></div>
    <div class="grid3" style="margin-bottom:10px"><div class="kpi"><small>Vendidas</small><b>${delMes.length}</b></div><div class="kpi"><small>Ingresos</small><b>${eur(tot)}</b></div><div class="kpi"><small>Beneficio</small><b class="${ben >= 0 ? 'pos' : 'neg'}">${eur(ben)}</b></div></div>
    <div class="cal">${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(x => `<div class="h">${x}</div>`).join('')}${celdas}</div>${detalle}`;
}

/* ---- Ajustes ---- */
function cardCuenta() {
  const t = '<h3 style="margin-top:0">Cuenta y sincronización</h3>';
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_KEY) return `<div class="card">${t}<p class="note">La nube aún no está configurada. Rellena el archivo <b>config.js</b> con los datos de tu proyecto de Supabase y vuelve a subirlo. Mientras tanto la app funciona solo en este dispositivo.</p></div>`;
  if (!sb) return `<div class="card">${t}<p class="note">No se pudo cargar la librería de la nube (¿sin conexión?). Recarga la página con internet.</p></div>`;
  if (!cloudUser) return `<div class="card">${t}<p class="note">Entra con tu cuenta para que tus prendas y fotos se guarden en la nube y salgan igual en el móvil y en el ordenador.</p>
    <label>Email</label><input type="text" id="aEmail" inputmode="email" autocapitalize="off" autocomplete="username">
    <label>Contraseña (mínimo 6 caracteres)</label><input type="password" id="aPass" autocomplete="current-password" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--card)">
    <div class="row"><button class="btn primary" data-act="signin">Entrar</button><button class="btn" data-act="signup">Crear cuenta</button></div></div>`;
  return `<div class="card">${t}<p class="note">Sesión iniciada como <b>${esc(cloudUser.email || '')}</b></p>
    <p class="note" id="syncEstado">${esc(syncMsg)}</p>
    <div class="row"><button class="btn primary" data-act="syncnow">Sincronizar ahora</button><button class="btn" data-act="signout">Cerrar sesión</button></div>
    <p class="note">La clave de la IA no se sincroniza: tendrás que ponerla en cada dispositivo.</p></div>`;
}

function vistaAjustes() {
  const s = settings();
  return cardCuenta() + `<div class="card"><h3 style="margin-top:0">Conexión con la IA</h3>
    <label>Proveedor</label><select id="sProv"><option value="gemini" ${s.provider === 'gemini' ? 'selected' : ''}>Google Gemini (tiene capa gratuita)</option><option value="anthropic" ${s.provider === 'anthropic' ? 'selected' : ''}>Claude (Anthropic API, de pago)</option></select>
    <label>Clave de API</label><input type="text" id="sKey" value="${esc(s.apiKey)}" placeholder="Pega aquí tu clave" autocomplete="off">
    <label>Modelo</label><input type="text" id="sModel" value="${esc(s.model)}">
    <p class="note">La clave se guarda solo en este dispositivo y se envía directamente al proveedor. No la compartas. Si el modelo deja de existir, cambia aquí su nombre (ejemplos: gemini-3.8-flash, claude-haiku-5-5).</p>
    <div class="row"><button class="btn primary" data-act="saveset">Guardar ajustes</button></div></div>
    <div class="card"><h3 style="margin-top:0">Copia de seguridad</h3>
    <p class="note">Tus datos y fotos viven en este navegador. Si borras los datos del navegador o cambias de móvil, se pierden. Haz copias a menudo.</p>
    <div class="row"><button class="btn" data-act="exportjson">Descargar copia (.json)</button><label class="btn" style="margin:0;color:var(--ink);font-size:16px">Restaurar copia<input type="file" id="impJson" accept="application/json" hidden></label><button class="btn" data-act="xlsx">Exportar a Excel</button></div></div>
    <div class="card"><h3 style="margin-top:0">Acerca de</h3><p class="note">El precio que sugiere la IA es orientativo: no usa datos de mercado en tiempo real. Los gráficos y medias salen de tus propias ventas.</p></div>`;
}

/* ========= Formulario de prenda ========= */
function abrirForm(id) {
  const it = id ? items.find(x => x.id === id) : null;
  formPhotos = it ? [...(it.photos || [])] : [];
  const d = it || { status: 'stock', condition: 'Muy bueno', origin: ORIGENES[0], dateBought: today(), personal: false };
  const sel = (arr, v) => arr.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('');
  const sheet = $('#sheet');
  sheet.innerHTML = `<div class="inner"><form id="frm" autocomplete="off">
    <div class="row" style="justify-content:space-between;align-items:center;margin:0"><h2>${it ? 'Editar prenda' : 'Nueva prenda'}</h2><button type="button" class="btn" data-act="cerrar">Cerrar</button></div>
    <label>Fotos (máx. 8)</label>
    <div class="photos" id="photos"></div>
    <input type="file" id="fileIn" accept="image/*" multiple hidden>
    <div class="row"><button type="button" class="btn primary" id="btnIA" data-act="ia">✨ Generar título y descripción con IA</button></div>
    <div id="iaNote"></div>
    <div class="grid2"><div><label>Marca</label><input type="text" name="brand" value="${esc(d.brand)}"></div><div><label>Talla</label><input type="text" name="size" value="${esc(d.size)}"></div></div>
    <div class="grid2"><div><label>Categoría</label><input type="text" name="category" value="${esc(d.category)}" placeholder="Sudadera, vaqueros…"></div><div><label>Estado de la prenda</label><select name="condition">${sel(CONDICIONES, d.condition)}</select></div></div>
    <label>Título</label><input type="text" name="title" maxlength="100" value="${esc(d.title)}">
    <label>Descripción</label><textarea name="description">${esc(d.description)}</textarea>
    <div class="row"><button type="button" class="btn" data-act="copyt">Copiar título</button><button type="button" class="btn" data-act="copyd">Copiar descripción</button></div>
    <h3>Compra</h3>
    <div class="grid2"><div><label>Origen</label><select name="origin">${sel(ORIGENES, d.origin)}</select></div><div><label>Lote / bala (opcional)</label><input type="text" name="lot" value="${esc(d.lot)}" placeholder="Bala julio"></div></div>
    <div class="grid3"><div><label>Precio (€)</label><input type="number" step="0.01" inputmode="decimal" name="buyPrice" value="${d.buyPrice ?? ''}"></div><div><label>Envío compra (€)</label><input type="number" step="0.01" inputmode="decimal" name="buyShip" value="${d.buyShip ?? ''}"></div><div><label>Fecha compra</label><input type="date" name="dateBought" value="${esc(d.dateBought)}"></div></div>
    <label><input type="checkbox" name="personal" ${d.personal ? 'checked' : ''}> Es para uso personal (no cuenta en las estadísticas)</label>
    <h3>Estado y venta</h3>
    <label>Estado</label><select name="status" id="stSel">${Object.entries(ESTADOS).map(([k, n]) => `<option value="${k}" ${d.status === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <div id="ventaBox" class="${d.status === 'vendido' ? '' : 'hidden'}"><div class="grid3"><div><label>Vendida por (€)</label><input type="number" step="0.01" inputmode="decimal" name="sellPrice" value="${d.sellPrice ?? ''}"></div><div><label>Comisiones/envío (€)</label><input type="number" step="0.01" inputmode="decimal" name="sellFees" value="${d.sellFees ?? ''}"></div><div><label>Fecha venta</label><input type="date" name="dateSold" value="${esc(d.dateSold)}"></div></div></div>
    <label>Notas</label><input type="text" name="notes" value="${esc(d.notes)}">
    <div class="row"><button type="submit" class="btn primary">Guardar</button>${it ? '<button type="button" class="btn danger" data-act="borrar" data-id="' + it.id + '">Eliminar</button>' : ''}</div>
  </form></div>`;
  sheet.classList.remove('hidden');
  sheet.scrollTop = 0;
  pintarFotos();
  $('#stSel').onchange = e => $('#ventaBox').classList.toggle('hidden', e.target.value !== 'vendido');
  $('#fileIn').onchange = async e => {
    const files = [...e.target.files]; e.target.value = '';
    for (const f of files) { if (formPhotos.length >= 8) break; try { formPhotos.push(await comprimir(f)); } catch { toast('Una foto no se pudo leer'); } }
    pintarFotos();
  };
  $('#frm').onsubmit = ev => { ev.preventDefault(); guardarForm(it ? it.id : null); };
}
function pintarFotos() {
  $('#photos').innerHTML = formPhotos.map((p, k) => `<div class="ph"><img src="${p}" alt=""><button type="button" class="x" data-act="quitaf" data-k="${k}">×</button></div>`).join('') +
    (formPhotos.length < 8 ? `<div class="addph" data-act="addf">+ Foto<br>o cámara</div>` : '');
}
async function guardarForm(id) {
  const f = new FormData($('#frm'));
  const g = k => (f.get(k) ?? '').toString().trim();
  const prev = id ? items.find(x => x.id === id) : null;
  const it = {
    id: id || uid(), created: prev?.created || Date.now(), photos: formPhotos,
    title: g('title'), description: g('description'), brand: g('brand'), size: g('size'), category: g('category'), condition: g('condition'),
    origin: g('origin'), lot: g('lot'), buyPrice: num(g('buyPrice')), buyShip: num(g('buyShip')), dateBought: g('dateBought'),
    personal: f.get('personal') === 'on', status: g('status'), notes: g('notes'),
    sellPrice: num(g('sellPrice')), sellFees: num(g('sellFees')), dateSold: g('dateSold'), datePublished: prev?.datePublished || '',
    updatedAt: Date.now(), photoPaths: prev?.photoPaths || []
  };
  if (it.status === 'vendido' && !it.dateSold) it.dateSold = today();
  if (it.status === 'publicado' && !it.datePublished) it.datePublished = today();
  if (it.status !== 'vendido') { it.sellPrice = 0; it.sellFees = 0; it.dateSold = ''; }
  try { await dbPut(it); } catch (e) { toast('No se pudo guardar: ' + (e.message || 'almacenamiento lleno')); return; }
  const k = items.findIndex(x => x.id === it.id);
  if (k >= 0) items[k] = it; else items.push(it);
  cerrarForm(); render(); toast('Guardado');
  cloudSync();
}
function cerrarForm() { $('#sheet').classList.add('hidden'); $('#sheet').innerHTML = ''; }

async function accionIA() {
  const f = $('#frm'); const btn = $('#btnIA'); const note = $('#iaNote');
  const ctx = { brand: f.brand.value, size: f.size.value, category: f.category.value, condition: f.condition.value };
  btn.disabled = true; btn.textContent = 'Analizando fotos…'; note.innerHTML = '';
  try {
    const r = await generarConIA(formPhotos, ctx);
    if (r.titulo) f.title.value = r.titulo;
    if (r.descripcion) f.description.value = r.descripcion;
    if (r.marca && !f.brand.value) f.brand.value = r.marca;
    if (r.categoria && !f.category.value) f.category.value = r.categoria;
    if (r.talla && !f.size.value) f.size.value = r.talla;
    if (r.precio_orientativo) {
      const margen = settings().margen;
      const c = num(f.buyPrice.value) + num(f.buyShip.value);
      const min = c > 0 ? ` Para ganar un ${margen}% sobre tu coste de ${eur(c)}, necesitarías venderla a partir de ${eur(c * (1 + margen / 100))}.` : '';
      note.innerHTML = `<div class="hint">Precio orientativo de la IA: <b>${esc(r.precio_orientativo)}</b> (estimación general, no datos de mercado en tiempo real).${min}</div>`;
    }
    toast('Listo. Revisa el texto antes de publicar.');
  } catch (e) { toast(e.message || 'Error al generar'); }
  btn.disabled = false; btn.textContent = '✨ Generar título y descripción con IA';
}

/* ========= Exportar / importar ========= */
function descargar(blob, nombre) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function exportarExcel() {
  const filas = items.map(i => ({
    Título: i.title, Marca: i.brand, Talla: i.size, Categoría: i.category, Estado_prenda: i.condition, Origen: i.origin, Lote: i.lot,
    Precio_compra: num(i.buyPrice), Envío_compra: num(i.buyShip), Coste_total: coste(i), Fecha_compra: i.dateBought,
    Estado: ESTADOS[i.status], Personal: i.personal ? 'Sí' : 'No', Fecha_publicado: i.datePublished,
    Precio_venta: i.status === 'vendido' ? num(i.sellPrice) : '', Comisiones: i.status === 'vendido' ? num(i.sellFees) : '',
    Beneficio: i.status === 'vendido' ? beneficio(i) : '', Fecha_venta: i.dateSold, Notas: i.notes
  }));
  const vd = vendidas();
  const rg = arr => arr.map(g => ({ Grupo: g.k, Vendidas: g.n, Coste_medio: +g.costeMedio.toFixed(2), Venta_media: +g.ventaMedia.toFixed(2), Beneficio_medio: +g.benMedio.toFixed(2), Beneficio_total: +g.benTotal.toFixed(2), ROI_pct: +g.roi.toFixed(1), Dias_medios: g.dias === null ? '' : +g.dias.toFixed(1) }));
  const mt = rg(agrupar(vd, i => `${i.brand || 'Sin marca'} · ${i.size || '–'}`));
  const mr = rg(agrupar(vd, i => i.brand || 'Sin marca'));
  if (typeof XLSX === 'undefined') { // respaldo en CSV si no cargó la librería
    const cols = Object.keys(filas[0] || { Título: '' });
    const csv = [cols.join(';'), ...filas.map(r => cols.map(c => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(';'))].join('\n');
    descargar(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `reventa-${today()}.csv`); return;
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'Prendas');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mt), 'Marca y talla');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mr), 'Por marca');
  XLSX.writeFile(wb, `reventa-${today()}.xlsx`);
}
function exportarJSON() {
  descargar(new Blob([JSON.stringify({ version: 1, fecha: today(), items })], { type: 'application/json' }), `reventa-copia-${today()}.json`);
}
async function importarJSON(file) {
  try {
    const j = JSON.parse(await file.text());
    if (!Array.isArray(j.items)) throw new Error();
    for (const it of j.items) { if (!it.id) it.id = uid(); it.updatedAt = Date.now(); it.photoPaths = []; delete it.deleted; await dbPut(it); }
    items = (await dbAll()).filter(i => !i.deleted); render(); toast(`Restauradas ${j.items.length} prendas`);
    cloudSync();
  } catch { toast('Archivo de copia no válido'); }
}

/* ========= Nube (Supabase): cuentas y sincronización ========= */
/* Cada prenda se guarda como una fila (campos) + fotos en un almacén privado.
   Gana siempre la versión más reciente (updatedAt). Los borrados se propagan con "lápidas" (deleted:true). */
const CFG = window.REVENTIX_CONFIG || {};
let sb = null, cloudUser = null, syncing = false, syncAgain = false, syncMsg = '';

function initCloud() {
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_KEY || !window.supabase) return;
  try { sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY); } catch { sb = null; return; }
  sb.auth.getSession().then(({ data }) => {
    cloudUser = data?.session?.user || null;
    pintarTop(); if (tab === 'set') render();
    if (cloudUser) cloudSync();
  });
  sb.auth.onAuthStateChange((ev, session) => {
    cloudUser = session?.user || null;
    if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') setTimeout(() => { render(); cloudSync(); }, 0);
  });
}

function hashFoto(dataUrl) { // hash del contenido de la foto (sin la cabecera data:)
  const s = dataUrl.split(',')[1] || dataUrl; let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16) + '-' + s.length.toString(16);
}
async function dataABlob(d) { return (await fetch(d)).blob(); }
function blobAData(b) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); }); }

async function pushItem(it) {
  const bucket = sb.storage.from('photos');
  if (it.deleted) {
    const old = it.photoPaths || [];
    if (old.length) await bucket.remove(old);
    const { error } = await sb.from('items').upsert({ id: it.id, data: {}, photo_paths: [], updated_at: it.updatedAt, deleted: true });
    if (error) throw error;
    const cur = await dbGet(it.id);
    if (cur && cur.updatedAt === it.updatedAt) { cur.photoPaths = []; await dbPut(cur); }
    return;
  }
  const fotos = it.photos || [];
  const paths = fotos.map(p => `${cloudUser.id}/${it.id}/${hashFoto(p)}.jpg`);
  const old = it.photoPaths || [];
  for (let k = 0; k < fotos.length; k++) {
    if (old.includes(paths[k])) continue;
    const { error } = await bucket.upload(paths[k], await dataABlob(fotos[k]), { upsert: true, contentType: 'image/jpeg' });
    if (error) throw error;
  }
  const sobran = old.filter(p => !paths.includes(p));
  if (sobran.length) await bucket.remove(sobran);
  const { photos: _f, photoPaths: _p, ...data } = it;
  const { error } = await sb.from('items').upsert({ id: it.id, data, photo_paths: paths, updated_at: it.updatedAt, deleted: false });
  if (error) throw error;
  const cur = await dbGet(it.id); // por si se editó mientras subíamos: solo actualizamos si sigue siendo la misma versión
  if (cur && cur.updatedAt === it.updatedAt) { cur.photoPaths = paths; await dbPut(cur); }
}

async function pullItem(id) {
  const { data: row, error } = await sb.from('items').select('*').eq('id', id).single();
  if (error) throw error;
  const loc = await dbGet(id);
  if (row.deleted) {
    if (loc) await dbPut({ id, deleted: true, updatedAt: row.updated_at, photos: [], photoPaths: [] });
    return;
  }
  const fotos = [], ok = [];
  for (const p of row.photo_paths || []) {
    const k = loc?.photoPaths ? loc.photoPaths.indexOf(p) : -1;
    if (k >= 0 && loc.photos?.[k]) { fotos.push(loc.photos[k]); ok.push(p); continue; }
    const { data: blob, error: e2 } = await sb.storage.from('photos').download(p);
    if (e2 || !blob) continue;
    fotos.push(await blobAData(blob)); ok.push(p);
  }
  await dbPut({ ...row.data, id, photos: fotos, photoPaths: ok, updatedAt: row.updated_at, deleted: false });
}

function setSync(m) { syncMsg = m; pintarTop(); if (tab === 'set') { const n = $('#syncEstado'); if (n) n.textContent = m; } }

async function cloudSync(manual = false) {
  if (!sb || !cloudUser) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true; setSync('Sincronizando…');
  let cambios = 0;
  try {
    const { data: remoto, error } = await sb.from('items').select('id,updated_at,deleted');
    if (error) throw error;
    const rmap = new Map(remoto.map(r => [r.id, r]));
    const local = await dbAll();
    const lmap = new Map(local.map(l => [l.id, l]));
    const aBajar = remoto.filter(r => { const l = lmap.get(r.id); return l ? r.updated_at > l.updatedAt : !r.deleted; });
    const aSubir = local.filter(l => { const r = rmap.get(l.id); return r ? l.updatedAt > r.updated_at : !l.deleted; });
    for (const l of aSubir) { await pushItem(l); cambios++; }
    for (const r of aBajar) { await pullItem(r.id); cambios++; }
    items = (await dbAll()).filter(i => !i.deleted);
    setSync('Sincronizado ' + new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }));
    if (cambios) render();
    if (manual) toast(cambios ? `Sincronizado (${cambios} cambios)` : 'Todo está al día');
  } catch (e) {
    setSync('Error al sincronizar');
    if (manual) toast('No se pudo sincronizar: ' + (e.message || 'error de red'));
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; cloudSync(); }
  }
}

async function cuenta(modo) {
  const email = ($('#aEmail')?.value || '').trim(), pass = $('#aPass')?.value || '';
  if (!email || pass.length < 6) { toast('Pon tu email y una contraseña de al menos 6 caracteres'); return; }
  try {
    if (modo === 'signup') {
      const { data, error } = await sb.auth.signUp({ email, password: pass });
      if (error) throw error;
      toast(data.session ? 'Cuenta creada' : 'Cuenta creada. Confirma tu email y luego entra.');
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
    }
  } catch (e) { toast(e.message || 'Error de cuenta'); }
}
async function cerrarSesion() {
  await cloudSync(); // sube lo pendiente antes de salir
  const borrar = confirm('¿Quieres borrar también los datos de ESTE dispositivo? Seguirán guardados en la nube. Pulsa Cancelar para conservarlos aquí.');
  await sb.auth.signOut();
  if (borrar) { await dbClear(); items = []; }
  render();
}

/* ========= Eventos ========= */
document.addEventListener('click', async e => {
  const tb = e.target.closest('.tabs button');
  if (tb) { tab = tb.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act;
  if (a === 'new') abrirForm(null);
  else if (a === 'edit') abrirForm(el.dataset.id);
  else if (a === 'cerrar') cerrarForm();
  else if (a === 'filtro') { filtro = el.dataset.v; render(); }
  else if (a === 'addf') $('#fileIn').click();
  else if (a === 'quitaf') { formPhotos.splice(+el.dataset.k, 1); pintarFotos(); }
  else if (a === 'ia') accionIA();
  else if (a === 'copyt' || a === 'copyd') {
    const v = $('#frm')[a === 'copyt' ? 'title' : 'description'].value;
    try { await navigator.clipboard.writeText(v); toast('Copiado'); } catch { toast('No se pudo copiar'); }
  }
  else if (a === 'borrar') {
    if (!confirm('¿Eliminar esta prenda y sus fotos? No se puede deshacer.')) return;
    const id = el.dataset.id, viejo = items.find(x => x.id === id);
    // Se deja una "lápida" para que el borrado llegue también a los demás dispositivos
    await dbPut({ id, deleted: true, updatedAt: Date.now(), photos: [], photoPaths: viejo?.photoPaths || [] });
    items = items.filter(x => x.id !== id); cerrarForm(); render(); toast('Eliminada');
    cloudSync();
  }
  else if (a === 'signin' || a === 'signup') cuenta(a);
  else if (a === 'signout') cerrarSesion();
  else if (a === 'syncnow') cloudSync(true);
  else if (a === 'mes') { calMes.setMonth(calMes.getMonth() + +el.dataset.v); calSel = null; render(); }
  else if (a === 'dia') { calSel = el.dataset.f; render(); }
  else if (a === 'xlsx') exportarExcel();
  else if (a === 'exportjson') exportarJSON();
  else if (a === 'saveset') {
    const s = settings();
    s.provider = $('#sProv').value; s.apiKey = $('#sKey').value.trim(); s.model = $('#sModel').value.trim() || DEF.model;
    saveSettings(s); toast('Ajustes guardados');
  }
});
document.addEventListener('input', e => {
  if (e.target.id === 'busca') {
    busca = e.target.value; const pos = e.target.selectionStart; render();
    const n = $('#busca'); if (n) { n.focus(); n.setSelectionRange(pos, pos); }
  }
});
document.addEventListener('change', e => {
  if (e.target.id === 'sProv') {
    const m = $('#sModel'); const s = settings();
    if (e.target.value === 'anthropic' && /^gemini/.test(m.value)) m.value = 'claude-haiku-5-5';
    if (e.target.value === 'gemini' && /^claude/.test(m.value)) m.value = DEF.model;
  }
  if (e.target.id === 'impJson' && e.target.files[0]) importarJSON(e.target.files[0]);
});

/* ========= Arranque ========= */
(async function init() {
  try {
    const todo = await dbAll();
    for (const i of todo) if (!i.updatedAt) { i.updatedAt = i.created || Date.now(); await dbPut(i); } // datos de la versión anterior
    items = todo.filter(i => !i.deleted);
  } catch { toast('No se pudo abrir el almacenamiento del navegador'); }
  initCloud();
  render();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') cloudSync(); });
  window.addEventListener('online', () => cloudSync());
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
})();
