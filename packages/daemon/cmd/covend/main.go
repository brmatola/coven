package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"github.com/coven/daemon/internal/daemon"
)

var version = "dev"

func main() {
	workspace := flag.String("workspace", "", "Path to workspace directory")
	showVersion := flag.Bool("version", false, "Show version")
	flag.Parse()

	if *showVersion {
		fmt.Printf("covend version %s\n", version)
		os.Exit(0)
	}

	if *workspace == "" {
		fmt.Fprintln(os.Stderr, "Error: --workspace is required")
		os.Exit(1)
	}

	d, err := daemon.New(*workspace, version)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	if err := d.Run(context.Background()); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
