// Package agent provides agent process management.
package agent

import (
	"sync"
	"time"
)

const (
	// DefaultMaxBufferSize is the default maximum buffer size (10MB).
	DefaultMaxBufferSize = 10 * 1024 * 1024
)

// OutputLine represents a single line of output from an agent.
type OutputLine struct {
	Sequence  uint64    `json:"sequence"`
	Timestamp time.Time `json:"timestamp"`
	Stream    string    `json:"stream"` // "stdout" or "stderr"
	Data      string    `json:"data"`
}

// RingBuffer is a thread-safe ring buffer for agent output.
// It maintains a maximum size by dropping oldest entries.
type RingBuffer struct {
	mu          sync.RWMutex
	lines       []OutputLine
	maxSize     int
	currentSize int
	nextSeq     uint64
}

// NewRingBuffer creates a new ring buffer with the given max size.
func NewRingBuffer(maxSize int) *RingBuffer {
	if maxSize <= 0 {
		maxSize = DefaultMaxBufferSize
	}
	return &RingBuffer{
		lines:   make([]OutputLine, 0, 1024),
		maxSize: maxSize,
	}
}

// Write adds a new line to the buffer.
func (b *RingBuffer) Write(stream, data string) uint64 {
	b.mu.Lock()
	defer b.mu.Unlock()

	lineSize := len(data)

	// If single line exceeds max, truncate it
	if lineSize > b.maxSize {
		data = data[:b.maxSize]
		lineSize = b.maxSize
	}

	// Drop oldest lines until we have space
	for b.currentSize+lineSize > b.maxSize && len(b.lines) > 0 {
		b.currentSize -= len(b.lines[0].Data)
		b.lines = b.lines[1:]
	}

	line := OutputLine{
		Sequence:  b.nextSeq,
		Timestamp: time.Now(),
		Stream:    stream,
		Data:      data,
	}

	b.lines = append(b.lines, line)
	b.currentSize += lineSize
	b.nextSeq++

	return line.Sequence
}

// GetAll returns all lines in the buffer.
func (b *RingBuffer) GetAll() []OutputLine {
	b.mu.RLock()
	defer b.mu.RUnlock()

	result := make([]OutputLine, len(b.lines))
	copy(result, b.lines)
	return result
}

// GetSince returns all lines with sequence >= afterSeq.
func (b *RingBuffer) GetSince(afterSeq uint64) []OutputLine {
	b.mu.RLock()
	defer b.mu.RUnlock()

	var result []OutputLine
	for _, line := range b.lines {
		if line.Sequence >= afterSeq {
			result = append(result, line)
		}
	}
	return result
}

// Size returns the current size of data in the buffer.
func (b *RingBuffer) Size() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.currentSize
}

// LineCount returns the number of lines in the buffer.
func (b *RingBuffer) LineCount() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return len(b.lines)
}

// Clear removes all lines from the buffer.
func (b *RingBuffer) Clear() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.lines = b.lines[:0]
	b.currentSize = 0
}

// LastSequence returns the sequence number of the last line.
func (b *RingBuffer) LastSequence() uint64 {
	b.mu.RLock()
	defer b.mu.RUnlock()
	if b.nextSeq == 0 {
		return 0
	}
	return b.nextSeq - 1
}
