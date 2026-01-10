package scheduler

import (
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	// DefaultRetentionDays is the default number of days to retain old files.
	DefaultRetentionDays = 7
)

// cleanupOldFiles removes workflow state and log files older than the retention period.
// This is called periodically to prevent unbounded disk usage.
func (s *Scheduler) cleanupOldFiles() {
	cutoff := time.Now().Add(-time.Duration(DefaultRetentionDays) * 24 * time.Hour)

	// Clean up old workflow state files
	workflowsDir := filepath.Join(s.covenDir, "workflows")
	s.cleanupDirectory(workflowsDir, cutoff, ".json")

	// Clean up old workflow log files
	logsDir := filepath.Join(s.covenDir, "logs", "workflows")
	s.cleanupDirectory(logsDir, cutoff, ".jsonl")

	// Clean up old question files
	questionsDir := filepath.Join(s.covenDir, "questions")
	s.cleanupDirectory(questionsDir, cutoff, ".json")
}

// cleanupDirectory removes files older than cutoff with the specified extension.
func (s *Scheduler) cleanupDirectory(dir string, cutoff time.Time, ext string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		// Directory might not exist yet, which is fine
		if !os.IsNotExist(err) {
			s.logger.Debug("failed to read directory for cleanup",
				"dir", dir,
				"error", err,
			)
		}
		return
	}

	var cleaned int
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		if !strings.HasSuffix(entry.Name(), ext) {
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		if info.ModTime().Before(cutoff) {
			path := filepath.Join(dir, entry.Name())
			if err := os.Remove(path); err != nil {
				s.logger.Debug("failed to remove old file",
					"path", path,
					"error", err,
				)
			} else {
				cleaned++
			}
		}
	}

	if cleaned > 0 {
		s.logger.Info("cleaned up old files",
			"dir", dir,
			"count", cleaned,
		)
	}
}
