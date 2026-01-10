package questions

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Store persists questions to disk and provides thread-safe access.
type Store struct {
	mu       sync.RWMutex
	dir      string             // .coven/questions/
	pending  map[string]*Question // Indexed by question ID
	byTask   map[string][]string  // Task ID -> question IDs
}

// NewStore creates a new question store.
func NewStore(covenDir string) *Store {
	dir := filepath.Join(covenDir, "questions")
	return &Store{
		dir:     dir,
		pending: make(map[string]*Question),
		byTask:  make(map[string][]string),
	}
}

// ensureDir ensures the questions directory exists.
func (s *Store) ensureDir() error {
	return os.MkdirAll(s.dir, 0755)
}

// questionPath returns the file path for a question.
func (s *Store) questionPath(id string) string {
	return filepath.Join(s.dir, id+".json")
}

// Save persists a question to disk and adds it to the in-memory index.
func (s *Store) Save(q *Question) error {
	if err := s.ensureDir(); err != nil {
		return fmt.Errorf("failed to create questions directory: %w", err)
	}

	// Write to temp file first, then rename (atomic)
	tempPath := s.questionPath(q.ID) + ".tmp"
	data, err := json.MarshalIndent(q, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal question: %w", err)
	}

	if err := os.WriteFile(tempPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write question file: %w", err)
	}

	if err := os.Rename(tempPath, s.questionPath(q.ID)); err != nil {
		os.Remove(tempPath)
		return fmt.Errorf("failed to rename question file: %w", err)
	}

	// Update in-memory index
	s.mu.Lock()
	defer s.mu.Unlock()

	s.pending[q.ID] = q

	// Add to task index if not already present
	found := false
	for _, id := range s.byTask[q.TaskID] {
		if id == q.ID {
			found = true
			break
		}
	}
	if !found {
		s.byTask[q.TaskID] = append(s.byTask[q.TaskID], q.ID)
	}

	return nil
}

// Get returns a question by ID.
func (s *Store) Get(id string) *Question {
	s.mu.RLock()
	q, ok := s.pending[id]
	s.mu.RUnlock()

	if ok {
		// Return a copy
		copy := *q
		return &copy
	}

	// Try loading from disk
	q, err := s.loadFromDisk(id)
	if err != nil {
		return nil
	}

	// Cache it
	s.mu.Lock()
	s.pending[id] = q
	s.mu.Unlock()

	copy := *q
	return &copy
}

// loadFromDisk loads a question from its file.
func (s *Store) loadFromDisk(id string) (*Question, error) {
	data, err := os.ReadFile(s.questionPath(id))
	if err != nil {
		return nil, err
	}

	var q Question
	if err := json.Unmarshal(data, &q); err != nil {
		return nil, err
	}

	return &q, nil
}

// GetPendingForTask returns all pending questions for a task.
func (s *Store) GetPendingForTask(taskID string) []*Question {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var pending []*Question
	for _, qID := range s.byTask[taskID] {
		if q, ok := s.pending[qID]; ok && q.IsPending() {
			copy := *q
			pending = append(pending, &copy)
		}
	}
	return pending
}

// GetAllPending returns all pending questions.
func (s *Store) GetAllPending() []*Question {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var pending []*Question
	for _, q := range s.pending {
		if q.IsPending() {
			copy := *q
			pending = append(pending, &copy)
		}
	}
	return pending
}

// MarkAnswered marks a question as answered and persists the change.
func (s *Store) MarkAnswered(id, answer string) error {
	s.mu.Lock()
	q, ok := s.pending[id]
	if !ok {
		s.mu.Unlock()
		return fmt.Errorf("question not found: %s", id)
	}

	now := time.Now()
	q.AnsweredAt = &now
	q.Answer = answer
	s.mu.Unlock()

	// Persist to disk
	return s.Save(q)
}

// MarkDelivered marks a question's answer as delivered and persists the change.
func (s *Store) MarkDelivered(id string) error {
	s.mu.Lock()
	q, ok := s.pending[id]
	if !ok {
		s.mu.Unlock()
		return fmt.Errorf("question not found: %s", id)
	}

	now := time.Now()
	q.DeliveredAt = &now
	s.mu.Unlock()

	// Persist to disk
	return s.Save(q)
}

// MarkDeliveryFailed records a delivery error and persists the change.
func (s *Store) MarkDeliveryFailed(id, errMsg string) error {
	s.mu.Lock()
	q, ok := s.pending[id]
	if !ok {
		s.mu.Unlock()
		return fmt.Errorf("question not found: %s", id)
	}

	q.Error = errMsg
	s.mu.Unlock()

	// Persist to disk
	return s.Save(q)
}

// Delete removes a question from the store and disk.
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	q, ok := s.pending[id]
	if ok {
		// Remove from task index
		taskQuestions := s.byTask[q.TaskID]
		for i, qID := range taskQuestions {
			if qID == id {
				s.byTask[q.TaskID] = append(taskQuestions[:i], taskQuestions[i+1:]...)
				break
			}
		}
		delete(s.pending, id)
	}

	// Remove from disk
	os.Remove(s.questionPath(id))
	return nil
}

// ClearForTask removes all questions for a task.
func (s *Store) ClearForTask(taskID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, qID := range s.byTask[taskID] {
		delete(s.pending, qID)
		os.Remove(s.questionPath(qID))
	}
	delete(s.byTask, taskID)
}

// LoadAll loads all questions from disk into the in-memory index.
// This should be called on daemon startup.
func (s *Store) LoadAll() error {
	if err := s.ensureDir(); err != nil {
		return err
	}

	entries, err := os.ReadDir(s.dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // No questions directory yet
		}
		return fmt.Errorf("failed to read questions directory: %w", err)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if filepath.Ext(name) != ".json" {
			continue
		}
		// Skip temp files
		if filepath.Ext(filepath.Base(name[:len(name)-5])) == ".tmp" {
			continue
		}

		id := name[:len(name)-5] // Remove .json extension
		q, err := s.loadFromDisk(id)
		if err != nil {
			continue // Skip corrupted files
		}

		s.pending[q.ID] = q
		s.byTask[q.TaskID] = append(s.byTask[q.TaskID], q.ID)
	}

	return nil
}

// PendingCount returns the number of pending questions.
func (s *Store) PendingCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()

	count := 0
	for _, q := range s.pending {
		if q.IsPending() {
			count++
		}
	}
	return count
}

// Count returns the total number of questions in the store.
func (s *Store) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.pending)
}
