package logging

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// mockWriter is a test writer that captures output.
type mockWriter struct {
	buf    bytes.Buffer
	closed bool
}

func (m *mockWriter) Write(p []byte) (n int, err error) {
	return m.buf.Write(p)
}

func (m *mockWriter) Close() error {
	m.closed = true
	return nil
}

func TestNew(t *testing.T) {
	tmpDir := t.TempDir()
	logPath := filepath.Join(tmpDir, "test.log")

	logger, err := New(logPath)
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}
	defer logger.Close()

	if logger.FilePath() != logPath {
		t.Errorf("FilePath() = %q, want %q", logger.FilePath(), logPath)
	}

	// Verify file was created
	if _, err := os.Stat(logPath); os.IsNotExist(err) {
		t.Error("Log file was not created")
	}
}

func TestNewWithWriter(t *testing.T) {
	w := &mockWriter{}
	logger := NewWithWriter(w)

	if logger == nil {
		t.Fatal("NewWithWriter returned nil")
	}

	logger.Info("test message")

	if w.buf.Len() == 0 {
		t.Error("Nothing written to writer")
	}
}

func TestLevelString(t *testing.T) {
	tests := []struct {
		level Level
		want  string
	}{
		{LevelDebug, "debug"},
		{LevelInfo, "info"},
		{LevelWarn, "warn"},
		{LevelError, "error"},
		{Level(99), "unknown"},
	}

	for _, tt := range tests {
		got := tt.level.String()
		if got != tt.want {
			t.Errorf("Level(%d).String() = %q, want %q", tt.level, got, tt.want)
		}
	}
}

func TestSetLevel(t *testing.T) {
	w := &mockWriter{}
	logger := NewWithWriter(w)

	logger.SetLevel(LevelWarn)

	// Debug and Info should be filtered
	logger.Debug("debug message")
	logger.Info("info message")

	if w.buf.Len() != 0 {
		t.Error("Debug/Info messages should be filtered at Warn level")
	}

	// Warn and Error should pass
	logger.Warn("warn message")
	if w.buf.Len() == 0 {
		t.Error("Warn message should not be filtered")
	}

	w.buf.Reset()
	logger.Error("error message")
	if w.buf.Len() == 0 {
		t.Error("Error message should not be filtered")
	}
}

func TestLogMethods(t *testing.T) {
	tests := []struct {
		name    string
		logFunc func(*Logger, string, ...any)
		level   string
	}{
		{"Debug", (*Logger).Debug, "debug"},
		{"Info", (*Logger).Info, "info"},
		{"Warn", (*Logger).Warn, "warn"},
		{"Error", (*Logger).Error, "error"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := &mockWriter{}
			logger := NewWithWriter(w)
			logger.SetLevel(LevelDebug) // Enable all levels

			tt.logFunc(logger, "test message", "key", "value")

			var entry LogEntry
			if err := json.Unmarshal(w.buf.Bytes(), &entry); err != nil {
				t.Fatalf("Failed to parse log entry: %v", err)
			}

			if entry.Level != tt.level {
				t.Errorf("Level = %q, want %q", entry.Level, tt.level)
			}
			if entry.Message != "test message" {
				t.Errorf("Message = %q, want %q", entry.Message, "test message")
			}
			if entry.Fields["key"] != "value" {
				t.Errorf("Fields[key] = %q, want %q", entry.Fields["key"], "value")
			}
		})
	}
}

func TestLogWithMultipleFields(t *testing.T) {
	w := &mockWriter{}
	logger := NewWithWriter(w)

	logger.Info("test", "a", 1, "b", "two", "c", true)

	var entry LogEntry
	if err := json.Unmarshal(w.buf.Bytes(), &entry); err != nil {
		t.Fatalf("Failed to parse log entry: %v", err)
	}

	if len(entry.Fields) != 3 {
		t.Errorf("Expected 3 fields, got %d", len(entry.Fields))
	}

	// Check field values (JSON numbers are float64)
	if entry.Fields["a"] != float64(1) {
		t.Errorf("Fields[a] = %v, want 1", entry.Fields["a"])
	}
	if entry.Fields["b"] != "two" {
		t.Errorf("Fields[b] = %q, want %q", entry.Fields["b"], "two")
	}
	if entry.Fields["c"] != true {
		t.Errorf("Fields[c] = %v, want true", entry.Fields["c"])
	}
}

func TestLogWithOddKeyvals(t *testing.T) {
	w := &mockWriter{}
	logger := NewWithWriter(w)

	// Odd number of keyvals - last one should go to _extra
	logger.Info("test", "key", "value", "orphan")

	var entry LogEntry
	if err := json.Unmarshal(w.buf.Bytes(), &entry); err != nil {
		t.Fatalf("Failed to parse log entry: %v", err)
	}

	if entry.Fields["_extra"] != "orphan" {
		t.Errorf("Fields[_extra] = %q, want %q", entry.Fields["_extra"], "orphan")
	}
}

func TestLogWithNonStringKey(t *testing.T) {
	w := &mockWriter{}
	logger := NewWithWriter(w)

	// Non-string key should be converted
	logger.Info("test", 123, "value")

	var entry LogEntry
	if err := json.Unmarshal(w.buf.Bytes(), &entry); err != nil {
		t.Fatalf("Failed to parse log entry: %v", err)
	}

	if entry.Fields["123"] != "value" {
		t.Errorf("Expected field with key '123', got %v", entry.Fields)
	}
}

func TestLogEntryFormat(t *testing.T) {
	w := &mockWriter{}
	logger := NewWithWriter(w)

	logger.Info("test message")

	var entry LogEntry
	if err := json.Unmarshal(w.buf.Bytes(), &entry); err != nil {
		t.Fatalf("Failed to parse log entry: %v", err)
	}

	// Check time format (RFC3339)
	if !strings.Contains(entry.Time, "T") || !strings.Contains(entry.Time, "Z") {
		t.Errorf("Time format should be RFC3339, got %q", entry.Time)
	}

	// Verify line ends with newline
	if !strings.HasSuffix(w.buf.String(), "\n") {
		t.Error("Log entry should end with newline")
	}
}

func TestClose(t *testing.T) {
	w := &mockWriter{}
	logger := NewWithWriter(w)

	if err := logger.Close(); err != nil {
		t.Errorf("Close() error: %v", err)
	}

	if !w.closed {
		t.Error("Writer was not closed")
	}

	// Close with nil writer should not panic
	logger2 := &Logger{}
	if err := logger2.Close(); err != nil {
		t.Errorf("Close() with nil writer error: %v", err)
	}
}

func TestLogToFile(t *testing.T) {
	tmpDir := t.TempDir()
	logPath := filepath.Join(tmpDir, "test.log")

	logger, err := New(logPath)
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	logger.Info("test message", "key", "value")
	logger.Close()

	// Read the file
	data, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("Failed to read log file: %v", err)
	}

	var entry LogEntry
	if err := json.Unmarshal(data, &entry); err != nil {
		t.Fatalf("Failed to parse log entry: %v", err)
	}

	if entry.Message != "test message" {
		t.Errorf("Message = %q, want %q", entry.Message, "test message")
	}
}

func TestNewInvalidPath(t *testing.T) {
	// Try to create log in non-existent directory
	_, err := New("/nonexistent/directory/test.log")
	if err == nil {
		t.Error("New() should fail for invalid path")
	}
}

// Ensure mockWriter implements io.WriteCloser
var _ io.WriteCloser = (*mockWriter)(nil)
