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
	tasks, err := p.client.Ready(ctx)
	if err != nil {
		return err
	}

	// Check for changes
	oldTasks := p.store.GetTasks()
	changed := p.tasksChanged(oldTasks, tasks)

	// Update store
	p.store.SetTasks(tasks)

	// Emit event if changed
	if changed && p.broker != nil {
		p.broker.EmitTasksUpdated(tasks)
	}

	return nil
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
