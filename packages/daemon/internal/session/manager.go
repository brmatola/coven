// Package session manages the daemon session lifecycle.
package session

import (
	"context"
	"fmt"
	"os"
	"sync"
	"syscall"
	"time"

	"github.com/coven/daemon/internal/logging"
	"github.com/coven/daemon/internal/state"
	"github.com/coven/daemon/pkg/types"
)

// Manager handles session lifecycle operations.
type Manager struct {
	mu     sync.Mutex
	store  *state.Store
	logger *logging.Logger

	// stopCh is used to signal session stop
	stopCh chan struct{}
	// doneCh signals when session has fully stopped
	doneCh chan struct{}
}

// NewManager creates a new session manager.
func NewManager(store *state.Store, logger *logging.Logger) *Manager {
	return &Manager{
		store:  store,
		logger: logger,
	}
}

// Start begins a new session.
func (m *Manager) Start() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	session := m.store.GetSession()
	if session.Status == types.SessionStatusActive {
		return fmt.Errorf("session already active")
	}

	if err := m.store.StartSession(); err != nil {
		return err
	}

	m.stopCh = make(chan struct{})
	m.doneCh = make(chan struct{})

	if err := m.store.Save(); err != nil {
		m.logger.Error("failed to save session state", "error", err)
	}

	m.logger.Info("session started")
	return nil
}

// Stop gracefully stops the session, waiting for agents to complete.
func (m *Manager) Stop(ctx context.Context) error {
	m.mu.Lock()

	session := m.store.GetSession()
	if session.Status != types.SessionStatusActive {
		m.mu.Unlock()
		return fmt.Errorf("no active session")
	}

	if err := m.store.StopSession(); err != nil {
		m.mu.Unlock()
		return err
	}

	// Signal stop
	if m.stopCh != nil {
		close(m.stopCh)
	}

	m.mu.Unlock()

	// Wait for all agents to complete gracefully
	if err := m.waitForAgents(ctx); err != nil {
		return err
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	m.store.SetSessionStopped()
	if err := m.store.Save(); err != nil {
		m.logger.Error("failed to save session state", "error", err)
	}

	if m.doneCh != nil {
		close(m.doneCh)
	}

	m.logger.Info("session stopped")
	return nil
}

// ForceStop kills all agents immediately with SIGKILL.
func (m *Manager) ForceStop() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	session := m.store.GetSession()
	if session.Status == types.SessionStatusInactive {
		return fmt.Errorf("no active session")
	}

	// Kill all running agents
	agents := m.store.GetAllAgents()
	for taskID, agent := range agents {
		if agent.Status == types.AgentStatusRunning || agent.Status == types.AgentStatusStarting {
			if err := m.killAgent(agent.PID); err != nil {
				// Process might not exist anymore, still mark as killed
				m.logger.Warn("failed to kill agent (may already be dead)", "task_id", taskID, "pid", agent.PID, "error", err)
			} else {
				m.logger.Info("killed agent", "task_id", taskID, "pid", agent.PID)
			}
			// Always mark as killed during force stop
			m.store.UpdateAgentStatus(taskID, types.AgentStatusKilled)
		}
	}

	// Signal stop if not already done
	if m.stopCh != nil {
		select {
		case <-m.stopCh:
			// Already closed
		default:
			close(m.stopCh)
		}
	}

	m.store.SetSessionStopped()
	if err := m.store.Save(); err != nil {
		m.logger.Error("failed to save session state", "error", err)
	}

	if m.doneCh != nil {
		select {
		case <-m.doneCh:
			// Already closed
		default:
			close(m.doneCh)
		}
	}

	m.logger.Info("session force stopped")
	return nil
}

// IsActive returns whether a session is currently active.
func (m *Manager) IsActive() bool {
	session := m.store.GetSession()
	return session.Status == types.SessionStatusActive
}

// IsStopping returns whether a session is currently stopping.
func (m *Manager) IsStopping() bool {
	session := m.store.GetSession()
	return session.Status == types.SessionStatusStopping
}

// StopCh returns a channel that is closed when the session should stop.
func (m *Manager) StopCh() <-chan struct{} {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.stopCh
}

// Recover attempts to recover session state after daemon restart.
func (m *Manager) Recover() error {
	session := m.store.GetSession()

	if session.Status == types.SessionStatusInactive {
		// No session to recover
		return nil
	}

	m.logger.Info("recovering session state", "status", session.Status)

	// Check for orphaned agents
	agents := m.store.GetAllAgents()
	for taskID, agent := range agents {
		if agent.Status == types.AgentStatusRunning || agent.Status == types.AgentStatusStarting {
			// Check if process is still running
			if !m.isProcessRunning(agent.PID) {
				m.logger.Warn("agent process no longer running", "task_id", taskID, "pid", agent.PID)
				m.store.UpdateAgentStatus(taskID, types.AgentStatusFailed)
				m.store.SetAgentError(taskID, "process terminated unexpectedly")
			}
		}
	}

	// If session was active, reinitialize channels
	if session.Status == types.SessionStatusActive {
		m.mu.Lock()
		m.stopCh = make(chan struct{})
		m.doneCh = make(chan struct{})
		m.mu.Unlock()
	}

	if err := m.store.Save(); err != nil {
		return fmt.Errorf("failed to save recovered state: %w", err)
	}

	m.logger.Info("session recovery complete")
	return nil
}

// waitForAgents waits for all running agents to complete.
func (m *Manager) waitForAgents(ctx context.Context) error {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			agents := m.store.GetAllAgents()
			allDone := true
			for _, agent := range agents {
				if agent.Status == types.AgentStatusRunning || agent.Status == types.AgentStatusStarting {
					allDone = false
					break
				}
			}
			if allDone {
				return nil
			}
		}
	}
}

// killAgent sends SIGKILL to a process.
func (m *Manager) killAgent(pid int) error {
	process, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return process.Signal(syscall.SIGKILL)
}

// isProcessRunning checks if a process is still running.
func (m *Manager) isProcessRunning(pid int) bool {
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	// On Unix, FindProcess always succeeds. Check with signal 0.
	err = process.Signal(syscall.Signal(0))
	return err == nil
}
