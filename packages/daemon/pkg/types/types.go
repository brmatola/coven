// Package types defines the core types used throughout the daemon.
package types

import "time"

// AgentStatus represents the current state of an agent.
type AgentStatus string

const (
	AgentStatusStarting  AgentStatus = "starting"
	AgentStatusRunning   AgentStatus = "running"
	AgentStatusCompleted AgentStatus = "completed"
	AgentStatusFailed    AgentStatus = "failed"
	AgentStatusKilled    AgentStatus = "killed"
)

// TaskStatus represents the status of a task from beads.
type TaskStatus string

const (
	TaskStatusOpen         TaskStatus = "open"
	TaskStatusInProgress   TaskStatus = "in_progress"
	TaskStatusClosed       TaskStatus = "closed"
	TaskStatusBlocked      TaskStatus = "blocked"
	TaskStatusPendingMerge TaskStatus = "pending_merge"
)

// Task represents a task from the beads issue tracker.
type Task struct {
	ID          string     `json:"id"`
	Title       string     `json:"title"`
	Description string     `json:"description,omitempty"`
	Status      TaskStatus `json:"status"`
	Priority    int        `json:"priority"`
	Type        string     `json:"type"` // task, bug, feature, epic
	Labels      []string   `json:"labels,omitempty"`
	DependsOn   []string   `json:"depends_on,omitempty"`
	Blocks      []string   `json:"blocks,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

// Agent represents a running or completed agent process.
type Agent struct {
	TaskID     string      `json:"task_id"`
	StepTaskID string      `json:"step_task_id,omitempty"` // The current step's process ID (e.g., "task-1-step-1")
	PID        int         `json:"pid"`
	Status     AgentStatus `json:"status"`
	Worktree   string      `json:"worktree"`
	Branch     string      `json:"branch"`
	StartedAt  time.Time   `json:"started_at"`
	EndedAt    *time.Time  `json:"ended_at,omitempty"`
	ExitCode   *int        `json:"exit_code,omitempty"`
	Error      string      `json:"error,omitempty"`
}

// DaemonState represents the complete state of the daemon.
type DaemonState struct {
	// Agents maps task IDs to their agent state.
	Agents map[string]*Agent `json:"agents"`

	// Tasks is the list of ready tasks from beads.
	Tasks []Task `json:"tasks"`

	// LastTaskSync is when tasks were last synced from beads.
	LastTaskSync *time.Time `json:"last_task_sync,omitempty"`
}

// NewDaemonState creates a new empty daemon state.
func NewDaemonState() *DaemonState {
	return &DaemonState{
		Agents: make(map[string]*Agent),
		Tasks:  []Task{},
	}
}

// HealthStatus represents the health of the daemon.
type HealthStatus struct {
	Status    string `json:"status"`
	Version   string `json:"version"`
	Uptime    string `json:"uptime"`
	Workspace string `json:"workspace"`
}

// VersionInfo represents version information about the daemon.
type VersionInfo struct {
	Version   string `json:"version"`
	GitCommit string `json:"git_commit,omitempty"`
	BuildTime string `json:"build_time,omitempty"`
	GoVersion string `json:"go_version"`
}

// StateResponse is the response from GET /state.
type StateResponse struct {
	State     *DaemonState `json:"state"`
	Timestamp time.Time    `json:"timestamp"`
}

// ErrorResponse represents an error response.
type ErrorResponse struct {
	Error   string `json:"error"`
	Code    string `json:"code,omitempty"`
	Details string `json:"details,omitempty"`
}

// Event represents an SSE event.
type Event struct {
	Type      string    `json:"type"`
	Data      any       `json:"data"`
	Timestamp time.Time `json:"timestamp"`
}

// Event types for SSE.
const (
	EventTypeTasksUpdated = "tasks.updated"
	EventTypeAgentStarted    = "agent.started"
	EventTypeAgentOutput     = "agent.output"
	EventTypeAgentCompleted  = "agent.completed"
	EventTypeAgentFailed     = "agent.failed"
	EventTypeAgentQuestion   = "agent.question"
	EventTypeStateSnapshot   = "state.snapshot"
	EventTypeHeartbeat       = "heartbeat"

	// Workflow events
	EventTypeWorkflowStarted       = "workflow.started"
	EventTypeWorkflowStepStarted   = "workflow.step.started"
	EventTypeWorkflowStepCompleted = "workflow.step.completed"
	EventTypeWorkflowBlocked       = "workflow.blocked"
	EventTypeWorkflowMergePending  = "workflow.merge_pending"
	EventTypeWorkflowCompleted     = "workflow.completed"
	EventTypeWorkflowCancelled     = "workflow.cancelled"
)
