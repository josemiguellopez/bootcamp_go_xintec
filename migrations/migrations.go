// Package migrations embebe los archivos SQL versionados en el binario, de
// modo que la imagen Docker no necesita copiarlos aparte.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
