package config

import (
	"fmt"
	"os"

	"github.com/joho/godotenv"
)

// LoadEnvFile carga .env.<ENVIRONMENT> (solo dev/qa) si existe. Las variables
// ya definidas en el entorno tienen prioridad. En prod no se lee ningún
// archivo: la configuración llega del entorno.
func LoadEnvFile() error {
	appEnv := os.Getenv("ENVIRONMENT")
	if appEnv == "" {
		appEnv = "dev"
	}
	if appEnv != "dev" && appEnv != "qa" {
		return nil
	}

	filename := ".env." + appEnv
	if _, err := os.Stat(filename); err != nil {
		return nil
	}
	if err := godotenv.Load(filename); err != nil {
		return fmt.Errorf("load %s: %w", filename, err)
	}
	return nil
}
