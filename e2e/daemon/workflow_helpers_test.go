//go:build e2e

package daemon_e2e

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coven/e2e/daemon/helpers"
)

// Workflow test helpers

func writeGrimoire(t *testing.T, env *helpers.TestEnv, name, content string) {
	t.Helper()
	grimoireDir := filepath.Join(env.CovenDir, "grimoires")
	if err := os.MkdirAll(grimoireDir, 0755); err != nil {
		t.Fatalf("Failed to create grimoires dir: %v", err)
	}
	path := filepath.Join(grimoireDir, name+".yaml")
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("Failed to write grimoire: %v", err)
	}
}

func writeCovenConfig(t *testing.T, env *helpers.TestEnv, name, content string) {
	t.Helper()
	if err := os.MkdirAll(env.CovenDir, 0755); err != nil {
		t.Fatalf("Failed to create .coven dir: %v", err)
	}
	path := filepath.Join(env.CovenDir, name)
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("Failed to write config: %v", err)
	}
}

func createTaskWithLabel(t *testing.T, env *helpers.TestEnv, title, label string) string {
	t.Helper()
	cmd := exec.Command("bd", "create",
		"--title="+title,
		"--type=task",
		"--priority=1",
		"--label="+label,
	)
	cmd.Dir = env.TmpDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("Failed to create task with label: %v\n%s", err, output)
	}
	return parseTaskID(t, string(output))
}

func createTaskWithType(t *testing.T, env *helpers.TestEnv, title, taskType string) string {
	t.Helper()
	cmd := exec.Command("bd", "create",
		"--title="+title,
		"--type="+taskType,
		"--priority=1",
	)
	cmd.Dir = env.TmpDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("Failed to create task with type: %v\n%s", err, output)
	}
	return parseTaskID(t, string(output))
}

func parseTaskID(t *testing.T, output string) string {
	t.Helper()
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		if strings.Contains(line, "Created issue:") {
			parts := strings.Split(line, "Created issue:")
			if len(parts) >= 2 {
				taskID := strings.TrimSpace(parts[1])
				taskID = strings.Fields(taskID)[0]
				return taskID
			}
		}
	}
	t.Fatalf("Failed to parse task ID from output: %s", output)
	return ""
}

func waitForTask(t *testing.T, api *helpers.APIClient, taskID string, timeoutSec int) {
	t.Helper()
	deadline := time.Now().Add(time.Duration(timeoutSec) * time.Second)
	for time.Now().Before(deadline) {
		tasks, err := api.GetTasks()
		if err == nil {
			for _, task := range tasks.Tasks {
				if task.ID == taskID {
					return
				}
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("Task %s did not appear within %d seconds", taskID, timeoutSec)
}

func waitForTaskStatus(t *testing.T, api *helpers.APIClient, taskID, status string, timeoutSec int) {
	t.Helper()
	deadline := time.Now().Add(time.Duration(timeoutSec) * time.Second)
	var lastStatus string
	for time.Now().Before(deadline) {
		tasks, err := api.GetTasks()
		if err == nil {
			for _, task := range tasks.Tasks {
				if task.ID == taskID {
					lastStatus = task.Status
					if task.Status == status {
						return
					}
				}
			}
		}
		time.Sleep(200 * time.Millisecond)
	}
	t.Fatalf("Task %s did not reach status %q within %d seconds (last status: %s)",
		taskID, status, timeoutSec, lastStatus)
}

func readDaemonLog(t *testing.T, env *helpers.TestEnv) string {
	t.Helper()
	logPath := filepath.Join(env.CovenDir, "covend.log")
	data, err := os.ReadFile(logPath)
	if err != nil {
		t.Logf("Warning: could not read daemon log: %v", err)
		return ""
	}
	return string(data)
}

// startSessionAndWaitForTask is a common setup pattern for workflow tests.
func startSessionAndWaitForTask(t *testing.T, env *helpers.TestEnv, api *helpers.APIClient, taskID string) {
	t.Helper()

	if err := api.StartSession(); err != nil {
		t.Fatalf("Failed to start session: %v", err)
	}

	waitForTask(t, api, taskID, 5)
}
