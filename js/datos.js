/* ====== Capa de datos: localStorage, validación, sync ====== */
/* global LZString */

const Datos = (() => {
  const CLAVE_CONFIG = 'pokayoke_config_v1';
  const CLAVE_HISTORIAL = 'pokayoke_historial_v1';
  const CLAVE_PIN = 'pokayoke_pin_v1';
  const PIN_DEFAULT = '1234';
  const MAX_HISTORIAL = 5000;
  const PREFIJO_SYNC = 'PKYK1:'; // marca los QR de sincronización de esta app

  function configVacia() {
    return { version: 1, actualizado: new Date().toISOString().slice(0, 10), materiales: [], estaciones: [], grupos: [] };
  }

  function cargarConfig() {
    try {
      const crudo = localStorage.getItem(CLAVE_CONFIG);
      if (!crudo) return configVacia();
      const cfg = JSON.parse(crudo);
      if (!Array.isArray(cfg.materiales) || !Array.isArray(cfg.estaciones)) return configVacia();
      if (!Array.isArray(cfg.grupos)) cfg.grupos = []; // configs viejas sin grupos
      return cfg;
    } catch (e) {
      return configVacia();
    }
  }

  let config = cargarConfig();

  function guardar() {
    config.version = (config.version || 0) + 1;
    config.actualizado = new Date().toISOString().slice(0, 10);
    localStorage.setItem(CLAVE_CONFIG, JSON.stringify(config));
  }

  function normalizar(codigo) {
    return String(codigo || '').trim().toUpperCase();
  }

  /* ---- Estaciones ---- */
  function buscarEstacion(codigo) {
    const c = normalizar(codigo);
    return config.estaciones.find(e => normalizar(e.codigo) === c) || null;
  }

  function guardarEstacion(codigoOriginal, datos) {
    const codigo = normalizar(datos.codigo);
    if (!codigo) return { ok: false, error: 'El código no puede estar vacío' };
    const existente = buscarEstacion(codigo);
    if (existente && normalizar(codigoOriginal) !== codigo) {
      return { ok: false, error: 'Ya existe una estación con ese código' };
    }
    if (codigoOriginal) {
      const est = buscarEstacion(codigoOriginal);
      if (est) {
        // actualizar referencias en materiales y grupos si cambió el código
        if (normalizar(codigoOriginal) !== codigo) {
          config.materiales.forEach(m => {
            m.estaciones = m.estaciones.map(c => normalizar(c) === normalizar(codigoOriginal) ? codigo : c);
          });
          config.grupos.forEach(g => {
            g.estaciones = (g.estaciones || []).map(c => normalizar(c) === normalizar(codigoOriginal) ? codigo : c);
          });
        }
        est.codigo = codigo;
        est.nombre = datos.nombre || '';
        guardar();
        return { ok: true };
      }
    }
    config.estaciones.push({ codigo, nombre: datos.nombre || '' });
    guardar();
    return { ok: true };
  }

  function eliminarEstacion(codigo) {
    const c = normalizar(codigo);
    config.estaciones = config.estaciones.filter(e => normalizar(e.codigo) !== c);
    config.materiales.forEach(m => { m.estaciones = m.estaciones.filter(x => normalizar(x) !== c); });
    config.grupos.forEach(g => { g.estaciones = (g.estaciones || []).filter(x => normalizar(x) !== c); });
    guardar();
  }

  /* ---- Grupos (familias de materiales: todos heredan las líneas del grupo) ---- */
  function buscarGrupo(nombre) {
    const n = normalizar(nombre);
    return config.grupos.find(g => normalizar(g.nombre) === n) || null;
  }

  function guardarGrupo(nombreOriginal, datos) {
    const nombre = String(datos.nombre || '').trim();
    if (!nombre) return { ok: false, error: 'El nombre del grupo no puede estar vacío' };
    const existente = buscarGrupo(nombre);
    if (existente && normalizar(nombreOriginal) !== normalizar(nombre)) {
      return { ok: false, error: 'Ya existe un grupo con ese nombre' };
    }
    const estaciones = (datos.estaciones || []).map(normalizar);
    if (nombreOriginal) {
      const g = buscarGrupo(nombreOriginal);
      if (g) {
        // actualizar referencia en materiales si cambió el nombre
        if (normalizar(nombreOriginal) !== normalizar(nombre)) {
          config.materiales.forEach(m => {
            if (normalizar(m.grupo) === normalizar(nombreOriginal)) m.grupo = nombre;
          });
        }
        g.nombre = nombre;
        g.estaciones = estaciones;
        guardar();
        return { ok: true };
      }
    }
    config.grupos.push({ nombre, estaciones });
    guardar();
    return { ok: true };
  }

  function eliminarGrupo(nombre) {
    const n = normalizar(nombre);
    config.grupos = config.grupos.filter(g => normalizar(g.nombre) !== n);
    config.materiales.forEach(m => { if (normalizar(m.grupo) === n) delete m.grupo; });
    guardar();
  }

  // Líneas efectivas de un material: las suyas + las de su grupo
  function estacionesDeMaterial(material) {
    const propias = (material.estaciones || []).map(normalizar);
    const g = material.grupo ? buscarGrupo(material.grupo) : null;
    const delGrupo = g ? (g.estaciones || []).map(normalizar) : [];
    return Array.from(new Set([...propias, ...delGrupo]));
  }

  /* ---- Materiales ---- */
  function buscarMaterialPorCodigoExacto(codigo) {
    const c = normalizar(codigo);
    return config.materiales.find(m => normalizar(m.codigo) === c) || null;
  }

  // Encuentra el material que corresponde a un código de rollo escaneado
  // (exacto primero; si no, el prefijo MÁS LARGO que coincida)
  function buscarMaterialParaRollo(codigoRollo) {
    const c = normalizar(codigoRollo);
    const exacto = config.materiales.find(m => m.tipoCoincidencia !== 'prefijo' && normalizar(m.codigo) === c);
    if (exacto) return exacto;
    const porPrefijo = config.materiales
      .filter(m => m.tipoCoincidencia === 'prefijo' && c.startsWith(normalizar(m.codigo)))
      .sort((a, b) => b.codigo.length - a.codigo.length);
    return porPrefijo[0] || null;
  }

  function guardarMaterial(codigoOriginal, datos) {
    const codigo = normalizar(datos.codigo);
    if (!codigo) return { ok: false, error: 'El código no puede estar vacío' };
    const existente = buscarMaterialPorCodigoExacto(codigo);
    if (existente && normalizar(codigoOriginal) !== codigo) {
      return { ok: false, error: 'Ya existe un material con ese código' };
    }
    const nuevo = {
      codigo,
      tipoCoincidencia: datos.tipoCoincidencia === 'prefijo' ? 'prefijo' : 'exacto',
      descripcion: datos.descripcion || '',
      estaciones: (datos.estaciones || []).map(normalizar)
    };
    if (datos.grupo && buscarGrupo(datos.grupo)) nuevo.grupo = buscarGrupo(datos.grupo).nombre;
    if (codigoOriginal) {
      const idx = config.materiales.findIndex(m => normalizar(m.codigo) === normalizar(codigoOriginal));
      if (idx >= 0) { config.materiales[idx] = nuevo; guardar(); return { ok: true }; }
    }
    config.materiales.push(nuevo);
    guardar();
    return { ok: true };
  }

  function eliminarMaterial(codigo) {
    const c = normalizar(codigo);
    config.materiales = config.materiales.filter(m => normalizar(m.codigo) !== c);
    guardar();
  }

  /* ---- Validación principal (el corazón del poka-yoke) ---- */
  // Devuelve: { resultado: 'ok'|'error'|'rollo_desconocido', material, estacionesPermitidas }
  function validar(codigoRollo, codigoEstacion) {
    const material = buscarMaterialParaRollo(codigoRollo);
    if (!material) return { resultado: 'rollo_desconocido', material: null, estacionesPermitidas: [] };
    const permitidas = estacionesDeMaterial(material); // incluye las líneas heredadas del grupo
    const ok = permitidas.includes(normalizar(codigoEstacion));
    return { resultado: ok ? 'ok' : 'error', material, estacionesPermitidas: permitidas };
  }

  // Clasifica un código escaneado: ¿es estación, rollo conocido, o desconocido?
  function clasificarCodigo(codigo) {
    if (buscarEstacion(codigo)) return 'estacion';
    if (buscarMaterialParaRollo(codigo)) return 'rollo';
    return 'desconocido';
  }

  /* ---- Historial ---- */
  function cargarHistorial() {
    try { return JSON.parse(localStorage.getItem(CLAVE_HISTORIAL)) || []; }
    catch (e) { return []; }
  }

  function registrarEscaneo(rollo, estacion, resultado) {
    const hist = cargarHistorial();
    hist.unshift({ fecha: new Date().toISOString(), rollo: normalizar(rollo), estacion: normalizar(estacion), resultado });
    localStorage.setItem(CLAVE_HISTORIAL, JSON.stringify(hist.slice(0, MAX_HISTORIAL)));
  }

  function borrarHistorial() { localStorage.removeItem(CLAVE_HISTORIAL); }

  /* ---- PIN ---- */
  function verificarPin(pin) { return String(pin) === (localStorage.getItem(CLAVE_PIN) || PIN_DEFAULT); }
  function cambiarPin(nuevo) {
    const p = String(nuevo || '').trim();
    if (!/^\d{4,8}$/.test(p)) return { ok: false, error: 'El PIN debe tener de 4 a 8 dígitos' };
    localStorage.setItem(CLAVE_PIN, p);
    return { ok: true };
  }

  /* ---- Sincronización por QR ---- */
  function exportarParaQR() {
    const json = JSON.stringify(config);
    return PREFIJO_SYNC + LZString.compressToEncodedURIComponent(json);
  }

  function esQRDeSync(texto) { return typeof texto === 'string' && texto.startsWith(PREFIJO_SYNC); }

  function importarDeQR(texto) {
    if (!esQRDeSync(texto)) return { ok: false, error: 'Ese QR no es una configuración de esta app' };
    try {
      const json = LZString.decompressFromEncodedURIComponent(texto.slice(PREFIJO_SYNC.length));
      const cfg = JSON.parse(json);
      if (!Array.isArray(cfg.materiales) || !Array.isArray(cfg.estaciones)) throw new Error('estructura inválida');
      if (!Array.isArray(cfg.grupos)) cfg.grupos = []; // configs de versiones anteriores
      const versionAnterior = config.version || 0;
      config = cfg;
      localStorage.setItem(CLAVE_CONFIG, JSON.stringify(config));
      return { ok: true, version: cfg.version, versionAnterior };
    } catch (e) {
      return { ok: false, error: 'No se pudo leer la configuración (QR dañado o incompleto)' };
    }
  }

  /* ---- CSV ---- */
  // Formato: TIPO,CODIGO,COINCIDENCIA,DESCRIPCION,ESTACIONES (separadas por |),GRUPO
  function exportarCSV() {
    const lineas = ['TIPO,CODIGO,COINCIDENCIA,DESCRIPCION,ESTACIONES,GRUPO'];
    const esc = v => '"' + String(v || '').replace(/"/g, '""') + '"';
    config.estaciones.forEach(e => lineas.push(['ESTACION', esc(e.codigo), '', esc(e.nombre), '', ''].join(',')));
    config.grupos.forEach(g => lineas.push(['GRUPO', esc(g.nombre), '', '', esc((g.estaciones || []).join('|')), ''].join(',')));
    config.materiales.forEach(m =>
      lineas.push(['MATERIAL', esc(m.codigo), m.tipoCoincidencia || 'exacto', esc(m.descripcion), esc(m.estaciones.join('|')), esc(m.grupo || '')].join(','))
    );
    return lineas.join('\r\n');
  }

  function parsearLineaCSV(linea) {
    const campos = [];
    let actual = '', enComillas = false;
    for (let i = 0; i < linea.length; i++) {
      const ch = linea[i];
      if (enComillas) {
        if (ch === '"' && linea[i + 1] === '"') { actual += '"'; i++; }
        else if (ch === '"') enComillas = false;
        else actual += ch;
      } else if (ch === '"') enComillas = true;
      else if (ch === ',') { campos.push(actual); actual = ''; }
      else actual += ch;
    }
    campos.push(actual);
    return campos;
  }

  function importarCSV(texto) {
    const lineas = String(texto).split(/\r?\n/).filter(l => l.trim());
    if (!lineas.length) return { ok: false, error: 'Archivo vacío' };
    const nuevaCfg = configVacia();
    let errores = 0;
    lineas.forEach((linea, i) => {
      if (i === 0 && /^TIPO/i.test(linea)) return; // encabezado
      const [tipo, codigo, coincidencia, descripcion, estaciones, grupo] = parsearLineaCSV(linea);
      const t = normalizar(tipo);
      if (t === 'ESTACION' || t === 'ESTACIÓN' || t === 'LINEA' || t === 'LÍNEA') {
        if (normalizar(codigo)) nuevaCfg.estaciones.push({ codigo: normalizar(codigo), nombre: (descripcion || '').trim() });
        else errores++;
      } else if (t === 'GRUPO') {
        if (String(codigo || '').trim()) nuevaCfg.grupos.push({
          nombre: String(codigo).trim(),
          estaciones: String(estaciones || '').split('|').map(normalizar).filter(Boolean)
        });
        else errores++;
      } else if (t === 'MATERIAL') {
        if (normalizar(codigo)) {
          const m = {
            codigo: normalizar(codigo),
            tipoCoincidencia: normalizar(coincidencia) === 'PREFIJO' ? 'prefijo' : 'exacto',
            descripcion: (descripcion || '').trim(),
            estaciones: String(estaciones || '').split('|').map(normalizar).filter(Boolean)
          };
          if (String(grupo || '').trim()) m.grupo = String(grupo).trim();
          nuevaCfg.materiales.push(m);
        } else errores++;
      } else errores++;
    });
    if (!nuevaCfg.materiales.length && !nuevaCfg.estaciones.length && !nuevaCfg.grupos.length) {
      return { ok: false, error: 'No se encontraron datos válidos en el archivo' };
    }
    nuevaCfg.version = (config.version || 0) + 1;
    config = nuevaCfg;
    localStorage.setItem(CLAVE_CONFIG, JSON.stringify(config));
    return { ok: true, materiales: nuevaCfg.materiales.length, estaciones: nuevaCfg.estaciones.length, errores };
  }

  function borrarTodo() {
    localStorage.removeItem(CLAVE_CONFIG);
    localStorage.removeItem(CLAVE_HISTORIAL);
    config = configVacia();
  }

  return {
    get config() { return config; },
    normalizar,
    buscarEstacion, guardarEstacion, eliminarEstacion,
    buscarGrupo, guardarGrupo, eliminarGrupo, estacionesDeMaterial,
    buscarMaterialPorCodigoExacto, buscarMaterialParaRollo, guardarMaterial, eliminarMaterial,
    validar, clasificarCodigo,
    cargarHistorial, registrarEscaneo, borrarHistorial,
    verificarPin, cambiarPin,
    exportarParaQR, esQRDeSync, importarDeQR,
    exportarCSV, importarCSV,
    borrarTodo
  };
})();
