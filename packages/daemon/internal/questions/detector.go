package questions

import (
	"regexp"
	"strings"
	"sync/atomic"
	"time"
)

// DetectionContext provides context for question detection.
type DetectionContext struct {
	TaskID     string // Main bead/task ID
	WorkflowID string // Workflow ID (if running in workflow)
	StepName   string // Step name (if running in workflow)
	StepIndex  int    // Step index (if running in workflow)
	StepTaskID string // Step-specific task ID (for stdin delivery)
}

// Detector detects questions in agent output.
type Detector struct {
	nextID uint64

	// Patterns for question detection
	confirmationPattern *regexp.Regexp
	choicePattern       *regexp.Regexp
	permissionPattern   *regexp.Regexp
	questionPattern     *regexp.Regexp

	// Callbacks
	onQuestion func(*Question)
}

// NewDetector creates a new question detector.
func NewDetector() *Detector {
	return &Detector{
		// Patterns for different question types
		confirmationPattern: regexp.MustCompile(`(?i)(proceed|continue|confirm|yes/no|y/n|\(y/n\))\??\s*\)?$`),
		choicePattern:       regexp.MustCompile(`(?i)(?:select|choose|which|option)\s*(?:\[|\()?[\d\w,\s/]+(?:\]|\))?\s*[:?]?\s*$`),
		permissionPattern:   regexp.MustCompile(`(?i)(allow|permission|authorize|grant access|approve|access)\?$`),
		questionPattern:     regexp.MustCompile(`\?\s*$`),
	}
}

// OnQuestion sets a callback for when questions are detected.
func (d *Detector) OnQuestion(fn func(*Question)) {
	d.onQuestion = fn
}

// ProcessLine processes an output line and detects questions.
// Returns the detected question or nil if no question was found.
func (d *Detector) ProcessLine(ctx DetectionContext, stream string, text string, sequence uint64) *Question {
	// Only check stdout
	if stream != "stdout" {
		return nil
	}

	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}

	// Check if this looks like a question
	qType := d.detectQuestionType(text)
	if qType == "" {
		return nil
	}

	q := &Question{
		ID:       d.generateID(),
		TaskID:   ctx.TaskID,
		Context: WorkflowContext{
			WorkflowID: ctx.WorkflowID,
			StepName:   ctx.StepName,
			StepIndex:  ctx.StepIndex,
			StepTaskID: ctx.StepTaskID,
		},
		Type:       qType,
		Text:       text,
		Sequence:   sequence,
		DetectedAt: time.Now(),
	}

	// Extract options if it's a choice question
	if qType == QuestionTypeChoice {
		q.Options = extractOptions(text)
	}

	if d.onQuestion != nil {
		d.onQuestion(q)
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

func (d *Detector) generateID() string {
	n := atomic.AddUint64(&d.nextID, 1)
	return "q-" + time.Now().Format("20060102150405") + "-" + uintToString(n)
}

func uintToString(n uint64) string {
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

// ParseStepTaskID extracts the main task ID from a step-specific task ID.
// Step task IDs have the format "{taskID}-step-{N}".
// Returns the original ID if it doesn't match the pattern.
func ParseStepTaskID(stepTaskID string) (mainTaskID string, isStepTask bool) {
	// Look for "-step-" suffix
	idx := strings.LastIndex(stepTaskID, "-step-")
	if idx == -1 {
		return stepTaskID, false
	}

	// Check that what follows is a number
	suffix := stepTaskID[idx+6:] // Skip "-step-"
	for _, c := range suffix {
		if c < '0' || c > '9' {
			return stepTaskID, false
		}
	}

	return stepTaskID[:idx], true
}
