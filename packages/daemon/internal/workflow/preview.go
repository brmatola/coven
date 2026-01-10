package workflow

import (
	"encoding/json"
	"fmt"
	"strings"
	"text/template"

	"github.com/coven/daemon/internal/grimoire"
	"github.com/coven/daemon/internal/spell"
)

// PreviewResult contains the result of previewing a grimoire.
type PreviewResult struct {
	// GrimoireName is the name of the grimoire.
	GrimoireName string `json:"grimoire_name"`

	// GrimoireSource is where the grimoire was loaded from.
	GrimoireSource string `json:"grimoire_source"`

	// Steps contains preview info for each step.
	Steps []StepPreview `json:"steps"`

	// Errors contains any validation errors found.
	Errors []PreviewError `json:"errors,omitempty"`

	// IsValid indicates whether the grimoire is valid.
	IsValid bool `json:"is_valid"`
}

// StepPreview contains preview information for a single step.
type StepPreview struct {
	// Index is the step number (1-indexed).
	Index int `json:"index"`

	// Name is the step name.
	Name string `json:"name"`

	// Type is the step type (agent, script, loop, merge).
	Type string `json:"type"`

	// Timeout is the step timeout if configured.
	Timeout string `json:"timeout,omitempty"`

	// When is the condition for step execution.
	When string `json:"when,omitempty"`

	// Agent-specific fields
	SpellName    string `json:"spell_name,omitempty"`
	SpellSource  string `json:"spell_source,omitempty"`
	SpellPreview string `json:"spell_preview,omitempty"`
	Output       string `json:"output,omitempty"`

	// Script-specific fields
	Command   string `json:"command,omitempty"`
	OnFail    string `json:"on_fail,omitempty"`
	OnSuccess string `json:"on_success,omitempty"`

	// Loop-specific fields
	MaxIterations   int           `json:"max_iterations,omitempty"`
	OnMaxIterations string        `json:"on_max_iterations,omitempty"`
	NestedSteps     []StepPreview `json:"nested_steps,omitempty"`

	// Merge-specific fields
	RequiresReview bool `json:"requires_review,omitempty"`

	// Errors contains any errors for this step.
	Errors []PreviewError `json:"errors,omitempty"`
}

// PreviewError represents an error found during preview.
type PreviewError struct {
	// StepName is the step where the error occurred.
	StepName string `json:"step_name,omitempty"`

	// Field is the specific field with the error.
	Field string `json:"field,omitempty"`

	// Message describes the error.
	Message string `json:"message"`

	// Line is the line number in the template (if applicable).
	Line int `json:"line,omitempty"`
}

// PreviewOptions configures the preview operation.
type PreviewOptions struct {
	// BeadData is the bead data to use for template rendering.
	BeadData *BeadData

	// MaxSpellPreviewLength limits the spell preview output.
	MaxSpellPreviewLength int

	// IncludeFullSpells includes full rendered spells in output.
	IncludeFullSpells bool
}

// DefaultPreviewOptions returns default preview options.
func DefaultPreviewOptions() *PreviewOptions {
	return &PreviewOptions{
		MaxSpellPreviewLength: 500,
		IncludeFullSpells:     false,
	}
}

// Previewer generates previews for grimoires.
type Previewer struct {
	grimoireLoader *grimoire.Loader
	spellLoader    *spell.Loader
	spellRenderer  *spell.Renderer
}

// NewPreviewer creates a new previewer.
func NewPreviewer(covenDir string) *Previewer {
	return &Previewer{
		grimoireLoader: grimoire.NewLoader(covenDir),
		spellLoader:    spell.NewLoader(covenDir),
		spellRenderer:  spell.NewRenderer(),
	}
}

// Preview generates a preview of a grimoire.
func (p *Previewer) Preview(grimoireName string, opts *PreviewOptions) (*PreviewResult, error) {
	if opts == nil {
		opts = DefaultPreviewOptions()
	}

	// Load the grimoire
	g, err := p.grimoireLoader.Load(grimoireName)
	if err != nil {
		return nil, fmt.Errorf("failed to load grimoire %q: %w", grimoireName, err)
	}

	result := &PreviewResult{
		GrimoireName:   g.Name,
		GrimoireSource: string(g.Source),
		IsValid:        true,
	}

	// Validate the grimoire
	if err := g.Validate(); err != nil {
		result.IsValid = false
		result.Errors = append(result.Errors, PreviewError{
			Message: fmt.Sprintf("grimoire validation failed: %v", err),
		})
	}

	// Build step context for template rendering
	ctx := NewStepContext("", "", "")
	if opts.BeadData != nil {
		ctx.SetBead(opts.BeadData)
	} else {
		// Use sample bead data
		ctx.SetBead(&BeadData{
			ID:       "<bead-id>",
			Title:    "<bead-title>",
			Body:     "<bead-description>",
			Type:     "<bead-type>",
			Priority: "P2",
		})
	}

	// Preview each step
	for i, step := range g.Steps {
		stepPreview := p.previewStep(&step, i+1, ctx, opts)
		result.Steps = append(result.Steps, stepPreview)

		// Collect step errors
		if len(stepPreview.Errors) > 0 {
			result.IsValid = false
			result.Errors = append(result.Errors, stepPreview.Errors...)
		}
	}

	return result, nil
}

// previewStep generates preview for a single step.
func (p *Previewer) previewStep(step *grimoire.Step, index int, ctx *StepContext, opts *PreviewOptions) StepPreview {
	preview := StepPreview{
		Index:   index,
		Name:    step.Name,
		Type:    string(step.Type),
		Timeout: step.Timeout,
		When:    step.When,
		Output:  step.Output,
	}

	switch step.Type {
	case grimoire.StepTypeAgent:
		p.previewAgentStep(step, &preview, ctx, opts)

	case grimoire.StepTypeScript:
		preview.Command = step.Command
		preview.OnFail = step.OnFail
		preview.OnSuccess = step.OnSuccess

	case grimoire.StepTypeLoop:
		preview.MaxIterations = step.MaxIterations
		preview.OnMaxIterations = step.OnMaxIterations

		// Preview nested steps
		for i, nested := range step.Steps {
			nestedPreview := p.previewStep(&nested, i+1, ctx, opts)
			preview.NestedSteps = append(preview.NestedSteps, nestedPreview)

			// Propagate nested errors
			if len(nestedPreview.Errors) > 0 {
				preview.Errors = append(preview.Errors, nestedPreview.Errors...)
			}
		}

	case grimoire.StepTypeMerge:
		preview.RequiresReview = step.RequiresReview()
	}

	// Validate 'when' condition if present
	if step.When != "" {
		if err := p.validateCondition(step.When, ctx); err != nil {
			preview.Errors = append(preview.Errors, PreviewError{
				StepName: step.Name,
				Field:    "when",
				Message:  err.Error(),
			})
		}
	}

	return preview
}

// previewAgentStep generates preview for an agent step.
func (p *Previewer) previewAgentStep(step *grimoire.Step, preview *StepPreview, ctx *StepContext, opts *PreviewOptions) {
	preview.SpellName = step.Spell

	// Load the spell
	sp, err := p.spellLoader.Load(step.Spell)
	if err != nil {
		preview.Errors = append(preview.Errors, PreviewError{
			StepName: step.Name,
			Field:    "spell",
			Message:  fmt.Sprintf("failed to load spell: %v", err),
		})
		return
	}

	preview.SpellSource = string(sp.Source)

	// Build render context
	renderCtx := spell.RenderContext{}
	for k, v := range ctx.ToMap() {
		renderCtx[k] = v
	}

	// Add step inputs
	for k, v := range step.Input {
		renderCtx[k] = v
	}

	// Try to render the spell
	rendered, err := p.spellRenderer.Render(sp, renderCtx)
	if err != nil {
		preview.Errors = append(preview.Errors, PreviewError{
			StepName: step.Name,
			Field:    "spell",
			Message:  fmt.Sprintf("template rendering error: %v", err),
		})
		return
	}

	// Truncate preview if needed
	maxLen := opts.MaxSpellPreviewLength
	if opts.IncludeFullSpells {
		maxLen = 0
	}

	if maxLen > 0 && len(rendered) > maxLen {
		preview.SpellPreview = rendered[:maxLen] + "..."
	} else {
		preview.SpellPreview = rendered
	}
}

// validateCondition validates a 'when' condition template.
func (p *Previewer) validateCondition(condition string, ctx *StepContext) error {
	// Parse template
	tmpl, err := template.New("condition").Parse(condition)
	if err != nil {
		return fmt.Errorf("invalid template syntax: %v", err)
	}

	// Execute with context to find missing variables
	var buf strings.Builder
	if err := tmpl.Execute(&buf, ctx.ToMap()); err != nil {
		return fmt.Errorf("template execution error: %v", err)
	}

	return nil
}

// ToJSON converts the preview result to JSON.
func (r *PreviewResult) ToJSON() (string, error) {
	data, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// ToText converts the preview result to human-readable text.
func (r *PreviewResult) ToText() string {
	var sb strings.Builder

	sb.WriteString(fmt.Sprintf("Grimoire: %s\n", r.GrimoireName))
	sb.WriteString(fmt.Sprintf("Source: %s\n", r.GrimoireSource))
	sb.WriteString("\n")

	// Write steps
	for _, step := range r.Steps {
		writeStepText(&sb, step, 0)
	}

	// Write validation summary
	sb.WriteString("\n")
	if r.IsValid {
		sb.WriteString("Validation: OK - All templates valid\n")
	} else {
		sb.WriteString(fmt.Sprintf("Validation: FAILED - %d error(s) found\n", len(r.Errors)))
		for _, err := range r.Errors {
			if err.StepName != "" {
				sb.WriteString(fmt.Sprintf("  - [%s] %s: %s\n", err.StepName, err.Field, err.Message))
			} else {
				sb.WriteString(fmt.Sprintf("  - %s\n", err.Message))
			}
		}
	}

	return sb.String()
}

// writeStepText writes a step preview as text.
func writeStepText(sb *strings.Builder, step StepPreview, indent int) {
	prefix := strings.Repeat("  ", indent)

	// Step header
	sb.WriteString(fmt.Sprintf("%sStep %d: %s (%s)\n", prefix, step.Index, step.Name, step.Type))

	// Step details based on type
	switch step.Type {
	case "agent":
		sb.WriteString(fmt.Sprintf("%s  Spell: %s (from %s)\n", prefix, step.SpellName, step.SpellSource))
		if step.SpellPreview != "" {
			// Show first line of preview
			lines := strings.SplitN(step.SpellPreview, "\n", 2)
			sb.WriteString(fmt.Sprintf("%s  Preview: %s\n", prefix, lines[0]))
		}
		if step.Output != "" {
			sb.WriteString(fmt.Sprintf("%s  Output: %s\n", prefix, step.Output))
		}

	case "script":
		sb.WriteString(fmt.Sprintf("%s  Command: %s\n", prefix, step.Command))
		if step.OnFail != "" {
			sb.WriteString(fmt.Sprintf("%s  On Fail: %s\n", prefix, step.OnFail))
		}

	case "loop":
		if step.MaxIterations > 0 {
			sb.WriteString(fmt.Sprintf("%s  Max Iterations: %d\n", prefix, step.MaxIterations))
		}
		for _, nested := range step.NestedSteps {
			writeStepText(sb, nested, indent+1)
		}

	case "merge":
		sb.WriteString(fmt.Sprintf("%s  Requires Review: %v\n", prefix, step.RequiresReview))
	}

	// When condition
	if step.When != "" {
		sb.WriteString(fmt.Sprintf("%s  When: %s\n", prefix, step.When))
	}

	// Timeout
	if step.Timeout != "" {
		sb.WriteString(fmt.Sprintf("%s  Timeout: %s\n", prefix, step.Timeout))
	}

	// Step errors
	for _, err := range step.Errors {
		sb.WriteString(fmt.Sprintf("%s  ERROR: %s\n", prefix, err.Message))
	}
}

// ValidateGrimoire validates a grimoire without generating a full preview.
func ValidateGrimoire(g *grimoire.Grimoire) []PreviewError {
	var errors []PreviewError

	if err := g.Validate(); err != nil {
		errors = append(errors, PreviewError{
			Message: err.Error(),
		})
	}

	// Validate step configurations
	for _, step := range g.Steps {
		stepErrors := validateStep(&step)
		errors = append(errors, stepErrors...)
	}

	return errors
}

// validateStep validates a single step.
func validateStep(step *grimoire.Step) []PreviewError {
	var errors []PreviewError

	// Validate timeout format
	if step.Timeout != "" {
		if _, err := step.GetTimeout(); err != nil {
			errors = append(errors, PreviewError{
				StepName: step.Name,
				Field:    "timeout",
				Message:  err.Error(),
			})
		}
	}

	// Validate nested steps for loops
	if step.Type == grimoire.StepTypeLoop {
		for _, nested := range step.Steps {
			nestedErrors := validateStep(&nested)
			errors = append(errors, nestedErrors...)
		}
	}

	return errors
}
