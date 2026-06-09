/* ====== App Poka-Yoke: flujo de escaneo, validación y UI ====== */
/* global Html5Qrcode, qrcode, Datos */

(() => {
  const $ = id => document.getElementById(id);

  /* ================== Estado ================== */
  let paso = 'estacion';            // 'estacion' | 'rollo'
  let estacionActual = null;        // objeto estación fijada
  let lectorPrincipal = null;       // Html5Qrcode de la pantalla principal
  let lectorSync = null;
  let lectorModal = null;
  let procesando = false;           // evita doble lectura mientras se muestra resultado
  let ultimoCodigo = '';
  let ultimoTiempo = 0;
  let adminDesbloqueado = false;
  let modalContexto = null;         // { tipo: 'material'|'estacion', codigoOriginal: string|null }

  /* ================== Sonido y vibración ================== */
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
  function vibrar(patron) { if (navigator.vibrate) navigator.vibrate(patron); }

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
  function mostrarPantalla(id) {
    detenerLectorPrincipal();
    detenerLectorSync();
    document.querySelectorAll('.pantalla').forEach(p => p.classList.remove('activa'));
    $(id).classList.add('activa');
    if (id === 'pantalla-escaneo') iniciarLectorPrincipal();
    if (id === 'pantalla-historial') renderHistorial();
  }

  /* ================== Lector principal ================== */
  // Zona de escaneo ancha (rectángulo): mejor para códigos de barras 1D
  function calcularQrbox(anchoVista, altoVista) {
    const ancho = Math.floor(Math.min(anchoVista * 0.9, 500));
    const alto = Math.floor(Math.min(altoVista * 0.45, 220));
    return { width: ancho, height: alto };
  }

  const CONFIG_LECTOR = {
    fps: 15,
    qrbox: calcularQrbox,
    // mayor resolución + enfoque continuo = lecturas nítidas
    videoConstraints: {
      facingMode: 'environment',
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      advanced: [{ focusMode: 'continuous' }]
    }
  };

  // usa el detector de códigos NATIVO del celular si existe (mucho más preciso)
  const OPCIONES_HTML5QR = {
    verbose: false,
    experimentalFeatures: { useBarCodeDetectorIfSupported: true }
  };

  function iniciarLectorPrincipal() {
    if (lectorPrincipal) return;
    $('lector-apagado').classList.add('oculto');
    lectorPrincipal = new Html5Qrcode('lector', OPCIONES_HTML5QR);
    lectorPrincipal.start(
      { facingMode: 'environment' },
      CONFIG_LECTOR,
      onCodigoEscaneado,
      () => { /* sin lectura en este frame: normal */ }
    ).catch(err => {
      lectorPrincipal = null;
      $('lector-apagado').classList.remove('oculto');
      toast('No se pudo abrir la cámara. Usa la entrada manual o revisa permisos.');
      console.error(err);
    });
  }

  function detenerLectorPrincipal() {
    if (!lectorPrincipal) return;
    const l = lectorPrincipal;
    lectorPrincipal = null;
    l.stop().then(() => l.clear()).catch(() => {});
  }

  /* ================== Flujo de escaneo (poka-yoke) ================== */
  function actualizarUIPaso() {
    const p1 = $('paso-1'), p2 = $('paso-2');
    if (paso === 'estacion') {
      p1.classList.add('activo'); p1.classList.remove('completado');
      p2.classList.remove('activo', 'completado');
      $('instruccion-escaneo').textContent = 'Escanea el código de la ESTACIÓN';
      $('banner-estacion-fija').classList.add('oculto');
    } else {
      p1.classList.remove('activo'); p1.classList.add('completado');
      p2.classList.add('activo');
      $('instruccion-escaneo').textContent = 'Ahora escanea el código del ROLLO';
      const nombre = estacionActual.nombre ? ` — ${estacionActual.nombre}` : '';
      $('texto-estacion-fija').textContent = `📍 Estación: ${estacionActual.codigo}${nombre}`;
      $('banner-estacion-fija').classList.remove('oculto');
    }
    $('aviso-escaneo').classList.add('oculto');
  }

  function mostrarAviso(msg) {
    const av = $('aviso-escaneo');
    av.textContent = msg;
    av.classList.remove('oculto');
    sonidoAviso();
    vibrar(200);
    setTimeout(() => av.classList.add('oculto'), 4000);
  }

  // Confirmación de doble lectura: el mismo código debe leerse 2 veces seguidas
  // en menos de 1.5 s antes de aceptarse — descarta lecturas parciales/borrosas
  let candidato = '';
  let candidatoTiempo = 0;

  function onCodigoEscaneado(texto) {
    const ahora = Date.now();
    if (procesando) return;
    // anti-rebote: ignora el código recién procesado por 2.5 s
    if (texto === ultimoCodigo && ahora - ultimoTiempo < 2500) return;

    if (texto !== candidato || ahora - candidatoTiempo > 1500) {
      // primera lectura: queda como candidato a confirmar
      candidato = texto;
      candidatoTiempo = ahora;
      return;
    }

    // segunda lectura idéntica: confirmado
    candidato = '';
    ultimoCodigo = texto;
    ultimoTiempo = ahora;
    procesarCodigo(texto);
  }

  function procesarCodigo(texto) {
    const codigo = Datos.normalizar(texto);
    if (!codigo) return;

    // ¿escanearon un QR de configuración aquí por error?
    if (Datos.esQRDeSync(texto)) {
      mostrarAviso('Ese es un QR de configuración. Para recibirlo entra a Admin → Sincronizar.');
      return;
    }

    const tipo = Datos.clasificarCodigo(codigo);

    if (paso === 'estacion') {
      if (tipo === 'estacion') {
        estacionActual = Datos.buscarEstacion(codigo);
        paso = 'rollo';
        sonidoOk();
        vibrar(80);
        actualizarUIPaso();
      } else if (tipo === 'rollo') {
        mostrarAviso('⚠️ Eso es un ROLLO. Primero escanea la etiqueta de la MÁQUINA / estación.');
      } else {
        mostrarAviso('⚠️ Código no registrado como estación. Verifica o avisa a tu supervisor.');
      }
      return;
    }

    // paso === 'rollo'
    if (tipo === 'estacion') {
      // escaneó otra estación: la cambiamos (caso común al moverse de máquina)
      estacionActual = Datos.buscarEstacion(codigo);
      sonidoAviso();
      vibrar(80);
      actualizarUIPaso();
      toast(`Estación cambiada a ${estacionActual.codigo}`);
      return;
    }

    mostrarResultado(codigo);
  }

  /* ================== Pantalla de resultado ================== */
  function mostrarResultado(codigoRollo) {
    procesando = true;
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
      vibrar(150);
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
      vibrar([400, 150, 400, 150, 400]);
    } else {
      pant.classList.add('desconocido');
      $('resultado-icono').textContent = '?';
      $('resultado-titulo').textContent = 'CÓDIGO DESCONOCIDO';
      $('resultado-detalle').innerHTML =
        `El código <b>${codigoRollo}</b> no está registrado.<br>NO coloques el rollo. Avisa a tu supervisor.`;
      sonidoError();
      vibrar([400, 150, 400]);
    }
  }

  function cerrarResultado() {
    $('pantalla-resultado').classList.add('oculto');
    procesando = false;
    ultimoCodigo = '';
    // la estación queda fija: el siguiente escaneo es otro rollo en la misma máquina
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
    }
  }

  function intentarPin() {
    if (Datos.verificarPin($('input-pin').value)) {
      adminDesbloqueado = true;
      abrirAdmin();
    } else {
      $('error-pin').classList.remove('oculto');
      vibrar(200);
    }
  }

  function cambiarTab(idTab) {
    detenerLectorSync();
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
    $('modal-lector').classList.add('oculto');
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
  }

  function cerrarModal() {
    detenerLectorModal();
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

  /* ---- escanear para llenar el campo código del modal ---- */
  function escanearEnModal() {
    if (lectorModal) { detenerLectorModal(); return; }
    $('modal-lector').classList.remove('oculto');
    lectorModal = new Html5Qrcode('modal-lector', OPCIONES_HTML5QR);
    lectorModal.start({ facingMode: 'environment' }, CONFIG_LECTOR, texto => {
      $('modal-codigo').value = Datos.normalizar(texto);
      vibrar(80);
      detenerLectorModal();
    }, () => {}).catch(() => {
      detenerLectorModal();
      toast('No se pudo abrir la cámara');
    });
  }

  function detenerLectorModal() {
    if (!lectorModal) return;
    const l = lectorModal;
    lectorModal = null;
    l.stop().then(() => l.clear()).catch(() => {});
    $('modal-lector').classList.add('oculto');
  }

  /* ================== Sincronización ================== */
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
      avisoGrande.textContent = 'La configuración es demasiado grande para un solo QR. Usa "Exportar CSV" y pasa el archivo.';
      avisoGrande.classList.remove('oculto');
    }
  }

  function recibirQRSync() {
    if (lectorSync) { detenerLectorSync(); return; }
    $('lector-sync').classList.remove('oculto');
    lectorSync = new Html5Qrcode('lector-sync', OPCIONES_HTML5QR);
    // el QR de configuración es denso: zona cuadrada grande + alta resolución
    lectorSync.start({ facingMode: 'environment' }, {
      fps: 15,
      qrbox: (w, h) => { const lado = Math.floor(Math.min(w, h) * 0.8); return { width: lado, height: lado }; },
      videoConstraints: CONFIG_LECTOR.videoConstraints
    }, texto => {
      const res = Datos.importarDeQR(texto);
      if (res.ok) {
        detenerLectorSync();
        renderAdmin();
        sonidoOk();
        vibrar(150);
        toast(`✓ Configuración recibida (versión ${res.version})`);
      } else {
        toast('⚠️ ' + res.error);
      }
    }, () => {}).catch(() => {
      detenerLectorSync();
      toast('No se pudo abrir la cámara');
    });
  }

  function detenerLectorSync() {
    if (!lectorSync) return;
    const l = lectorSync;
    lectorSync = null;
    l.stop().then(() => l.clear()).catch(() => {});
    const el = $('lector-sync');
    if (el) el.classList.add('oculto');
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
    // pantalla principal
    $('btn-iniciar-camara').addEventListener('click', iniciarLectorPrincipal);
    $('btn-otro').addEventListener('click', cerrarResultado);
    $('btn-soltar-estacion').addEventListener('click', () => {
      estacionActual = null;
      paso = 'estacion';
      actualizarUIPaso();
    });
    $('btn-manual').addEventListener('click', () => {
      const v = $('input-manual').value;
      if (v.trim()) { $('input-manual').value = ''; procesarCodigo(v); }
    });
    $('input-manual').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-manual').click(); });

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
    $('modal-btn-escanear').addEventListener('click', escanearEnModal);

    // sync
    $('btn-generar-qr').addEventListener('click', generarQRSync);
    $('btn-recibir-qr').addEventListener('click', recibirQRSync);
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
      if (confirm('⚠️ Se borrarán TODOS los materiales, estaciones e historial de este dispositivo. ¿Continuar?')) {
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
