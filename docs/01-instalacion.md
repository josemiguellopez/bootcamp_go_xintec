# 1. Instalación

## Requisitos

| Herramienta | Para qué | ¿Obligatoria? |
|---|---|---|
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) (o Docker Engine + Compose v2 en Linux) | Levantar PostgreSQL, RabbitMQ, la API y el worker | **Sí** |
| [Git](https://git-scm.com/downloads) | Clonar el repositorio. En Windows incluye **Git Bash**, necesario para `scripts/demo.sh` | **Sí** |
| [Go 1.25+](https://go.dev/dl/) | Correr las pruebas, o la API sin Docker | Para pruebas |
| curl | Probar la API (viene con Windows 10+, macOS y Linux) | Recomendada |

Puertos que se usan: **3200** (API), **3201** (worker), **5432** (PostgreSQL), **5672** y **15672** (RabbitMQ y su
consola web).

### Windows

1. Instala Docker Desktop. Usa WSL 2 y puede pedir reiniciar; en equipos de empresa puede requerir permisos de
   administrador.
2. Instala Git for Windows con las opciones por defecto.
3. Instala Go con el `.msi`. **Sin permisos de administrador:** descarga el `.zip`, descomprímelo (por ejemplo en
   `C:\Users\<usuario>\tools\go`) y agrega `...\tools\go\bin` al `PATH` de tu usuario.

### macOS

```bash
brew install --cask docker   # luego abre Docker Desktop una vez
brew install go git
```

### Linux

Instala Docker Engine con el plugin compose ([guía oficial](https://docs.docker.com/engine/install/)) y Go desde
<https://go.dev/dl/>.

### Verificar

```bash
docker compose version   # v2.x
go version               # go1.25 o superior
```

## Levantar el sistema

```bash
git clone <url-del-repositorio> eventflow
cd eventflow
docker compose up -d --build
```

La primera vez tarda unos minutos porque descarga imágenes y compila. Después:

```bash
docker compose ps                 # postgres y rabbitmq "healthy"; api y worker "running"
curl -s localhost:3200/ready      # {"database":"up","status":"up"}
curl -s localhost:3201/ready      # el worker
```

La API crea las tablas sola al arrancar (migraciones). No hay que ejecutar SQL a mano.

Para detener:

```bash
docker compose down        # conserva los datos
docker compose down -v     # borra también la base de datos
```

## Ejecutar sin Docker (opcional, para depurar)

Solo PostgreSQL y RabbitMQ corren en Docker:

```bash
cp .env.example .env.dev                  # PowerShell: Copy-Item .env.example .env.dev
docker compose up -d postgres rabbitmq
go run ./cmd/api                          # terminal 1
go run ./cmd/worker                       # terminal 2
```

Si `api` y `worker` también están corriendo en Docker, primero detenlos (`docker compose stop api worker`) para
liberar los puertos.

## Problemas frecuentes

| Síntoma | Solución |
|---|---|
| `port is already allocated` en el 5432 | Ya tienes un PostgreSQL instalado: detenlo, o cambia en `docker-compose.yml` el mapeo a `"5433:5432"` |
| `error during connect ... docker` | Abre Docker Desktop y espera a que diga "Engine running" |
| `go: command not found` | Abre una terminal nueva o revisa el `PATH` |
| `bash: $'\r': command not found` al correr `demo.sh` | El archivo tiene saltos de línea de Windows. El repo trae `.gitattributes` para evitarlo; si clonaste antes, ejecuta `git config core.autocrlf input` y vuelve a clonar |
| `api` o `worker` se reinician | Mira el motivo con `docker compose logs api worker`. Si dice que no conecta a postgres o rabbitmq, espera unos segundos: Docker los reintenta solo |
