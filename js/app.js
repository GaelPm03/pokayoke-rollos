/* ====== App Poka-Yoke (PC + escáner de pistola): flujo, validación y UI ====== */
/* global qrcode, Datos */

(() => {
  const $ = id => document.getElementById(id);

  /* ================== Estado ================== */
  let paso = 'estacion';            // 'estacion' | 'rollo'
  let estacionActual = null;        // objeto estación fijada
  let adminDesbloqueado = false;
  let modalContexto = null;         // { tipo: 'material'|'estacion', codigoOriginal: string|null }

  /* ================== Sonido ================== */
  let audioCtx = null;
  function tono(frec, duracionMs, tipo = 'sine', cuando = 0) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = tipo;
      osc.frequency.value = frec;
      gain.gain.value = 0.4;
      osc.connect(gain).connect(audioCtx.destination);
      const t = audioCtx.currentTime + cuando / 1000;
      osc.start(t);
      osc.stop(t + duracionMs / 1000);
    } catch (e) { /* sin audio */ }
  }
  function sonidoOk() { tono(880, 120); tono(1320, 180, 'sine', 130); }
  function sonidoError() { tono(220, 350, 'square'); tono(180, 350, 'square', 380); tono(150, 500, 'square', 760); }
  function sonidoAviso() { tono(440, 200, 'triangle'); }

  /* ================== Toast ================== */
  let toastTimer = null;
  function toast(msg, ms = 2600) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('oculto');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('oculto'), ms);
  }

  /* ================== Navegación de pantallas ================== */
  function pantallaActiva() {
    return document.querySelector('.pantalla.activa').id;
  }

  function mostrarPantalla(id) {
    document.querySelectorAll('.pantalla').forEach(p => p.classList.remove('activa'));
    $(id).classList.add('activa');
    if (id === 'pantalla-historial') renderHistorial();
  }

  /* ================== Captura global de la pistola ================== */
  // La pistola actúa como teclado: teclea el código muy rápido y manda Enter.
  // Capturamos a nivel documento para que el operador NUNCA tenga que hacer clic.
  let bufferPistola = '';
  let timerPistola = null;
  const PAUSA_FIN_LECTURA = 400; // ms sin teclas = fin de lectura (pistolas sin Enter)

  function focoEnCampo() {
    const el = document.activeElement;
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
  }

  function onTeclaGlobal(e) {
    // si el cursor está en un campo de texto, la pistola/teclado escribe ahí (admin, manual)
    if (focoEnCampo()) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      finalizarLectura();
      return;
    }
    if (e.key.length !== 1) return; // ignora F5, flechas, etc.

    e.preventDefault();
    bufferPistola += e.key;
    clearTimeout(timerPistola);
    // respaldo para pistolas que no mandan Enter: procesa tras una pausa corta
    timerPistola = setTimeout(() => { if (bufferPistola.length >= 4) finalizarLectura(); }, PAUSA_FIN_LECTURA);
  }

  function finalizarLectura() {
    clearTimeout(timerPistola);
    const texto = bufferPistola;
    bufferPistola = '';
    if (texto.trim().length < 2) return;
    manejarLectura(texto);
  }

  function parpadearZona() {
    const z = $('zona-escaneo');
    z.classList.remove('lectura');
    void z.offsetWidth; // reinicia la animación
    z.classList.add('lectura');
  }

  // Punto de entrada de toda lectura de pistola, venga de donde venga
  function manejarLectura(texto) {
    // ¿es una configuración (QR de sync leído con pistola 2D)? funciona en cualquier pantalla
    if (Datos.esQRDeSync(texto)) {
      recibirConfigPorPistola(texto);
      return;
    }

    const activa = pantallaActiva();

    if (activa === 'pantalla-admin') {
      toast('Estás en Administración. Vuelve a la pantalla de escaneo para validar rollos.');
      sonidoAviso();
      return;
    }
    if (activa === 'pantalla-historial') {
      mostrarPantalla('pantalla-escaneo');
    }

    // si hay un resultado en pantalla, el disparo lo cierra y procesa el siguiente código
    if (!$('pantalla-resultado').classList.contains('oculto')) {
      cerrarResultado();
    }

    parpadearZona();
    procesarCodigo(texto);
  }

  function recibirConfigPorPistola(texto) {
    const versionActual = Datos.config.version || 0;
    if (confirm(`Se detectó un código de CONFIGURACIÓN.\n\nTu versión actual: ${versionActual}\n¿Aplicar la configuración recibida? Reemplazará la de esta PC.`)) {
      const res = Datos.importarDeQR(texto);
      if (res.ok) {
        sonidoOk();
        toast(`✓ Configuración aplicada (versión ${res.version})`);
        if (adminDesbloqueado) renderAdmin();
      } else {
        sonidoError();
        toast('⚠️ ' + res.error);
      }
    }
  }

  /* ================== Flujo de escaneo (poka-yoke) ================== */
  function actualizarUIPaso() {
    const p1 = $('paso-1'), p2 = $('paso-2');
    if (paso === 'estacion') {
      p1.classList.add('activo'); p1.classList.remove('completado');
      p2.classList.remove('activo', 'completado');
      $('instruccion-escaneo').textContent = 'Dispara al código de la ESTACIÓN';
      $('zona-sub').textContent = 'Apunta la pistola a la etiqueta de la máquina y dispara';
      $('banner-estacion-fija').classList.add('oculto');
    } else {
      p1.classList.remove('activo'); p1.classList.add('completado');
      p2.classList.add('activo');
      $('instruccion-escaneo').textContent = 'Ahora dispara al código del ROLLO';
      $('zona-sub').textContent = 'Apunta la pistola a la etiqueta del rollo y dispara';
      const nombre = estacionActual.nombre ? ` — ${estacionActual.nombre}` : '';
      $('texto-estacion-fija').textContent = `📍 Estación: ${estacionActual.codigo}${nombre}`;
      $('banner-estacion-fija').classList.remove('oculto');
    }
    $('zona-texto').textContent = 'Listo para escanear';
    $('aviso-escaneo').classList.add('oculto');
  }

  function mostrarAviso(msg) {
    const av = $('aviso-escaneo');
    av.textContent = msg;
    av.classList.remove('oculto');
    sonidoAviso();
    setTimeout(() => av.classList.add('oculto'), 4000);
  }

  function procesarCodigo(texto) {
    const codigo = Datos.normalizar(texto);
    if (!codigo) return;

    const tipo = Datos.clasificarCodigo(codigo);

    if (paso === 'estacion') {
      if (tipo === 'estacion') {
        estacionActual = Datos.buscarEstacion(codigo);
        paso = 'rollo';
        sonidoOk();
        actualizarUIPaso();
      } else if (tipo === 'rollo') {
        mostrarAviso('⚠️ Eso es un ROLLO. Primero dispara a la etiqueta de la MÁQUINA / estación.');
      } else {
        mostrarAviso('⚠️ Código no registrado como estación. Verifica o avisa a tu supervisor.');
      }
      return;
    }

    // paso === 'rollo'
    if (tipo === 'estacion') {
      // disparó a otra estación: la cambiamos (caso común al moverse de máquina)
      estacionActual = Datos.buscarEstacion(codigo);
      sonidoAviso();
      actualizarUIPaso();
      toast(`Estación cambiada a ${estacionActual.codigo}`);
      return;
    }

    mostrarResultado(codigo);
  }

  /* ================== Pantalla de resultado ================== */
  function mostrarResultado(codigoRollo) {
    const v = Datos.validar(codigoRollo, estacionActual.codigo);
    Datos.registrarEscaneo(codigoRollo, estacionActual.codigo, v.resultado);

    const pant = $('pantalla-resultado');
    pant.classList.remove('oculto', 'ok', 'error', 'desconocido');

    const nombreEst = estacionActual.nombre || estacionActual.codigo;

    if (v.resultado === 'ok') {
      pant.classList.add('ok');
      $('resultado-icono').textContent = '✓';
      $('resultado-titulo').textContent = 'ROLLO CORRECTO';
      $('resultado-detalle').innerHTML =
        `${v.material.descripcion || v.material.codigo}<br>sí va en <b>${nombreEst}</b>`;
      sonidoOk();
    } else if (v.resultado === 'error') {
      pant.classList.add('error');
      $('resultado-icono').textContent = '✕';
      $('resultado-titulo').textContent = 'NO COLOCAR';
      const destinos = v.estacionesPermitidas.map(c => {
        const e = Datos.buscarEstacion(c);
        return e && e.nombre ? `${e.codigo} (${e.nombre})` : c;
      }).join(', ');
      $('resultado-detalle').innerHTML =
        `Este rollo (${v.material.descripcion || v.material.codigo})<br>NO va en ${nombreEst}.<br>` +
        (destinos ? `Su lugar correcto es:<br><b>${destinos}</b>` : '<b>No tiene estación asignada</b>');
      sonidoError();
    } else {
      pant.classList.add('desconocido');
      $('resultado-icono').textContent = '?';
      $('resultado-titulo').textContent = 'CÓDIGO DESCONOCIDO';
      $('resultado-detalle').innerHTML =
        `El código <b>${codigoRollo}</b> no está registrado.<br>NO coloques el rollo. Avisa a tu supervisor.`;
      sonidoError();
    }
  }

  function cerrarResultado() {
    $('pantalla-resultado').classList.add('oculto');
    // la estación queda fija: el siguiente disparo es otro rollo en la misma máquina
    actualizarUIPaso();
  }

  /* ================== Admin: PIN y tabs ================== */
  function abrirAdmin() {
    mostrarPantalla('pantalla-admin');
    if (adminDesbloqueado) {
      $('admin-candado').classList.add('oculto');
      $('admin-contenido').classList.remove('oculto');
      renderAdmin();
    } else {
      $('admin-candado').classList.remove('oculto');
      $('admin-contenido').classList.add('oculto');
      $('input-pin').value = '';
      $('error-pin').classList.add('oculto');
      $('input-pin').focus();
    }
  }

  function intentarPin() {
    if (Datos.verificarPin($('input-pin').value)) {
      adminDesbloqueado = true;
      abrirAdmin();
    } else {
      $('error-pin').classList.remove('oculto');
      sonidoError();
    }
  }

  function cambiarTab(idTab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('activa', t.dataset.tab === idTab));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('activa', p.id === idTab));
    if (idTab === 'tab-sync') renderSyncInfo();
  }

  /* ================== Admin: render de listas ================== */
  function renderAdmin() {
    renderMateriales();
    renderEstaciones();
    renderSyncInfo();
  }

  function renderMateriales() {
    const ul = $('lista-materiales');
    ul.innerHTML = '';
    const mats = Datos.config.materiales;
    if (!mats.length) { ul.innerHTML = '<li class="lista-vacia">Sin materiales. Agrega el primero ☝️</li>'; return; }
    mats.forEach(m => {
      const li = document.createElement('li');
      const tag = m.tipoCoincidencia === 'prefijo' ? '<span class="item-tag">PREFIJO</span>' : '';
      const ests = m.estaciones.length ? m.estaciones.join(', ') : '⚠️ sin estaciones';
      li.innerHTML = `<div class="item-codigo">${m.codigo}${tag}</div>
        <div class="item-detalle">${m.descripcion || '(sin descripción)'} → ${ests}</div>`;
      li.addEventListener('click', () => abrirModal('material', m.codigo));
      ul.appendChild(li);
    });
  }

  function renderEstaciones() {
    const ul = $('lista-estaciones');
    ul.innerHTML = '';
    const ests = Datos.config.estaciones;
    if (!ests.length) { ul.innerHTML = '<li class="lista-vacia">Sin estaciones. Agrega la primera ☝️</li>'; return; }
    ests.forEach(e => {
      const li = document.createElement('li');
      const nMat = Datos.config.materiales.filter(m => m.estaciones.map(Datos.normalizar).includes(Datos.normalizar(e.codigo))).length;
      li.innerHTML = `<div class="item-codigo">${e.codigo}</div>
        <div class="item-detalle">${e.nombre || '(sin nombre)'} — ${nMat} material(es) autorizados</div>`;
      li.addEventListener('click', () => abrirModal('estacion', e.codigo));
      ul.appendChild(li);
    });
  }

  function renderSyncInfo() {
    $('sync-version').textContent = Datos.config.version || 0;
    $('sync-fecha').textContent = Datos.config.actualizado || '—';
  }

  /* ================== Modal material / estación ================== */
  function abrirModal(tipo, codigoOriginal) {
    modalContexto = { tipo, codigoOriginal: codigoOriginal || null };
    $('modal-fondo').classList.remove('oculto');
    $('modal-codigo').value = '';
    $('modal-descripcion').value = '';
    $('modal-btn-eliminar').classList.toggle('oculto', !codigoOriginal);

    if (tipo === 'material') {
      $('modal-titulo').textContent = codigoOriginal ? 'Editar material' : 'Nuevo material';
      $('modal-hint-codigo').textContent = '(del rollo)';
      $('modal-solo-material').classList.remove('oculto');
      const m = codigoOriginal ? Datos.buscarMaterialPorCodigoExacto(codigoOriginal) : null;
      if (m) {
        $('modal-codigo').value = m.codigo;
        $('modal-descripcion').value = m.descripcion || '';
        $('modal-coincidencia').value = m.tipoCoincidencia || 'exacto';
      } else {
        $('modal-coincidencia').value = 'exacto';
      }
      // checkboxes de estaciones
      const cont = $('modal-estaciones');
      cont.innerHTML = '';
      if (!Datos.config.estaciones.length) {
        cont.innerHTML = '<p class="lista-vacia">Primero registra estaciones en la pestaña "Estaciones".</p>';
      }
      Datos.config.estaciones.forEach(e => {
        const marcado = m && m.estaciones.map(Datos.normalizar).includes(Datos.normalizar(e.codigo));
        const label = document.createElement('label');
        label.innerHTML = `<input type="checkbox" value="${e.codigo}" ${marcado ? 'checked' : ''}> ${e.codigo} ${e.nombre ? '— ' + e.nombre : ''}`;
        cont.appendChild(label);
      });
    } else {
      $('modal-titulo').textContent = codigoOriginal ? 'Editar estación' : 'Nueva estación';
      $('modal-hint-codigo').textContent = '(de la máquina)';
      $('modal-solo-material').classList.add('oculto');
      const e = codigoOriginal ? Datos.buscarEstacion(codigoOriginal) : null;
      if (e) {
        $('modal-codigo').value = e.codigo;
        $('modal-descripcion').value = e.nombre || '';
      }
    }
    // foco directo al campo código: la pistola puede disparar de inmediato
    $('modal-codigo').focus();
  }

  function cerrarModal() {
    $('modal-fondo').classList.add('oculto');
    modalContexto = null;
  }

  function guardarModal() {
    if (!modalContexto) return;
    let res;
    if (modalContexto.tipo === 'material') {
      const estaciones = Array.from(document.querySelectorAll('#modal-estaciones input:checked')).map(c => c.value);
      res = Datos.guardarMaterial(modalContexto.codigoOriginal, {
        codigo: $('modal-codigo').value,
        descripcion: $('modal-descripcion').value.trim(),
        tipoCoincidencia: $('modal-coincidencia').value,
        estaciones
      });
    } else {
      res = Datos.guardarEstacion(modalContexto.codigoOriginal, {
        codigo: $('modal-codigo').value,
        nombre: $('modal-descripcion').value.trim()
      });
    }
    if (!res.ok) { toast('⚠️ ' + res.error); return; }
    cerrarModal();
    renderAdmin();
    toast('Guardado ✓');
  }

  function eliminarModal() {
    if (!modalContexto || !modalContexto.codigoOriginal) return;
    if (!confirm('¿Eliminar definitivamente?')) return;
    if (modalContexto.tipo === 'material') Datos.eliminarMaterial(modalContexto.codigoOriginal);
    else Datos.eliminarEstacion(modalContexto.codigoOriginal);
    cerrarModal();
    renderAdmin();
    toast('Eliminado');
  }

  /* ================== Sincronización ================== */
  function generarCodigoSync() {
    $('texto-codigo-sync').value = Datos.exportarParaQR();
    $('contenedor-codigo-sync').classList.remove('oculto');
  }

  function copiarCodigoSync() {
    const texto = $('texto-codigo-sync').value;
    const listo = () => toast('📋 Código copiado. Pégalo en la otra PC.');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(listo).catch(() => copiarFallback(texto, listo));
    } else {
      copiarFallback(texto, listo);
    }
  }

  function copiarFallback(texto, listo) {
    const ta = $('texto-codigo-sync');
    ta.select();
    try { document.execCommand('copy'); listo(); }
    catch (e) { toast('Selecciona el texto y cópialo con Ctrl+C'); }
  }

  function aplicarCodigoSync() {
    const texto = $('texto-recibir-sync').value.trim();
    if (!texto) { toast('Pega primero el código de configuración'); return; }
    const res = Datos.importarDeQR(texto);
    if (res.ok) {
      $('texto-recibir-sync').value = '';
      renderAdmin();
      sonidoOk();
      toast(`✓ Configuración aplicada (versión ${res.version})`);
    } else {
      sonidoError();
      toast('⚠️ ' + res.error);
    }
  }

  function generarQRSync() {
    const datos = Datos.exportarParaQR();
    const cont = $('contenedor-qr-sync');
    const avisoGrande = $('aviso-qr-grande');
    avisoGrande.classList.add('oculto');
    try {
      const qr = qrcode(0, 'L'); // tipo auto, corrección L = máxima capacidad
      qr.addData(datos);
      qr.make();
      cont.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 4 });
      cont.classList.remove('oculto');
    } catch (e) {
      cont.classList.add('oculto');
      avisoGrande.textContent = 'La configuración es demasiado grande para un solo QR. Usa el código copiable o el CSV.';
      avisoGrande.classList.remove('oculto');
    }
  }

  /* ================== CSV ================== */
  function descargarArchivo(nombre, contenido) {
    const blob = new Blob(['﻿' + contenido], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function exportarHistorialCSV() {
    const hist = Datos.cargarHistorial();
    const lineas = ['FECHA,ROLLO,ESTACION,RESULTADO'];
    hist.forEach(h => lineas.push(`${h.fecha},${h.rollo},${h.estacion},${h.resultado}`));
    descargarArchivo('historial-pokayoke.csv', lineas.join('\r\n'));
  }

  /* ================== Historial ================== */
  function renderHistorial() {
    const ul = $('lista-historial');
    ul.innerHTML = '';
    const hist = Datos.cargarHistorial();
    if (!hist.length) { ul.innerHTML = '<li class="lista-vacia">Sin escaneos todavía</li>'; return; }
    const iconos = { ok: '✅', error: '❌', rollo_desconocido: '⚠️' };
    hist.forEach(h => {
      const li = document.createElement('li');
      const f = new Date(h.fecha);
      const fecha = `${f.toLocaleDateString()} ${f.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      li.innerHTML = `<span class="h-icono">${iconos[h.resultado] || '?'}</span>
        <div class="h-info">
          <div class="h-codigos">${h.rollo} → ${h.estacion}</div>
          <div class="h-fecha">${fecha}</div>
        </div>`;
      ul.appendChild(li);
    });
  }

  /* ================== Eventos ================== */
  document.addEventListener('DOMContentLoaded', () => {
    // captura global de la pistola
    document.addEventListener('keydown', onTeclaGlobal);

    // pantalla principal
    $('btn-otro').addEventListener('click', cerrarResultado);
    $('btn-soltar-estacion').addEventListener('click', () => {
      estacionActual = null;
      paso = 'estacion';
      actualizarUIPaso();
    });
    $('btn-manual').addEventListener('click', () => {
      const v = $('input-manual').value;
      if (v.trim()) { $('input-manual').value = ''; $('input-manual').blur(); manejarLectura(v); }
    });
    $('input-manual').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); $('btn-manual').click(); }
    });

    // navegación
    $('btn-admin').addEventListener('click', abrirAdmin);
    $('btn-historial').addEventListener('click', () => mostrarPantalla('pantalla-historial'));
    $('btn-volver-1').addEventListener('click', () => mostrarPantalla('pantalla-escaneo'));
    $('btn-volver-2').addEventListener('click', () => mostrarPantalla('pantalla-escaneo'));
    $('btn-volver-3').addEventListener('click', () => mostrarPantalla('pantalla-escaneo'));

    // admin
    $('btn-entrar-admin').addEventListener('click', intentarPin);
    $('input-pin').addEventListener('keydown', e => { if (e.key === 'Enter') intentarPin(); });
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => cambiarTab(t.dataset.tab)));
    $('btn-nuevo-material').addEventListener('click', () => abrirModal('material', null));
    $('btn-nueva-estacion').addEventListener('click', () => abrirModal('estacion', null));

    // modal
    $('modal-btn-cancelar').addEventListener('click', cerrarModal);
    $('modal-btn-guardar').addEventListener('click', guardarModal);
    $('modal-btn-eliminar').addEventListener('click', eliminarModal);

    // sync
    $('btn-generar-codigo').addEventListener('click', generarCodigoSync);
    $('btn-copiar-codigo').addEventListener('click', copiarCodigoSync);
    $('btn-aplicar-codigo').addEventListener('click', aplicarCodigoSync);
    $('btn-generar-qr').addEventListener('click', generarQRSync);
    $('btn-exportar-csv').addEventListener('click', () => descargarArchivo('configuracion-pokayoke.csv', Datos.exportarCSV()));
    $('btn-importar-csv').addEventListener('click', () => $('input-csv').click());
    $('input-csv').addEventListener('change', e => {
      const archivo = e.target.files[0];
      if (!archivo) return;
      const lector = new FileReader();
      lector.onload = () => {
        const res = Datos.importarCSV(lector.result);
        if (res.ok) {
          renderAdmin();
          toast(`✓ Importado: ${res.materiales} materiales, ${res.estaciones} estaciones` + (res.errores ? ` (${res.errores} líneas con error)` : ''));
        } else toast('⚠️ ' + res.error);
        e.target.value = '';
      };
      lector.readAsText(archivo, 'utf-8');
    });

    // ajustes
    $('btn-cambiar-pin').addEventListener('click', () => {
      const res = Datos.cambiarPin($('input-pin-nuevo').value);
      if (res.ok) { $('input-pin-nuevo').value = ''; toast('PIN actualizado ✓'); }
      else toast('⚠️ ' + res.error);
    });
    $('btn-borrar-historial').addEventListener('click', () => {
      if (confirm('¿Borrar todo el historial de escaneos?')) { Datos.borrarHistorial(); toast('Historial borrado'); }
    });
    $('btn-borrar-todo').addEventListener('click', () => {
      if (confirm('⚠️ Se borrarán TODOS los materiales, estaciones e historial de esta PC. ¿Continuar?')) {
        Datos.borrarTodo();
        renderAdmin();
        toast('Configuración borrada');
      }
    });

    // historial
    $('btn-exportar-historial').addEventListener('click', exportarHistorialCSV);

    actualizarUIPaso();
  });

  /* ================== Service worker ================== */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
