# 6. Sitio web (EventFlow en vivo)

El sitio de la carpeta [`site/`](../site/) sirve para probar el sistema desde el navegador, sin saber programar:

- **Hacer un pedido** en tres pasos (RUT, productos, enviar). Una impresora térmica imprime la boleta, con sonido.
- **Buscar un pedido** por su número y cambiar su estado.
- **Resultado del desafío**: una prueba por cada requisito del PDF (RF-01 a RF-14).
- **Cómo funciona**: las seis piezas del sistema.

El sitio funciona de dos maneras:

| Modo | Cuándo | Qué pasa |
|---|---|---|
| **Conectado** (punto verde arriba a la derecha) | La API responde en `localhost:3200` | Los pedidos van a la API real en Go y quedan guardados en PostgreSQL |
| **Modo de prueba** (punto amarillo) | La API no responde | Todo se simula en el navegador. Sirve para mirar el sitio, pero no guarda nada |

Para probar el sistema de verdad hay que levantar primero el backend con Docker (pasos 1 y 2) y después el sitio
(paso 3).

## Requisitos

| Herramienta | Para qué | Cómo verificar |
|---|---|---|
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | PostgreSQL, RabbitMQ, la API y el worker | `docker compose version` |
| [Node.js 18 o superior](https://nodejs.org/) (incluye `npm`) | Levantar el sitio con Vite | `node --version` |
| Git | Clonar el repositorio | `git --version` |

Puertos que se usan:

| Puerto | Servicio |
|---|---|
| **5173** | El sitio (`npm run dev`) |
| **3200** | API en Go |
| **3201** | Worker (salud y métricas) |
| **5432** | PostgreSQL |
| **5672** / **15672** | RabbitMQ y su consola web |

## Paso 1: abrir Docker Desktop

Abre Docker Desktop y espera a que diga **Engine running**. Para comprobarlo desde la terminal:

```powershell
docker info --format '{{.ServerVersion}}'   # muestra un número de versión, por ejemplo 29.8.1
```

Si responde `failed to connect to the docker API ... dockerDesktopLinuxEngine`, Docker Desktop todavía no
arranca: espera unos segundos y vuelve a probar.

## Paso 2: levantar el backend (API, worker, base de datos y RabbitMQ)

En la carpeta raíz del proyecto:

```powershell
docker compose up -d --build
docker compose ps
```

Debe verse `postgres` y `rabbitmq` como **healthy**, y `api` y `worker` como **Up**. La primera vez tarda unos
minutos porque descarga imágenes y compila el código Go.

Comprueba que responden:

```powershell
curl.exe -s localhost:3200/health   # {"status":"up"}
curl.exe -s localhost:3200/ready    # {"database":"up","status":"up"}
curl.exe -s localhost:3201/health   # el worker: {"status":"up"}
```

> En PowerShell usa `curl.exe` (con `.exe`): `curl` a secas es otro comando de PowerShell. En Git Bash, macOS o
> Linux basta con `curl`.

La API crea las tablas sola al arrancar (migraciones de [`migrations/`](../migrations/)). No hay que ejecutar SQL a
mano.

### Después de cambiar código Go

`docker compose up -d --build` vuelve a compilar la imagen, pero a veces deja corriendo los contenedores viejos.
Para asegurarte de que `api` y `worker` usan el código nuevo:

```powershell
docker compose up -d --build --force-recreate api worker
```

## Paso 3: levantar el sitio

En otra terminal:

```powershell
cd site
npm install      # solo la primera vez (o si cambia package.json)
npm run dev
```

Abre <http://localhost:5173>. Arriba a la derecha debe decir **Conectado**. Si dice **Modo de prueba**, el backend
no está respondiendo: revisa el paso 2 y pulsa el indicador para que vuelva a comprobar.

`npm run dev` queda corriendo y recarga el sitio solo cada vez que guardas un archivo de `site/`. Para detenerlo,
pulsa `Ctrl + C` en esa terminal.

### Cómo habla el sitio con la API

El navegador nunca llama directamente a `localhost:3200`. Vite hace de intermediario (proxy, ver
[`site/vite.config.js`](../site/vite.config.js)). Así todo queda en el mismo origen y la API no necesita CORS:

| El sitio pide | Vite lo envía a |
|---|---|
| `/api/...` | `http://localhost:3200/...` (API de pedidos) |
| `/worker/...` | `http://localhost:3201/...` (salud y métricas del worker) |

Si la API corre en otra dirección, indícala con variables de entorno antes de `npm run dev`:

```powershell
$env:EVENTFLOW_API = "http://otra-maquina:3200"
$env:EVENTFLOW_WORKER = "http://otra-maquina:3201"
npm run dev
```

## La base de datos local (PostgreSQL)

PostgreSQL corre dentro de Docker y guarda los datos en el volumen `pgdata`. Los datos se conservan aunque apagues
los contenedores.

| Dato | Valor |
|---|---|
| Servidor | `localhost` |
| Puerto | `5432` |
| Base de datos | `eventflow` |
| Usuario / contraseña | `postgres` / `postgres` (solo para desarrollo local) |

### Entrar con psql (sin instalar nada)

```powershell
docker compose exec postgres psql -U postgres -d eventflow
```

Dentro de `psql`: `\dt` lista las tablas, `\d orders` muestra las columnas de `orders` y `\q` sale.

| Tabla | Qué guarda |
|---|---|
| `orders` | Un pedido por fila: RUT del cliente (`customer_id`), estado, total en pesos, clave de idempotencia y fechas |
| `order_items` | Los productos de cada pedido: SKU, cantidad y precio unitario |
| `notifications` | Los correos (simulados) ya enviados, uno por evento, para no enviarlos dos veces |

Consultas útiles:

```sql
-- Los últimos 10 pedidos
SELECT id, customer_id, status, total, created_at
FROM orders ORDER BY created_at DESC LIMIT 10;

-- Cuántos pedidos hay en cada estado
SELECT status, count(*) FROM orders GROUP BY status;

-- Los productos de un pedido (pon el número completo que aparece al pie de la boleta)
SELECT sku, quantity, unit_price, quantity * unit_price AS subtotal
FROM order_items WHERE order_id = '<numero-del-pedido>' ORDER BY position;

-- Pedidos con su correo enviado
SELECT o.id, o.status, n.sent_at
FROM orders o JOIN notifications n ON n.order_id = o.id
ORDER BY n.sent_at DESC LIMIT 10;
```

Para hacer una sola consulta sin entrar a `psql`:

```powershell
docker compose exec postgres psql -U postgres -d eventflow -c "SELECT status, count(*) FROM orders GROUP BY status;"
```

### Con un programa gráfico (opcional)

Con DBeaver, pgAdmin, la extensión de PostgreSQL de VS Code o un programa parecido, crea una conexión PostgreSQL
con los datos de la tabla de arriba.

### Empezar con la base vacía

```powershell
docker compose down -v           # borra los contenedores y el volumen con los datos
docker compose up -d --build     # al arrancar, la API vuelve a crear las tablas
```

Para borrar solo los pedidos, sin tocar los contenedores:

```powershell
docker compose exec postgres psql -U postgres -d eventflow -c "TRUNCATE orders, notifications CASCADE;"
```

## RabbitMQ y los logs

- **Consola de RabbitMQ**: <http://localhost:15672> (usuario `guest`, contraseña `guest`). En la pestaña *Queues*
  están `orders.processing`, `notifications.send` y sus colas `.dlq`, donde quedan los mensajes que fallaron.
- **Logs de la API y del worker**, en vivo:

  ```powershell
  docker compose logs -f api worker
  ```

  En el sitio, abre **Detalles técnicos** (debajo del pedido) para ver cada petición con su `X-Request-ID`. Con ese
  código encuentras la misma petición en los logs:

  ```powershell
  docker compose logs api worker | Select-String "<X-Request-ID>"
  ```

## Usar el sitio

| Botón / sección | Qué hace |
|---|---|
| **Hacer un pedido** | Escribe un RUT válido (por ejemplo `12.345.678-5`), agrega productos con **+** y pulsa **Enviar pedido**. La boleta sale de la impresora y debajo se ve el recorrido del pedido por el sistema. Al terminar, el sitio pregunta si quieres crear otro pedido |
| **¿Quién arma el pedido?** | Arriba del formulario. «Lo hago yo» (lo normal) o «Que lo haga un agente»: un agente bot escribe el RUT, elige productos y envía el pedido a la vista. Pulsar «Lo hago yo» lo detiene |
| **Buscar un pedido** | Pega el número completo del pedido (o pulsa «Usar mi último pedido»). Un agente revisa el archivo de pedidos cajón por cajón hasta encontrar la ficha, que vuela a la impresora y sale la boleta (el SQL real y cómo lo hace PostgreSQL de verdad están en un desplegable para programadores). Desde la boleta se puede cambiar el estado: enviar a reparto, entregado, etc. |
| **Resultado del desafío** | **Probar todo** ejecuta las pruebas automáticas. **Copiar informe** copia el resultado en Markdown |
| **Conectado / Modo de prueba** | Indica si el sitio habla con la API real. Púlsalo para volver a comprobar |
| **Sonido / Silencio** | Activa o silencia el sonido de la impresora (impresión, corte del papel y pitido) |
| **A+** | Agranda la letra de toda la página |

El sonido de impresión y de corte es una grabación de impresora antigua
([`site/public/sounds/impresora.mp3`](../site/public/sounds/impresora.mp3), del canal *Efectos de sonido para
todos*). El navegador solo deja sonar audio después del primer clic en la página.

Al abrir el sitio se ve una intro corta (unos 2,5 s, una vez por visita; se salta con un clic o una tecla). La
primera vez que se abre cada sección en la visita, los agentes bot la construyen: cada pieza parte como un plano
punteado y aparece cuando su agente termina de dibujarla (la impresora se arma pieza por pieza). Tarda un par de
segundos. Al final de cada sección hay un minimarket animado, como un pequeño videojuego: clientes que compran,
conversan y a veces chocan en el pasillo, atendidos por los agentes bot. Con *reducir movimiento* activado en el
sistema no hay intro ni animaciones.

## Versión de producción del sitio (opcional)

```powershell
cd site
npm run build     # genera site/dist/
npm run preview   # sirve esa versión en http://localhost:4173, con el mismo proxy a la API
```

## Apagar todo

```powershell
# en la terminal del sitio: Ctrl + C
docker compose down        # detiene el backend y conserva los datos
docker compose down -v     # detiene el backend y BORRA la base de datos
```

## Problemas frecuentes

| Síntoma | Solución |
|---|---|
| `failed to connect to the docker API ... dockerDesktopLinuxEngine` | Docker Desktop no está abierto. Ábrelo y espera a que diga *Engine running* |
| El sitio dice **Modo de prueba** | La API no responde en el 3200. Revisa `docker compose ps` y `curl.exe -s localhost:3200/health`, y luego pulsa el indicador |
| Dice **Conectado · worker apagado** y el pedido se queda «en preparación» | Enciende el worker con `docker compose start worker`. El aviso esperaba en la cola y se procesa enseguida |
| Los logs muestran `postgres not reachable` o `connection refused` al arrancar | Normal en los primeros segundos: la API y el worker arrancan antes que PostgreSQL y RabbitMQ, y Docker los reinicia solos. Si se repite después de un minuto, revisa `docker compose logs postgres rabbitmq` |
| Cambié código Go y el sitio no lo refleja | Recrea los contenedores: `docker compose up -d --build --force-recreate api worker` |
| `Port 5173 is in use` | Ya hay otro `npm run dev` abierto. Ciérralo, o usa la dirección que Vite muestra en la terminal |
| `port is already allocated` en el 5432 | Tienes otro PostgreSQL instalado: detenlo, o cambia en `docker-compose.yml` el mapeo a `"5433:5432"` |
| `npm: command not found` | Instala Node.js y abre una terminal nueva |
| No se escucha la impresora | Revisa que el botón diga **Sonido** (no **Silencio**) y que el navegador o la pestaña no estén silenciados |
