package spell

import (
	"bytes"
	"fmt"
	"strings"
	"text/template"
)

// RenderContext contains the data available during template rendering.
type RenderContext map[string]interface{}

// Renderer handles rendering spell templates with variable substitution.
type Renderer struct {
	// options contains the rendering options.
	options RenderOptions
}

// RenderOptions configures the renderer behavior.
type RenderOptions struct {
	// MissingKeyError controls whether missing keys cause errors.
	// When true (default), accessing a missing key returns an error.
	// When false, missing keys are replaced with an empty string.
	MissingKeyError bool
}

// DefaultRenderOptions returns the default rendering options.
func DefaultRenderOptions() RenderOptions {
	return RenderOptions{
		MissingKeyError: true,
	}
}

// NewRenderer creates a new spell renderer with default options.
func NewRenderer() *Renderer {
	return &Renderer{
		options: DefaultRenderOptions(),
	}
}

// NewRendererWithOptions creates a new spell renderer with custom options.
func NewRendererWithOptions(opts RenderOptions) *Renderer {
	return &Renderer{
		options: opts,
	}
}

// Render renders a spell template with the provided context.
// The context map is available as the root object in templates.
// Example: {{.taskTitle}} accesses context["taskTitle"]
func (r *Renderer) Render(spell *Spell, ctx RenderContext) (string, error) {
	if spell == nil {
		return "", fmt.Errorf("spell cannot be nil")
	}

	return r.RenderString(spell.Name, spell.Content, ctx)
}

// RenderString renders a template string with the provided context.
// The name is used for error messages and template identification.
func (r *Renderer) RenderString(name, content string, ctx RenderContext) (string, error) {
	if ctx == nil {
		ctx = make(RenderContext)
	}

	// Create template with options
	tmpl := template.New(name)

	// Configure missing key behavior
	if r.options.MissingKeyError {
		tmpl = tmpl.Option("missingkey=error")
	} else {
		tmpl = tmpl.Option("missingkey=zero")
	}

	// Add custom template functions
	tmpl = tmpl.Funcs(templateFuncs())

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

// templateFuncs returns custom template functions available in spells.
func templateFuncs() template.FuncMap {
	return template.FuncMap{
		// default returns the default value if the given value is empty.
		"default": func(defaultVal, val interface{}) interface{} {
			if val == nil {
				return defaultVal
			}
			if s, ok := val.(string); ok && s == "" {
				return defaultVal
			}
			return val
		},

		// join concatenates slice elements with a separator.
		"join": func(sep string, items interface{}) string {
			switch v := items.(type) {
			case []string:
				return strings.Join(v, sep)
			case []interface{}:
				strs := make([]string, len(v))
				for i, item := range v {
					strs[i] = fmt.Sprint(item)
				}
				return strings.Join(strs, sep)
			default:
				return fmt.Sprint(items)
			}
		},

		// upper converts a string to uppercase.
		"upper": strings.ToUpper,

		// lower converts a string to lowercase.
		"lower": strings.ToLower,

		// trim removes leading and trailing whitespace.
		"trim": strings.TrimSpace,

		// indent adds a prefix to each line.
		"indent": func(spaces int, s string) string {
			prefix := strings.Repeat(" ", spaces)
			lines := strings.Split(s, "\n")
			for i, line := range lines {
				if line != "" {
					lines[i] = prefix + line
				}
			}
			return strings.Join(lines, "\n")
		},

		// quote wraps a string in double quotes.
		"quote": func(s string) string {
			return fmt.Sprintf("%q", s)
		},
	}
}

// TemplateParseError is returned when a template fails to parse.
type TemplateParseError struct {
	Name    string
	Content string
	Err     error
}

func (e *TemplateParseError) Error() string {
	return fmt.Sprintf("failed to parse spell template %q: %v", e.Name, e.Err)
}

func (e *TemplateParseError) Unwrap() error {
	return e.Err
}

// TemplateRenderError is returned when a template fails to render.
type TemplateRenderError struct {
	Name string
	Err  error
}

func (e *TemplateRenderError) Error() string {
	return fmt.Sprintf("failed to render spell template %q: %v", e.Name, e.Err)
}

func (e *TemplateRenderError) Unwrap() error {
	return e.Err
}

// IsParseError returns true if the error is a TemplateParseError.
func IsParseError(err error) bool {
	_, ok := err.(*TemplateParseError)
	return ok
}

// IsRenderError returns true if the error is a TemplateRenderError.
func IsRenderError(err error) bool {
	_, ok := err.(*TemplateRenderError)
	return ok
}
