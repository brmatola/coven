# Coven Makefile

.PHONY: all build test test-unit test-e2e clean run-daemon coverage

# Build directory
BUILD_DIR := ./build
DAEMON_BIN := $(BUILD_DIR)/covend
MOCKAGENT_BIN := $(BUILD_DIR)/mockagent

# Go settings
GO := go
GOFLAGS :=

# Version
VERSION ?= dev

# Source files for dependency tracking
DAEMON_SOURCES := $(shell find packages/daemon -name '*.go' -type f)
MOCKAGENT_SOURCES := $(shell find e2e/daemon/mockagent -name '*.go' -type f)

all: build

# Build all binaries
build: $(DAEMON_BIN) $(MOCKAGENT_BIN)

# Build daemon binary (only when sources change)
$(DAEMON_BIN): $(DAEMON_SOURCES)
	@mkdir -p $(BUILD_DIR)
	@echo "Building daemon..."
	@cd packages/daemon && $(GO) build $(GOFLAGS) -ldflags "-X main.version=$(VERSION)" -o ../../$(DAEMON_BIN) ./cmd/covend

# Build mock agent for E2E tests (only when sources change)
$(MOCKAGENT_BIN): $(MOCKAGENT_SOURCES)
	@mkdir -p $(BUILD_DIR)
	@echo "Building mockagent..."
	@cd e2e/daemon && $(GO) build $(GOFLAGS) -o ../../$(MOCKAGENT_BIN) ./mockagent

# Run all tests
test: test-unit test-e2e

# Run unit tests for daemon
test-unit:
	@echo "Running unit tests..."
	@cd packages/daemon && $(GO) test -cover ./...

# Run E2E tests (automatically builds dependencies if needed)
test-e2e: $(DAEMON_BIN) $(MOCKAGENT_BIN)
	@echo "Running E2E tests..."
	@cd e2e/daemon && $(GO) test -tags=e2e ./...

# Run E2E tests with verbose output
test-e2e-v: $(DAEMON_BIN) $(MOCKAGENT_BIN)
	@echo "Running E2E tests (verbose)..."
	@cd e2e/daemon && $(GO) test -v -tags=e2e ./...

# Run VS Code extension E2E tests
test-e2e-extension:
	@echo "Running VS Code extension E2E tests..."
	@cd packages/vscode && npm run test:e2e:new

# Clean build artifacts
clean:
	rm -rf $(BUILD_DIR)
	rm -f packages/daemon/coverage.out

# Run daemon for development
run-daemon: $(DAEMON_BIN)
	$(DAEMON_BIN) --workspace=$(PWD)

# Coverage report
coverage:
	cd packages/daemon && $(GO) test -coverprofile=coverage.out ./...
	cd packages/daemon && $(GO) tool cover -html=coverage.out -o coverage.html

# Force rebuild (useful for debugging)
rebuild: clean build
