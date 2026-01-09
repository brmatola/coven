package agent

import (
	"sync"
	"testing"
)

func TestNewRingBuffer(t *testing.T) {
	tests := []struct {
		name    string
		maxSize int
		want    int
	}{
		{"default size", 0, DefaultMaxBufferSize},
		{"negative size", -1, DefaultMaxBufferSize},
		{"custom size", 1024, 1024},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			buf := NewRingBuffer(tt.maxSize)
			if buf.maxSize != tt.want {
				t.Errorf("maxSize = %d, want %d", buf.maxSize, tt.want)
			}
		})
	}
}

func TestRingBufferWrite(t *testing.T) {
	buf := NewRingBuffer(1024)

	seq1 := buf.Write("stdout", "line 1")
	if seq1 != 0 {
		t.Errorf("first sequence = %d, want 0", seq1)
	}

	seq2 := buf.Write("stderr", "line 2")
	if seq2 != 1 {
		t.Errorf("second sequence = %d, want 1", seq2)
	}

	if buf.LineCount() != 2 {
		t.Errorf("LineCount() = %d, want 2", buf.LineCount())
	}
}

func TestRingBufferGetAll(t *testing.T) {
	buf := NewRingBuffer(1024)
	buf.Write("stdout", "line 1")
	buf.Write("stderr", "line 2")
	buf.Write("stdout", "line 3")

	lines := buf.GetAll()
	if len(lines) != 3 {
		t.Fatalf("GetAll() returned %d lines, want 3", len(lines))
	}

	if lines[0].Data != "line 1" || lines[0].Stream != "stdout" {
		t.Errorf("lines[0] = %+v, want stdout 'line 1'", lines[0])
	}
	if lines[1].Data != "line 2" || lines[1].Stream != "stderr" {
		t.Errorf("lines[1] = %+v, want stderr 'line 2'", lines[1])
	}
}

func TestRingBufferGetSince(t *testing.T) {
	buf := NewRingBuffer(1024)
	buf.Write("stdout", "line 1")
	buf.Write("stdout", "line 2")
	buf.Write("stdout", "line 3")

	lines := buf.GetSince(1)
	if len(lines) != 2 {
		t.Fatalf("GetSince(1) returned %d lines, want 2", len(lines))
	}

	if lines[0].Sequence != 1 {
		t.Errorf("first line sequence = %d, want 1", lines[0].Sequence)
	}
}

func TestRingBufferEviction(t *testing.T) {
	// Create small buffer
	buf := NewRingBuffer(50)

	// Write data that exceeds buffer
	for i := 0; i < 10; i++ {
		buf.Write("stdout", "0123456789") // 10 bytes each
	}

	// Should have evicted oldest entries
	if buf.Size() > 50 {
		t.Errorf("Size() = %d, want <= 50", buf.Size())
	}

	lines := buf.GetAll()
	if len(lines) == 0 {
		t.Error("Buffer should have some lines")
	}

	// Oldest lines should be gone, newest should remain
	lastLine := lines[len(lines)-1]
	if lastLine.Sequence != 9 {
		t.Errorf("last sequence = %d, want 9", lastLine.Sequence)
	}
}

func TestRingBufferLargeLinetruncation(t *testing.T) {
	buf := NewRingBuffer(100)

	// Write line larger than buffer
	longLine := make([]byte, 200)
	for i := range longLine {
		longLine[i] = 'x'
	}
	buf.Write("stdout", string(longLine))

	lines := buf.GetAll()
	if len(lines) != 1 {
		t.Fatalf("Expected 1 line, got %d", len(lines))
	}

	if len(lines[0].Data) != 100 {
		t.Errorf("Truncated line length = %d, want 100", len(lines[0].Data))
	}
}

func TestRingBufferSize(t *testing.T) {
	buf := NewRingBuffer(1024)

	buf.Write("stdout", "12345") // 5 bytes
	buf.Write("stdout", "67890") // 5 bytes

	if buf.Size() != 10 {
		t.Errorf("Size() = %d, want 10", buf.Size())
	}
}

func TestRingBufferClear(t *testing.T) {
	buf := NewRingBuffer(1024)
	buf.Write("stdout", "line 1")
	buf.Write("stdout", "line 2")

	buf.Clear()

	if buf.LineCount() != 0 {
		t.Errorf("LineCount() after Clear = %d, want 0", buf.LineCount())
	}
	if buf.Size() != 0 {
		t.Errorf("Size() after Clear = %d, want 0", buf.Size())
	}
}

func TestRingBufferLastSequence(t *testing.T) {
	buf := NewRingBuffer(1024)

	if buf.LastSequence() != 0 {
		t.Errorf("LastSequence() on empty = %d, want 0", buf.LastSequence())
	}

	buf.Write("stdout", "line 1")
	buf.Write("stdout", "line 2")

	if buf.LastSequence() != 1 {
		t.Errorf("LastSequence() = %d, want 1", buf.LastSequence())
	}
}

func TestRingBufferConcurrency(t *testing.T) {
	buf := NewRingBuffer(10 * 1024)

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				buf.Write("stdout", "test data")
			}
		}(i)
	}

	// Also read concurrently
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				buf.GetAll()
				buf.Size()
				buf.LineCount()
			}
		}()
	}

	wg.Wait()

	// Should complete without race conditions
	if buf.LineCount() == 0 {
		t.Error("Buffer should have lines after concurrent writes")
	}
}
