/* Visor de la pantalla remota del teléfono (pagos.dmalabomba.com/remoto). Habla solo con /remoto/api (mismo origen). */
(function () {
  'use strict';
  var API = '/remoto/api';
  var EMPRESA = /[?&]empresa=pollos(&|$)/.test(location.search) ? 'pollos' : 'soda';
  var NOMBRE_EMPRESA = EMPRESA === 'pollos' ? 'Pollos La Bomba' : 'Soda La Bomba';
  var $ = function (id) { return document.getElementById(id); };
  var token = null, tokExp = 0, sid = null, ultimoSeq = -1, temporizador = null, cuentaT = null, vence = 0, abiertoEn = 0;
  var hayImagen = false, cargando = false, parado = false;
  var NOMBRES = { toque: 'Toque', largo: 'Toque largo', deslizar: 'Deslizar', atras: 'Atrás', inicio: 'Inicio', recientes: 'Apps recientes', notificaciones: 'Notificaciones', texto: 'Escribir texto', borrar: 'Borrar', encender: 'Encender pantalla' };
  var RESULTADOS = { cancelada: 'cancelada', sin_respuesta: 'sin respuesta', obsoleta: 'la pantalla cambió, no se hizo', vencida: 'venció sin llegar al teléfono' };

  try { token = sessionStorage.getItem('pv_t'); tokExp = Number(sessionStorage.getItem('pv_e')) || 0; } catch (e) { token = null; }
  if (token && tokExp && tokExp <= Date.now()) { token = null; tokExp = 0; try { sessionStorage.removeItem('pv_t'); sessionStorage.removeItem('pv_e'); } catch (e) {} }
  $('quien').textContent = NOMBRE_EMPRESA;

  function vista(cual) {
    ['vEntrar', 'vInicio', 'vSesion', 'vFin'].forEach(function (v) { $(v).classList.toggle('oculto', v !== cual); });
  }
  function salirDeSesion(msg) {
    token = null; tokExp = 0; sid = null; try { sessionStorage.removeItem('pv_t'); sessionStorage.removeItem('pv_e'); } catch (e) {}
    parar(); $('imagen').removeAttribute('src'); $('pin').value = ''; vista('vEntrar'); $('mEntrar').className = 'mensaje'; $('mEntrar').textContent = msg || '';
  }
  function parar() { parado = true; clearTimeout(temporizador); clearInterval(cuentaT); temporizador = null; cuentaT = null; }

  async function api(op, extra) {
    var cuerpo = Object.assign({ op: op, token: token }, extra || {});
    var r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo), cache: 'no-store', credentials: 'omit' });
    var j = null; try { j = await r.json(); } catch (e) { j = null; }
    if (r.status === 401 && j && (j.vencida || op !== 'entrar')) { salirDeSesion(j.vencida ? 'Tu ingreso venció (dura 15 minutos). Entra de nuevo.' : 'Tu ingreso ya no es válido. Entra de nuevo.'); throw new Error('sin-ingreso'); }
    return { status: r.status, j: j || {} };
  }

  // ---------- entrar ----------
  $('fEntrar').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var m = $('mEntrar'), b = $('bEntrar');
    b.disabled = true; m.className = 'mensaje'; m.textContent = 'Verificando…';
    try {
      var r = await api('entrar', { usuario: $('usuario').value, pin: $('pin').value });
      $('pin').value = '';
      if (r.j.ok && r.j.token) {
        token = r.j.token; tokExp = Date.now() + (Number(r.j.vence_s) || 900) * 1000; try { sessionStorage.setItem('pv_t', token); sessionStorage.setItem('pv_e', String(tokExp)); } catch (e) {}
        m.textContent = ''; vista('vInicio'); $('mInicio').textContent = '';
      } else {
        m.className = 'mensaje error'; m.textContent = r.status === 429 && r.j.bloqueado ? 'Demasiados intentos. Espera unos minutos antes de volver a intentar.' : (r.j.error || 'No se pudo entrar. Intenta de nuevo.');
      }
    } catch (e) {
      if (e.message !== 'sin-ingreso') { m.className = 'mensaje error'; m.textContent = 'No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.'; }
    } finally { b.disabled = false; }
  });

  // ---------- abrir sesión ----------
  async function abrir() {
    var b = $('bAbrir'), m = $('mInicio');
    b.disabled = true; m.className = 'mensaje'; m.textContent = 'Abriendo la sesión…';
    try {
      var r = await api('abrir', { empresa: EMPRESA });
      if (r.j.ok && r.j.sid) {
        sid = r.j.sid; ultimoSeq = -1; hayImagen = false; parado = false; abiertoEn = Date.now();
        vence = Date.now() + (r.j.resta_s || 600) * 1000; if (tokExp && vence > tokExp) vence = tokExp;
        $('imagen').classList.add('oculto'); $('espera').classList.remove('oculto'); $('velo').classList.add('oculto');
        $('espera').textContent = 'Esperando la primera imagen del teléfono…';
        pintarLista([{ t: 'Todavía no has enviado órdenes.' }]);
        vista('vSesion'); ponerEstado('', 'Sesión abierta. Esperando al teléfono…');
        clearInterval(cuentaT); cuentaT = setInterval(pintarCuenta, 1000); pintarCuenta();
        ciclo();
      } else {
        m.className = 'mensaje error'; m.textContent = r.status === 403 ? 'Tu usuario no tiene permiso para esto.' : (r.j.error || 'No se pudo abrir la sesión.');
      }
    } catch (e) { if (e.message !== 'sin-ingreso') { m.className = 'mensaje error'; m.textContent = 'No hay conexión con el servidor. Intenta de nuevo.'; } }
    finally { b.disabled = false; }
  }
  $('bAbrir').addEventListener('click', abrir);
  $('bOtra').addEventListener('click', function () {
    if (!token || (tokExp && tokExp - Date.now() < 10000)) { salirDeSesion('Tu ingreso venció (dura 15 minutos). Entra de nuevo.'); return; }
    vista('vInicio'); $('mInicio').textContent = '';
  });

  // ---------- estado y cuenta regresiva ----------
  function ponerEstado(clase, texto) { $('punto').className = 'punto ' + (clase || ''); $('estadoTexto').textContent = texto; }
  function pintarCuenta() {
    var s = Math.max(0, Math.round((vence - Date.now()) / 1000));
    $('cuenta').textContent = 'Quedan ' + String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') + ' de sesión';
  }

  // ---------- ciclo de lectura (~1 s) ----------
  function ciclo() {
    clearTimeout(temporizador);
    if (parado) return;
    leer().then(function () { if (!parado) temporizador = setTimeout(ciclo, 700); }, function (e) {
      if (e && e.message === 'sin-ingreso') return;
      ponerEstado('mal', 'Sin conexión con el servidor. Reintentando…');
      if (!parado) temporizador = setTimeout(ciclo, 2500);
    });
  }
  async function leer() {
    if (cargando) return; cargando = true;
    try {
      var r = await api('leer', { sid: sid, desde: ultimoSeq });
      var d = r.j;
      if (!d.ok) { fin('No se pudo leer la sesión.'); return; }
      if (!d.viva) { fin(d.motivo_cierre === 'telefono' ? 'El teléfono cerró la sesión.' : (d.motivo_cierre === 'vencida' ? 'La sesión llegó al límite de tiempo (máximo 15 minutos). Se borró la imagen del teléfono.' : 'La sesión terminó. Se borró la imagen del teléfono.')); return; }
      vence = Date.now() + d.resta_s * 1000; pintarCuenta();
      var c = d.cuadro;
      if (c) {
        if (c.jpg) {
          var im = $('imagen'); im.src = 'data:image/jpeg;base64,' + c.jpg; ultimoSeq = c.seq;
          im.classList.remove('oculto'); $('espera').classList.add('oculto');
          $('pantalla').style.aspectRatio = c.w + '/' + c.h; hayImagen = true;
        }
        var v = $('velo');
        if (c.encendida === false) { v.textContent = 'La pantalla del teléfono está apagada. Usa «Encender la pantalla del teléfono».'; v.classList.remove('oculto'); $('bEncender').classList.add('aviso'); }
        else if (c.bloqueada === true) { v.textContent = 'El teléfono tiene el bloqueo de pantalla puesto. Desde aquí no se puede desbloquear.'; v.classList.remove('oculto'); $('bEncender').classList.remove('aviso'); }
        else { v.classList.add('oculto'); $('bEncender').classList.remove('aviso'); }
      }
      var visto = d.telefono_visto_s;
      if (hayImagen && visto !== null && visto <= 10) ponerEstado('bien', 'Conectado al teléfono. Imagen de hace ' + Math.max(visto, 0) + ' s.');
      else if (hayImagen) ponerEstado('mal', 'El teléfono dejó de responder hace ' + visto + ' s. Puede haber perdido internet.');
      else {
        var seg = Math.round((Date.now() - abiertoEn) / 1000);
        if (seg < 75) { ponerEstado('', 'Esperando al teléfono. Revisa cada minuto si lo necesitas; puede tardar hasta 1 minuto. Van ' + seg + ' s.'); }
        else { ponerEstado('mal', 'El teléfono no ha respondido en ' + seg + ' s. Puede estar apagado, sin internet o sin el servicio de accesibilidad activo. La sesión sigue abierta.'); $('espera').textContent = 'El teléfono no responde todavía.'; }
      }
      pintarUltimas(d.ultimas || [], d.pendientes || 0);
    } finally { cargando = false; }
  }
  // Todo el texto va con textContent (nada de innerHTML): el nombre de la orden y el resultado vienen del servidor/teléfono.
  function pintarLista(items) {
    var ul = $('ultimas'); while (ul.firstChild) ul.removeChild(ul.firstChild);
    items.forEach(function (it) {
      var li = document.createElement('li'), a = document.createElement('span'), b = document.createElement('span');
      a.textContent = it.t; b.textContent = it.r || ''; if (it.c) b.className = it.c;
      li.appendChild(a); li.appendChild(b); ul.appendChild(li);
    });
  }
  function pintarUltimas(lista, pendientes) {
    if (!lista.length && !pendientes) return;
    var items = [];
    if (pendientes) items.push({ t: pendientes + ' orden' + (pendientes === 1 ? '' : 'es') + ' esperando al teléfono', r: '…' });
    lista.forEach(function (x) {
      var ok = x.resultado === 'ok';
      items.push({ t: NOMBRES[x.a] || String(x.a).slice(0, 20), r: ok ? 'hecho' : (RESULTADOS[x.resultado] || 'no se pudo'), c: ok ? 'ok' : 'fallo' });
    });
    pintarLista(items);
  }
  function fin(texto) {
    parar(); $('finTexto').textContent = texto; vista('vFin');
    $('imagen').removeAttribute('src');
  }

  // ---------- órdenes ----------
  async function orden(a, params) {
    if (!sid || parado) return;
    // Cada orden va atada a la última imagen que se ve: si la pantalla del teléfono ya cambió, el teléfono la descarta («obsoleta»).
    if (a !== 'encender' && !hayImagen) { ponerEstado('', 'Espera a que llegue la primera imagen del teléfono antes de mandar órdenes.'); return; }
    var cuerpo = { sid: sid, a: a, params: params || {} };
    if (a !== 'encender' && ultimoSeq >= 0) cuerpo.cuadro_seq = ultimoSeq;
    try {
      var r = await api('accion', cuerpo);
      if (!r.j.ok) {
        if (r.j.error === 'sesion cerrada') { fin('La sesión ya terminó.'); return; }
        if (r.j.error === 'cuadro invalido' || r.j.error === 'sin imagen todavia') { ponerEstado('mal', 'La imagen cambió o todavía no llega. Mira la pantalla y vuelve a intentar.'); return; }
        ponerEstado('mal', 'No se envió la orden: ' + (r.j.error || 'error') + '.');
      }
    } catch (e) { if (e.message !== 'sin-ingreso') ponerEstado('mal', 'No se pudo enviar la orden. Revisa tu conexión.'); }
  }
  document.querySelectorAll('button[data-a]').forEach(function (b) { b.addEventListener('click', function () { orden(b.getAttribute('data-a')); }); });
  $('bTexto').addEventListener('click', function () {
    var t = $('texto').value; if (!t) return;
    orden('texto', { t: t }); $('texto').value = '';
  });
  $('bBorrar').addEventListener('click', function () { orden('borrar', { n: 1 }); });
  $('bProrrogar').addEventListener('click', async function () {
    try { var r = await api('prorrogar', { sid: sid }); if (r.j.ok) { vence = Date.now() + r.j.resta_s * 1000; pintarCuenta(); if (r.j.tope_15min) ponerEstado('', 'La sesión llegó al máximo de 15 minutos desde que se abrió; después hay que abrir otra.'); } else ponerEstado('mal', r.j.error || 'No se pudo alargar.'); }
    catch (e) { /* ya manejado */ }
  });
  $('bTerminar').addEventListener('click', async function () {
    var b = $('bTerminar'); b.disabled = true;
    try { await api('cerrar', { sid: sid }); } catch (e) { /* si falla, igual se cierra aquí: la sesión vence sola */ }
    // Cierra la sesión en el servidor y deja el visor sin ingreso: para volver hay que escribir usuario y PIN otra vez.
    salirDeSesion('Sesión terminada. Se borró la imagen del teléfono. Para volver a entrar, escribe tu usuario y PIN.');
    b.disabled = false;
  });

  // ---------- toque, toque largo y deslizar sobre la imagen ----------
  var p0 = null;
  var pant = $('pantalla');
  function rel(ev) {
    var r = pant.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)), px: ev.clientX - r.left, py: ev.clientY - r.top };
  }
  function onda(px, py) { var d = document.createElement('div'); d.className = 'toque'; d.style.left = px + 'px'; d.style.top = py + 'px'; pant.appendChild(d); setTimeout(function () { d.remove(); }, 800); }
  pant.addEventListener('pointerdown', function (ev) {
    if (!hayImagen || ev.button > 0) return;
    pant.setPointerCapture(ev.pointerId); var p = rel(ev); p.t = Date.now(); p0 = p; ev.preventDefault();
  });
  pant.addEventListener('pointerup', function (ev) {
    if (!p0) return; var p1 = rel(ev), dur = Date.now() - p0.t, dx = p1.x - p0.x, dy = p1.y - p0.y, dist = Math.sqrt(dx * dx + dy * dy);
    var a = p0; p0 = null; onda(p1.px, p1.py);
    if (dist < 0.025) {
      if (dur >= 500) orden('largo', { x: round(a.x), y: round(a.y), ms: Math.min(1500, Math.max(500, dur)) });
      else orden('toque', { x: round(a.x), y: round(a.y) });
    } else {
      orden('deslizar', { x1: round(a.x), y1: round(a.y), x2: round(p1.x), y2: round(p1.y), ms: Math.min(1500, Math.max(120, dur)) });
    }
  });
  pant.addEventListener('pointercancel', function () { p0 = null; });
  function round(v) { return Math.round(v * 10000) / 10000; }

  // ---------- arranque ----------
  window.addEventListener('pagehide', function () { parar(); });
  if (token) vista('vInicio'); else vista('vEntrar');
})();
