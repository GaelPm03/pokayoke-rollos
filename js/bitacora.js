/* ====== Bitácora en archivo: escribe cada escaneo en un CSV real del disco ======
   Usa la File System Access API (Chrome/Edge). El permiso sobre la carpeta se pide
   una vez y el "handle" se guarda en IndexedDB para reutilizarlo entre sesiones. */

const Bitacora = (() => {
  const DB_NOMBRE = 'pokayoke_fs';
  const STORE = 'handles';
  const CLAVE_NOMBRE_PC = 'pokayoke_nombre_pc';

  const soportado = typeof window.showDirectoryPicker === 'function';
  let carpeta = null; // FileSystemDirectoryHandle

  /* ---- IndexedDB (los handles de archivos no caben en localStorage) ---- */
  function abrirDB() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NOMBRE, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }

  function enStore(modo, accion) {
    return abrirDB().then(db => new Promise((res, rej) => {
      const tx = db.transaction(STORE, modo);
      const pet = accion(tx.objectStore(STORE));
      pet.onsuccess = () => res(pet.result);
      pet.onerror = () => rej(pet.error);
    }));
  }

  const guardarHandle = h => enStore('readwrite', s => s.put(h, 'carpeta'));
  const cargarHandle = () => enStore('readonly', s => s.get('carpeta'));
  const borrarHandle = () => enStore('readwrite', s => s.delete('carpeta'));

  /* ---- Estado ---- */
  // Devuelve: 'no_soportado' | 'sin_carpeta' | 'granted' | 'prompt' | 'denied'
  async function estado() {
    if (!soportado) return 'no_soportado';
    if (!carpeta) {
      try { carpeta = await cargarHandle(); } catch (e) { carpeta = null; }
    }
    if (!carpeta) return 'sin_carpeta';
    try { return await carpeta.queryPermission({ mode: 'readwrite' }); }
    catch (e) { return 'sin_carpeta'; }
  }

  function nombreCarpeta() { return carpeta ? carpeta.name : ''; }

  /* ---- Configuración ---- */
  async function elegirCarpeta() {
    carpeta = await window.showDirectoryPicker({ mode: 'readwrite' });
    await guardarHandle(carpeta);
    return carpeta.name;
  }

  // Reactivar permiso (requiere clic del usuario)
  async function reactivar() {
    if (!carpeta) return false;
    try { return (await carpeta.requestPermission({ mode: 'readwrite' })) === 'granted'; }
    catch (e) { return false; }
  }

  async function quitarCarpeta() {
    carpeta = null;
    await borrarHandle();
  }

  function nombrePC() { return localStorage.getItem(CLAVE_NOMBRE_PC) || ''; }
  function cambiarNombrePC(n) {
    const limpio = String(n || '').trim().replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 30);
    if (limpio) localStorage.setItem(CLAVE_NOMBRE_PC, limpio);
    else localStorage.removeItem(CLAVE_NOMBRE_PC);
    return limpio;
  }

  /* ---- Escritura: agrega el registro al CSV del mes ---- */
  // Las escrituras se encolan una tras otra: dos escaneos seguidos no deben
  // leer el tamaño del archivo al mismo tiempo (se sobreescribirían).
  let cola = Promise.resolve();
  function escribir(registro) {
    const p = cola.then(() => escribirInterno(registro));
    cola = p.catch(() => {});
    return p;
  }

  async function escribirInterno(registro) {
    const est = await estado();
    if (est === 'no_soportado' || est === 'sin_carpeta') return { ok: false, motivo: est };
    if (est !== 'granted') return { ok: false, motivo: 'permiso' };
    try {
      const f = new Date(registro.fecha);
      const sufijo = nombrePC() ? `-${nombrePC()}` : '';
      const nombre = `bitacora${sufijo}-${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}.csv`;
      const fh = await carpeta.getFileHandle(nombre, { create: true });
      const archivo = await fh.getFile();
      const w = await fh.createWritable({ keepExistingData: true });
      let datos = '';
      if (archivo.size === 0) datos = '﻿FECHA,ROLLO,LINEA,RESULTADO\r\n'; // BOM para Excel
      const esc = v => '"' + String(v || '').replace(/"/g, '""') + '"';
      datos += [registro.fecha, esc(registro.rollo), esc(registro.estacion), registro.resultado].join(',') + '\r\n';
      await w.write({ type: 'write', position: archivo.size, data: datos });
      await w.close();
      return { ok: true, archivo: nombre };
    } catch (e) {
      // típico: el archivo está abierto/bloqueado por Excel
      return { ok: false, motivo: 'error', detalle: String(e && e.name || e) };
    }
  }

  return { soportado, estado, nombreCarpeta, elegirCarpeta, reactivar, quitarCarpeta, nombrePC, cambiarNombrePC, escribir };
})();
