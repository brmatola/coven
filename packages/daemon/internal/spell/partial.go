package spell

import (
	"bytes"
	"fmt"
	"strings"
	"text/template"
)

const (
	// MaxIncludeDepth is the maximum nesting depth for includes.
	MaxIncludeDepth = 5
)

// IncludeError represents an error during include processing.
type IncludeError struct {
	PartialName string
	Err         error
}

func (e *IncludeError) Error() string {
	return fmt.Sprintf("failed to include partial %q: %v", e.PartialName, e.Err)
}

func (e *IncludeError) Unwrap() error {
	return e.Err
}

// CircularIncludeError is returned when a circular include is detected.
type CircularIncludeError struct {
	PartialName string
	Stack       []string
}

func (e *CircularIncludeError) Error() string {
	return fmt.Sprintf("circular include detected: %s -> %s", strings.Join(e.Stack, " -> "), e.PartialName)
}

// MaxDepthError is returned when the include depth exceeds the limit.
type MaxDepthError struct {
	PartialName string
	Depth       int
	MaxDepth    int
}

func (e *MaxDepthError) Error() string {
	return fmt.Sprintf("include depth exceeded: %d > %d (including %q)", e.Depth, e.MaxDepth, e.PartialName)
}

// PartialRenderer extends Renderer with partial/include support.
type PartialRenderer struct {
	*Renderer
	loader *Loader
}

// NewPartialRenderer creates a renderer with partial support.
func NewPartialRenderer(loader *Loader) *PartialRenderer {
	return &PartialRenderer{
		Renderer: NewRenderer(),
		loader:   loader,
	}
}

// NewPartialRendererWithOptions creates a renderer with partial support and custom options.
func NewPartialRendererWithOptions(loader *Loader, opts RenderOptions) *PartialRenderer {
	return &PartialRenderer{
		Renderer: NewRendererWithOptions(opts),
		loader:   loader,
	}
}

// Render renders a spell template with include support.
func (r *PartialRenderer) Render(spell *Spell, ctx RenderContext) (string, error) {
	if spell == nil {
		return "", fmt.Errorf("spell cannot be nil")
	}

	return r.renderWithIncludes(spell.Name, spell.Content, ctx, nil)
}

// RenderString renders a template string with include support.
func (r *PartialRenderer) RenderString(name, content string, ctx RenderContext) (string, error) {
	return r.renderWithIncludes(name, content, ctx, nil)
}

// renderWithIncludes renders a template with include tracking.
func (r *PartialRenderer) renderWithIncludes(name, content string, ctx RenderContext, stack []string) (string, error) {
	if ctx == nil {
		ctx = make(RenderContext)
	}

	// Check for circular includes
	for _, stackName := range stack {
		if stackName == name {
			return "", &CircularIncludeError{
				PartialName: name,
				Stack:       stack,
			}
		}
	}

	// Check depth limit
	if len(stack) >= MaxIncludeDepth {
		return "", &MaxDepthError{
			PartialName: name,
			Depth:       len(stack) + 1,
			MaxDepth:    MaxIncludeDepth,
		}
	}

	// Create template with options
	tmpl := template.New(name)

	// Configure missing key behavior
	if r.options.MissingKeyError {
		tmpl = tmpl.Option("missingkey=error")
	} else {
		tmpl = tmpl.Option("missingkey=zero")
	}

	// Add custom template functions including 'include'
	funcs := templateFuncs()
	funcs["include"] = r.makeIncludeFunc(ctx, append(stack, name))
	tmpl = tmpl.Funcs(funcs)

	// Parse the template
	parsed, err := tmpl.Parse(content)
	if err != nil {
		return "", &TemplateParseError{
			Name:    name,
			Content: content,
			Err:     err,
		}
	}

	// Execute the template
	var buf bytes.Buffer
	if err := parsed.Execute(&buf, ctx); err != nil {
		return "", &TemplateRenderError{
			Name: name,
			Err:  err,
		}
	}

	return buf.String(), nil
}

// makeIncludeFunc creates the include template function with closure over context and stack.
// Usage: {{include "partial-name" "key1" "value1" "key2" "value2"}}
// Or: {{include "partial-name"}} for no extra variables
func (r *PartialRenderer) makeIncludeFunc(parentCtx RenderContext, stack []string) func(args ...interface{}) (string, error) {
	return func(args ...interface{}) (string, error) {
		if len(args) == 0 {
			return "", fmt.Errorf("include requires at least a partial name")
		}

		// First arg is the partial name
		partialName, ok := args[0].(string)
		if !ok {
			return "", fmt.Errorf("include: partial name must be a string, got %T", args[0])
		}

		// Remaining args are key-value pairs
		if len(args) > 1 && (len(args)-1)%2 != 0 {
			return "", fmt.Errorf("include: variables must be key-value pairs")
		}

		// Build context: start with parent context, then overlay with include args
		includeCtx := make(RenderContext)
		for k, v := range parentCtx {
			includeCtx[k] = v
		}

		// Parse key-value pairs
		for i := 1; i < len(args); i += 2 {
			key, ok := args[i].(string)
			if !ok {
				return "", fmt.Errorf("include: variable key must be a string, got %T", args[i])
			}
			includeCtx[key] = args[i+1]
		}

		// Load the partial
		partial, err := r.loader.Load(partialName)
		if err != nil {
			return "", &IncludeError{
				PartialName: partialName,
				Err:         err,
			}
		}

		// Render the partial with the merged context
		result, err := r.renderWithIncludes(partialName, partial.Content, includeCtx, stack)
		if err != nil {
			return "", &IncludeError{
				PartialName: partialName,
				Err:         err,
			}
		}

		return result, nil
	}
}

// IsCircularIncludeError returns true if the error is a CircularIncludeError.
func IsCircularIncludeError(err error) bool {
	_, ok := err.(*CircularIncludeError)
	return ok
}

// IsMaxDepthError returns true if the error is a MaxDepthError.
func IsMaxDepthError(err error) bool {
	_, ok := err.(*MaxDepthError)
	return ok
}

// IsIncludeError returns true if the error is an IncludeError.
func IsIncludeError(err error) bool {
	_, ok := err.(*IncludeError)
	return ok
}
