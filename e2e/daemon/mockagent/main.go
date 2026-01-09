// Package main provides a mock agent for E2E testing.
//
// The mock agent simulates claude agent behavior for fast, deterministic testing.
// It reads commands from stdin and responds with predefined behavior.
//
// Usage:
//
//	mockagent [flags]
//
// Flags:
//
//	-delay <duration>  Delay before completing (default: 100ms)
//	-fail              Exit with non-zero code
//	-question          Output a question and wait for response
//	-output <text>     Custom output text
//	-exit-code <int>   Exit with specific code (default: 0)
package main

import (
	"bufio"
	"flag"
	"fmt"
	"os"
	"time"
)

func main() {
	delay := flag.Duration("delay", 100*time.Millisecond, "Delay before completing")
	fail := flag.Bool("fail", false, "Exit with non-zero code")
	question := flag.Bool("question", false, "Output a question and wait for response")
	output := flag.String("output", "", "Custom output text")
	exitCode := flag.Int("exit-code", 0, "Exit with specific code")
	flag.Parse()

	// Get task description from args (simulating prompt)
	taskDesc := "test task"
	if len(flag.Args()) > 0 {
		taskDesc = flag.Args()[0]
	}

	fmt.Printf("Starting work on: %s\n", taskDesc)

	// Simulate work
	time.Sleep(*delay)

	// Output custom text if provided
	if *output != "" {
		fmt.Println(*output)
	}

	// Handle question mode
	if *question {
		fmt.Println("Do you want to proceed? (y/n)")

		// Wait for input
		reader := bufio.NewReader(os.Stdin)
		response, _ := reader.ReadString('\n')
		fmt.Printf("Received response: %s", response)
	}

	// Simulate more work
	time.Sleep(*delay)

	fmt.Println("Task completed successfully")

	// Handle failure mode
	if *fail {
		fmt.Fprintln(os.Stderr, "Error: task failed")
		os.Exit(1)
	}

	os.Exit(*exitCode)
}
