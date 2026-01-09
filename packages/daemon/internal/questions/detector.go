// Package questions provides question detection and handling for agent output.
package questions

import (
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/coven/daemon/internal/agent"
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

// Question represents a detected question from agent output.
type Question struct {
	ID          string       `json:"id"`
	TaskID      string       `json:"task_id"`
	Type        QuestionType `json:"type"`
	Text        string       `json:"text"`
	Context     string       `json:"context,omitempty"`
	Options     []string     `json:"options,omitempty"`
	Sequence    uint64       `json:"sequence"`
	DetectedAt  time.Time    `json:"detected_at"`
	AnsweredAt  *time.Time   `json:"answered_at,omitempty"`
	Answer      string       `json:"answer,omitempty"`
}

// Detector detects questions in agent output.
type Detector struct {
	mu               sync.RWMutex
	questions        map[string]*Question
	questionsByTask  map[string][]*Question
	nextID           int
	onQuestion       func(*Question)

	// Patterns for question detection
	confirmationPattern *regexp.Regexp
	choicePattern       *regexp.Regexp
	permissionPattern   *regexp.Regexp
	questionPattern     *regexp.Regexp
}

// NewDetector creates a new question detector.
func NewDetector() *Detector {
	return &Detector{
		questions:       make(map[string]*Question),
		questionsByTask: make(map[string][]*Question),

		// Patterns for different question types
		confirmationPattern: regexp.MustCompile(`(?i)(proceed|continue|confirm|yes/no|y/n|\(y/n\))\??\s*\)?$`),
		choicePattern:       regexp.MustCompile(`(?i)(?:select|choose|which|option)\s*(?:\[|\()?[\d\w,\s/]+(?:\]|\))?\s*[:?]?\s*$`),
		permissionPattern:   regexp.MustCompile(`(?i)(allow|permission|authorize|grant access|approve|access)\?$`),
		questionPattern:     regexp.MustCompile(`\?\s*$`),
	}
}

// OnQuestion sets a callback for when questions are detected.
func (d *Detector) OnQuestion(fn func(*Question)) {
	d.mu.Lock()
	d.onQuestion = fn
	d.mu.Unlock()
}

// ProcessLine processes an output line and detects questions.
func (d *Detector) ProcessLine(taskID string, line agent.OutputLine) *Question {
	// Only check stdout
	if line.Stream != "stdout" {
		return nil
	}

	text := strings.TrimSpace(line.Data)
	if text == "" {
		return nil
	}

	// Check if this looks like a question
	qType := d.detectQuestionType(text)
	if qType == "" {
		return nil
	}

	d.mu.Lock()
	defer d.mu.Unlock()

	d.nextID++
	q := &Question{
		ID:         generateQuestionID(d.nextID),
		TaskID:     taskID,
		Type:       qType,
		Text:       text,
		Sequence:   line.Sequence,
		DetectedAt: time.Now(),
	}

	// Extract options if it's a choice question
	if qType == QuestionTypeChoice {
		q.Options = extractOptions(text)
	}

	d.questions[q.ID] = q
	d.questionsByTask[taskID] = append(d.questionsByTask[taskID], q)

	if d.onQuestion != nil {
		go d.onQuestion(q)
	}

	return q
}

func (d *Detector) detectQuestionType(text string) QuestionType {
	// Check specific patterns first
	if d.confirmationPattern.MatchString(text) {
		return QuestionTypeConfirmation
	}
	if d.permissionPattern.MatchString(text) {
		return QuestionTypePermission
	}
	if d.choicePattern.MatchString(text) {
		return QuestionTypeChoice
	}

	// Generic question pattern
	if d.questionPattern.MatchString(text) {
		return QuestionTypeInput
	}

	return ""
}

// GetQuestion returns a question by ID.
func (d *Detector) GetQuestion(id string) *Question {
	d.mu.RLock()
	defer d.mu.RUnlock()

	if q, ok := d.questions[id]; ok {
		copy := *q
		return &copy
	}
	return nil
}

// GetPendingQuestions returns all unanswered questions.
func (d *Detector) GetPendingQuestions() []*Question {
	d.mu.RLock()
	defer d.mu.RUnlock()

	var pending []*Question
	for _, q := range d.questions {
		if q.AnsweredAt == nil {
			copy := *q
			pending = append(pending, &copy)
		}
	}
	return pending
}

// GetPendingQuestionsForTask returns unanswered questions for a specific task.
func (d *Detector) GetPendingQuestionsForTask(taskID string) []*Question {
	d.mu.RLock()
	defer d.mu.RUnlock()

	var pending []*Question
	for _, q := range d.questionsByTask[taskID] {
		if q.AnsweredAt == nil {
			copy := *q
			pending = append(pending, &copy)
		}
	}
	return pending
}

// AnswerQuestion marks a question as answered.
func (d *Detector) AnswerQuestion(id string, answer string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	q, ok := d.questions[id]
	if !ok {
		return nil // Question not found
	}

	now := time.Now()
	q.AnsweredAt = &now
	q.Answer = answer

	return nil
}

// ClearTaskQuestions removes all questions for a task.
func (d *Detector) ClearTaskQuestions(taskID string) {
	d.mu.Lock()
	defer d.mu.Unlock()

	for _, q := range d.questionsByTask[taskID] {
		delete(d.questions, q.ID)
	}
	delete(d.questionsByTask, taskID)
}

// Count returns the total number of questions.
func (d *Detector) Count() int {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return len(d.questions)
}

// PendingCount returns the number of pending questions.
func (d *Detector) PendingCount() int {
	d.mu.RLock()
	defer d.mu.RUnlock()

	count := 0
	for _, q := range d.questions {
		if q.AnsweredAt == nil {
			count++
		}
	}
	return count
}

// generateQuestionID generates a unique question ID.
func generateQuestionID(n int) string {
	return "q-" + time.Now().Format("20060102150405") + "-" + intToString(n)
}

func intToString(n int) string {
	if n == 0 {
		return "0"
	}
	result := ""
	for n > 0 {
		result = string(rune('0'+n%10)) + result
		n /= 10
	}
	return result
}

// extractOptions attempts to extract options from choice text.
func extractOptions(text string) []string {
	// Look for patterns like [1/2/3], (a/b/c), 1. option 2. option, etc.
	patterns := []*regexp.Regexp{
		regexp.MustCompile(`\[([^\]]+)\]`),
		regexp.MustCompile(`\(([^)]+)\)`),
	}

	for _, p := range patterns {
		if matches := p.FindStringSubmatch(text); len(matches) > 1 {
			// Split by common delimiters
			parts := regexp.MustCompile(`[/,|]`).Split(matches[1], -1)
			var options []string
			for _, part := range parts {
				trimmed := strings.TrimSpace(part)
				if trimmed != "" {
					options = append(options, trimmed)
				}
			}
			if len(options) > 0 {
				return options
			}
		}
	}

	return nil
}
