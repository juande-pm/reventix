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
const PLANT_DEF = {
  plantTitulo: '{tipo} {marca} - Talla {talla}',
  plantArriba: 'Medidas:\nHombro a hombro: cm\nCuello hasta abajo: cm\n\nEnvío entre 24 y 48h!!',
  plantAbajo: 'Medidas:\nCintura: cm\nLargo: cm\nTiro: cm\n\nEnvío entre 24 y 48h!!'
};
const DEF = { provider: 'gemini', apiKey: '', model: 'gemini-3.8-flash', margen: 100, ...PLANT_DEF };
function settings() { try { return { ...DEF, ...JSON.parse(localStorage.getItem('rv_settings') || '{}') }; } catch { return { ...DEF }; } }
function saveSettings(s) { localStorage.setItem('rv_settings', JSON.stringify(s)); }

/* ========= Estado ========= */
let items = [];
let tab = 'inv';
let filtro = 'todo';
let busca = '';
let calMes = new Date(); calMes.setDate(1);
let periodo = 'mes', dim = 'mt', orden = 'n';
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
  for (const i of lista) {
    const k0 = String(keyFn(i)).trim(), id = k0.toLowerCase();
    if (!m.has(id)) m.set(id, { k: k0, arr: [] });
    m.get(id).arr.push(i);
  }
  return [...m.values()].map(({ k, arr }) => {
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
  const limpia = t => String(t || '').replace(/"""/g, '"').trim().slice(0, 2500);
  const tt = limpia(ctx.title), dd = limpia(ctx.description);
  const previo = (tt || dd) ? `

El vendedor YA ha escrito esto (puede estar a medias o desordenado):
TÍTULO ACTUAL: """${tt}"""
DESCRIPCIÓN ACTUAL: """${dd}"""
Reglas sobre ese texto del vendedor:
- Es información fiable que él conoce de primera mano (medidas, defectos, material, uso, motivo de venta…). CONSERVA todos sus datos concretos tal cual (cifras, medidas, defectos, composición) en la nueva descripción: no los cambies ni los omitas.
- Mejora la redacción y la estructura, y completa lo que falte con lo que se vea en las fotos, pero no contradigas lo que él ha escrito.
- Si su título ya es bueno, puedes mantenerlo o pulirlo un poco.` : '';
  return `Eres un experto en vender ropa de segunda mano en Vinted España. Analiza las fotos de la prenda y devuelve SOLO un JSON válido (sin texto extra ni bloques de código) con estas claves:
{"titulo":"","descripcion":"","marca":"","categoria":"","talla":"","precio_orientativo":""}

Reglas:
- "titulo": máximo 90 caracteres, en español, pensado para llamar la atención y aparecer en las búsquedas de Vinted. Formato: "<Tipo de prenda> <Marca> <color o rasgo clave> <2-4 palabras clave de estilo> - Talla <talla>" (la talla siempre al final, separada con un guion). Las palabras clave de estilo (por ejemplo Y2K, Vintage, Retro, Old Money, Gorpcore, 90s, Streetwear, Oversize, Deportivo) solo van si de verdad encajan con la prenda: no pongas etiquetas que no apliquen. Sin emojis, sin palabras enteras en MAYÚSCULAS y sin hashtags en el título. Si no se sabe la talla, no pongas el guion ni "Talla".
- "descripcion": en español, tono natural y cercano, párrafos cortos. Incluye tipo de prenda, marca, color, material y talla solo si se ven o se indican. Menciona el estado con honestidad. Termina con una línea de envío/oferta amable y, en la última línea, 6-8 hashtags relevantes y buscables en minúsculas (marca, tipo de prenda, estilo o época; por ejemplo #adidas #sudadera #y2k #vintage #streetwear), sin repetir y solo los que apliquen a la prenda.
- No inventes medidas, materiales ni marcas que no se vean en las fotos ni los haya escrito el vendedor. Si no estás seguro, omite el dato o déjalo en "".
- "precio_orientativo": rango aproximado en euros (por ejemplo "12-18 €") según marca, tipo y estado. Es solo una estimación general, no datos de mercado en tiempo real.

Datos que da el vendedor: marca="${ctx.brand || ''}", talla="${ctx.size || ''}", categoría="${ctx.category || ''}", estado="${ctx.condition || ''}".${previo}`;
}
function extraerJSON(txt) {
  const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
  const falla = () => Object.assign(new Error('La IA no devolvió un formato válido. Inténtalo de nuevo.'), { code: 'formato' });
  if (a < 0 || b < a) throw falla();
  try { return JSON.parse(txt.slice(a, b + 1)); } catch { throw falla(); }
}

/* --- Llamadas a la IA: siempre con tiempo límite, para que nunca se quede colgada --- */
let IA_TIMEOUT_MS = 40000;  // por intento al generar un anuncio
let IA_LISTA_MS = 15000;    // al pedir la lista de modelos
let IA_PRUEBA_MS = 30000;   // en la prueba de conexión
let iaCtl = null;           // permite cancelar desde el botón o al cerrar el formulario
function cancelarIA() { if (iaCtl) iaCtl.abort(); }

const esperar = (ms, ext) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  if (ext) ext.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('cancelado'), { code: 'cancelado' })); }, { once: true });
});

// fetch + lectura del JSON dentro del mismo tiempo límite. Errores con .code = 'timeout' | 'cancelado' | 'red'
async function pedirJSON(url, opts, ms, ext) {
  const ctl = new AbortController();
  let vencio = false;
  const t = setTimeout(() => { vencio = true; ctl.abort(); }, ms);
  const alCancelar = () => ctl.abort();
  if (ext) { if (ext.aborted) ctl.abort(); else ext.addEventListener('abort', alCancelar); }
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    let j = {};
    try { j = await r.json(); } catch (e) { if (vencio || (ext && ext.aborted)) throw e; }
    return { status: r.status, ok: r.ok, j: j || {} };
  } catch (e) {
    if (vencio) throw Object.assign(new Error('tiempo agotado'), { code: 'timeout' });
    if (ext && ext.aborted) throw Object.assign(new Error('cancelado'), { code: 'cancelado' });
    throw Object.assign(new Error((e && e.message) || 'sin conexión'), { code: 'red' });
  } finally {
    clearTimeout(t);
    if (ext) ext.removeEventListener('abort', alCancelar);
  }
}

function errorIA(status, j, modelo) {
  const raw = j && j.error ? (j.error.message || j.error.type || '') : '';
  const m = String(raw).replace(/key=[^&\s]+/g, 'key=…').slice(0, 160);
  let txt;
  if (status === 400 && /api key|api_key|key not valid|invalid.*key/i.test(m)) txt = 'La clave de API no es válida. Revísala en Ajustes.';
  else if (status === 401 || status === 403) txt = `La clave no es válida o no tiene permiso para este modelo (error ${status}). Revísala en Ajustes.`;
  else if (status === 404) txt = `El modelo "${modelo}" no existe o no está disponible con tu clave. En Ajustes pulsa "Probar conexión" para ver cuáles puedes usar.`;
  else if (status === 429) txt = 'Has llegado al límite de uso gratuito o hay demasiadas peticiones. Espera un minuto e inténtalo otra vez.';
  else if (status >= 500) txt = `El servidor de la IA está saturado o fallando (error ${status}).`;
  else txt = `La IA devolvió el error ${status}${m ? ': ' + m : ''}.`;
  return Object.assign(new Error(txt), { status, reintentable: status >= 500 });
}
function textoErrorIA(e, seg = Math.round(IA_TIMEOUT_MS / 1000), intentos = 1) {
  if (e.code === 'timeout') return `La IA no respondió en ${seg} s${intentos > 1 ? ` (se probó ${intentos} veces)` : ''}. Suele ser un problema temporal de Google con ese modelo: en Ajustes pulsa "Probar conexión" y elige otro, o inténtalo más tarde.`;
  if (e.code === 'red') return 'No hay conexión con la IA. Revisa tu internet (o la VPN) e inténtalo de nuevo.';
  return e.message || 'Error desconocido';
}

// Reduce la foto antes de enviarla: manda menos datos y la IA contesta antes
function reducirParaIA(dataUrl, max = 768, q = 0.7) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL('image/jpeg', q).split(',')[1]);
    };
    img.onerror = () => rej(new Error('No se pudo preparar una foto para la IA'));
    img.src = dataUrl;
  });
}

const URL_GEMINI = (modelo, key) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent?key=${encodeURIComponent(key)}`;

async function llamarGemini(s, prompt, imgs, modoJson, ext) {
  const cuerpo = {
    contents: [{ parts: [{ text: prompt }, ...imgs.map(d => ({ inline_data: { mime_type: 'image/jpeg', data: d } }))] }],
    generationConfig: { temperature: 0.6 }
  };
  if (modoJson) cuerpo.generationConfig.responseMimeType = 'application/json';
  const r = await pedirJSON(URL_GEMINI(s.model, s.apiKey), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) }, IA_TIMEOUT_MS, ext);
  if (!r.ok) throw errorIA(r.status, r.j, s.model);
  const c = r.j.candidates && r.j.candidates[0];
  const txt = c && c.content && c.content.parts ? c.content.parts.map(p => p.text || '').join('') : '';
  if (!txt) {
    const br = r.j.promptFeedback && r.j.promptFeedback.blockReason;
    throw Object.assign(new Error(br ? `La IA bloqueó la petición (${br}). Prueba con otras fotos.` : 'La IA no devolvió texto. Inténtalo de nuevo.'), { reintentable: !br });
  }
  return txt;
}

async function llamarClaude(s, prompt, imgs, ext) {
  const r = await pedirJSON('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': s.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({
      model: s.model, max_tokens: 1200,
      messages: [{ role: 'user', content: [...imgs.map(d => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: d } })), { type: 'text', text: prompt }] }]
    })
  }, IA_TIMEOUT_MS, ext);
  if (!r.ok) throw errorIA(r.status, r.j, s.model);
  const txt = (r.j.content || []).map(p => p.text || '').join('');
  if (!txt) throw Object.assign(new Error('La IA no devolvió texto. Inténtalo de nuevo.'), { reintentable: true });
  return txt;
}

// ext: AbortSignal para cancelar. alIntento(n, max): aviso de progreso.
async function generarConIA(fotos, ctx, ext, alIntento) {
  const s = settings();
  if (!s.apiKey) throw new Error('Falta la clave de API. Ponla en Ajustes.');
  if (!fotos.length) throw new Error('Añade al menos una foto.');
  const imgs = [];
  for (const p of fotos.slice(0, 4)) imgs.push(await reducirParaIA(p));
  const prompt = construirPrompt(ctx);
  const MAX = 2;
  let ultimo = null, n = 0;
  for (n = 1; n <= MAX; n++) {
    if (alIntento) alIntento(n, MAX);
    try {
      // 1.º intento con "modo JSON"; si falla, el 2.º va en modo normal (a veces el modo JSON es lo que se atasca)
      const txt = s.provider === 'gemini' ? await llamarGemini(s, prompt, imgs, n === 1, ext) : await llamarClaude(s, prompt, imgs, ext);
      return extraerJSON(txt);
    } catch (e) {
      if (e.code === 'cancelado') throw e;
      ultimo = e;
      const reintentar = e.code === 'timeout' || e.code === 'red' || e.code === 'formato' || e.reintentable;
      if (!reintentar || n === MAX) break;
      await esperar(1200, ext);
    }
  }
  throw Object.assign(new Error(textoErrorIA(ultimo, undefined, Math.min(n, MAX))), { code: ultimo.code });
}

/* --- Tasación y chat: reutilizan las mismas llamadas con tiempo límite --- */
const llamarIA = (s, prompt, imgs, json, ext) => s.provider === 'gemini' ? llamarGemini(s, prompt, imgs, json, ext) : llamarClaude(s, prompt, imgs, ext);

async function imgsIA(fotos, n = 3) {
  const imgs = [];
  for (const p of (fotos || []).slice(0, n)) imgs.push(await reducirParaIA(p));
  return imgs;
}

// Repite una operación de IA si falla por algo temporal (tiempo agotado, red, 5xx, formato). hacer(n) hace una llamada.
async function conReintentos(hacer, ext, alIntento, MAX = 2) {
  let ultimo = null, n;
  for (n = 1; n <= MAX; n++) {
    if (alIntento) alIntento(n, MAX);
    try { return await hacer(n); }
    catch (e) {
      if (e.code === 'cancelado') throw e;
      ultimo = e;
      const reintentar = e.code === 'timeout' || e.code === 'red' || e.code === 'formato' || e.reintentable;
      if (!reintentar || n === MAX) break;
      await esperar(1200, ext);
    }
  }
  throw Object.assign(new Error(textoErrorIA(ultimo, undefined, Math.min(n, MAX))), { code: ultimo.code });
}

const mediana = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const redondea = x => Math.round(x * 100) / 100;

// Precios sueltos que el vendedor ha copiado de anuncios parecidos ("18, 22 €, 15,50")
function parseComps(t) {
  return (String(t || '').match(/\d+(?:[.,]\d{1,2})?/g) || []).map(num).filter(x => x > 0 && x < 5000);
}

// Lo que ya has vendido de esa marca (y de esa talla), con tus propios datos
function historialPropio(marca, talla, exceptoId) {
  const b = String(marca || '').trim().toLowerCase();
  if (!b) return { n: 0 };
  const l = vendidas().filter(i => String(i.brand || '').trim().toLowerCase() === b && i.id !== exceptoId && num(i.sellPrice) > 0);
  if (!l.length) return { n: 0 };
  const t = String(talla || '').trim().toLowerCase();
  const lt = t ? l.filter(i => String(i.size || '').trim().toLowerCase() === t) : [];
  const dias = l.map(i => diasEntre(i.datePublished || i.dateBought, i.dateSold)).filter(d => d !== null && d >= 0);
  const ventas = l.map(i => num(i.sellPrice));
  return {
    n: l.length, mediana: redondea(mediana(ventas)), min: Math.min(...ventas), max: Math.max(...ventas),
    dias: dias.length ? Math.round(mediana(dias)) : null,
    nTalla: lt.length, medianaTalla: lt.length ? redondea(mediana(lt.map(i => num(i.sellPrice)))) : null
  };
}

function datosTasacion(f, exceptoId) {
  const g = k => (f[k] ? String(f[k].value || '').trim() : '');
  const comps = parseComps(g('comps'));
  return {
    brand: g('brand'), size: g('size'), category: g('category'), condition: g('condition'), title: g('title'), description: g('description'),
    coste: num(g('buyPrice')) + num(g('buyShip')), comps, medComps: comps.length ? redondea(mediana(comps)) : null,
    hist: historialPropio(g('brand'), g('size'), exceptoId)
  };
}

function construirPromptTasacion(d) {
  const h = d.hist || { n: 0 };
  const propio = h.n
    ? `Ventas REALES anteriores del vendedor de esta marca: ${h.n} (mediana ${h.mediana} €, entre ${h.min} y ${h.max} €${h.dias !== null ? `, tardó una mediana de ${h.dias} días en venderlas` : ''}).${h.nTalla ? ` De la misma talla: ${h.nTalla} (mediana ${h.medianaTalla} €).` : ''}`
    : 'El vendedor no tiene ventas anteriores de esta marca.';
  const comps = d.comps.length
    ? `Precios de ${d.comps.length} anuncios parecidos que el vendedor ha visto publicados (precio pedido, no vendido; mediana ${d.medComps} €): ${d.comps.join(', ')} €.`
    : 'El vendedor no ha aportado precios de anuncios parecidos.';
  const limpia = t => String(t || '').replace(/"""/g, '"').slice(0, 1500);
  return `Eres un experto en reventa de ropa de segunda mano en Vinted y Wallapop España. Tasa el precio al que PUBLICAR esta prenda, mirando las fotos y los datos. Devuelve SOLO un JSON válido (sin texto extra ni bloques de código):
{"minimo":0,"recomendado":0,"maximo":0,"razon":"","consejos":[""],"confianza":""}

Reglas:
- Precios en euros como números (sin símbolo). Se cumple minimo <= recomendado <= maximo.
- "recomendado": precio de publicación razonable para venderla en unas pocas semanas, dejando algo de margen para negociar. "minimo": hasta dónde se podría bajar. "maximo": precio de salida optimista.
- Tienes en cuenta marca, tipo de prenda, estado real que se ve en las fotos y los datos del vendedor.
- Si hay ventas anteriores del vendedor o anuncios parecidos, dales mucho peso: son datos reales. Los anuncios son precio pedido, no precio final de venta.
- No tienes acceso a precios de mercado en tiempo real: no inventes cifras de mercado ni cites anuncios que no se te hayan dado.
- "razon": 1-3 frases en español explicando en qué te basas. "consejos": como máximo 3 consejos cortos (negociación, fotos, momento de bajar precio). "confianza": "baja", "media" o "alta" según la cantidad de datos reales.

Datos de la prenda: marca="${d.brand}", talla="${d.size}", categoría="${d.category}", estado="${d.condition}".
Lo que pagó el vendedor (coste total): ${d.coste > 0 ? d.coste + ' €' : 'no indicado'}.
Título del vendedor: """${limpia(d.title)}"""
Descripción del vendedor (fiable: medidas, defectos…): """${limpia(d.description)}"""
${propio}
${comps}`;
}

// Convierte la respuesta de la IA en cifras seguras (o lanza error de formato para reintentar)
function normalizarTasa(j) {
  const n = v => { const x = typeof v === 'number' ? v : num(v); return isFinite(x) && x > 0 && x < 100000 ? redondea(x) : null; };
  const rec = n(j && (j.recomendado ?? j.recomendada));
  if (rec === null) throw Object.assign(new Error('La IA no devolvió un precio válido. Inténtalo de nuevo.'), { code: 'formato' });
  let min = n(j.minimo ?? j.min), max = n(j.maximo ?? j.max);
  if (min === null || min > rec) min = rec;
  if (max === null || max < rec) max = rec;
  const consejos = Array.isArray(j.consejos) ? j.consejos.map(c => String(c || '').trim()).filter(Boolean).slice(0, 3) : [];
  const conf = ['baja', 'media', 'alta'].includes(String(j.confianza || '').toLowerCase()) ? String(j.confianza).toLowerCase() : '';
  return { min, rec, max, razon: String(j.razon || '').slice(0, 600), consejos, confianza: conf };
}

async function tasarConIA(fotos, d, ext, alIntento) {
  const s = settings();
  if (!s.apiKey) throw new Error('Falta la clave de API. Ponla en Ajustes.');
  const imgs = await imgsIA(fotos, 3);
  const prompt = construirPromptTasacion(d);
  return conReintentos(async n => normalizarTasa(extraerJSON(await llamarIA(s, prompt, imgs, n === 1, ext))), ext, alIntento);
}

/* --- Chat sobre la prenda --- */
function contextoPrenda(d, tasa) {
  const h = d.hist || { n: 0 };
  return [
    `Marca: ${d.brand || '?'}; talla: ${d.size || '?'}; categoría: ${d.category || '?'}; estado: ${d.condition || '?'}.`,
    d.title ? `Título: ${d.title}` : '', d.description ? `Descripción: ${String(d.description).slice(0, 1500)}` : '',
    d.coste > 0 ? `Coste total para el vendedor: ${d.coste} €.` : '',
    h.n ? `Ventas anteriores de esa marca: ${h.n}, mediana ${h.mediana} €.` : '',
    d.comps && d.comps.length ? `Precios de anuncios parecidos: ${d.comps.join(', ')} €.` : '',
    tasa ? `Tasación previa de la IA: mínimo ${tasa.min} €, recomendado ${tasa.rec} €, máximo ${tasa.max} €.` : ''
  ].filter(Boolean).join('\n');
}

function construirPromptChat(d, tasa, historial) {
  const conv = historial.slice(-10).map(m => `${m.rol === 'user' ? 'Vendedor' : 'Asistente'}: ${m.texto}`).join('\n');
  return `Eres un asistente experto en reventa de ropa de segunda mano en Vinted y Wallapop España. Responde en español, de forma breve y práctica (máximo unas 8 líneas). No tienes acceso a precios de mercado en tiempo real ni a internet: si no lo sabes con seguridad, dilo. No inventes datos de la prenda que no estén en las fotos o en el contexto.

Contexto de la prenda (las fotos van adjuntas):
${contextoPrenda(d, tasa)}

Conversación hasta ahora:
${conv}

Responde al último mensaje del vendedor.`;
}

async function chatearConIA(fotos, d, tasa, historial, ext, alIntento) {
  const s = settings();
  if (!s.apiKey) throw new Error('Falta la clave de API. Ponla en Ajustes.');
  const imgs = await imgsIA(fotos, 3);
  const prompt = construirPromptChat(d, tasa, historial);
  return conReintentos(async () => {
    const t = (await llamarIA(s, prompt, imgs, false, ext)).trim();
    if (!t) throw Object.assign(new Error('La IA no devolvió texto. Inténtalo de nuevo.'), { reintentable: true });
    return t;
  }, ext, alIntento);
}

/* --- Prueba de conexión (Ajustes): comprueba la clave, el modelo y cuánto tarda --- */
const PROB_EXCLUIR = /image|tts|live|audio|embed|robotics|computer-use|imagen|veo|gemma/i;
async function probarIA() {
  const out = $('#iaTest'); if (!out) return;
  const s = { ...settings(), provider: $('#sProv').value, apiKey: $('#sKey').value.trim(), model: $('#sModel').value.trim() || DEF.model };
  if (!s.apiKey) { out.innerHTML = '<div class="hint">Pega primero tu clave de API.</div>'; return; }
  out.innerHTML = '<p class="note">Comprobando la conexión… (puede tardar hasta unos 45 s)</p>';
  const linea = (ok, t) => `<p class="note">${ok ? '✅' : '❌'} ${t}</p>`;
  let html = '', modelos = [], sugeridos = [];
  try {
    if (s.provider === 'gemini') {
      try {
        const r = await pedirJSON(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(s.apiKey)}`, { method: 'GET' }, IA_LISTA_MS);
        if (!r.ok) throw errorIA(r.status, r.j, s.model);
        modelos = (r.j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => String(m.name || '').replace(/^models\//, ''));
      } catch (e) { out.innerHTML = linea(false, esc(textoErrorIA(e, Math.round(IA_LISTA_MS / 1000)))); return; }
      html += linea(true, `Clave aceptada. ${modelos.length} modelos disponibles con tu clave.`);
      sugeridos = modelos.filter(m => /flash/i.test(m) && !PROB_EXCLUIR.test(m)).sort((a, b) => b.localeCompare(a, 'en', { numeric: true })).slice(0, 6);
      if (!modelos.includes(s.model)) html += linea(false, `El modelo "${esc(s.model)}" no aparece entre los disponibles. Elige uno de la lista de abajo.`);
    }
    if (s.provider !== 'gemini' || modelos.includes(s.model)) {
      const t0 = Date.now();
      try {
        const r = s.provider === 'gemini'
          ? await pedirJSON(URL_GEMINI(s.model, s.apiKey), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: 'Responde solo con la palabra: ok' }] }] }) }, IA_PRUEBA_MS)
          : await pedirJSON('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': s.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model: s.model, max_tokens: 16, messages: [{ role: 'user', content: 'Responde solo con la palabra: ok' }] }) }, IA_PRUEBA_MS);
        if (!r.ok) throw errorIA(r.status, r.j, s.model);
        const seg = (Date.now() - t0) / 1000;
        html += linea(true, `El modelo "${esc(s.model)}" respondió en ${seg.toFixed(1)} s.` + (seg > 15 ? ' Es lento: prueba otro modelo de la lista.' : ''));
        html += '<p class="note">Esta prueba solo envía texto: con fotos puede tardar algo más.</p>';
      } catch (e) { html += linea(false, esc(textoErrorIA(e, Math.round(IA_PRUEBA_MS / 1000)))); }
    }
    if (sugeridos.length) html += '<p class="note">Modelos "flash" disponibles con tu clave (toca uno para usarlo):</p><div class="chips">' + sugeridos.map(m => `<button type="button" class="chip ${m === s.model ? 'on' : ''}" data-act="usemodel" data-v="${esc(m)}">${esc(m)}</button>`).join('') + '</div>';
  } catch (e) { html += linea(false, esc(textoErrorIA(e))); }
  out.innerHTML = html;
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
      : `Coste ${eur(coste(i))}${num(i.listPrice) > 0 ? ` · Publicada a ${eur(i.listPrice)}` : ''}`;
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
const PERIODOS = [['mes', 'Este mes'], ['ant', 'Mes anterior'], ['3m', '3 meses'], ['anio', 'Este año'], ['todo', 'Todo']];
const DIMS = [['mt', 'Marca y talla'], ['talla', 'Talla'], ['cat', 'Tipo de prenda'], ['marca', 'Marca'], ['origen', 'Origen'], ['estado', 'Estado'], ['lote', 'Lote']];
const ORDENES = [['n', 'Más vendidas'], ['benMedio', 'Beneficio medio'], ['benTotal', 'Beneficio total'], ['roi', 'ROI'], ['dias', 'Más rápidas']];
const RE_MES = /^\d{4}-\d{2}$/;

function rangoPeriodo(p, ref = new Date()) {
  const y = ref.getFullYear(), m = ref.getMonth();
  const ini = (yy, mm) => `${yy}-${pad(mm + 1)}-01`;
  const fin = (yy, mm) => ymd(new Date(yy, mm + 1, 0));
  if (p === 'todo') return { d: '', h: '', todo: true, unMes: false, etiqueta: 'Todo el histórico' };
  if (p === 'anio') return { d: `${y}-01-01`, h: `${y}-12-31`, todo: false, unMes: false, etiqueta: `Año ${y}` };
  if (p === '3m') {
    const s = new Date(y, m - 2, 1);
    return { d: ini(s.getFullYear(), s.getMonth()), h: fin(y, m), todo: false, unMes: false, etiqueta: 'Últimos 3 meses' };
  }
  let yy = y, mm = m;
  if (p === 'ant') { const s = new Date(y, m - 1, 1); yy = s.getFullYear(); mm = s.getMonth(); }
  else if (RE_MES.test(p)) { yy = +p.slice(0, 4); mm = +p.slice(5) - 1; }
  return { d: ini(yy, mm), h: fin(yy, mm), todo: false, unMes: true, y: yy, m: mm, etiqueta: `${MESES[mm]} ${yy}` };
}

let statsCache = null;
function calcStats() {
  const R = rangoPeriodo(periodo);
  const en = f => R.todo || (!!f && f >= R.d && f <= R.h);
  const compras = negocio().filter(i => en(i.dateBought));
  const vd = vendidas().filter(i => en(i.dateSold));
  const invertido = compras.reduce((s, i) => s + coste(i), 0);
  const ingresos = vd.reduce((s, i) => s + num(i.sellPrice) - num(i.sellFees), 0);
  const costeVend = vd.reduce((s, i) => s + coste(i), 0);
  const ben = ingresos - costeVend;
  const stockCoste = negocio().filter(i => i.status !== 'vendido').reduce((s, i) => s + coste(i), 0);
  const dias = vd.map(i => diasEntre(i.dateBought, i.dateSold)).filter(d => d !== null && d >= 0);
  return {
    R, compras, vd, invertido, ingresos, costeVend, ben, stockCoste,
    balance: ingresos - invertido,
    roi: costeVend > 0 ? (ben / costeVend) * 100 : 0,
    diasMedios: dias.length ? dias.reduce((a, b) => a + b, 0) / dias.length : null
  };
}

function serieTemporal(S) {
  const R = S.R; let keys, labels, keyOf;
  if (R.unMes) {
    const n = new Date(R.y, R.m + 1, 0).getDate();
    keys = Array.from({ length: n }, (_, k) => `${R.y}-${pad(R.m + 1)}-${pad(k + 1)}`);
    labels = keys.map((_, k) => String(k + 1)); keyOf = f => f;
  } else {
    const set = new Set();
    S.compras.forEach(i => i.dateBought && set.add(i.dateBought.slice(0, 7)));
    S.vd.forEach(i => i.dateSold && set.add(i.dateSold.slice(0, 7)));
    keys = [...set].sort();
    labels = keys.map(k => `${MESES[+k.slice(5) - 1].slice(0, 3)} ${k.slice(0, 4)}`);
    keyOf = f => f.slice(0, 7);
  }
  const g = new Map(keys.map(k => [k, { g: 0, i: 0 }]));
  S.compras.forEach(i => { if (i.dateBought && g.has(keyOf(i.dateBought))) g.get(keyOf(i.dateBought)).g += coste(i); });
  S.vd.forEach(i => { if (i.dateSold && g.has(keyOf(i.dateSold))) g.get(keyOf(i.dateSold)).i += num(i.sellPrice) - num(i.sellFees); });
  return { labels, gasto: keys.map(k => +g.get(k).g.toFixed(2)), ingresos: keys.map(k => +g.get(k).i.toFixed(2)), por: R.unMes ? 'día' : 'mes' };
}

function gruposDim(S) {
  const f = {
    mt: i => `${i.brand || 'Sin marca'} · ${i.size || '–'}`,
    talla: i => i.size || 'Sin talla',
    cat: i => i.category || 'Sin tipo',
    marca: i => i.brand || 'Sin marca',
    origen: i => i.origin || 'Sin origen',
    estado: i => i.condition || '–',
    lote: i => i.lot
  }[dim] || (i => i.brand || 'Sin marca');
  const base = dim === 'lote' ? S.vd.filter(i => i.lot) : S.vd;
  const ord = {
    n: (a, b) => b.n - a.n || b.benTotal - a.benTotal,
    benMedio: (a, b) => b.benMedio - a.benMedio,
    benTotal: (a, b) => b.benTotal - a.benTotal,
    roi: (a, b) => b.roi - a.roi,
    dias: (a, b) => (a.dias ?? 1e9) - (b.dias ?? 1e9)
  }[orden] || ((a, b) => b.n - a.n);
  return agrupar(base, f).sort(ord);
}

const chipsHtml = (lista, actual, act) => lista.map(([k, n]) => `<button class="chip ${actual === k ? 'on' : ''}" data-act="${act}" data-v="${k}">${n}</button>`).join('');

function vistaStats() {
  const S = statsCache = calcStats();
  const R = S.R;
  const kpi = (t, v, cls = '') => `<div class="kpi"><small>${t}</small><b class="${cls}">${v}</b></div>`;
  const grupos = gruposDim(S);
  const filas = grupos.map(g => `<tr><td>${esc(g.k)}</td><td>${g.n}</td><td>${eur(g.costeMedio)}</td><td>${eur(g.ventaMedia)}</td><td class="${g.benMedio >= 0 ? 'pos' : 'neg'}">${eur(g.benMedio)}</td><td class="${g.benTotal >= 0 ? 'pos' : 'neg'}">${eur(g.benTotal)}</td><td>${g.roi.toFixed(0)}%</td><td>${g.dias === null ? '–' : g.dias.toFixed(0)}</td></tr>`).join('');
  const mesVal = RE_MES.test(periodo) ? periodo : '';
  const altoTop = Math.max(140, Math.min(grupos.length, 8) * 34 + 40);
  const T = serieTemporal(S);
  return `<div class="chips">${chipsHtml(PERIODOS, periodo, 'per')}</div>
    <div class="row" style="margin:0 0 10px;align-items:center"><label style="margin:0">Elegir mes:</label><input type="month" id="perMes" value="${mesVal}" style="width:auto"><span class="note">Mostrando: <b>${esc(R.etiqueta)}</b></span></div>
    <div class="grid4">
      ${kpi('Invertido', eur(S.invertido))}
      ${kpi('Ingresos (neto)', eur(S.ingresos))}
      ${kpi('Beneficio vendidas', eur(S.ben), S.ben >= 0 ? 'pos' : 'neg')}
      ${kpi('ROI vendidas', S.roi.toFixed(0) + '%', S.roi >= 0 ? 'pos' : 'neg')}
      ${kpi('Prendas vendidas', S.vd.length)}
      ${kpi('Dinero en stock (ahora)', eur(S.stockCoste))}
      ${kpi('Balance de caja', eur(S.balance), S.balance >= 0 ? 'pos' : 'neg')}
      ${kpi('Beneficio medio', S.vd.length ? eur(S.ben / S.vd.length) : '–')}
      ${kpi('Tiempo medio de venta', S.diasMedios === null ? '–' : S.diasMedios.toFixed(0) + ' días')}
    </div>
    <p class="note">Invertido, ingresos y balance son del periodo elegido (compras por fecha de compra, ventas por fecha de venta). El dinero en stock es el de ahora. Balance de caja = ingresos menos lo gastado. Las prendas de uso personal no cuentan.</p>
    <h3>Gasto e ingresos por ${T.por}</h3><div class="card"><canvas id="chMes" height="220"></canvas></div>
    <h3>Balance acumulado</h3><div class="card"><canvas id="chAcum" height="200"></canvas></div>
    <h3>¿Qué te sale mejor?</h3>
    <div class="chips">${chipsHtml(DIMS, dim, 'dim')}</div>
    <div class="chips">${chipsHtml(ORDENES, orden, 'ord')}</div>
    ${grupos.length
      ? `<div class="card"><div style="position:relative;height:${altoTop}px"><canvas id="chTop"></canvas></div></div>
         <div class="card tw"><table><thead><tr><th>${esc((DIMS.find(d => d[0] === dim) || [])[1] || '')}</th><th>Vend.</th><th>Coste m.</th><th>Venta m.</th><th>Benef. m.</th><th>Benef. total</th><th>ROI</th><th>Días</th></tr></thead><tbody>${filas}</tbody></table></div>`
      : `<div class="card note">No hay ventas en este periodo${dim === 'lote' ? ' con lote asignado' : ''}. Cuando marques prendas como vendidas, aquí verás qué talla, marca y tipo te salen mejor.</div>`}
    <div class="row"><button class="btn primary" data-act="xlsx">Exportar a Excel</button></div>`;
}

function pintarCharts() {
  if (typeof Chart === 'undefined' || !statsCache) return;
  const S = statsCache, T = serieTemporal(S);
  const css = getComputedStyle(document.documentElement);
  const col = n => css.getPropertyValue(n).trim();
  const c1 = col('--bad') || '#b42318', c2 = col('--good') || '#15803d', cA = col('--accent') || '#0f766e', ink = col('--muted') || '#667380';
  const opt = { responsive: true, plugins: { legend: { labels: { color: ink } } }, scales: { x: { ticks: { color: ink } }, y: { ticks: { color: ink, callback: v => v + ' €' } } } };
  if (T.labels.length && $('#chMes')) {
    charts.push(new Chart($('#chMes'), { type: 'bar', data: { labels: T.labels, datasets: [{ label: 'Gasto', data: T.gasto, backgroundColor: c1 }, { label: 'Ingresos', data: T.ingresos, backgroundColor: c2 }] }, options: opt }));
    let acc = 0;
    const acum = T.labels.map((_, k) => +(acc += T.ingresos[k] - T.gasto[k]).toFixed(2));
    charts.push(new Chart($('#chAcum'), { type: 'line', data: { labels: T.labels, datasets: [{ label: 'Balance acumulado', data: acum, borderColor: cA, backgroundColor: cA, pointRadius: T.labels.length > 1 ? 3 : 6, tension: .25, fill: false }] }, options: opt }));
  }
  const top = gruposDim(S).slice(0, 8);
  if (top.length && $('#chTop')) {
    const m = { n: ['Prendas vendidas', g => g.n, v => v], benMedio: ['Beneficio medio', g => +g.benMedio.toFixed(2), v => v + ' €'], benTotal: ['Beneficio total', g => +g.benTotal.toFixed(2), v => v + ' €'], roi: ['ROI', g => +g.roi.toFixed(0), v => v + ' %'], dias: ['Días hasta vender', g => g.dias === null ? 0 : +g.dias.toFixed(0), v => v + ' d'] }[orden] || ['Prendas vendidas', g => g.n, v => v];
    charts.push(new Chart($('#chTop'), {
      type: 'bar',
      data: { labels: top.map(g => g.k), datasets: [{ label: m[0], data: top.map(m[1]), backgroundColor: cA }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, title: { display: true, text: m[0], color: ink } }, scales: { x: { beginAtZero: true, ticks: { color: ink, callback: m[2] } }, y: { ticks: { color: ink } } } }
    }));
  }
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
    <p class="note">La clave se guarda solo en este dispositivo y se envía directamente al proveedor. No la compartas. Si la IA tarda o falla, pulsa "Probar conexión": comprueba la clave, qué modelos puedes usar y cuánto tarda cada uno.</p>
    <div class="row"><button class="btn primary" data-act="saveset">Guardar ajustes</button><button class="btn" data-act="testia">Probar conexión</button></div>
    <div id="iaTest"></div></div>
    <div class="card"><h3 style="margin-top:0">Plantillas de texto</h3>
     <p class="note">Se usan con los botones "Plantilla…" del formulario. Puedes poner {tipo} (la categoría), {marca}, {talla} y {estado}; se sustituyen por lo que hayas rellenado. Se guardan solo en este dispositivo.</p>
     <label>Plantilla de título</label><input type="text" id="sPT" value="${esc(s.plantTitulo)}">
     <label>Plantilla de descripción: parte de arriba</label><textarea id="sPA" style="min-height:130px">${esc(s.plantArriba)}</textarea>
     <label>Plantilla de descripción: parte de abajo</label><textarea id="sPB" style="min-height:130px">${esc(s.plantAbajo)}</textarea>
     <div class="row"><button class="btn primary" data-act="saveplant">Guardar plantillas</button><button class="btn" data-act="resetplant">Restaurar las de ejemplo</button></div></div>
     <div class="card"><h3 style="margin-top:0">Copia de seguridad</h3>
    <p class="note">Tus datos y fotos viven en este navegador. Si borras los datos del navegador o cambias de móvil, se pierden. Haz copias a menudo.</p>
    <div class="row"><button class="btn" data-act="exportjson">Descargar copia (.json)</button><label class="btn" style="margin:0;color:var(--ink);font-size:16px">Restaurar copia<input type="file" id="impJson" accept="application/json" hidden></label><button class="btn" data-act="xlsx">Exportar a Excel</button></div></div>
    <div class="card"><h3 style="margin-top:0">Acerca de</h3><p class="note">El precio que sugiere la IA es orientativo: no usa datos de mercado en tiempo real. Los gráficos y medias salen de tus propias ventas.</p></div>`;
}

/* ========= Formulario de prenda ========= */
function abrirForm(id) {
  const it = id ? items.find(x => x.id === id) : null;
  formPhotos = it ? [...(it.photos || [])] : [];
  formId = id || null; iaPrev = null; tasaUlt = null; chatMsgs = []; mejoras = [];
  const d = it || { status: 'stock', condition: 'Muy bueno', origin: ORIGENES[0], dateBought: today(), personal: false };
  const sel = (arr, v) => arr.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('');
  const sheet = $('#sheet');
  sheet.innerHTML = `<div class="inner"><form id="frm" autocomplete="off">
    <div class="row" style="justify-content:space-between;align-items:center;margin:0"><h2>${it ? 'Editar prenda' : 'Nueva prenda'}</h2><button type="button" class="btn" data-act="cerrar">Cerrar</button></div>
    <label>Fotos (máx. 8)</label>
    <div class="photos" id="photos"></div>
    <input type="file" id="fileIn" accept="image/*" multiple hidden>
    <input type="file" id="camIn" accept="image/*" capture="environment" hidden>
    <div class="row"><button type="button" class="btn primary" id="btnIA" data-act="ia">✨ Generar título y descripción con IA</button></div>
    <div id="iaNote"></div>
    <div class="grid2"><div><label>Marca</label><input type="text" name="brand" value="${esc(d.brand)}"></div><div><label>Talla</label><input type="text" name="size" value="${esc(d.size)}"></div></div>
    <div class="grid2"><div><label>Categoría</label><input type="text" name="category" value="${esc(d.category)}" placeholder="Sudadera, vaqueros…"></div><div><label>Estado de la prenda</label><select name="condition">${sel(CONDICIONES, d.condition)}</select></div></div>
    <label>Título</label><input type="text" name="title" maxlength="100" value="${esc(d.title)}">
    <label>Descripción</label><textarea name="description">${esc(d.description)}</textarea>
    <div class="row plantrow"><button type="button" class="btn" data-act="plant" data-v="plantTitulo">📝 Plantilla título</button><button type="button" class="btn" data-act="plant" data-v="plantArriba">👕 Plantilla parte de arriba</button><button type="button" class="btn" data-act="plant" data-v="plantAbajo">👖 Plantilla parte de abajo</button></div>
    <p class="note">Plantillas por si la IA no funciona o prefieres tu propio texto. Se rellenan con la categoría, marca y talla de arriba y se configuran en Ajustes.</p>
    <div class="row"><button type="button" class="btn c-azul" data-act="copyt">Copiar título</button><button type="button" class="btn c-violeta" data-act="copyd">Copiar descripción</button><button type="button" class="btn c-verde" data-act="sharef">Enviar fotos a Vinted / galería</button><button type="button" class="btn c-naranja" data-act="dlf">Descargar fotos</button></div>
    <p class="note">Para publicar: copia título y descripción, y pasa las fotos con "Enviar fotos" (menú de compartir) o "Descargar fotos" (quedan en la carpeta Descargas). Toca una miniatura para verla en grande.</p>
    <h3>Precio</h3>
    <div class="grid2"><div><label>Precio de publicación (€)</label><input type="number" step="0.01" inputmode="decimal" name="listPrice" value="${d.listPrice ?? ''}"></div><div><label>¿No sabes cuánto pedir?</label><button type="button" class="btn c-rosa" style="width:100%" id="btnTasa" data-act="tasar">💶 Tasar con IA</button></div></div>
    <label>Anuncios parecidos (opcional): apunta los precios que veas en Vinted/Wallapop</label>
    <textarea name="comps" style="min-height:64px" placeholder="Solo precios, ej.: 18, 22, 15,50 (mejora mucho la tasación)">${esc(d.comps)}</textarea>
    <div id="tasaBox"></div>
    <div class="row"><button type="button" class="btn" data-act="chatopen">💬 Preguntar a la IA sobre esta prenda</button></div>
    <div id="chatPanel" class="hidden"><div class="chatlog" id="chatLog"></div><div class="row chatrow"><input type="text" id="chatIn" placeholder="Escribe tu pregunta…" maxlength="500"><button type="button" class="btn primary" id="chatSend" data-act="chatsend">Enviar</button></div><div class="row"><button type="button" class="btn" data-act="chatclear">Borrar conversación</button></div><p class="note">La conversación no se guarda: se borra al cerrar la prenda.</p></div>
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
  const alElegir = async e => {
    const files = [...e.target.files]; e.target.value = '';
    for (const f of files) { if (formPhotos.length >= 8) break; try { formPhotos.push(await comprimir(f)); } catch { toast('Una foto no se pudo leer'); } }
    pintarFotos();
  };
  $('#fileIn').onchange = alElegir; // galería (varias a la vez)
  $('#camIn').onchange = alElegir;  // cámara (una por toque)
  $('#frm').onsubmit = ev => { ev.preventDefault(); guardarForm(it ? it.id : null); };
}
function pintarFotos() {
  $('#photos').innerHTML = formPhotos.map((p, k) => `<div class="ph"><img src="${p}" alt="Foto ${k + 1}" data-act="verf" data-k="${k}" style="cursor:zoom-in"><button type="button" class="x" data-act="quitaf" data-k="${k}">×</button></div>`).join('') +
    (formPhotos.length < 8 ? `<div class="addph" data-act="addmulti">📸<br>Varias fotos</div><div class="addph" data-act="addcam">📷<br>Cámara</div><div class="addph" data-act="addgal">🖼️<br>Galería</div>` : '');
  actualizarMejoraUI();
}
async function guardarForm(id) {
  const f = new FormData($('#frm'));
  const g = k => (f.get(k) ?? '').toString().trim();
  const prev = id ? items.find(x => x.id === id) : null;
  const it = {
    id: id || uid(), created: prev?.created || Date.now(), photos: formPhotos,
    title: g('title'), description: g('description'), listPrice: num(g('listPrice')), comps: g('comps'), brand: g('brand'), size: g('size'), category: g('category'), condition: g('condition'),
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
function cerrarForm() { cancelarIA(); $('#sheet').classList.add('hidden'); $('#sheet').innerHTML = ''; }

let iaPrev = null;    // texto que tenía el vendedor antes de generar, para poder recuperarlo
let tasaUlt = null;   // última tasación de esta prenda
let chatMsgs = [];    // mensajes del chat de esta prenda (solo mientras el formulario está abierto)
let formId = null;

async function accionIA() {
  if (iaCtl) { toast('Espera a que termine la otra petición de la IA'); return; }
  const f = $('#frm'); const btn = $('#btnIA'); const note = $('#iaNote');
  const ctx = { brand: f.brand.value, size: f.size.value, category: f.category.value, condition: f.condition.value, title: f.title.value, description: f.description.value };
  const previo = { title: f.title.value, description: f.description.value };
  iaCtl = new AbortController();
  const t0 = Date.now(); let intento = '';
  const pinta = () => { btn.textContent = `Analizando fotos… ${Math.round((Date.now() - t0) / 1000)} s${intento}`; };
  btn.disabled = true; pinta();
  note.innerHTML = '<div class="row" style="margin-top:6px"><button type="button" class="btn" data-act="iacancel">Cancelar</button></div>';
  const tick = setInterval(pinta, 1000);
  try {
    const r = await generarConIA(formPhotos, ctx, iaCtl.signal, (n, max) => { intento = n > 1 ? ` · intento ${n} de ${max}` : ''; pinta(); });
    if ($('#frm') !== f) return; // el formulario se cerró mientras tanto
    note.innerHTML = '';
    iaPrev = (previo.title.trim() || previo.description.trim()) ? previo : null;
    if (r.titulo) f.title.value = normalizarTitulo(r.titulo, f.size.value || r.talla);
    if (r.descripcion) f.description.value = r.descripcion;
    if (r.marca && !f.brand.value) f.brand.value = r.marca;
    if (r.categoria && !f.category.value) f.category.value = r.categoria;
    if (r.talla && !f.size.value) f.size.value = r.talla;
    let html = '';
    if (iaPrev) html += '<div class="row" style="margin-top:6px"><button type="button" class="btn" data-act="iaundo">↩ Volver a mi texto anterior</button></div>';
    if (r.precio_orientativo) {
      const margen = settings().margen;
      const c = num(f.buyPrice.value) + num(f.buyShip.value);
      const min = c > 0 ? ` Para ganar un ${margen}% sobre tu coste de ${eur(c)}, necesitarías venderla a partir de ${eur(c * (1 + margen / 100))}.` : '';
      html += `<div class="hint">Precio orientativo de la IA: <b>${esc(r.precio_orientativo)}</b> (estimación general, no datos de mercado en tiempo real). Para algo más fino usa "Tasar con IA".${min}</div>`;
    }
    note.innerHTML = html;
    toast('Listo. Revisa el texto antes de publicar.');
  } catch (e) {
    if ($('#frm') === f) {
      if (e.code === 'cancelado') { note.innerHTML = ''; toast('Cancelado'); }
      else note.innerHTML = `<div class="hint">${esc(e.message || 'Error al generar')}</div>`;
    }
  } finally {
    clearInterval(tick); iaCtl = null;
    if ($('#frm') === f) { btn.disabled = false; btn.textContent = '✨ Generar título y descripción con IA'; }
  }
}

function deshacerIA() {
  const f = $('#frm'); if (!f || !iaPrev) return;
  f.title.value = iaPrev.title; f.description.value = iaPrev.description;
  iaPrev = null; $('#iaNote').innerHTML = ''; toast('Texto anterior recuperado');
}

function pintarTasa(r, d) {
  const box = $('#tasaBox'); if (!box) return;
  const gan = d.coste > 0 ? `<p class="note">Si la vendes al recomendado, ganarías ${eur(r.rec - d.coste)} sobre tu coste de ${eur(d.coste)}${r.rec - d.coste < 0 ? ' (pérdida)' : ''}.</p>` : '';
  const h = d.hist || { n: 0 };
  const propio = h.n ? `<p class="note">Tus ventas anteriores de ${esc(d.brand)}: ${h.n} (mediana ${eur(h.mediana)}${h.dias !== null ? `, ~${h.dias} días en venderse` : ''}).</p>` : '';
  const comps = d.comps.length ? `<p class="note">Anuncios parecidos que has anotado: ${d.comps.length} (mediana ${eur(d.medComps)}).</p>` : '';
  box.innerHTML = `<div class="tasa">
    <div class="tasa-cifras"><div><small>Mínimo</small><b>${eur(r.min)}</b></div><div class="rec"><small>Recomendado</small><b>${eur(r.rec)}</b></div><div><small>Máximo</small><b>${eur(r.max)}</b></div></div>
    ${r.razon ? `<p>${esc(r.razon)}</p>` : ''}
    ${r.consejos.length ? '<ul>' + r.consejos.map(c => `<li>${esc(c)}</li>`).join('') + '</ul>' : ''}
    ${propio}${comps}${gan}
    <div class="row"><button type="button" class="btn primary" data-act="usarprecio" data-v="${r.rec}">Usar ${eur(r.rec)} como precio de publicación</button></div>
    <p class="note">Estimación de la IA${r.confianza ? ` (confianza ${esc(r.confianza)})` : ''}: no consulta precios de mercado en tiempo real. Cuantos más precios de anuncios parecidos anotes, más fiable.</p></div>`;
}

async function accionTasar() {
  if (iaCtl) { toast('Espera a que termine la otra petición de la IA'); return; }
  const f = $('#frm'); const btn = $('#btnTasa'); const box = $('#tasaBox');
  if (!formPhotos.length) { toast('Añade al menos una foto para tasar'); return; }
  const d = datosTasacion(f, formId);
  iaCtl = new AbortController();
  const t0 = Date.now(); let intento = '';
  const pinta = () => { btn.textContent = `Tasando… ${Math.round((Date.now() - t0) / 1000)} s${intento}`; };
  btn.disabled = true; pinta();
  box.innerHTML = '<div class="row" style="margin-top:6px"><button type="button" class="btn" data-act="iacancel">Cancelar</button></div>';
  const tick = setInterval(pinta, 1000);
  try {
    const r = await tasarConIA(formPhotos, d, iaCtl.signal, (n, max) => { intento = n > 1 ? ` · intento ${n} de ${max}` : ''; pinta(); });
    if ($('#frm') !== f) return;
    tasaUlt = r; pintarTasa(r, d);
  } catch (e) {
    if ($('#frm') === f) {
      if (e.code === 'cancelado') { box.innerHTML = ''; toast('Cancelado'); }
      else box.innerHTML = `<div class="hint">${esc(e.message || 'Error al tasar')}</div>`;
    }
  } finally {
    clearInterval(tick); iaCtl = null;
    if ($('#frm') === f) { btn.disabled = false; btn.textContent = '💶 Tasar con IA'; }
  }
}

function pintarChat(pensando) {
  const log = $('#chatLog'); if (!log) return;
  const burbuja = m => `<div class="msg ${m.rol}">${esc(m.texto).replace(/\n/g, '<br>')}</div>`;
  log.innerHTML = (chatMsgs.length ? chatMsgs.map(burbuja).join('') : '<p class="note">Pregunta lo que quieras sobre esta prenda: a cuánto subirla, cómo negociar, qué foto mejorar, cómo redactar una respuesta a un comprador…</p>') +
    (pensando ? `<div class="msg ai"><i>${esc(pensando)}</i> <button type="button" class="btn" data-act="iacancel">Cancelar</button></div>` : '');
  log.scrollTop = log.scrollHeight;
}

async function enviarChat() {
  const f = $('#frm'); const inp = $('#chatIn'); if (!f || !inp) return;
  const texto = inp.value.trim(); if (!texto) return;
  if (iaCtl) { toast('Espera a que termine la otra petición de la IA'); return; }
  if (!formPhotos.length) { toast('Añade al menos una foto para hablar de la prenda'); return; }
  chatMsgs.push({ rol: 'user', texto }); inp.value = '';
  const d = datosTasacion(f, formId);
  iaCtl = new AbortController();
  const t0 = Date.now(); let intento = '';
  const pinta = () => pintarChat(`Pensando… ${Math.round((Date.now() - t0) / 1000)} s${intento}`);
  pinta(); const tick = setInterval(pinta, 1000);
  const btn = $('#chatSend'); if (btn) btn.disabled = true;
  try {
    const r = await chatearConIA(formPhotos, d, tasaUlt, chatMsgs, iaCtl.signal, (n, max) => { intento = n > 1 ? ` · intento ${n} de ${max}` : ''; });
    if ($('#frm') !== f) return;
    chatMsgs.push({ rol: 'ai', texto: r });
  } catch (e) {
    if ($('#frm') === f) {
      if (e.code === 'cancelado') { chatMsgs.pop(); inp.value = texto; toast('Cancelado'); }
      else chatMsgs.push({ rol: 'ai', texto: '⚠️ ' + (e.message || 'Error') });
    }
  } finally {
    clearInterval(tick); iaCtl = null;
    if ($('#frm') === f) { pintarChat(); const b2 = $('#chatSend'); if (b2) b2.disabled = false; }
  }
}

/* ========= Plantillas (para cuando no quieres o no puedes usar la IA) ========= */
function rellenarPlantilla(texto, v) {
  return String(texto || '').replace(/\{(tipo|marca|talla|estado)\}/gi, (_, k) => v[k.toLowerCase()] || '');
}
// Quita los huecos que quedan si falta algún dato ("Sudadera - Talla " → "Sudadera")
function limpiarTitulo(t) {
  t = String(t).replace(/[ \t]{2,}/g, ' ').trim()
    .replace(/\s*[-–]\s*Talla\s*[-–]?\s*$/i, '').replace(/\s*[-–]\s*$/, '').replace(/^\s*[-–]\s*/, '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}
function aplicarPlantilla(clave) {
  const f = $('#frm'); if (!f || !(clave in PLANT_DEF)) return;
  const base = String(settings()[clave] || '');
  if (!base.trim()) { toast('Esa plantilla está vacía. Configúrala en Ajustes.'); return; }
  const esTitulo = clave === 'plantTitulo';
  const campo = esTitulo ? f.title : f.description;
  if (campo.value.trim() && !confirm(`Ya hay ${esTitulo ? 'un título' : 'una descripción'} escrito. ¿Reemplazarlo por la plantilla?`)) return;
  const v = { tipo: f.category.value.trim(), marca: f.brand.value.trim(), talla: f.size.value.trim(), estado: f.condition.value.trim() };
  const txt = rellenarPlantilla(base, v);
  campo.value = esTitulo ? limpiarTitulo(txt).slice(0, 100) : txt;
  toast(esTitulo && !v.tipo ? 'Plantilla puesta. Rellena la categoría (Sudadera, vaqueros…) para completar el título.' : 'Plantilla puesta');
}
function guardarPlantillas(restaurar) {
  const s = settings();
  for (const [k, id] of [['plantTitulo', '#sPT'], ['plantArriba', '#sPA'], ['plantAbajo', '#sPB']]) {
    const n = $(id); if (!n) continue;
    if (restaurar) n.value = PLANT_DEF[k];
    s[k] = n.value;
  }
  saveSettings(s); toast(restaurar ? 'Plantillas restauradas' : 'Plantillas guardadas');
}

/* ========= Título con talla separada ========= */
const escRe = t => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Deja el título como "<texto> - Talla X" (máx. 100 caracteres), sin hashtags ni tallas repetidas
function normalizarTitulo(t, talla) {
  const fin = /[\s\-–—|,·:]+$/;
  talla = String(talla || '').trim();
  t = String(t || '').replace(/#\S+/g, '').replace(/\s{2,}/g, ' ').trim()
    .replace(/(?:\s+|\s*[-–—|,·]\s*)\(?\btalla\b(?:[:\s]*\S{1,4})?\)?\s*$/i, '').replace(fin, '').trim();
  if (talla) t = t.replace(new RegExp(`(?:\\s+|\\s*[-–—|,·]\\s*)(?:talla\\s*)?${escRe(talla)}\\s*$`, 'i'), '').replace(fin, '').trim();
  if (!talla) return t.slice(0, 100).replace(fin, '');
  const suf = ` - Talla ${talla}`;
  return t.slice(0, Math.max(0, 100 - suf.length)).replace(fin, '') + suf;
}

/* ========= Mejorar fotos (en el propio dispositivo, sin enviar nada a internet) =========
   Ajusta niveles y brillo sobre la luminosidad (así los colores de la prenda no cambian de tono),
   sube un poco la viveza y afila ligeramente. No cambia el fondo ni toca la prenda. */
function mejorarPixeles(d, w, h) {
  const n = w * h, hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) { const p = i * 4; hist[(0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) | 0]++; }
  const corte = n * 0.005; let lo = 0, hi = 255, a = 0;
  for (let v = 0; v < 256; v++) { a += hist[v]; if (a > corte) { lo = v; break; } }
  a = 0; for (let v = 255; v >= 0; v--) { a += hist[v]; if (a > corte) { hi = v; break; } }
  if (hi - lo < 40) { const m = (hi + lo) / 2; lo = Math.max(0, m - 20); hi = Math.min(255, m + 20); }
  let suma = 0; for (let v = 0; v < 256; v++) suma += hist[v] * Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  const media = Math.min(0.9, Math.max(0.05, suma / n));
  const gamma = Math.min(1.15, Math.max(0.7, Math.log(0.52) / Math.log(media)));
  const lut = new Float32Array(256);
  for (let v = 0; v < 256; v++) lut[v] = 255 * Math.pow(Math.min(1, Math.max(0, (v - lo) / (hi - lo))), gamma);
  const c = x => x < 0 ? 0 : x > 255 ? 255 : x;
  for (let i = 0; i < n; i++) {
    const p = i * 4, L = 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2];
    const T = lut[L | 0]; const k = L > 1 ? Math.min(3, T / L) : 1;
    const r = d[p] * k, g = d[p + 1] * k, b = d[p + 2] * k, Lt = L > 1 ? T : L;
    d[p] = c(Lt + (r - Lt) * 1.08); d[p + 1] = c(Lt + (g - Lt) * 1.08); d[p + 2] = c(Lt + (b - Lt) * 1.08);
  }
  // Afilado suave (unsharp mask con desenfoque 3×3)
  const src = new Uint8ClampedArray(d);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = (y * w + x) * 4;
    for (let ch = 0; ch < 3; ch++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += src[p + ch + (dy * w + dx) * 4];
      d[p + ch] = c(src[p + ch] + 0.5 * (src[p + ch] - s / 9));
    }
  }
  return { lo, hi, gamma };
}
async function mejorarFoto(src) {
  const img = await cargarImg(src);
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, cv.width, cv.height);
  mejorarPixeles(id.data, cv.width, cv.height);
  ctx.putImageData(id, 0, 0);
  return cv.toDataURL('image/jpeg', 0.88);
}
let mejoras = [];      // {orig, nueva}: para poder volver a la foto original
let mejorando = false;
function actualizarMejoraUI() {
  const b = $('#btnUndoMej');
  if (b) b.classList.toggle('hidden', !mejoras.some(m => formPhotos.includes(m.nueva)));
}
async function mejorarFotos(indices) {
  if (mejorando) return;
  const lista = indices.filter(k => formPhotos[k] && !mejoras.some(m => m.nueva === formPhotos[k]));
  if (!lista.length) { toast(indices.length ? 'Ya está mejorada' : 'Añade fotos primero'); return; }
  mejorando = true; toast(`Mejorando ${lista.length} foto(s)…`);
  let hechas = 0;
  try {
    for (const k of lista) {
      const orig = formPhotos[k];
      try { const nueva = await mejorarFoto(orig); if (formPhotos[k] === orig) { formPhotos[k] = nueva; mejoras.push({ orig, nueva }); hechas++; } } catch { /* esa foto se queda como estaba */ }
    }
  } finally { mejorando = false; }
  if ($('#photos')) pintarFotos();
  actualizarMejoraUI();
  toast(hechas ? `${hechas} foto(s) mejoradas. Pulsa Guardar en la prenda para conservar el cambio.` : 'No se pudo mejorar la foto');
}
function deshacerMejora(k) { // k opcional: solo esa foto
  let n = 0;
  formPhotos.forEach((p, i) => {
    if (k !== undefined && i !== k) return;
    const m = mejoras.find(x => x.nueva === p);
    if (m) { formPhotos[i] = m.orig; n++; }
  });
  mejoras = mejoras.filter(m => formPhotos.includes(m.nueva));
  if ($('#photos')) pintarFotos();
  actualizarMejoraUI();
  toast(n ? 'Fotos originales recuperadas' : 'No hay mejoras que deshacer');
}
async function mejorarVisor() {
  const v = $('#lb'); if (!v || crop) return;
  const k = +v.dataset.k; await mejorarFotos([k]); abrirVisor(k);
}
function originalVisor() {
  const v = $('#lb'); if (!v || crop) return;
  const k = +v.dataset.k; deshacerMejora(k); abrirVisor(k);
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
    Estado: ESTADOS[i.status], Precio_publicación: num(i.listPrice) || '', Personal: i.personal ? 'Sí' : 'No', Fecha_publicado: i.datePublished,
    Precio_venta: i.status === 'vendido' ? num(i.sellPrice) : '', Comisiones: i.status === 'vendido' ? num(i.sellFees) : '',
    Beneficio: i.status === 'vendido' ? beneficio(i) : '', Fecha_venta: i.dateSold, Notas: i.notes
  }));
  const vd = vendidas();
  const rg = arr => arr.map(g => ({ Grupo: g.k, Vendidas: g.n, Coste_medio: +g.costeMedio.toFixed(2), Venta_media: +g.ventaMedia.toFixed(2), Beneficio_medio: +g.benMedio.toFixed(2), Beneficio_total: +g.benTotal.toFixed(2), ROI_pct: +g.roi.toFixed(1), Dias_medios: g.dias === null ? '' : +g.dias.toFixed(1) }));
  const mt = rg(agrupar(vd, i => `${i.brand || 'Sin marca'} · ${i.size || '–'}`));
  const mr = rg(agrupar(vd, i => i.brand || 'Sin marca'));
  const mtal = rg(agrupar(vd, i => i.size || 'Sin talla'));
  const mcat = rg(agrupar(vd, i => i.category || 'Sin tipo'));
  if (typeof XLSX === 'undefined') { // respaldo en CSV si no cargó la librería
    const cols = Object.keys(filas[0] || { Título: '' });
    const csv = [cols.join(';'), ...filas.map(r => cols.map(c => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(';'))].join('\n');
    descargar(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `reventa-${today()}.csv`); return;
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'Prendas');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mt), 'Marca y talla');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mr), 'Por marca');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mtal), 'Por talla');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mcat), 'Por tipo');
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

/* ========= Fotos: compartir, descargar y visor ========= */
/* Pasa las fotos de la prenda a otra app (Vinted, Galería, WhatsApp…) con el menú "Compartir" del móvil.
   Si el dispositivo no lo permite (p. ej. un ordenador), las descarga como archivos .jpg. */
async function compartirFotos() {
  if (!formPhotos.length) { toast('Esta prenda no tiene fotos'); return; }
  const titulo = ($('#frm')?.title?.value || 'prenda').trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'prenda';
  try {
    const files = await Promise.all(formPhotos.map(async (p, k) => new File([await dataABlob(p)], `${titulo}-${k + 1}.jpg`, { type: 'image/jpeg' })));
    if (navigator.canShare && navigator.canShare({ files })) {
      try { await navigator.share({ files }); }
      catch (e) { if (e.name !== 'AbortError') toast('No se pudo abrir el menú de compartir'); }
      return;
    }
    files.forEach((f, k) => setTimeout(() => descargar(f, f.name), k * 400));
    toast(`Descargando ${files.length} foto(s)…`);
  } catch { toast('No se pudieron preparar las fotos'); }
}
const slugTitulo = () => ($('#frm')?.title?.value || 'prenda').trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'prenda';

/* Descarga todas las fotos de la prenda como .jpg (una a una; el navegador puede pedir permiso para descargas múltiples). */
async function descargarFotos() {
  if (!formPhotos.length) { toast('Esta prenda no tiene fotos'); return; }
  const base = slugTitulo(), n = formPhotos.length;
  try {
    for (let k = 0; k < n; k++) {
      descargar(await dataABlob(formPhotos[k]), `${base}-${k + 1}.jpg`);
      if (k < n - 1) await new Promise(r => setTimeout(r, 400));
    }
    toast(`Descargadas ${n} foto(s). Búscalas en Descargas.`);
  } catch { toast('No se pudieron descargar las fotos'); }
}

/* Visor a pantalla completa de las fotos de la prenda */
function cerrarVisor() { crop = null; const v = $('#lb'); if (v) v.remove(); }
function abrirVisor(k) {
  const n = formPhotos.length;
  if (!(k >= 0 && k < n)) return;
  cerrarVisor();
  const d = document.createElement('div');
  d.id = 'lb'; d.className = 'lb'; d.dataset.k = String(k);
  d.innerHTML = `<img src="${formPhotos[k]}" alt="Foto ${k + 1}"><div class="note" style="color:#ddd">Foto ${k + 1} de ${n}</div>
    <div class="bar"><button type="button" class="btn" data-act="lbrotl">↺ Girar</button><button type="button" class="btn" data-act="lbrotr">↻ Girar</button><button type="button" class="btn" data-act="lbcrop">✂ Recortar</button>${mejoras.some(m => m.nueva === formPhotos[k]) ? '<button type="button" class="btn" data-act="lboriginal">↩ Original</button>' : '<button type="button" class="btn" data-act="lbmejorar">✨ Mejorar</button>'}</div>
    <div class="bar">${n > 1 ? '<button type="button" class="btn" data-act="lbprev">‹ Anterior</button><button type="button" class="btn" data-act="lbnext">Siguiente ›</button>' : ''}<button type="button" class="btn primary" data-act="lbdl">Descargar esta foto</button><button type="button" class="btn" data-act="lbclose">Cerrar</button></div>`;
  document.body.appendChild(d);
}
function visorIr(delta) {
  const v = $('#lb'); if (!v || crop) return;
  const n = formPhotos.length;
  abrirVisor((((+v.dataset.k + delta) % n) + n) % n);
}
async function visorDescargar() {
  const v = $('#lb'); if (!v) return;
  const k = +v.dataset.k;
  if (!formPhotos[k]) return;
  try { descargar(await dataABlob(formPhotos[k]), `${slugTitulo()}-${k + 1}.jpg`); toast('Foto descargada'); }
  catch { toast('No se pudo descargar la foto'); }
}
document.addEventListener('keydown', e => {
  if (!$('#lb')) return;
  if (e.key === 'Escape') cerrarVisor();
  else if (e.key === 'ArrowRight') visorIr(1);
  else if (e.key === 'ArrowLeft') visorIr(-1);
});

/* ========= Editar fotos: girar y recortar ========= */
let crop = null; // { k, r:{x,y,w,h} en fracciones 0..1, ratio:null|número (ancho/alto), W, H (px reales), drag }
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const cargarImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('img')); i.src = src; });

// Mayor rectángulo centrado con la proporción pedida (ancho/alto) dentro de una imagen W×H
function rectConProporcion(ratio, W, H) {
  let w = 1, h = (W / ratio) / H;
  if (h > 1) { h = 1; w = (H * ratio) / W; }
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}
function mover(r, dx, dy) {
  return { ...r, x: clamp(r.x + dx, 0, 1 - r.w), y: clamp(r.y + dy, 0, 1 - r.h) };
}
// Arrastre de una esquina ('tl','tr','bl','br'). Con ratio, se mantiene la proporción y el borde opuesto queda fijo.
function redimensionar(r, hd, dx, dy, ratio, W, H) {
  const MIN = 0.08;
  let l = r.x, t = r.y, rt = r.x + r.w, b = r.y + r.h;
  if (hd.includes('l')) l = clamp(l + dx, 0, rt - MIN);
  if (hd.includes('r')) rt = clamp(rt + dx, l + MIN, 1);
  if (hd.includes('t')) t = clamp(t + dy, 0, b - MIN);
  if (hd.includes('b')) b = clamp(b + dy, t + MIN, 1);
  if (ratio) {
    let w = rt - l, hh = (w * W) / ratio / H;
    const fijoArriba = hd.includes('b');
    const espacio = fijoArriba ? 1 - t : b;
    if (hh > espacio) { hh = espacio; w = (hh * H * ratio) / W; if (hd.includes('l')) l = rt - w; else rt = l + w; }
    if (fijoArriba) b = t + hh; else t = b - hh;
  }
  return { x: l, y: t, w: rt - l, h: b - t };
}
// Rectángulo en píxeles reales, siempre dentro de la imagen
function rectPixels(r, W, H) {
  const sx = clamp(Math.round(r.x * W), 0, W - 1), sy = clamp(Math.round(r.y * H), 0, H - 1);
  return { sx, sy, sw: clamp(Math.round(r.w * W), 1, W - sx), sh: clamp(Math.round(r.h * H), 1, H - sy) };
}

async function rotarFoto(k, grados) { // grados: 90, -90 o 180
  if (!formPhotos[k]) return;
  const img = await cargarImg(formPhotos[k]);
  const c = document.createElement('canvas');
  const cuarto = Math.abs(grados) % 180 === 90;
  c.width = cuarto ? img.height : img.width; c.height = cuarto ? img.width : img.height;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2); ctx.rotate(grados * Math.PI / 180);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  formPhotos[k] = c.toDataURL('image/jpeg', 0.85);
}
async function recortarFoto(k, r) {
  if (!formPhotos[k]) return;
  const img = await cargarImg(formPhotos[k]);
  const { sx, sy, sw, sh } = rectPixels(r, img.width, img.height);
  const c = document.createElement('canvas'); c.width = sw; c.height = sh;
  c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  formPhotos[k] = c.toDataURL('image/jpeg', 0.85);
}

async function rotarVisor(g) {
  const v = $('#lb'); if (!v || crop) return;
  const k = +v.dataset.k;
  try { await rotarFoto(k, g); pintarFotos(); abrirVisor(k); toast('Foto girada. Pulsa Guardar en la prenda para conservar el cambio.'); }
  catch { toast('No se pudo girar la foto'); }
}

const RATIOS = [['free', 'Libre'], ['1', '1:1'], ['0.8', '4:5'], ['0.75', '3:4'], ['1.3333', '4:3']];
async function abrirRecorte(k) {
  if (!formPhotos[k]) return;
  let img;
  try { img = await cargarImg(formPhotos[k]); } catch { toast('No se pudo abrir la foto'); return; }
  const v = $('#lb'); if (!v) return;
  crop = { k, r: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, ratio: null, W: img.width, H: img.height, drag: null };
  v.innerHTML = `<div class="cropwrap"><div class="cropin" id="cropIn"><img id="cropImg" src="${formPhotos[k]}" alt="" draggable="false"><div class="crop" id="cropBox"><i class="hd" data-h="tl"></i><i class="hd" data-h="tr"></i><i class="hd" data-h="bl"></i><i class="hd" data-h="br"></i></div></div></div>
    <div class="note" style="color:#ddd">Arrastra el recuadro para moverlo y las esquinas para cambiar su tamaño</div>
    <div class="bar">${RATIOS.map(([val, n]) => `<button type="button" class="chip ${val === 'free' ? 'on' : ''}" data-act="cropr" data-v="${val}">${n}</button>`).join('')}</div>
    <div class="bar"><button type="button" class="btn primary" data-act="cropok">Aplicar recorte</button><button type="button" class="btn" data-act="cropno">Cancelar</button></div>`;
  pintarCrop(); enlazarCrop();
}
function pintarCrop() {
  const b = $('#cropBox'); if (!b || !crop) return;
  const r = crop.r;
  b.style.left = (r.x * 100) + '%'; b.style.top = (r.y * 100) + '%';
  b.style.width = (r.w * 100) + '%'; b.style.height = (r.h * 100) + '%';
}
function ratioCrop(val) {
  if (!crop) return;
  crop.ratio = val === 'free' ? null : +val;
  if (crop.ratio) {
    const r = rectConProporcion(crop.ratio, crop.W, crop.H); // y lo reducimos un 10% para que haya margen de movimiento
    const w = r.w * 0.9, h = r.h * 0.9;
    crop.r = { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
  }
  document.querySelectorAll('[data-act="cropr"]').forEach(bt => bt.classList.toggle('on', bt.dataset.v === val));
  pintarCrop();
}
function enlazarCrop() {
  const box = $('#cropBox'), area = $('#cropIn'); if (!box || !area) return;
  box.addEventListener('pointerdown', e => {
    e.preventDefault();
    crop.drag = { id: e.pointerId, hd: (e.target.dataset && e.target.dataset.h) || null, x0: e.clientX, y0: e.clientY, r0: { ...crop.r } };
    try { box.setPointerCapture(e.pointerId); } catch { /* sin captura también funciona */ }
  });
  box.addEventListener('pointermove', e => {
    const d = crop && crop.drag; if (!d || d.id !== e.pointerId) return;
    const bb = area.getBoundingClientRect();
    const dx = (e.clientX - d.x0) / bb.width, dy = (e.clientY - d.y0) / bb.height;
    crop.r = d.hd ? redimensionar(d.r0, d.hd, dx, dy, crop.ratio, crop.W, crop.H) : mover(d.r0, dx, dy);
    pintarCrop();
  });
  const fin = e => { if (crop && crop.drag && crop.drag.id === e.pointerId) crop.drag = null; };
  box.addEventListener('pointerup', fin); box.addEventListener('pointercancel', fin);
}
async function aplicarRecorte() {
  if (!crop) return;
  const { k, r } = crop;
  try { await recortarFoto(k, r); crop = null; pintarFotos(); abrirVisor(k); toast('Foto recortada. Pulsa Guardar en la prenda para conservar el cambio.'); }
  catch { toast('No se pudo recortar la foto'); }
}
function cancelarRecorte() { if (!crop) return; const k = crop.k; crop = null; abrirVisor(k); }

/* ========= Cámara en directo: varias fotos seguidas ========= */
let camStream = null, camFacing = 'environment';

function pararStream() {
  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
}
function cerrarCamara() {
  pararStream();
  const c = $('#cam'); if (c) c.remove();
}
async function iniciarStream() {
  pararStream();
  camStream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: camFacing }, width: { ideal: 1920 }, height: { ideal: 1920 } }
  });
  const v = $('#camVideo');
  if (v) { v.srcObject = camStream; try { await v.play(); } catch { /* algunos navegadores arrancan solos */ } }
}
function actualizarCam() {
  const c = $('#camCount'); if (c) c.textContent = `${formPhotos.length} de 8 fotos`;
  const t = $('#camStrip');
  if (t) {
    t.innerHTML = formPhotos.map((p, k) => `<div class="camth"><img src="${p}" alt="Foto ${k + 1}"><button type="button" class="camx" data-act="camdel" data-k="${k}" aria-label="Borrar foto ${k + 1}">×</button></div>`).join('');
    t.scrollLeft = t.scrollWidth; // la última foto siempre a la vista
  }
}
function quitarFotoCam(k) {
  if (!(k >= 0 && k < formPhotos.length)) return;
  formPhotos.splice(k, 1);
  pintarFotos(); actualizarCam();
}
async function abrirCamara() {
  if (formPhotos.length >= 8) { toast('Ya hay 8 fotos (el máximo)'); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('Tu navegador no permite la cámara en directo. Usa el botón Cámara.'); return; }
  cerrarCamara();
  const d = document.createElement('div');
  d.id = 'cam'; d.className = 'cam';
  d.innerHTML = `<video id="camVideo" autoplay playsinline muted></video><div class="camflash" id="camFlash"></div>
    <div class="camtop"><span id="camCount"></span><button type="button" class="btn" data-act="camflip">🔄 Girar cámara</button></div>
    <div class="cambottom"><div class="camstrip" id="camStrip"></div><div class="cambar"><span class="camspacer"></span><button type="button" class="shutter" data-act="camshot" aria-label="Hacer foto"></button><button type="button" class="btn primary" data-act="camdone">Listo</button></div></div>`;
  document.body.appendChild(d);
  actualizarCam();
  try { await iniciarStream(); }
  catch (e) {
    cerrarCamara();
    toast(e && e.name === 'NotAllowedError'
      ? 'Permiso de cámara denegado. Actívalo para este sitio en los ajustes del navegador.'
      : 'No se pudo abrir la cámara. Usa el botón Cámara.');
  }
}
async function girarCamara() {
  camFacing = camFacing === 'environment' ? 'user' : 'environment';
  try { await iniciarStream(); } catch { toast('No se pudo cambiar de cámara'); }
}
function hacerFoto() {
  const v = $('#camVideo');
  if (!v || !v.videoWidth) { toast('La cámara aún no está lista'); return; }
  if (formPhotos.length >= 8) { toast('Ya hay 8 fotos (el máximo)'); return; }
  const k = Math.min(1, 1100 / Math.max(v.videoWidth, v.videoHeight)); // mismo tamaño que las demás fotos
  const c = document.createElement('canvas');
  c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  formPhotos.push(c.toDataURL('image/jpeg', 0.72));
  pintarFotos(); actualizarCam();
  const f = $('#camFlash'); if (f) { f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 120); }
  if (navigator.vibrate) navigator.vibrate(25);
  if (formPhotos.length >= 8) toast('Has llegado a 8 fotos. Borra alguna con la × o pulsa Listo.');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#cam')) cerrarCamara(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) cerrarCamara(); }); // al salir de la app, se apaga la cámara

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

function guardarAjustes() {
  const s = settings();
  s.provider = $('#sProv').value; s.apiKey = $('#sKey').value.trim(); s.model = $('#sModel').value.trim() || DEF.model;
  saveSettings(s); toast('Ajustes guardados');
}

/* ========= Eventos ========= */
document.addEventListener('click', async e => {
  if (e.target.id === 'lb') { if (!crop) cerrarVisor(); return; } // clic en el fondo del visor
  const tb = e.target.closest('.tabs button');
  if (tb) { tab = tb.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act;
  if (a === 'new') abrirForm(null);
  else if (a === 'edit') abrirForm(el.dataset.id);
  else if (a === 'cerrar') cerrarForm();
  else if (a === 'filtro') { filtro = el.dataset.v; render(); }
  else if (a === 'addmulti') abrirCamara();
  else if (a === 'camshot') hacerFoto();
  else if (a === 'camdel') quitarFotoCam(+el.dataset.k);
  else if (a === 'camdone') cerrarCamara();
  else if (a === 'camflip') girarCamara();
  else if (a === 'addcam') $('#camIn').click();
  else if (a === 'addgal') $('#fileIn').click();
  else if (a === 'quitaf') { formPhotos.splice(+el.dataset.k, 1); pintarFotos(); }
  else if (a === 'ia') accionIA();
  else if (a === 'sharef') compartirFotos();
  else if (a === 'dlf') descargarFotos();
  else if (a === 'verf') abrirVisor(+el.dataset.k);
  else if (a === 'lbclose') cerrarVisor();
  else if (a === 'lbprev') visorIr(-1);
  else if (a === 'lbnext') visorIr(1);
  else if (a === 'lbdl') visorDescargar();
  else if (a === 'lbrotl') rotarVisor(-90);
  else if (a === 'lbrotr') rotarVisor(90);
  else if (a === 'lbcrop') abrirRecorte(+$('#lb').dataset.k);
  else if (a === 'lbmejorar') mejorarVisor();
  else if (a === 'lboriginal') originalVisor();
  else if (a === 'cropr') ratioCrop(el.dataset.v);
  else if (a === 'cropok') aplicarRecorte();
  else if (a === 'cropno') cancelarRecorte();
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
  else if (a === 'per') { periodo = el.dataset.v; render(); }
  else if (a === 'dim') { dim = el.dataset.v; render(); }
  else if (a === 'ord') { orden = el.dataset.v; render(); }
  else if (a === 'xlsx') exportarExcel();
  else if (a === 'exportjson') exportarJSON();
  else if (a === 'saveset') guardarAjustes();
  else if (a === 'testia') probarIA();
  else if (a === 'usemodel') { $('#sModel').value = el.dataset.v; guardarAjustes(); probarIA(); }
  else if (a === 'iacancel') cancelarIA();
  else if (a === 'iaundo') deshacerIA();
  else if (a === 'plant') aplicarPlantilla(el.dataset.v);
  else if (a === 'saveplant') guardarPlantillas(false);
  else if (a === 'resetplant') { if (confirm('¿Volver a las plantillas de ejemplo? Se perderán tus cambios.')) guardarPlantillas(true); }
  else if (a === 'tasar') accionTasar();
  else if (a === 'usarprecio') { const f = $('#frm'); if (f) { f.listPrice.value = el.dataset.v; toast('Precio de publicación puesto. Pulsa Guardar.'); } }
  else if (a === 'chatopen') { const c = $('#chatPanel'); if (c) { c.classList.toggle('hidden'); if (!c.classList.contains('hidden')) { pintarChat(); const i = $('#chatIn'); if (i) i.focus(); } } }
  else if (a === 'chatsend') enviarChat();
  else if (a === 'chatclear') { if (!iaCtl) { chatMsgs = []; pintarChat(); } }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target && e.target.id === 'chatIn') { e.preventDefault(); enviarChat(); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'busca') {
    busca = e.target.value; const pos = e.target.selectionStart; render();
    const n = $('#busca'); if (n) { n.focus(); n.setSelectionRange(pos, pos); }
  }
});
document.addEventListener('change', e => {
  if (e.target.id === 'perMes' && /^\d{4}-\d{2}$/.test(e.target.value)) { periodo = e.target.value; render(); return; }
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
