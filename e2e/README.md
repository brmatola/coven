# Coven E2E Tests

This directory contains end-to-end tests for the Coven project. E2E tests verify the complete system works correctly by testing actual binaries rather than internal packages.

## Directory Structure

```
e2e/
├── README.md           # This file
├── daemon/             # Daemon E2E tests
│   ├── helpers/        # Test utilities and helpers
│   │   ├── daemon.go   # Test environment setup
│   │   └── client.go   # API client for daemon endpoints
│   ├── mockagent/      # Mock agent binary for testing
│   │   └── main.go     # Mock agent that simulates claude behavior
│   ├── lifecycle_test.go   # Daemon start/stop tests
│   ├── session_test.go     # Session lifecycle tests
│   └── state_test.go       # State and API endpoint tests
└── extension/          # VS Code extension E2E tests (placeholder)
    └── extension_test.ts
```

## Running Tests

### Prerequisites

Build the daemon and mock agent first:

```bash
make build
```

Or build individually:

```bash
make build-daemon    # Build covend binary
make build-mockagent # Build mock agent for tests
```

### Running E2E Tests

```bash
make test-e2e
```

This will:
1. Build the daemon binary if needed
2. Build the mock agent if needed
3. Run all E2E tests

### Running Specific Tests

```bash
cd e2e/daemon
go test -v -tags=e2e -run TestDaemonStartStop ./...
```

## Writing Tests

### Test Structure

E2E tests should:
- Test the actual binary, not internal packages
- Use the helper utilities for consistent setup
- Clean up after themselves (helpers do this automatically)
- Be independent and runnable in parallel

### Using the Test Environment

```go
func TestExample(t *testing.T) {
    // Create test environment
    env := helpers.NewTestEnv(t)
    defer env.Stop()

    // Start daemon
    env.MustStart()

    // Use API client for requests
    api := helpers.NewAPIClient(env)
    health, err := api.GetHealth()
    if err != nil {
        t.Fatalf("Health check error: %v", err)
    }

    // Make assertions
    if health.Status != "healthy" {
        t.Errorf("Status = %q, want %q", health.Status, "healthy")
    }
}
```

### Available Helpers

#### TestEnv

- `NewTestEnv(t)` - Create isolated test environment
- `env.MustStart()` - Start daemon (fails test on error)
- `env.Stop()` - Stop daemon gracefully
- `env.WriteFile(path, content)` - Write file to workspace
- `env.ReadFile(path)` - Read file from workspace
- `env.FileExists(path)` - Check if file exists

#### APIClient

- `api.GetHealth()` - GET /health
- `api.GetVersion()` - GET /version
- `api.GetSessionStatus()` - GET /session/status
- `api.StartSession()` - POST /session/start
- `api.StopSession()` - POST /session/stop
- `api.GetTasks()` - GET /tasks
- `api.StartTask(id)` - POST /tasks/:id/start
- `api.GetAgents()` - GET /agents
- `api.GetQuestions()` - GET /questions
- `api.GetState()` - GET /state
- `api.Shutdown()` - POST /shutdown

## Mock Agent

The mock agent (`e2e/daemon/mockagent`) simulates claude agent behavior for fast, deterministic testing.

### Usage

```bash
mockagent [flags] [task description]
```

### Flags

- `-delay <duration>` - Delay before completing (default: 100ms)
- `-fail` - Exit with non-zero code
- `-question` - Output a question and wait for response
- `-output <text>` - Custom output text
- `-exit-code <int>` - Exit with specific code (default: 0)

### Examples

```bash
# Complete successfully after 100ms
mockagent "implement feature"

# Fail with error
mockagent -fail "buggy task"

# Ask a question
mockagent -question "interactive task"

# Custom delay
mockagent -delay 5s "long task"
```

## Test Coverage

Current E2E tests cover:

### Daemon Lifecycle
- Daemon start/stop
- Health endpoint stability
- Version endpoint
- Shutdown endpoint
- PID file creation/cleanup
- Socket creation
- Double-start prevention
- Stale socket cleanup

### Session Control
- Session start/stop lifecycle
- Force stop functionality
- Double-start handling
- Stop when not started

### State and APIs
- State endpoint
- Tasks endpoint
- Agents endpoint
- Questions endpoint

## Adding New Tests

1. Add test file in appropriate category (e.g., `agent_test.go` for agent tests)
2. Use the `//go:build e2e` build tag
3. Use helpers for consistent setup
4. Keep tests focused and independent
5. Clean up resources in `defer env.Stop()`

## CI Integration

E2E tests run as part of `make test`:

```bash
make test  # Runs both unit tests and E2E tests
```

Ensure the build directory is in `.gitignore` to avoid committing binaries.
