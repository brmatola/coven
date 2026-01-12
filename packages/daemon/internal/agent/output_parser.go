package agent

import (
	"encoding/json"
	"strings"
)

// StreamJSONMessage represents a message from claude's stream-json output format.
type StreamJSONMessage struct {
	Type    string          `json:"type"`
	Subtype string          `json:"subtype,omitempty"`
	Message *AssistantMsg   `json:"message,omitempty"`
	Result  string          `json:"result,omitempty"`
	Text    string          `json:"text,omitempty"` // For text type messages
	Stdout  string          `json:"stdout,omitempty"`
	Stderr  string          `json:"stderr,omitempty"`
}

// AssistantMsg represents an assistant message.
type AssistantMsg struct {
	Content []ContentBlock `json:"content,omitempty"`
}

// ContentBlock represents a content block in an assistant message.
type ContentBlock struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
	Name string `json:"name,omitempty"` // For tool_use
}

// ParseStreamJSONOutput parses a line from claude's stream-json output format.
// It returns the extracted text content and whether there was any content.
// For non-JSON lines or lines without relevant content, it returns the original line.
func ParseStreamJSONOutput(line string) (text string, hasContent bool) {
	line = strings.TrimSpace(line)
	if line == "" {
		return "", false
	}

	// Not JSON? Return as-is
	if !strings.HasPrefix(line, "{") {
		return line, true
	}

	var msg StreamJSONMessage
	if err := json.Unmarshal([]byte(line), &msg); err != nil {
		// Failed to parse, return original line
		return line, true
	}

	// Extract content based on message type
	switch msg.Type {
	case "assistant":
		// Extract text from assistant message content blocks
		if msg.Message != nil {
			var texts []string
			for _, block := range msg.Message.Content {
				if block.Type == "text" && block.Text != "" {
					texts = append(texts, block.Text)
				}
			}
			if len(texts) > 0 {
				return strings.Join(texts, "\n"), true
			}
		}
		return "", false

	case "result":
		// Final result - return the result text
		if msg.Result != "" {
			return msg.Result, true
		}
		return "", false

	case "text":
		// Direct text output
		if msg.Text != "" {
			return msg.Text, true
		}
		return "", false

	case "system":
		// System messages - extract stdout/stderr if present
		// These are often from hooks, skip most of them
		if msg.Subtype == "hook_response" {
			// Skip hook output - too noisy
			return "", false
		}
		if msg.Stdout != "" {
			return msg.Stdout, true
		}
		if msg.Stderr != "" {
			return msg.Stderr, true
		}
		return "", false

	default:
		// Unknown type - skip
		return "", false
	}
}
