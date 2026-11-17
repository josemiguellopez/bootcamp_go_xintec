package domain

import (
	"strconv"
	"strings"
)

// NormalizeRUT valida un RUT chileno y lo devuelve en formato único
// "12345678-5" (sin puntos, con guion y la K en mayúscula).
//
// Acepta "12.345.678-5", "12345678-5" o "123456785". Devuelve ok=false si el
// formato no es válido o si el dígito verificador no corresponde.
func NormalizeRUT(raw string) (rut string, ok bool) {
	clean := strings.ToUpper(strings.NewReplacer(".", "", "-", "", " ", "").Replace(raw))
	if len(clean) < 2 || len(clean) > 9 {
		return "", false
	}
	body, dv := clean[:len(clean)-1], clean[len(clean)-1:]
	if _, err := strconv.Atoi(body); err != nil || strings.HasPrefix(body, "0") {
		return "", false
	}
	if checkDigit(body) != dv {
		return "", false
	}
	return body + "-" + dv, true
}

// checkDigit calcula el dígito verificador con el algoritmo "módulo 11":
// se multiplican los dígitos, de derecha a izquierda, por 2, 3, 4, 5, 6, 7,
// 2, 3… se suman, y el dígito es 11 menos el resto de dividir por 11
// (11 se escribe 0 y 10 se escribe K).
func checkDigit(body string) string {
	sum, factor := 0, 2
	for i := len(body) - 1; i >= 0; i-- {
		sum += int(body[i]-'0') * factor
		factor++
		if factor > 7 {
			factor = 2
		}
	}
	switch d := 11 - sum%11; d {
	case 11:
		return "0"
	case 10:
		return "K"
	default:
		return strconv.Itoa(d)
	}
}
