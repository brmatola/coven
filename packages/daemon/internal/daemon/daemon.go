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

	"github.com/coven/daemon/internal/agent"
	"github.com/coven/daemon/internal/api"
	"github.com/coven/daemon/internal/beads"
	"github.com/coven/daemon/internal/config"
	"github.com/coven/daemon/internal/defaults"
	"github.com/coven/daemon/internal/git"
	"github.com/coven/daemon/internal/logging"
	"github.com/coven/daemon/internal/questions"
	"github.com/coven/daemon/internal/scheduler"
	"github.com/coven/daemon/internal/session"
	"github.com/coven/daemon/internal/state"
	"github.com/coven/daemon/pkg/types"
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

	// Components
	store            *state.Store
	sessionManager   *session.Manager
	beadsClient      *beads.Client
	beadsPoller      *beads.Poller
	processManager   *agent.ProcessManager
	worktreeManager  *git.WorktreeManager
	scheduler        *scheduler.Scheduler
	questionDetector *questions.Detector
	eventBroker      *api.EventBroker
}

// New creates a new daemon for the given workspace.
func New(workspace, version string) (*Daemon, error) {
	covenDir := filepath.Join(workspace, ".coven")

	// Ensure .coven directory exists
	if err := os.MkdirAll(covenDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create .coven directory: %w", err)
	}

	// Initialize defaults (copies default grimoires/spells to .coven if not present)
	// This is done early so defaults are available for the rest of initialization
	if initResult, err := defaults.Initialize(covenDir); err != nil {
		// Log warning but don't fail - defaults are optional
		fmt.Fprintf(os.Stderr, "warning: failed to initialize defaults: %v\n", err)
	} else if initResult.TotalCopied() > 0 {
		fmt.Fprintf(os.Stderr, "Initialized %d default files (spells: %d, grimoires: %d)\n",
			initResult.TotalCopied(), len(initResult.SpellsCopied), len(initResult.GrimoiresCopied))
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

	// Initialize components
	store := state.NewStore(covenDir)
	beadsClient := beads.NewClient(workspace)
	eventBroker := api.NewEventBroker(store)
	processManager := agent.NewProcessManager(logger)
	worktreeManager := git.NewWorktreeManager(workspace, logger)
	questionDetector := questions.NewDetector()
	sessionManager := session.NewManager(store, logger)
	sched := scheduler.NewScheduler(store, beadsClient, processManager, worktreeManager, logger, covenDir)
	beadsPoller := beads.NewPoller(beadsClient, store, eventBroker, logger)

	// Apply config settings
	sched.SetMaxAgents(cfg.MaxConcurrentAgents)
	if cfg.AgentCommand != "" {
		sched.SetAgentCommand(cfg.AgentCommand, []string{})
	}

	// Wire up event emitter for workflow events
	sched.SetEventEmitter(eventBroker)

	// Wire up event callbacks - this handles both state updates and event emission
	processManager.OnComplete(func(result *agent.ProcessResult) {
		logger.Info("agent completed",
			"task_id", result.TaskID,
			"exit_code", result.ExitCode,
			"duration", result.Duration,
		)

		// Update agent status in store
		store.UpdateAgentStatus(result.TaskID, result.ToAgentStatus())
		store.SetAgentExitCode(result.TaskID, result.ExitCode)
		if result.Error != "" {
			store.SetAgentError(result.TaskID, result.Error)
		}

		// Emit event
		agnt := store.GetAgent(result.TaskID)
		if agnt != nil {
			if result.Error != "" {
				eventBroker.EmitAgentFailed(agnt, result.Error)
			} else {
				eventBroker.EmitAgentCompleted(agnt)
			}
		}
	})

	processManager.OnOutput(func(taskID string, line agent.OutputLine) {
		// Check for questions
		questionDetector.ProcessLine(taskID, line)
		eventBroker.EmitAgentOutput(taskID, line.Data)
	})

	questionDetector.OnQuestion(func(q *questions.Question) {
		eventBroker.Broadcast(&types.Event{
			Type: types.EventTypeAgentQuestion,
			Data: map[string]interface{}{
				"question_id": q.ID,
				"task_id":     q.TaskID,
				"type":        q.Type,
				"text":        q.Text,
				"options":     q.Options,
			},
			Timestamp: time.Now(),
		})
	})

	return &Daemon{
		workspace:        workspace,
		covenDir:         covenDir,
		server:           server,
		logger:           logger,
		config:           cfg,
		version:          version,
		shutdownCh:       make(chan struct{}),
		store:            store,
		sessionManager:   sessionManager,
		beadsClient:      beadsClient,
		beadsPoller:      beadsPoller,
		processManager:   processManager,
		worktreeManager:  worktreeManager,
		scheduler:        sched,
		questionDetector: questionDetector,
		eventBroker:      eventBroker,
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

	// Start beads poller
	d.beadsPoller.Start()
	defer d.beadsPoller.Stop()

	// Start scheduler (handles workflow resumption and reconciliation)
	d.scheduler.Start()
	defer d.scheduler.Stop()

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
	// Core daemon endpoints (health and version handled by api handlers)
	d.server.RegisterHandlerFunc("/shutdown", d.handleShutdown)

	// API handlers (health, version, state, tasks)
	apiHandlers := api.NewHandlers(d.store, d.version, "", "", d.workspace)
	apiHandlers.Register(d.server)

	// Session handlers
	sessionHandlers := session.NewHandlers(d.sessionManager)
	sessionHandlers.Register(d.server)

	// Beads handlers
	beadsHandlers := beads.NewHandlers(d.store)
	beadsHandlers.Register(d.server)

	// Agent handlers
	agentHandlers := agent.NewHandlers(d.store, d.processManager)
	agentHandlers.Register(d.server)

	// Question handlers
	questionHandlers := questions.NewHandlers(d.questionDetector)
	questionHandlers.Register(d.server)

	// Scheduler/task control handlers
	schedulerHandlers := scheduler.NewHandlers(d.store, d.scheduler)
	schedulerHandlers.Register(d.server)

	// Workflow handlers
	workflowHandlers := scheduler.NewWorkflowHandlers(d.store, d.scheduler, d.covenDir)
	workflowHandlers.Register(d.server)

	// SSE event stream
	d.eventBroker.Register(d.server)
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
