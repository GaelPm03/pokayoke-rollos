# Poka-Yoke Rollos 📷✅

App web (PWA) para que los operadores validen con la cámara del celular que un **rollo** va en la **estación** correcta. Verde = correcto, Rojo = no colocar.

## Cómo funciona

1. El operador abre la app y escanea el código de la **estación** (la app rechaza el código si no es una estación).
2. Escanea el código del **rollo**.
3. Resultado a pantalla completa con color + sonido + vibración:
   - ✅ **Verde** — el rollo sí va en esa estación.
   - ❌ **Rojo** — NO colocar; la app le dice en qué estación sí va.
   - ⚠️ **Amarillo** — código no registrado; avisar al supervisor.
4. La estación queda fijada para validar muchos rollos seguidos ("Cambiar estación" para moverse de máquina).
5. Si la cámara falla, hay entrada manual del código.

## Administración (⚙️, PIN inicial: `1234`)

- **Materiales**: código del rollo (exacto o por *prefijo*: "todo rollo que empiece con MAT-12 es este material"), descripción y estaciones autorizadas (puede ser más de una).
- **Estaciones**: código y nombre de cada máquina.
- **Sincronizar**: genera un **QR con toda la configuración**; los demás celulares lo escanean (Admin → Sincronizar → Recibir) y quedan actualizados **sin necesidad de red**. También exporta/importa CSV como respaldo.
- **Ajustes**: cambiar PIN, borrar datos.

⚠️ Cambia el PIN `1234` en el primer uso.

## Cómo publicarla (una sola vez)

La cámara solo funciona con HTTPS, así que hay que subir la carpeta a un hosting gratuito:

1. Crear un repositorio en GitHub y subir todos los archivos de esta carpeta.
2. En el repositorio: Settings → Pages → Source: rama `main`, carpeta `/ (root)` → Save.
3. GitHub te da una URL tipo `https://tuusuario.github.io/pokayoke-rollos/`.
4. Cada operador abre esa URL **una vez** con internet (datos móviles sirven), y en el menú del navegador elige **"Agregar a pantalla de inicio"**.
5. A partir de ahí la app funciona **100 % sin internet** — la red de la planta no se usa nunca.

Cuando actualices la app y subas cambios a GitHub, los celulares se actualizan solos la próxima vez que tengan internet.

## Probar en la computadora

```
python -m http.server 8741
```
y abrir http://localhost:8741

## Estructura

```
index.html         pantallas (escaneo, admin, historial)
css/styles.css     estilos
js/app.js          flujo de escaneo y UI
js/datos.js        datos, validación, CSV, QR de sincronización
js/lib/            librerías locales (html5-qrcode, qrcode-generator, lz-string)
sw.js              service worker (modo offline)
manifest.json      instalación como app
iconos/            iconos PNG
```
