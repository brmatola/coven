package grimoire

import (
	"strings"
	"testing"
	"time"
)

func TestValidStepTypes(t *testing.T) {
	types := ValidStepTypes()
	if len(types) != 4 {
		t.Errorf("Expected 4 valid step types, got %d", len(types))
	}

	expected := []StepType{StepTypeAgent, StepTypeScript, StepTypeLoop, StepTypeMerge}
	for i, typ := range expected {
		if types[i] != typ {
			t.Errorf("types[%d] = %q, want %q", i, types[i], typ)
		}
	}
}

func TestIsValidStepType(t *testing.T) {
	tests := []struct {
		stepType StepType
		valid    bool
	}{
		{StepTypeAgent, true},
		{StepTypeScript, true},
		{StepTypeLoop, true},
		{StepTypeMerge, true},
		{StepType("invalid"), false},
		{StepType(""), false},
	}

	for _, tt := range tests {
		t.Run(string(tt.stepType), func(t *testing.T) {
			if got := IsValidStepType(tt.stepType); got != tt.valid {
				t.Errorf("IsValidStepType(%q) = %v, want %v", tt.stepType, got, tt.valid)
			}
		})
	}
}

func TestStep_GetTimeout(t *testing.T) {
	tests := []struct {
		name     string
		step     Step
		expected time.Duration
		wantErr  bool
	}{
		{
			name:     "default agent timeout",
			step:     Step{Type: StepTypeAgent},
			expected: 15 * time.Minute,
		},
		{
			name:     "default script timeout",
			step:     Step{Type: StepTypeScript},
			expected: 5 * time.Minute,
		},
		{
			name:     "custom timeout",
			step:     Step{Type: StepTypeAgent, Timeout: "10m"},
			expected: 10 * time.Minute,
		},
		{
			name:     "timeout in seconds",
			step:     Step{Type: StepTypeScript, Timeout: "30s"},
			expected: 30 * time.Second,
		},
		{
			name:     "timeout in hours",
			step:     Step{Type: StepTypeLoop, Timeout: "1h"},
			expected: 1 * time.Hour,
		},
		{
			name:    "invalid timeout",
			step:    Step{Type: StepTypeAgent, Timeout: "invalid"},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := tt.step.GetTimeout()
			if tt.wantErr {
				if err == nil {
					t.Error("GetTimeout() should return error")
				}
				return
			}
			if err != nil {
				t.Errorf("GetTimeout() error: %v", err)
				return
			}
			if got != tt.expected {
				t.Errorf("GetTimeout() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestStep_RequiresReview(t *testing.T) {
	boolTrue := true
	boolFalse := false

	tests := []struct {
		name     string
		step     Step
		expected bool
	}{
		{
			name:     "nil defaults to true",
			step:     Step{},
			expected: true,
		},
		{
			name:     "explicit true",
			step:     Step{RequireReview: &boolTrue},
			expected: true,
		},
		{
			name:     "explicit false",
			step:     Step{RequireReview: &boolFalse},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.step.RequiresReview(); got != tt.expected {
				t.Errorf("RequiresReview() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestStep_Validate_Basic(t *testing.T) {
	tests := []struct {
		name    string
		step    Step
		wantErr bool
		errMsg  string
	}{
		{
			name:    "missing name",
			step:    Step{Type: StepTypeAgent, Spell: "test"},
			wantErr: true,
			errMsg:  "step name is required",
		},
		{
			name:    "missing type",
			step:    Step{Name: "test"},
			wantErr: true,
			errMsg:  "type is required",
		},
		{
			name:    "invalid type",
			step:    Step{Name: "test", Type: "invalid"},
			wantErr: true,
			errMsg:  "invalid step type",
		},
		{
			name:    "invalid timeout format",
			step:    Step{Name: "test", Type: StepTypeAgent, Spell: "x", Timeout: "bad"},
			wantErr: true,
			errMsg:  "invalid timeout",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.step.Validate()
			if tt.wantErr {
				if err == nil {
					t.Error("Validate() should return error")
					return
				}
				if !strings.Contains(err.Error(), tt.errMsg) {
					t.Errorf("Error = %q, want to contain %q", err.Error(), tt.errMsg)
				}
			} else if err != nil {
				t.Errorf("Validate() error: %v", err)
			}
		})
	}
}

func TestStep_Validate_AgentStep(t *testing.T) {
	tests := []struct {
		name    string
		step    Step
		wantErr bool
	}{
		{
			name:    "valid agent step",
			step:    Step{Name: "implement", Type: StepTypeAgent, Spell: "implement"},
			wantErr: false,
		},
		{
			name:    "missing spell",
			step:    Step{Name: "implement", Type: StepTypeAgent},
			wantErr: true,
		},
		{
			name:    "with input and output",
			step:    Step{Name: "review", Type: StepTypeAgent, Spell: "review", Input: map[string]string{"data": "x"}, Output: "findings"},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.step.Validate()
			if tt.wantErr && err == nil {
				t.Error("Validate() should return error")
			} else if !tt.wantErr && err != nil {
				t.Errorf("Validate() error: %v", err)
			}
		})
	}
}

func TestStep_Validate_ScriptStep(t *testing.T) {
	tests := []struct {
		name    string
		step    Step
		wantErr bool
		errMsg  string
	}{
		{
			name:    "valid script step",
			step:    Step{Name: "test", Type: StepTypeScript, Command: "npm test"},
			wantErr: false,
		},
		{
			name:    "missing command",
			step:    Step{Name: "test", Type: StepTypeScript},
			wantErr: true,
			errMsg:  "requires command",
		},
		{
			name:    "valid on_fail continue",
			step:    Step{Name: "test", Type: StepTypeScript, Command: "npm test", OnFail: "continue"},
			wantErr: false,
		},
		{
			name:    "valid on_fail block",
			step:    Step{Name: "test", Type: StepTypeScript, Command: "npm test", OnFail: "block"},
			wantErr: false,
		},
		{
			name:    "invalid on_fail",
			step:    Step{Name: "test", Type: StepTypeScript, Command: "npm test", OnFail: "invalid"},
			wantErr: true,
			errMsg:  "invalid on_fail",
		},
		{
			name:    "valid on_success exit_loop",
			step:    Step{Name: "test", Type: StepTypeScript, Command: "npm test", OnSuccess: "exit_loop"},
			wantErr: false,
		},
		{
			name:    "invalid on_success",
			step:    Step{Name: "test", Type: StepTypeScript, Command: "npm test", OnSuccess: "invalid"},
			wantErr: true,
			errMsg:  "invalid on_success",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.step.Validate()
			if tt.wantErr {
				if err == nil {
					t.Error("Validate() should return error")
					return
				}
				if tt.errMsg != "" && !strings.Contains(err.Error(), tt.errMsg) {
					t.Errorf("Error = %q, want to contain %q", err.Error(), tt.errMsg)
				}
			} else if err != nil {
				t.Errorf("Validate() error: %v", err)
			}
		})
	}
}

func TestStep_Validate_LoopStep(t *testing.T) {
	tests := []struct {
		name    string
		step    Step
		wantErr bool
		errMsg  string
	}{
		{
			name: "valid loop step",
			step: Step{
				Name: "quality-loop",
				Type: StepTypeLoop,
				Steps: []Step{
					{Name: "test", Type: StepTypeScript, Command: "npm test"},
				},
			},
			wantErr: false,
		},
		{
			name:    "no nested steps",
			step:    Step{Name: "loop", Type: StepTypeLoop},
			wantErr: true,
			errMsg:  "at least one nested step",
		},
		{
			name: "invalid nested step",
			step: Step{
				Name: "loop",
				Type: StepTypeLoop,
				Steps: []Step{
					{Name: "bad", Type: "invalid"},
				},
			},
			wantErr: true,
			errMsg:  "invalid step type",
		},
		{
			name: "with max_iterations",
			step: Step{
				Name:          "loop",
				Type:          StepTypeLoop,
				MaxIterations: 3,
				Steps: []Step{
					{Name: "test", Type: StepTypeScript, Command: "npm test"},
				},
			},
			wantErr: false,
		},
		{
			name: "negative max_iterations",
			step: Step{
				Name:          "loop",
				Type:          StepTypeLoop,
				MaxIterations: -1,
				Steps: []Step{
					{Name: "test", Type: StepTypeScript, Command: "npm test"},
				},
			},
			wantErr: true,
			errMsg:  "non-negative",
		},
		{
			name: "valid on_max_iterations block",
			step: Step{
				Name:            "loop",
				Type:            StepTypeLoop,
				OnMaxIterations: "block",
				Steps: []Step{
					{Name: "test", Type: StepTypeScript, Command: "npm test"},
				},
			},
			wantErr: false,
		},
		{
			name: "valid on_max_iterations exit",
			step: Step{
				Name:            "loop",
				Type:            StepTypeLoop,
				OnMaxIterations: "exit",
				Steps: []Step{
					{Name: "test", Type: StepTypeScript, Command: "npm test"},
				},
			},
			wantErr: false,
		},
		{
			name: "valid on_max_iterations continue",
			step: Step{
				Name:            "loop",
				Type:            StepTypeLoop,
				OnMaxIterations: "continue",
				Steps: []Step{
					{Name: "test", Type: StepTypeScript, Command: "npm test"},
				},
			},
			wantErr: false,
		},
		{
			name: "invalid on_max_iterations",
			step: Step{
				Name:            "loop",
				Type:            StepTypeLoop,
				OnMaxIterations: "invalid",
				Steps: []Step{
					{Name: "test", Type: StepTypeScript, Command: "npm test"},
				},
			},
			wantErr: true,
			errMsg:  "invalid on_max_iterations",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.step.Validate()
			if tt.wantErr {
				if err == nil {
					t.Error("Validate() should return error")
					return
				}
				if tt.errMsg != "" && !strings.Contains(err.Error(), tt.errMsg) {
					t.Errorf("Error = %q, want to contain %q", err.Error(), tt.errMsg)
				}
			} else if err != nil {
				t.Errorf("Validate() error: %v", err)
			}
		})
	}
}

func TestStep_Validate_MergeStep(t *testing.T) {
	boolFalse := false

	tests := []struct {
		name    string
		step    Step
		wantErr bool
	}{
		{
			name:    "valid merge step",
			step:    Step{Name: "merge", Type: StepTypeMerge},
			wantErr: false,
		},
		{
			name:    "with require_review false",
			step:    Step{Name: "merge", Type: StepTypeMerge, RequireReview: &boolFalse},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.step.Validate()
			if tt.wantErr && err == nil {
				t.Error("Validate() should return error")
			} else if !tt.wantErr && err != nil {
				t.Errorf("Validate() error: %v", err)
			}
		})
	}
}

func TestInvalidStepTypeError(t *testing.T) {
	err := &InvalidStepTypeError{
		StepName: "test-step",
		StepType: "invalid",
		Valid:    ValidStepTypes(),
	}

	msg := err.Error()
	if !strings.Contains(msg, "test-step") {
		t.Error("Error should contain step name")
	}
	if !strings.Contains(msg, "invalid") {
		t.Error("Error should contain invalid type")
	}
	if !strings.Contains(msg, "agent") {
		t.Error("Error should list valid types")
	}
}

func TestIsInvalidStepType(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		expected bool
	}{
		{
			name:     "InvalidStepTypeError",
			err:      &InvalidStepTypeError{StepName: "test"},
			expected: true,
		},
		{
			name:     "other error",
			err:      &ValidationError{Field: "test"},
			expected: false,
		},
		{
			name:     "nil",
			err:      nil,
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsInvalidStepType(tt.err); got != tt.expected {
				t.Errorf("IsInvalidStepType() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestGrimoireSource_Constants(t *testing.T) {
	if SourceBuiltIn != "builtin" {
		t.Errorf("SourceBuiltIn = %q, want %q", SourceBuiltIn, "builtin")
	}
	if SourceUser != "user" {
		t.Errorf("SourceUser = %q, want %q", SourceUser, "user")
	}
}

func TestStepType_Constants(t *testing.T) {
	if StepTypeAgent != "agent" {
		t.Errorf("StepTypeAgent = %q, want %q", StepTypeAgent, "agent")
	}
	if StepTypeScript != "script" {
		t.Errorf("StepTypeScript = %q, want %q", StepTypeScript, "script")
	}
	if StepTypeLoop != "loop" {
		t.Errorf("StepTypeLoop = %q, want %q", StepTypeLoop, "loop")
	}
	if StepTypeMerge != "merge" {
		t.Errorf("StepTypeMerge = %q, want %q", StepTypeMerge, "merge")
	}
}

func TestOnMaxIterationsAction_Constants(t *testing.T) {
	if OnMaxIterationsBlock != "block" {
		t.Errorf("OnMaxIterationsBlock = %q, want %q", OnMaxIterationsBlock, "block")
	}
	if OnMaxIterationsExit != "exit" {
		t.Errorf("OnMaxIterationsExit = %q, want %q", OnMaxIterationsExit, "exit")
	}
	if OnMaxIterationsContinue != "continue" {
		t.Errorf("OnMaxIterationsContinue = %q, want %q", OnMaxIterationsContinue, "continue")
	}
}

func TestGrimoire_GetTimeout(t *testing.T) {
	tests := []struct {
		name     string
		grimoire Grimoire
		expected time.Duration
		wantErr  bool
	}{
		{
			name:     "default timeout",
			grimoire: Grimoire{Name: "test"},
			expected: DefaultWorkflowTimeout,
		},
		{
			name:     "custom timeout 30m",
			grimoire: Grimoire{Name: "test", Timeout: "30m"},
			expected: 30 * time.Minute,
		},
		{
			name:     "custom timeout 2h",
			grimoire: Grimoire{Name: "test", Timeout: "2h"},
			expected: 2 * time.Hour,
		},
		{
			name:     "invalid timeout",
			grimoire: Grimoire{Name: "test", Timeout: "invalid"},
			wantErr:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := tt.grimoire.GetTimeout()
			if tt.wantErr {
				if err == nil {
					t.Error("GetTimeout() should return error")
				}
				return
			}
			if err != nil {
				t.Errorf("GetTimeout() error: %v", err)
				return
			}
			if got != tt.expected {
				t.Errorf("GetTimeout() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestGrimoire_Validate(t *testing.T) {
	tests := []struct {
		name    string
		g       Grimoire
		wantErr bool
		errMsg  string
	}{
		{
			name: "valid grimoire",
			g: Grimoire{
				Name: "test-workflow",
				Steps: []Step{
					{Name: "step1", Type: StepTypeScript, Command: "echo hello"},
				},
			},
			wantErr: false,
		},
		{
			name:    "missing name",
			g:       Grimoire{Steps: []Step{{Name: "step1", Type: StepTypeScript, Command: "echo"}}},
			wantErr: true,
			errMsg:  "grimoire name is required",
		},
		{
			name:    "no steps",
			g:       Grimoire{Name: "test"},
			wantErr: true,
			errMsg:  "at least one step is required",
		},
		{
			name: "invalid timeout",
			g: Grimoire{
				Name:    "test",
				Timeout: "invalid",
				Steps:   []Step{{Name: "step1", Type: StepTypeScript, Command: "echo"}},
			},
			wantErr: true,
			errMsg:  "invalid timeout",
		},
		{
			name: "invalid step",
			g: Grimoire{
				Name: "test",
				Steps: []Step{
					{Name: "step1", Type: "invalid"},
				},
			},
			wantErr: true,
			errMsg:  "invalid step type",
		},
		{
			name: "duplicate step names",
			g: Grimoire{
				Name: "test",
				Steps: []Step{
					{Name: "step1", Type: StepTypeScript, Command: "echo 1"},
					{Name: "step1", Type: StepTypeScript, Command: "echo 2"},
				},
			},
			wantErr: true,
			errMsg:  "duplicate step name",
		},
		{
			name: "with timeout",
			g: Grimoire{
				Name:    "test",
				Timeout: "30m",
				Steps: []Step{
					{Name: "step1", Type: StepTypeScript, Command: "echo hello"},
				},
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.g.Validate()
			if tt.wantErr {
				if err == nil {
					t.Error("Validate() should return error")
					return
				}
				if tt.errMsg != "" && !strings.Contains(err.Error(), tt.errMsg) {
					t.Errorf("Error = %q, want to contain %q", err.Error(), tt.errMsg)
				}
			} else if err != nil {
				t.Errorf("Validate() error: %v", err)
			}
		})
	}
}

func TestDefaultWorkflowTimeout(t *testing.T) {
	if DefaultWorkflowTimeout != 1*time.Hour {
		t.Errorf("DefaultWorkflowTimeout = %v, want %v", DefaultWorkflowTimeout, 1*time.Hour)
	}
}
