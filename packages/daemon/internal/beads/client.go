// Package beads provides integration with the beads CLI for task management.
package beads

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/coven/daemon/pkg/types"
)

// Client wraps the beads CLI for task operations.
type Client struct {
	workDir string
	bdPath  string
}

// BeadsTask represents a task from bd ready --json output.
type BeadsTask struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Description string    `json:"description,omitempty"`
	Status      string    `json:"status"`
	Priority    int       `json:"priority"`
	IssueType   string    `json:"issue_type"`
	Labels      []string  `json:"labels,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	CreatedBy   string    `json:"created_by,omitempty"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// NewClient creates a new beads client.
func NewClient(workDir string) *Client {
	return &Client{
		workDir: workDir,
		bdPath:  "bd", // Assumes bd is in PATH
	}
}

// SetBdPath sets a custom path to the bd binary (for testing).
func (c *Client) SetBdPath(path string) {
	c.bdPath = path
}

// Ready returns the list of ready tasks (no blockers).
func (c *Client) Ready(ctx context.Context) ([]types.Task, error) {
	output, err := c.runCommand(ctx, "ready", "--json")
	if err != nil {
		return nil, fmt.Errorf("bd ready failed: %w", err)
	}

	var beadsTasks []BeadsTask
	if err := json.Unmarshal(output, &beadsTasks); err != nil {
		return nil, fmt.Errorf("failed to parse bd ready output: %w", err)
	}

	tasks := make([]types.Task, len(beadsTasks))
	for i, bt := range beadsTasks {
		tasks[i] = convertBeadsTask(bt)
	}

	return tasks, nil
}

// UpdateStatus updates the status of a task.
func (c *Client) UpdateStatus(ctx context.Context, taskID string, status types.TaskStatus) error {
	statusStr := string(status)
	_, err := c.runCommand(ctx, "update", taskID, "--status="+statusStr)
	if err != nil {
		return fmt.Errorf("bd update failed: %w", err)
	}
	return nil
}

// Close closes a task.
func (c *Client) Close(ctx context.Context, taskID string) error {
	_, err := c.runCommand(ctx, "close", taskID)
	if err != nil {
		return fmt.Errorf("bd close failed: %w", err)
	}
	return nil
}

// Show returns details of a specific task.
func (c *Client) Show(ctx context.Context, taskID string) (*types.Task, error) {
	output, err := c.runCommand(ctx, "show", taskID, "--json")
	if err != nil {
		return nil, fmt.Errorf("bd show failed: %w", err)
	}

	var bt BeadsTask
	if err := json.Unmarshal(output, &bt); err != nil {
		return nil, fmt.Errorf("failed to parse bd show output: %w", err)
	}

	task := convertBeadsTask(bt)
	return &task, nil
}

// runCommand executes a bd command and returns the output.
func (c *Client) runCommand(ctx context.Context, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, c.bdPath, args...)
	cmd.Dir = c.workDir

	output, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return nil, fmt.Errorf("command failed: %s", string(exitErr.Stderr))
		}
		return nil, err
	}

	return output, nil
}

// convertBeadsTask converts a BeadsTask to types.Task.
func convertBeadsTask(bt BeadsTask) types.Task {
	return types.Task{
		ID:          bt.ID,
		Title:       bt.Title,
		Description: bt.Description,
		Status:      convertStatus(bt.Status),
		Priority:    bt.Priority,
		Type:        bt.IssueType,
		Labels:      bt.Labels,
		CreatedAt:   bt.CreatedAt,
		UpdatedAt:   bt.UpdatedAt,
	}
}

// convertStatus converts beads status string to TaskStatus.
func convertStatus(s string) types.TaskStatus {
	switch strings.ToLower(s) {
	case "open":
		return types.TaskStatusOpen
	case "in_progress":
		return types.TaskStatusInProgress
	case "closed":
		return types.TaskStatusClosed
	default:
		return types.TaskStatusOpen
	}
}
