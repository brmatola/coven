package questions

import (
	"sync"
	"testing"
	"time"

	"github.com/coven/daemon/internal/agent"
)

func TestNewDetector(t *testing.T) {
	d := NewDetector()
	if d == nil {
		t.Fatal("NewDetector() returned nil")
	}
	if d.Count() != 0 {
		t.Errorf("Count() = %d, want 0", d.Count())
	}
}

func TestDetectorProcessLine(t *testing.T) {
	tests := []struct {
		name     string
		line     agent.OutputLine
		wantType QuestionType
		wantNil  bool
	}{
		{
			name: "confirmation question",
			line: agent.OutputLine{
				Sequence: 1,
				Stream:   "stdout",
				Data:     "Do you want to proceed?",
			},
			wantType: QuestionTypeConfirmation,
		},
		{
			name: "yes/no question",
			line: agent.OutputLine{
				Sequence: 2,
				Stream:   "stdout",
				Data:     "Continue with changes? (y/n)",
			},
			wantType: QuestionTypeConfirmation,
		},
		{
			name: "choice question",
			line: agent.OutputLine{
				Sequence: 3,
				Stream:   "stdout",
				Data:     "Select an option [1/2/3]:",
			},
			wantType: QuestionTypeChoice,
		},
		{
			name: "permission question",
			line: agent.OutputLine{
				Sequence: 4,
				Stream:   "stdout",
				Data:     "Allow file access?",
			},
			wantType: QuestionTypePermission,
		},
		{
			name: "generic question",
			line: agent.OutputLine{
				Sequence: 5,
				Stream:   "stdout",
				Data:     "What is your name?",
			},
			wantType: QuestionTypeInput,
		},
		{
			name: "not a question",
			line: agent.OutputLine{
				Sequence: 6,
				Stream:   "stdout",
				Data:     "Processing files...",
			},
			wantNil: true,
		},
		{
			name: "stderr ignored",
			line: agent.OutputLine{
				Sequence: 7,
				Stream:   "stderr",
				Data:     "Error occurred?",
			},
			wantNil: true,
		},
		{
			name: "empty line",
			line: agent.OutputLine{
				Sequence: 8,
				Stream:   "stdout",
				Data:     "",
			},
			wantNil: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d := NewDetector()
			q := d.ProcessLine("task-1", tt.line)

			if tt.wantNil {
				if q != nil {
					t.Errorf("ProcessLine() = %v, want nil", q)
				}
				return
			}

			if q == nil {
				t.Fatal("ProcessLine() returned nil, want question")
			}

			if q.Type != tt.wantType {
				t.Errorf("Type = %q, want %q", q.Type, tt.wantType)
			}

			if q.TaskID != "task-1" {
				t.Errorf("TaskID = %q, want %q", q.TaskID, "task-1")
			}
		})
	}
}

func TestDetectorGetQuestion(t *testing.T) {
	d := NewDetector()

	// Process a question
	q := d.ProcessLine("task-1", agent.OutputLine{
		Sequence: 1,
		Stream:   "stdout",
		Data:     "Continue?",
	})

	if q == nil {
		t.Fatal("ProcessLine() returned nil")
	}

	// Get the question
	retrieved := d.GetQuestion(q.ID)
	if retrieved == nil {
		t.Fatal("GetQuestion() returned nil")
	}

	if retrieved.ID != q.ID {
		t.Errorf("ID = %q, want %q", retrieved.ID, q.ID)
	}

	// Get non-existent question
	if d.GetQuestion("nonexistent") != nil {
		t.Error("GetQuestion() should return nil for nonexistent ID")
	}
}

func TestDetectorGetPendingQuestions(t *testing.T) {
	d := NewDetector()

	// Add some questions
	d.ProcessLine("task-1", agent.OutputLine{
		Sequence: 1,
		Stream:   "stdout",
		Data:     "Question 1?",
	})
	q2 := d.ProcessLine("task-2", agent.OutputLine{
		Sequence: 2,
		Stream:   "stdout",
		Data:     "Question 2?",
	})

	pending := d.GetPendingQuestions()
	if len(pending) != 2 {
		t.Errorf("GetPendingQuestions() = %d questions, want 2", len(pending))
	}

	// Answer one
	d.AnswerQuestion(q2.ID, "yes")

	pending = d.GetPendingQuestions()
	if len(pending) != 1 {
		t.Errorf("GetPendingQuestions() after answer = %d questions, want 1", len(pending))
	}
}

func TestDetectorGetPendingQuestionsForTask(t *testing.T) {
	d := NewDetector()

	// Add questions for different tasks
	d.ProcessLine("task-1", agent.OutputLine{
		Sequence: 1,
		Stream:   "stdout",
		Data:     "Question 1?",
	})
	d.ProcessLine("task-1", agent.OutputLine{
		Sequence: 2,
		Stream:   "stdout",
		Data:     "Question 2?",
	})
	d.ProcessLine("task-2", agent.OutputLine{
		Sequence: 3,
		Stream:   "stdout",
		Data:     "Question 3?",
	})

	task1Questions := d.GetPendingQuestionsForTask("task-1")
	if len(task1Questions) != 2 {
		t.Errorf("GetPendingQuestionsForTask(task-1) = %d, want 2", len(task1Questions))
	}

	task2Questions := d.GetPendingQuestionsForTask("task-2")
	if len(task2Questions) != 1 {
		t.Errorf("GetPendingQuestionsForTask(task-2) = %d, want 1", len(task2Questions))
	}
}

func TestDetectorAnswerQuestion(t *testing.T) {
	d := NewDetector()

	q := d.ProcessLine("task-1", agent.OutputLine{
		Sequence: 1,
		Stream:   "stdout",
		Data:     "Continue?",
	})

	if q.AnsweredAt != nil {
		t.Error("AnsweredAt should be nil initially")
	}

	d.AnswerQuestion(q.ID, "yes")

	updated := d.GetQuestion(q.ID)
	if updated.AnsweredAt == nil {
		t.Error("AnsweredAt should be set after answer")
	}
	if updated.Answer != "yes" {
		t.Errorf("Answer = %q, want %q", updated.Answer, "yes")
	}
}

func TestDetectorClearTaskQuestions(t *testing.T) {
	d := NewDetector()

	d.ProcessLine("task-1", agent.OutputLine{
		Sequence: 1,
		Stream:   "stdout",
		Data:     "Question 1?",
	})
	d.ProcessLine("task-2", agent.OutputLine{
		Sequence: 2,
		Stream:   "stdout",
		Data:     "Question 2?",
	})

	if d.Count() != 2 {
		t.Errorf("Count() = %d, want 2", d.Count())
	}

	d.ClearTaskQuestions("task-1")

	if d.Count() != 1 {
		t.Errorf("Count() after clear = %d, want 1", d.Count())
	}

	task1Questions := d.GetPendingQuestionsForTask("task-1")
	if len(task1Questions) != 0 {
		t.Errorf("task-1 questions = %d, want 0", len(task1Questions))
	}
}

func TestDetectorCount(t *testing.T) {
	d := NewDetector()

	if d.Count() != 0 {
		t.Errorf("Count() = %d, want 0", d.Count())
	}

	d.ProcessLine("task-1", agent.OutputLine{
		Sequence: 1,
		Stream:   "stdout",
		Data:     "Question?",
	})

	if d.Count() != 1 {
		t.Errorf("Count() = %d, want 1", d.Count())
	}
}

func TestDetectorPendingCount(t *testing.T) {
	d := NewDetector()

	q := d.ProcessLine("task-1", agent.OutputLine{
		Sequence: 1,
		Stream:   "stdout",
		Data:     "Question?",
	})

	if d.PendingCount() != 1 {
		t.Errorf("PendingCount() = %d, want 1", d.PendingCount())
	}

	d.AnswerQuestion(q.ID, "yes")

	if d.PendingCount() != 0 {
		t.Errorf("PendingCount() after answer = %d, want 0", d.PendingCount())
	}
}

func TestDetectorOnQuestion(t *testing.T) {
	d := NewDetector()

	var received *Question
	var mu sync.Mutex
	d.OnQuestion(func(q *Question) {
		mu.Lock()
		received = q
		mu.Unlock()
	})

	d.ProcessLine("task-1", agent.OutputLine{
		Sequence: 1,
		Stream:   "stdout",
		Data:     "Continue?",
	})

	// Wait for callback
	time.Sleep(50 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	if received == nil {
		t.Error("OnQuestion callback not called")
	}
}

func TestExtractOptions(t *testing.T) {
	tests := []struct {
		text    string
		want    []string
		wantNil bool
	}{
		{
			text: "Select [1/2/3]",
			want: []string{"1", "2", "3"},
		},
		{
			text: "Choose (a, b, c)",
			want: []string{"a", "b", "c"},
		},
		{
			text: "Pick [yes/no]",
			want: []string{"yes", "no"},
		},
		{
			text:    "No options here",
			wantNil: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.text, func(t *testing.T) {
			got := extractOptions(tt.text)
			if tt.wantNil {
				if got != nil {
					t.Errorf("extractOptions() = %v, want nil", got)
				}
				return
			}
			if len(got) != len(tt.want) {
				t.Errorf("extractOptions() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestDetectorConcurrency(t *testing.T) {
	d := NewDetector()

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				d.ProcessLine("task-1", agent.OutputLine{
					Sequence: uint64(n*100 + j),
					Stream:   "stdout",
					Data:     "Question?",
				})
			}
		}(i)
	}

	// Also read concurrently
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				d.GetPendingQuestions()
				d.Count()
			}
		}()
	}

	wg.Wait()

	// Should have processed all questions without panic
	if d.Count() == 0 {
		t.Error("Count should be > 0 after concurrent processing")
	}
}
