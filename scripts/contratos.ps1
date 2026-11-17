# Prueba cada contrato de la API (docs/07-contratos.md) y marca OK o FALLA.
# Requiere el sistema levantado: docker compose up -d --build
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\contratos.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\contratos.ps1 -Api http://otra:3200 -Worker http://otra:3201
#
# Termina con código 1 si algún contrato no se cumple. Funciona con Windows PowerShell 5.1 y PowerShell 7.
param(
  [string]$Api = "http://localhost:3200",
  [string]$Worker = "http://localhost:3201"
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$script:ok = 0
$script:fail = 0
$script:last = $null
$key = "contrato-" + [guid]::NewGuid().ToString().Substring(0, 8)

# Hace la petición y devuelve @{ Status; Body; Headers }, también para respuestas 4xx/5xx.
function Send($method, $url, $body = $null, $headers = @{}) {
  $params = @{ Method = $method; Uri = $url; Headers = $headers; UseBasicParsing = $true; TimeoutSec = 10 }
  if ($null -ne $body) {
    $params.ContentType = "application/json"
    $params.Body = [System.Text.Encoding]::UTF8.GetBytes($body)
  }
  try {
    $r = Invoke-WebRequest @params
    return @{ Status = [int]$r.StatusCode; Body = $r.Content; Headers = $r.Headers }
  } catch {
    $resp = $_.Exception.Response
    if ($null -eq $resp) { return @{ Status = 0; Body = $_.Exception.Message; Headers = @{} } }
    $text = ""
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      $text = $_.ErrorDetails.Message # PowerShell 7
    } else {
      $reader = New-Object System.IO.StreamReader($resp.GetResponseStream()) # PowerShell 5.1
      $text = $reader.ReadToEnd()
    }
    return @{ Status = [int]$resp.StatusCode; Body = $text; Headers = @{} }
  }
}

function Check($name, $want, $text, $method, $url, $body = $null, $headers = @{}) {
  $r = Send $method $url $body $headers
  $script:last = $r
  if ($r.Status -eq $want -and $r.Body.Contains($text)) {
    Write-Host ("  OK     {0,-62} {1}" -f $name, $r.Status) -ForegroundColor Green
    $script:ok++
  } else {
    Write-Host ("  FALLA  {0,-62} esperaba {1} con '{2}', llegó {3}" -f $name, $want, $text, $r.Status) -ForegroundColor Red
    $snippet = if ($r.Body.Length -gt 300) { $r.Body.Substring(0, 300) } else { $r.Body }
    Write-Host "         $snippet"
    $script:fail++
  }
}

$order = '{"customer_id":"12.345.678-5","items":[{"sku":"GO-TAZA","quantity":2,"unit_price":8990},{"sku":"GO-STICKERS","quantity":1,"unit_price":2990}]}'

Write-Host "== POST /orders: crear"
Check "201 pedido válido (RUT con puntos, 2 productos)" 201 '"status":"en_preparacion"' Post "$Api/orders" $order @{ "Idempotency-Key" = $key }
$id = ($script:last.Body | ConvertFrom-Json).id
Check "    total = 2x8990 + 2990 = 20970 CLP, RUT guardado sin puntos" 201 '"total":20970,"currency":"CLP"' Post "$Api/orders" $order
Check "200 misma Idempotency-Key devuelve el mismo pedido" 200 "`"id`":`"$id`"" Post "$Api/orders" $order @{ "Idempotency-Key" = $key }

Write-Host "== POST /orders: datos inválidos (no se crea nada)"
Check "400 RUT con dígito verificador incorrecto" 400 ORDER_INVALID_CUSTOMER Post "$Api/orders" '{"customer_id":"12345678-9","items":[{"sku":"A","quantity":1,"unit_price":100}]}'
Check "400 lista de productos vacía" 400 ORDER_EMPTY_ITEMS Post "$Api/orders" '{"customer_id":"12345678-5","items":[]}'
Check "400 cantidad 0" 400 ORDER_INVALID_QUANTITY Post "$Api/orders" '{"customer_id":"12345678-5","items":[{"sku":"A","quantity":0,"unit_price":100}]}'
Check "400 precio negativo" 400 ORDER_INVALID_PRICE Post "$Api/orders" '{"customer_id":"12345678-5","items":[{"sku":"A","quantity":1,"unit_price":-5}]}'
Check "400 sku vacío" 400 ORDER_INVALID_SKU Post "$Api/orders" '{"customer_id":"12345678-5","items":[{"sku":"","quantity":1,"unit_price":100}]}'
Check "400 JSON mal formado" 400 INVALID_JSON Post "$Api/orders" '{"customer_id": '
Check "400 campo desconocido" 400 INVALID_JSON Post "$Api/orders" '{"customer_id":"12345678-5","items":[{"sku":"A","quantity":1,"unit_price":1}],"descuento":10}'
Check "400 Idempotency-Key de 129 caracteres" 400 IDEMPOTENCY_KEY_INVALID Post "$Api/orders" $order @{ "Idempotency-Key" = ("k" * 129) }
Check "413 cuerpo de 70 KB (límite 64 KB)" 413 PAYLOAD_TOO_LARGE Post "$Api/orders" ('{"customer_id":"' + ("x" * 70000) + '","items":[]}')

Write-Host "== GET /orders/{id}"
for ($i = 0; $i -lt 20; $i++) {
  # el worker lo deja listo en menos de un segundo
  if ((Send Get "$Api/orders/$id").Body -like "*listo_para_despacho*") { break }
  Start-Sleep -Milliseconds 500
}
Check "200 el worker lo dejó listo_para_despacho" 200 '"status":"listo_para_despacho"' Get "$Api/orders/$id"
Check "404 UUID que no existe" 404 ORDER_NOT_FOUND Get "$Api/orders/00000000-0000-4000-8000-000000000000"
Check "400 id que no es UUID" 400 ORDER_INVALID_ID Get "$Api/orders/abc"

Write-Host "== PATCH /orders/{id}/status: el recorrido completo"
function Patch($name, $want, $text, $status) { Check $name $want $text Patch "$Api/orders/$id/status" "{`"status`":`"$status`"}" }
Patch "409 salto no permitido: listo_para_despacho -> entregado" 409 ORDER_INVALID_TRANSITION entregado
Patch "200 listo_para_despacho -> en_transito" 200 '"status":"en_transito"' en_transito
Patch "200 en_transito -> no_entregado" 200 '"status":"no_entregado"' no_entregado
Patch "200 no_entregado -> en_transito (reintento de entrega)" 200 '"status":"en_transito"' en_transito
Patch "200 en_transito -> entregado" 200 '"status":"entregado"' entregado
Patch "200 entregado -> devuelto" 200 '"next_statuses":[]' devuelto
Patch "409 devuelto es final: devuelto -> en_transito" 409 ORDER_INVALID_TRANSITION en_transito
Patch "400 estado que no existe" 400 ORDER_INVALID_STATUS perdido
Check "404 pedido que no existe" 404 ORDER_NOT_FOUND Patch "$Api/orders/00000000-0000-4000-8000-000000000000/status" '{"status":"en_transito"}'

Write-Host "== Operación"
Check "200 GET /health (API viva)" 200 '"status":"up"' Get "$Api/health"
Check "200 GET /ready (base de datos disponible)" 200 '"database":"up"' Get "$Api/ready"
Check "200 GET /metrics (contadores)" 200 orders_created_total Get "$Api/metrics"
Check "200 worker GET /health" 200 '"status":"up"' Get "$Worker/health"
Check "200 worker GET /ready" 200 '"database":"up"' Get "$Worker/ready"
Check "200 worker GET /metrics" 200 messages_processed_total Get "$Worker/metrics"
Check "404 ruta que no existe" 404 ROUTE_NOT_FOUND Get "$Api/esta-ruta-no-existe"
$rid = "contrato-" + (Get-Random -Maximum 99999)
$echo = (Send Get "$Api/health" $null @{ "X-Request-ID" = $rid }).Headers["X-Request-Id"]
if ($echo -eq $rid) {
  Write-Host ("  OK     {0,-62} {1}" -f "X-Request-ID propio vuelve en la respuesta", $echo) -ForegroundColor Green
  $script:ok++
} else {
  Write-Host ("  FALLA  {0,-62} envié {1}, volvió {2}" -f "X-Request-ID propio vuelve en la respuesta", $rid, $echo) -ForegroundColor Red
  $script:fail++
}

Write-Host ""
Write-Host "Resultado: $script:ok cumplen, $script:fail no cumplen. Pedido de prueba: $id"
if ($script:fail -gt 0) { exit 1 }
