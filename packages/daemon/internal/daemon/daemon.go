package daemon

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/coven/daemon/internal/api"
	"github.com/coven/daemon/internal/config"
	"github.com/coven/daemon/internal/logging"
)

// Daemon manages the covend daemon lifecycle.
type Daemon struct {
	workspace  string
	covenDir   string
	server     *api.Server
	logger     *logging.Logger
	config     *config.Config
	startTime  time.Time
	version    string
	shutdownCh chan struct{}
}

// New creates a new daemon for the given workspace.
func New(workspace, version string) (*Daemon, error) {
	covenDir := filepath.Join(workspace, ".coven")

	// Ensure .coven directory exists
	if err := os.MkdirAll(covenDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create .coven directory: %w", err)
	}

	// Load configuration
	cfg, err := config.Load(covenDir)
	if err != nil {
		return nil, fmt.Errorf("failed to load config: %w", err)
	}

	// Initialize logger
	logger, err := logging.New(filepath.Join(covenDir, "covend.log"))
	if err != nil {
		return nil, fmt.Errorf("failed to create logger: %w", err)
	}

	socketPath := filepath.Join(covenDir, "covend.sock")
	server := api.NewServer(socketPath)

	return &Daemon{
		workspace:  workspace,
		covenDir:   covenDir,
		server:     server,
		logger:     logger,
		config:     cfg,
		version:    version,
		shutdownCh: make(chan struct{}),
	}, nil
}

// Run starts the daemon and blocks until shutdown.
func (d *Daemon) Run(ctx context.Context) error {
	// Check for stale daemon
	if err := d.checkAndCleanStale(); err != nil {
		return err
	}

	// Write PID file
	if err := d.writePIDFile(); err != nil {
		return err
	}
	defer d.removePIDFile()

	// Register handlers
	d.registerHandlers()

	// Start server
	if err := d.server.Start(); err != nil {
		return fmt.Errorf("failed to start server: %w", err)
	}

	d.startTime = time.Now()
	d.logger.Info("daemon started", "workspace", d.workspace, "version", d.version)

	// Handle signals
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case <-ctx.Done():
		d.logger.Info("context cancelled, shutting down")
	case sig := <-sigCh:
		d.logger.Info("received signal, shutting down", "signal", sig.String())
	case <-d.shutdownCh:
		d.logger.Info("shutdown requested")
	}

	// Graceful shutdown
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := d.server.Stop(shutdownCtx); err != nil {
		d.logger.Error("failed to stop server", "error", err)
		return err
	}

	d.logger.Info("daemon stopped")
	return nil
}

// Shutdown triggers a graceful shutdown of the daemon.
func (d *Daemon) Shutdown() {
	close(d.shutdownCh)
}

// pidFilePath returns the path to the PID file.
func (d *Daemon) pidFilePath() string {
	return filepath.Join(d.covenDir, "covend.pid")
}

// writePIDFile writes the current process ID to the PID file.
func (d *Daemon) writePIDFile() error {
	pid := os.Getpid()
	content := fmt.Sprintf("%d\n", pid)
	if err := os.WriteFile(d.pidFilePath(), []byte(content), 0644); err != nil {
		return fmt.Errorf("failed to write PID file: %w", err)
	}
	return nil
}

// removePIDFile removes the PID file.
func (d *Daemon) removePIDFile() {
	os.Remove(d.pidFilePath())
}

// checkAndCleanStale checks for a stale daemon and cleans up if necessary.
func (d *Daemon) checkAndCleanStale() error {
	pidFile := d.pidFilePath()
	socketPath := filepath.Join(d.covenDir, "covend.sock")

	// Read existing PID file
	data, err := os.ReadFile(pidFile)
	if os.IsNotExist(err) {
		// No PID file, clean up any stale socket
		os.Remove(socketPath)
		return nil
	}
	if err != nil {
		return fmt.Errorf("failed to read PID file: %w", err)
	}

	// Parse PID
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		// Invalid PID file, clean up
		os.Remove(pidFile)
		os.Remove(socketPath)
		return nil
	}

	// Check if process is running
	process, err := os.FindProcess(pid)
	if err != nil {
		// Process not found, clean up
		os.Remove(pidFile)
		os.Remove(socketPath)
		return nil
	}

	// On Unix, FindProcess always succeeds. Check if process is actually running
	// by sending signal 0 (doesn't actually send a signal, just checks)
	err = process.Signal(syscall.Signal(0))
	if err != nil {
		// Process not running, clean up stale files
		d.logger.Info("cleaning up stale daemon", "pid", pid)
		os.Remove(pidFile)
		os.Remove(socketPath)
		return nil
	}

	// Process is running - daemon already active
	return fmt.Errorf("daemon already running with PID %d", pid)
}

// registerHandlers sets up the HTTP endpoints.
func (d *Daemon) registerHandlers() {
	d.server.RegisterHandlerFunc("/health", d.handleHealth)
	d.server.RegisterHandlerFunc("/shutdown", d.handleShutdown)
}

// handleHealth returns the daemon health status.
func (d *Daemon) handleHealth(w http.ResponseWriter, r *http.Request) {
	api.WriteJSON(w, http.StatusOK, api.HealthResponse{
		Status:    "healthy",
		Version:   d.version,
		Uptime:    time.Since(d.startTime).String(),
		Workspace: d.workspace,
	})
}

// handleShutdown triggers a graceful shutdown.
func (d *Daemon) handleShutdown(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		api.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	api.WriteJSON(w, http.StatusOK, map[string]string{"status": "shutting down"})

	// Trigger shutdown in a goroutine so the response can be sent
	go d.Shutdown()
}

// Workspace returns the workspace path.
func (d *Daemon) Workspace() string {
	return d.workspace
}

// Version returns the daemon version.
func (d *Daemon) Version() string {
	return d.version
}

// Config returns the daemon configuration.
func (d *Daemon) Config() *config.Config {
	return d.config
}
