package agent

import (
	"testing"
)

func TestParseStreamJSONOutput(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		wantText    string
		wantContent bool
	}{
		{
			name:        "empty line",
			input:       "",
			wantText:    "",
			wantContent: false,
		},
		{
			name:        "whitespace only",
			input:       "   \t  ",
			wantText:    "",
			wantContent: false,
		},
		{
			name:        "non-JSON line",
			input:       "plain text output",
			wantText:    "plain text output",
			wantContent: true,
		},
		{
			name:        "invalid JSON",
			input:       "{invalid json",
			wantText:    "{invalid json",
			wantContent: true,
		},
		{
			name:        "assistant message with text",
			input:       `{"type":"assistant","message":{"content":[{"type":"text","text":"Hello world"}]}}`,
			wantText:    "Hello world",
			wantContent: true,
		},
		{
			name:        "assistant message with multiple text blocks",
			input:       `{"type":"assistant","message":{"content":[{"type":"text","text":"First"},{"type":"text","text":"Second"}]}}`,
			wantText:    "First\nSecond",
			wantContent: true,
		},
		{
			name:        "assistant message without text",
			input:       `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read"}]}}`,
			wantText:    "",
			wantContent: false,
		},
		{
			name:        "result message",
			input:       `{"type":"result","result":"Final output"}`,
			wantText:    "Final output",
			wantContent: true,
		},
		{
			name:        "result message empty",
			input:       `{"type":"result","result":""}`,
			wantText:    "",
			wantContent: false,
		},
		{
			name:        "text type message",
			input:       `{"type":"text","text":"Direct text"}`,
			wantText:    "Direct text",
			wantContent: true,
		},
		{
			name:        "system init message",
			input:       `{"type":"system","subtype":"init","cwd":"/path"}`,
			wantText:    "",
			wantContent: false,
		},
		{
			name:        "system hook response",
			input:       `{"type":"system","subtype":"hook_response","stdout":"hook output"}`,
			wantText:    "",
			wantContent: false,
		},
		{
			name:        "system message with stdout",
			input:       `{"type":"system","subtype":"other","stdout":"system output"}`,
			wantText:    "system output",
			wantContent: true,
		},
		{
			name:        "unknown type",
			input:       `{"type":"unknown_type","data":"foo"}`,
			wantText:    "",
			wantContent: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotText, gotContent := ParseStreamJSONOutput(tt.input)
			if gotText != tt.wantText {
				t.Errorf("ParseStreamJSONOutput() text = %q, want %q", gotText, tt.wantText)
			}
			if gotContent != tt.wantContent {
				t.Errorf("ParseStreamJSONOutput() hasContent = %v, want %v", gotContent, tt.wantContent)
			}
		})
	}
}
