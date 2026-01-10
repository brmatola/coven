// Package questions provides workflow-aware question handling for agent interactions.
package questions

import (
	"time"
)

// QuestionType categorizes questions.
type QuestionType string

const (
	QuestionTypeConfirmation QuestionType = "confirmation"
	QuestionTypeChoice       QuestionType = "choice"
	QuestionTypeInput        QuestionType = "input"
	QuestionTypePermission   QuestionType = "permission"
	QuestionTypeUnknown      QuestionType = "unknown"
)

// WorkflowContext provides workflow context for a question.
type WorkflowContext struct {
	WorkflowID string `json:"workflow_id,omitempty"`
	StepName   string `json:"step_name,omitempty"`
	StepIndex  int    `json:"step_index"`
	StepTaskID string `json:"step_task_id"` // The step-specific task ID for stdin delivery
}

// Question represents a detected question from agent output with full workflow context.
type Question struct {
	ID          string          `json:"id"`
	TaskID      string          `json:"task_id"`       // Main bead/task ID
	Context     WorkflowContext `json:"context"`       // Workflow context for this question
	Type        QuestionType    `json:"type"`
	Text        string          `json:"text"`
	RawContext  string          `json:"raw_context,omitempty"` // Additional context from surrounding output
	Options     []string        `json:"options,omitempty"`
	Sequence    uint64          `json:"sequence"`
	DetectedAt  time.Time       `json:"detected_at"`
	AnsweredAt  *time.Time      `json:"answered_at,omitempty"`
	Answer      string          `json:"answer,omitempty"`
	DeliveredAt *time.Time      `json:"delivered_at,omitempty"` // When answer was sent to stdin
	Error       string          `json:"error,omitempty"`        // Error if answer delivery failed
}

// IsPending returns true if the question has not been answered.
func (q *Question) IsPending() bool {
	return q.AnsweredAt == nil
}

// IsDelivered returns true if the answer has been delivered to the agent.
func (q *Question) IsDelivered() bool {
	return q.DeliveredAt != nil
}
