package workflow

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/coven/daemon/internal/grimoire"
	"github.com/coven/daemon/internal/spell"
)

// AgentRunResult contains the result of running an agent.
type AgentRunResult struct {
	Output     string // The agent's output
	ExitCode   int    // Process exit code
	StepTaskID string // The task ID used to track this step's process
}

// AgentRunner executes agent commands.
// This interface allows for mocking in tests.
type AgentRunner interface {
	// Run executes an agent with the given prompt and returns the result.
	// The StepTaskID in the result can be used to track/reconnect to the running process.
	Run(ctx context.Context, workDir, prompt string) (*AgentRunResult, error)
}

// AgentOutput is the structured result expected from agent steps.
// Agents should output a JSON block with this schema.
type AgentOutput struct {
	Success bool                   `json:"success"`
	Summary string                 `json:"summary"`
	Outputs map[string]interface{} `json:"outputs,omitempty"`
	Error   *string                `json:"error,omitempty"`
}

// AgentExecutor executes agent steps.
type AgentExecutor struct {
	runner      AgentRunner
	spellLoader *spell.Loader
	renderer    *spell.PartialRenderer
}

// NewAgentExecutor creates a new agent executor.
func NewAgentExecutor(spellLoader *spell.Loader, runner AgentRunner) *AgentExecutor {
	return &AgentExecutor{
		runner:      runner,
		spellLoader: spellLoader,
		renderer:    spell.NewPartialRenderer(spellLoader),
	}
}

// Execute runs an agent step and returns the result.
func (e *AgentExecutor) Execute(ctx context.Context, step *grimoire.Step, stepCtx *StepContext) (*StepResult, error) {
	if step.Type != grimoire.StepTypeAgent {
		return nil, fmt.Errorf("expected agent step, got %s", step.Type)
	}

	if step.Spell == "" {
		return nil, fmt.Errorf("agent step %q has no spell", step.Name)
	}

	if e.runner == nil {
		return nil, fmt.Errorf("agent runner not configured for step %q", step.Name)
	}

	// Get timeout
	timeout, err := step.GetTimeout()
	if err != nil {
		return nil, fmt.Errorf("invalid timeout: %w", err)
	}

	// Create context with timeout
	execCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	// Load and render the spell
	prompt, err := e.preparePrompt(step, stepCtx)
	if err != nil {
		return nil, fmt.Errorf("failed to prepare prompt: %w", err)
	}

	// Execute the agent
	start := time.Now()
	runResult, err := e.runner.Run(execCtx, stepCtx.WorktreePath, prompt)
	duration := time.Since(start)

	// Extract values from result
	var output string
	var exitCode int
	if runResult != nil {
		output = runResult.Output
		exitCode = runResult.ExitCode
	}

	// Check for timeout
	if execCtx.Err() == context.DeadlineExceeded {
		return &StepResult{
			Success:  false,
			Output:   output,
			ExitCode: -1,
			Error:    fmt.Sprintf("agent timed out after %s", timeout),
			Duration: duration,
			Action:   ActionFail,
		}, nil
	}

	// Check for execution error
	if err != nil {
		return &StepResult{
			Success:  false,
			Output:   output,
			ExitCode: exitCode,
			Error:    fmt.Sprintf("failed to execute agent: %v", err),
			Duration: duration,
			Action:   ActionFail,
		}, nil
	}

	// Parse structured output if present
	agentOutput := e.parseAgentOutput(output)

	// Determine success from exit code or parsed output
	success := exitCode == 0
	if agentOutput != nil {
		success = agentOutput.Success
	}

	// Determine action based on success
	action := ActionContinue
	if !success {
		action = ActionFail
	}

	result := &StepResult{
		Success:  success,
		Output:   output,
		ExitCode: exitCode,
		Duration: duration,
		Action:   action,
	}

	// Store parsed output in context if step has output field
	if step.Output != "" && agentOutput != nil {
		stepCtx.SetVariable(step.Output, agentOutput)
	}

	return result, nil
}

// preparePrompt loads and renders the spell template.
func (e *AgentExecutor) preparePrompt(step *grimoire.Step, stepCtx *StepContext) (string, error) {
	var spellContent string

	// Check if spell is inline (contains newlines) or a file reference
	if strings.Contains(step.Spell, "\n") {
		// Inline spell
		spellContent = step.Spell
	} else {
		// Load from file
		loadedSpell, err := e.spellLoader.Load(step.Spell)
		if err != nil {
			if spell.IsNotFound(err) {
				return "", fmt.Errorf("spell not found: %q", step.Spell)
			}
			return "", fmt.Errorf("failed to load spell: %w", err)
		}
		spellContent = loadedSpell.Content
	}

	// Build render context
	renderCtx := spell.RenderContext{}

	// Copy workflow variables
	for k, v := range stepCtx.Variables {
		renderCtx[k] = v
	}

	// Add step input variables
	for k, v := range step.Input {
		// Render input variable values (they may contain template references)
		rendered, err := e.renderer.RenderString(k, v, spell.RenderContext(stepCtx.Variables))
		if err != nil {
			return "", fmt.Errorf("failed to render input %q: %w", k, err)
		}
		renderCtx[k] = rendered
	}

	// Add bead info - use full bead from context if available, otherwise just ID
	if bead := stepCtx.GetBead(); bead != nil {
		renderCtx["bead"] = map[string]interface{}{
			"id":       bead.ID,
			"title":    bead.Title,
			"body":     bead.Body,
			"type":     bead.Type,
			"priority": bead.Priority,
			"labels":   bead.Labels,
		}
	} else {
		renderCtx["bead"] = map[string]interface{}{
			"id": stepCtx.BeadID,
		}
	}

	// Render the spell
	return e.renderer.RenderString(step.Name, spellContent, renderCtx)
}

// parseAgentOutput extracts structured JSON output from agent response.
// Looks for the last JSON code block matching the AgentOutput schema.
func (e *AgentExecutor) parseAgentOutput(output string) *AgentOutput {
	// Find all JSON code blocks
	jsonBlocks := extractJSONBlocks(output)

	// Try parsing each block from last to first
	for i := len(jsonBlocks) - 1; i >= 0; i-- {
		var agentOutput AgentOutput
		if err := json.Unmarshal([]byte(jsonBlocks[i]), &agentOutput); err != nil {
			continue
		}

		// Check if it looks like a valid AgentOutput
		// (must have at least a summary or success field set)
		if agentOutput.Summary != "" || agentOutput.Success {
			return &agentOutput
		}
	}

	return nil
}

// extractJSONBlocks finds JSON code blocks in the output.
// Looks for ```json...``` or standalone {...} blocks.
func extractJSONBlocks(output string) []string {
	var blocks []string

	// Pattern for ```json...``` code blocks
	codeBlockPattern := regexp.MustCompile("(?s)```(?:json)?\\s*\\n?({[^`]*})\\s*\\n?```")
	matches := codeBlockPattern.FindAllStringSubmatch(output, -1)
	for _, match := range matches {
		if len(match) > 1 {
			blocks = append(blocks, strings.TrimSpace(match[1]))
		}
	}

	// If no code blocks found, try to find standalone JSON objects
	if len(blocks) == 0 {
		// Simple pattern for {...} at the end of output
		objectPattern := regexp.MustCompile(`(?s)\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}`)
		matches := objectPattern.FindAllString(output, -1)
		for _, match := range matches {
			// Validate it's valid JSON
			var obj map[string]interface{}
			if json.Unmarshal([]byte(match), &obj) == nil {
				blocks = append(blocks, match)
			}
		}
	}

	return blocks
}

// IsInlineSpell checks if a spell string is inline content or a file reference.
func IsInlineSpell(s string) bool {
	return strings.Contains(s, "\n")
}
