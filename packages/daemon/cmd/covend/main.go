package main

import (
	"flag"
	"fmt"
	"os"
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

	fmt.Printf("Starting covend for workspace: %s\n", *workspace)
	// TODO: Implement daemon
}
