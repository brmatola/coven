.PHONY: build test test-e2e clean lint fmt coverage

# Output directory for builds (used by E2E tests)
BUILD_DIR := ../../build

# Build the daemon binary
build:
	@mkdir -p $(BUILD_DIR)
	go build -o $(BUILD_DIR)/covend ./cmd/covend

# Run unit tests with coverage
test:
	go test -race -coverprofile=coverage.out ./...
	@echo "Coverage report:"
	@go tool cover -func=coverage.out | tail -1
	@go tool cover -func=coverage.out | grep total | awk '{print $$3}' | awk -F% '{if ($$1 < 80) { print "Coverage below 80%!"; exit 1 }}'

# Run E2E tests
test-e2e:
	go test -race -tags=e2e ./...

# Run all tests
test-all: test test-e2e

# Generate coverage HTML report
coverage:
	go test -coverprofile=coverage.out ./...
	go tool cover -html=coverage.out -o coverage.html

# Lint the code
lint:
	golangci-lint run ./...

# Format the code
fmt:
	go fmt ./...
	goimports -w .

# Clean build artifacts
clean:
	rm -rf $(BUILD_DIR)/covend* coverage.out coverage.html

# Install development tools
tools:
	go install golang.org/x/tools/cmd/goimports@latest
	go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest

# Cross-compile for all platforms
build-all:
	@mkdir -p $(BUILD_DIR)
	GOOS=darwin GOARCH=arm64 go build -o $(BUILD_DIR)/covend-darwin-arm64 ./cmd/covend
	GOOS=darwin GOARCH=amd64 go build -o $(BUILD_DIR)/covend-darwin-amd64 ./cmd/covend
	GOOS=linux GOARCH=amd64 go build -o $(BUILD_DIR)/covend-linux-amd64 ./cmd/covend
	GOOS=linux GOARCH=arm64 go build -o $(BUILD_DIR)/covend-linux-arm64 ./cmd/covend
