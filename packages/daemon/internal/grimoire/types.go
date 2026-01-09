package grimoire

import (
	"fmt"
	"time"
)

// Grimoire defines a workflow for processing beads.
type Grimoire struct {
	// Name is the unique identifier for this grimoire.
	Name string `yaml:"name"`

	// Description explains what this grimoire does.
	Description string `yaml:"description"`

	// Steps are the ordered steps to execute.
	Steps []Step `yaml:"steps"`

	// Source indicates where the grimoire was loaded from.
	Source GrimoireSource `yaml:"-"`
}

// GrimoireSource indicates the origin of a grimoire.
type GrimoireSource string

const (
	// SourceBuiltIn indicates the grimoire is built-in.
	SourceBuiltIn GrimoireSource = "builtin"

	// SourceUser indicates the grimoire was loaded from user's .coven/grimoires/.
	SourceUser GrimoireSource = "user"
)

// Step is a unit of work in a grimoire.
type Step struct {
	// Name is the unique identifier for this step within the grimoire.
	Name string `yaml:"name"`

	// Type specifies what kind of step this is.
	Type StepType `yaml:"type"`

	// Timeout is the maximum duration for this step.
	Timeout string `yaml:"timeout,omitempty"`

	// When is a condition that must be true for the step to execute.
	When string `yaml:"when,omitempty"`

	// For agent steps
	Spell  string            `yaml:"spell,omitempty"`  // Spell name or inline content
	Input  map[string]string `yaml:"input,omitempty"`  // Variables to pass to spell
	Output string            `yaml:"output,omitempty"` // Variable name to store output

	// For script steps
	Command   string `yaml:"command,omitempty"`    // Shell command to run
	OnFail    string `yaml:"on_fail,omitempty"`    // Action on failure: continue, block
	OnSuccess string `yaml:"on_success,omitempty"` // Action on success: exit_loop

	// For loop steps
	Steps            []Step `yaml:"steps,omitempty"`             // Nested steps for loops
	MaxIterations    int    `yaml:"max_iterations,omitempty"`    // Maximum loop iterations
	OnMaxIterations  string `yaml:"on_max_iterations,omitempty"` // Action when max reached: block

	// For merge steps
	RequireReview *bool `yaml:"require_review,omitempty"` // Default: true
}

// StepType defines the type of a workflow step.
type StepType string

const (
	// StepTypeAgent invokes an agent with a spell.
	StepTypeAgent StepType = "agent"

	// StepTypeScript runs a shell command.
	StepTypeScript StepType = "script"

	// StepTypeLoop repeats nested steps until condition or max iterations.
	StepTypeLoop StepType = "loop"

	// StepTypeMerge merges worktree changes back to main repo.
	StepTypeMerge StepType = "merge"
)

// ValidStepTypes returns all valid step types.
func ValidStepTypes() []StepType {
	return []StepType{StepTypeAgent, StepTypeScript, StepTypeLoop, StepTypeMerge}
}

// IsValidStepType checks if a step type is valid.
func IsValidStepType(t StepType) bool {
	for _, valid := range ValidStepTypes() {
		if t == valid {
			return true
		}
	}
	return false
}

// OnFailAction defines actions for script step failures.
type OnFailAction string

const (
	OnFailContinue OnFailAction = "continue"
	OnFailBlock    OnFailAction = "block"
)

// OnSuccessAction defines actions for script step success.
type OnSuccessAction string

const (
	OnSuccessExitLoop OnSuccessAction = "exit_loop"
)

// GetTimeout returns the timeout as a time.Duration.
// Returns the default timeout for the step type if not specified.
func (s *Step) GetTimeout() (time.Duration, error) {
	if s.Timeout == "" {
		return s.DefaultTimeout(), nil
	}
	return time.ParseDuration(s.Timeout)
}

// DefaultTimeout returns the default timeout for a step type.
func (s *Step) DefaultTimeout() time.Duration {
	switch s.Type {
	case StepTypeAgent:
		return 15 * time.Minute
	case StepTypeScript:
		return 5 * time.Minute
	default:
		return 5 * time.Minute
	}
}

// RequiresReview returns whether the merge step requires human review.
func (s *Step) RequiresReview() bool {
	if s.RequireReview == nil {
		return true // Default to requiring review
	}
	return *s.RequireReview
}

// Validate validates the step configuration.
func (s *Step) Validate() error {
	if s.Name == "" {
		return fmt.Errorf("step name is required")
	}

	if s.Type == "" {
		return fmt.Errorf("step %q: type is required", s.Name)
	}

	if !IsValidStepType(s.Type) {
		return &InvalidStepTypeError{
			StepName: s.Name,
			StepType: string(s.Type),
			Valid:    ValidStepTypes(),
		}
	}

	// Validate timeout if specified
	if s.Timeout != "" {
		if _, err := time.ParseDuration(s.Timeout); err != nil {
			return fmt.Errorf("step %q: invalid timeout %q: %w", s.Name, s.Timeout, err)
		}
	}

	// Type-specific validation
	switch s.Type {
	case StepTypeAgent:
		return s.validateAgentStep()
	case StepTypeScript:
		return s.validateScriptStep()
	case StepTypeLoop:
		return s.validateLoopStep()
	case StepTypeMerge:
		return s.validateMergeStep()
	}

	return nil
}

func (s *Step) validateAgentStep() error {
	if s.Spell == "" {
		return fmt.Errorf("step %q: agent step requires spell field", s.Name)
	}
	return nil
}

func (s *Step) validateScriptStep() error {
	if s.Command == "" {
		return fmt.Errorf("step %q: script step requires command field", s.Name)
	}

	// Validate on_fail if specified
	if s.OnFail != "" && s.OnFail != string(OnFailContinue) && s.OnFail != string(OnFailBlock) {
		return fmt.Errorf("step %q: invalid on_fail value %q, must be %q or %q",
			s.Name, s.OnFail, OnFailContinue, OnFailBlock)
	}

	// Validate on_success if specified
	if s.OnSuccess != "" && s.OnSuccess != string(OnSuccessExitLoop) {
		return fmt.Errorf("step %q: invalid on_success value %q, must be %q",
			s.Name, s.OnSuccess, OnSuccessExitLoop)
	}

	return nil
}

func (s *Step) validateLoopStep() error {
	if len(s.Steps) == 0 {
		return fmt.Errorf("step %q: loop step requires at least one nested step", s.Name)
	}

	// Validate max_iterations if specified
	if s.MaxIterations < 0 {
		return fmt.Errorf("step %q: max_iterations must be non-negative", s.Name)
	}

	// Validate on_max_iterations if specified
	if s.OnMaxIterations != "" && s.OnMaxIterations != string(OnFailBlock) {
		return fmt.Errorf("step %q: invalid on_max_iterations value %q, must be %q",
			s.Name, s.OnMaxIterations, OnFailBlock)
	}

	// Validate nested steps
	for i := range s.Steps {
		if err := s.Steps[i].Validate(); err != nil {
			return fmt.Errorf("step %q nested step %d: %w", s.Name, i, err)
		}
	}

	return nil
}

func (s *Step) validateMergeStep() error {
	// Merge step has no required fields beyond name and type
	// require_review defaults to true if not specified
	return nil
}

// InvalidStepTypeError is returned when a step has an invalid type.
type InvalidStepTypeError struct {
	StepName string
	StepType string
	Valid    []StepType
}

func (e *InvalidStepTypeError) Error() string {
	validStrs := make([]string, len(e.Valid))
	for i, v := range e.Valid {
		validStrs[i] = string(v)
	}
	return fmt.Sprintf("step %q: invalid step type %q, must be one of: %v",
		e.StepName, e.StepType, validStrs)
}

// IsInvalidStepType returns true if the error is an InvalidStepTypeError.
func IsInvalidStepType(err error) bool {
	_, ok := err.(*InvalidStepTypeError)
	return ok
}
