package logging

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sync"
	"time"
)

// Level represents a log level.
type Level int

const (
	LevelDebug Level = iota
	LevelInfo
	LevelWarn
	LevelError
)

func (l Level) String() string {
	switch l {
	case LevelDebug:
		return "debug"
	case LevelInfo:
		return "info"
	case LevelWarn:
		return "warn"
	case LevelError:
		return "error"
	default:
		return "unknown"
	}
}

// LogEntry represents a structured log entry.
type LogEntry struct {
	Time    string         `json:"time"`
	Level   string         `json:"level"`
	Message string         `json:"message"`
	Fields  map[string]any `json:"fields,omitempty"`
}

// Logger provides structured logging to a file.
type Logger struct {
	mu       sync.Mutex
	writer   io.WriteCloser
	level    Level
	filePath string
}

// New creates a new logger that writes to the given file path.
func New(filePath string) (*Logger, error) {
	file, err := os.OpenFile(filePath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return nil, fmt.Errorf("failed to open log file: %w", err)
	}

	return &Logger{
		writer:   file,
		level:    LevelInfo,
		filePath: filePath,
	}, nil
}

// NewWithWriter creates a logger with a custom writer (useful for testing).
func NewWithWriter(w io.WriteCloser) *Logger {
	return &Logger{
		writer: w,
		level:  LevelInfo,
	}
}

// SetLevel sets the minimum log level.
func (l *Logger) SetLevel(level Level) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.level = level
}

// Close closes the log file.
func (l *Logger) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.writer != nil {
		return l.writer.Close()
	}
	return nil
}

// log writes a log entry at the given level.
func (l *Logger) log(level Level, msg string, keyvals ...any) {
	l.mu.Lock()
	defer l.mu.Unlock()

	if level < l.level {
		return
	}

	entry := LogEntry{
		Time:    time.Now().UTC().Format(time.RFC3339),
		Level:   level.String(),
		Message: msg,
	}

	if len(keyvals) > 0 {
		entry.Fields = make(map[string]any)
		for i := 0; i < len(keyvals)-1; i += 2 {
			key, ok := keyvals[i].(string)
			if !ok {
				key = fmt.Sprintf("%v", keyvals[i])
			}
			// Handle error types specially - convert to string
			// (errors don't serialize to JSON properly, they become {})
			if err, ok := keyvals[i+1].(error); ok {
				entry.Fields[key] = err.Error()
			} else {
				entry.Fields[key] = keyvals[i+1]
			}
		}
		// Handle odd number of keyvals
		if len(keyvals)%2 != 0 {
			entry.Fields["_extra"] = keyvals[len(keyvals)-1]
		}
	}

	data, err := json.Marshal(entry)
	if err != nil {
		return
	}

	l.writer.Write(append(data, '\n'))
}

// Debug logs a debug message.
func (l *Logger) Debug(msg string, keyvals ...any) {
	l.log(LevelDebug, msg, keyvals...)
}

// Info logs an info message.
func (l *Logger) Info(msg string, keyvals ...any) {
	l.log(LevelInfo, msg, keyvals...)
}

// Warn logs a warning message.
func (l *Logger) Warn(msg string, keyvals ...any) {
	l.log(LevelWarn, msg, keyvals...)
}

// Error logs an error message.
func (l *Logger) Error(msg string, keyvals ...any) {
	l.log(LevelError, msg, keyvals...)
}

// FilePath returns the path to the log file.
func (l *Logger) FilePath() string {
	return l.filePath
}
