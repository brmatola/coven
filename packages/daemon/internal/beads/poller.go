package beads

import (
	"context"
	"sync"
	"time"

	"github.com/coven/daemon/internal/api"
	"github.com/coven/daemon/internal/logging"
	"github.com/coven/daemon/internal/state"
	"github.com/coven/daemon/pkg/types"
)

// Poller periodically fetches tasks from beads and updates state.
type Poller struct {
	mu       sync.Mutex
	client   *Client
	store    *state.Store
	broker   *api.EventBroker
	logger   *logging.Logger
	interval time.Duration

	stopCh  chan struct{}
	running bool
}

// NewPoller creates a new task poller.
func NewPoller(client *Client, store *state.Store, broker *api.EventBroker, logger *logging.Logger) *Poller {
	return &Poller{
		client:   client,
		store:    store,
		broker:   broker,
		logger:   logger,
		interval: 1 * time.Second,
	}
}

// SetInterval sets the polling interval (for testing).
func (p *Poller) SetInterval(d time.Duration) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.interval = d
}

// Start begins the polling loop.
func (p *Poller) Start() {
	p.mu.Lock()
	if p.running {
		p.mu.Unlock()
		return
	}
	p.running = true
	p.stopCh = make(chan struct{})
	p.mu.Unlock()

	go p.pollLoop()
}

// Stop stops the polling loop.
func (p *Poller) Stop() {
	p.mu.Lock()
	defer p.mu.Unlock()

	if !p.running {
		return
	}
	p.running = false
	close(p.stopCh)
}

// IsRunning returns whether the poller is running.
func (p *Poller) IsRunning() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.running
}

// Poll fetches tasks once and updates state.
func (p *Poller) Poll(ctx context.Context) error {
	tasks, err := p.client.List(ctx)
	if err != nil {
		return err
	}

	// Check for changes
	oldTasks := p.store.GetTasks()

	// Merge status updates: preserve local "terminal" statuses (blocked, closed)
	// that may not have propagated to beads yet
	mergedTasks := p.mergeTaskStatuses(oldTasks, tasks)

	changed := p.tasksChanged(oldTasks, mergedTasks)

	// Update store
	p.store.SetTasks(mergedTasks)

	// Emit event if changed
	if changed && p.broker != nil {
		p.broker.EmitTasksUpdated(mergedTasks)
	}

	return nil
}

// mergeTaskStatuses merges local status updates with fetched tasks.
// This preserves terminal statuses (blocked, closed) that may not have
// propagated to beads yet due to timing.
func (p *Poller) mergeTaskStatuses(oldTasks, newTasks []types.Task) []types.Task {
	// Build map of old task statuses
	oldStatusMap := make(map[string]types.TaskStatus)
	for _, t := range oldTasks {
		oldStatusMap[t.ID] = t.Status
	}

	// Merge statuses
	for i := range newTasks {
		oldStatus, exists := oldStatusMap[newTasks[i].ID]
		if !exists {
			continue
		}

		// If local status is a terminal status that beads doesn't have yet,
		// preserve the local status
		if isTerminalStatus(oldStatus) && !isTerminalStatus(newTasks[i].Status) {
			newTasks[i].Status = oldStatus
		}
	}

	return newTasks
}

// isTerminalStatus returns true for statuses that indicate workflow completion.
func isTerminalStatus(status types.TaskStatus) bool {
	switch status {
	case types.TaskStatusBlocked, types.TaskStatusClosed, types.TaskStatusPendingMerge:
		return true
	default:
		return false
	}
}

// pollLoop runs the polling loop.
func (p *Poller) pollLoop() {
	// Initial poll
	ctx := context.Background()
	if err := p.Poll(ctx); err != nil {
		p.logger.Error("initial poll failed", "error", err)
	}

	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()

	for {
		select {
		case <-p.stopCh:
			return
		case <-ticker.C:
			if err := p.Poll(ctx); err != nil {
				p.logger.Error("poll failed", "error", err)
			}
		}
	}
}

// tasksChanged checks if tasks have changed.
func (p *Poller) tasksChanged(old, new []types.Task) bool {
	if len(old) != len(new) {
		return true
	}

	oldMap := make(map[string]types.Task, len(old))
	for _, t := range old {
		oldMap[t.ID] = t
	}

	for _, t := range new {
		oldTask, ok := oldMap[t.ID]
		if !ok {
			return true
		}
		if oldTask.Status != t.Status || oldTask.Title != t.Title {
			return true
		}
	}

	return false
}
