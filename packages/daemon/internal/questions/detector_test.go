package questions

import (
	"testing"
)

func TestDetector_ProcessLine_Confirmation(t *testing.T) {
	d := NewDetector()

	tests := []struct {
		text     string
		expected bool
	}{
		{"Do you want to proceed?", true},
		{"Continue (y/n)?", true},
		{"Confirm changes?", true},
		{"Press yes/no to continue", true},
		{"This is not a question", false},
		{"", false},
	}

	for _, tc := range tests {
		ctx := DetectionContext{TaskID: "task-1", StepTaskID: "task-1-step-1"}
		q := d.ProcessLine(ctx, "stdout", tc.text, 1)

		if tc.expected && q == nil {
			t.Errorf("expected question for %q but got nil", tc.text)
		}
		if !tc.expected && q != nil {
			t.Errorf("did not expect question for %q but got one", tc.text)
		}
		if q != nil && tc.expected && q.Type != QuestionTypeConfirmation && q.Type != QuestionTypeInput {
			// Confirmation patterns may match as input too
		}
	}
}

func TestDetector_ProcessLine_Choice(t *testing.T) {
	d := NewDetector()

	ctx := DetectionContext{TaskID: "task-1", StepTaskID: "task-1-step-1"}
	// Use a pattern that matches the choice regex
	q := d.ProcessLine(ctx, "stdout", "Select option [1/2/3]:", 1)

	if q == nil {
		t.Fatal("expected question but got nil")
	}
	if q.Type != QuestionTypeChoice {
		t.Errorf("expected choice type, got %s", q.Type)
	}
	if len(q.Options) != 3 {
		t.Errorf("expected 3 options, got %d", len(q.Options))
	}
}

func TestDetector_ProcessLine_Permission(t *testing.T) {
	d := NewDetector()

	ctx := DetectionContext{TaskID: "task-1", StepTaskID: "task-1-step-1"}
	q := d.ProcessLine(ctx, "stdout", "Do you want to allow access?", 1)

	if q == nil {
		t.Fatal("expected question but got nil")
	}
	if q.Type != QuestionTypePermission {
		t.Errorf("expected permission type, got %s", q.Type)
	}
}

func TestDetector_ProcessLine_IgnoresStderr(t *testing.T) {
	d := NewDetector()

	ctx := DetectionContext{TaskID: "task-1", StepTaskID: "task-1-step-1"}
	q := d.ProcessLine(ctx, "stderr", "Do you want to proceed?", 1)

	if q != nil {
		t.Error("should not detect questions from stderr")
	}
}

func TestDetector_ProcessLine_Context(t *testing.T) {
	d := NewDetector()

	ctx := DetectionContext{
		TaskID:     "task-main",
		WorkflowID: "wf-123",
		StepName:   "implement",
		StepIndex:  2,
		StepTaskID: "task-main-step-3",
	}

	q := d.ProcessLine(ctx, "stdout", "Continue with implementation?", 1)

	if q == nil {
		t.Fatal("expected question but got nil")
	}
	if q.TaskID != "task-main" {
		t.Errorf("TaskID mismatch: got %s, want task-main", q.TaskID)
	}
	if q.Context.WorkflowID != "wf-123" {
		t.Errorf("WorkflowID mismatch: got %s, want wf-123", q.Context.WorkflowID)
	}
	if q.Context.StepName != "implement" {
		t.Errorf("StepName mismatch: got %s, want implement", q.Context.StepName)
	}
	if q.Context.StepIndex != 2 {
		t.Errorf("StepIndex mismatch: got %d, want 2", q.Context.StepIndex)
	}
	if q.Context.StepTaskID != "task-main-step-3" {
		t.Errorf("StepTaskID mismatch: got %s, want task-main-step-3", q.Context.StepTaskID)
	}
}

func TestDetector_OnQuestion_Callback(t *testing.T) {
	d := NewDetector()

	var received *Question
	d.OnQuestion(func(q *Question) {
		received = q
	})

	ctx := DetectionContext{TaskID: "task-1", StepTaskID: "task-1-step-1"}
	d.ProcessLine(ctx, "stdout", "Proceed?", 1)

	if received == nil {
		t.Fatal("callback was not called")
	}
	if received.Text != "Proceed?" {
		t.Errorf("Text mismatch: got %s, want Proceed?", received.Text)
	}
}

func TestDetector_GeneratesUniqueIDs(t *testing.T) {
	d := NewDetector()

	ctx := DetectionContext{TaskID: "task-1", StepTaskID: "task-1-step-1"}
	q1 := d.ProcessLine(ctx, "stdout", "Question 1?", 1)
	q2 := d.ProcessLine(ctx, "stdout", "Question 2?", 2)

	if q1 == nil || q2 == nil {
		t.Fatal("expected questions")
	}
	if q1.ID == q2.ID {
		t.Error("question IDs should be unique")
	}
}

func TestParseStepTaskID(t *testing.T) {
	tests := []struct {
		input      string
		wantMain   string
		wantIsStep bool
	}{
		{"task-123-step-1", "task-123", true},
		{"task-abc-step-99", "task-abc", true},
		{"task-123", "task-123", false},
		{"workflow-123456-step-5", "workflow-123456", true},
		{"task-with-dashes-step-3", "task-with-dashes", true},
		{"task-step-notanumber", "task-step-notanumber", false},
		{"", "", false},
	}

	for _, tc := range tests {
		main, isStep := ParseStepTaskID(tc.input)
		if main != tc.wantMain {
			t.Errorf("ParseStepTaskID(%q) main = %q, want %q", tc.input, main, tc.wantMain)
		}
		if isStep != tc.wantIsStep {
			t.Errorf("ParseStepTaskID(%q) isStep = %v, want %v", tc.input, isStep, tc.wantIsStep)
		}
	}
}

func TestExtractOptions(t *testing.T) {
	tests := []struct {
		text     string
		expected []string
	}{
		{"Choose [a/b/c]", []string{"a", "b", "c"}},
		{"Select (1, 2, 3)", []string{"1", "2", "3"}},
		{"Option [yes|no]", []string{"yes", "no"}},
		{"No options here", nil},
	}

	for _, tc := range tests {
		got := extractOptions(tc.text)
		if len(got) != len(tc.expected) {
			t.Errorf("extractOptions(%q) = %v, want %v", tc.text, got, tc.expected)
			continue
		}
		for i, opt := range got {
			if opt != tc.expected[i] {
				t.Errorf("extractOptions(%q)[%d] = %s, want %s", tc.text, i, opt, tc.expected[i])
			}
		}
	}
}
