// Comando api: servidor HTTP de pedidos (EventFlow).
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"microservice/cmd/app"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	a, err := app.New(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, "startup failed:", err)
		os.Exit(1)
	}
	if err := a.Run(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "api stopped with error:", err)
		os.Exit(1)
	}
}
