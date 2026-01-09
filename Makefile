# Coven Makefile

.PHONY: all build build-daemon test test-unit test-e2e clean

# Build directory
BUILD_DIR := ./build
DAEMON_BIN := $(BUILD_DIR)/covend

# Go settings
GO := go
GOFLAGS := -v

# Version
VERSION ?= dev

all: build

# Build all binaries
build: build-daemon

# Build daemon binary
build-daemon:
	@mkdir -p $(BUILD_DIR)
	cd packages/daemon && $(GO) build $(GOFLAGS) -ldflags "-X main.version=$(VERSION)" -o ../../$(DAEMON_BIN) ./cmd/covend

# Run all tests
test: test-unit test-e2e

# Run unit tests for daemon
test-unit:
	cd packages/daemon && $(GO) test -v -cover ./...

# Run E2E tests (builds daemon first)
test-e2e: build-daemon
	cd e2e/daemon && $(GO) test -v -tags=e2e ./...

# Clean build artifacts
clean:
	rm -rf $(BUILD_DIR)
	rm -f packages/daemon/coverage.out

# Run daemon for development
run-daemon: build-daemon
	$(DAEMON_BIN) --workspace=$(PWD)

# Coverage report
coverage:
	cd packages/daemon && $(GO) test -coverprofile=coverage.out ./...
	cd packages/daemon && $(GO) tool cover -html=coverage.out -o coverage.html
