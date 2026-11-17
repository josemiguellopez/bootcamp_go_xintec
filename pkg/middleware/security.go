package middleware

import "github.com/gin-gonic/gin"

// SecurityHeaders agrega cabeceras de seguridad básicas a cada respuesta.
// La API solo devuelve JSON, así que bastan estas tres.
func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff") // el navegador no "adivina" el tipo de contenido
		c.Header("X-Frame-Options", "DENY")           // no se puede mostrar dentro de un iframe
		c.Header("Referrer-Policy", "no-referrer")    // no se envía la URL de origen a otros sitios
		c.Next()
	}
}
