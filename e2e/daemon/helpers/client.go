package helpers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// APIClient provides typed methods for calling daemon API endpoints.
type APIClient struct {
	client *http.Client
}

// NewAPIClient creates a new API client from the test environment.
func NewAPIClient(env *TestEnv) *APIClient {
	return &APIClient{client: env.Client}
}

// Response wraps an HTTP response with helper methods.
type Response struct {
	*http.Response
	body []byte
}

// JSON unmarshals the response body into the given value.
func (r *Response) JSON(v any) error {
	return json.Unmarshal(r.body, v)
}

// String returns the response body as a string.
func (r *Response) String() string {
	return string(r.body)
}

// Get performs a GET request.
func (c *APIClient) Get(path string) (*Response, error) {
	resp, err := c.client.Get("http://unix" + path)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	return &Response{Response: resp, body: body}, nil
}

// Post performs a POST request with optional JSON body.
func (c *APIClient) Post(path string, body any) (*Response, error) {
	var reqBody io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal body: %w", err)
		}
		reqBody = bytes.NewReader(data)
	}

	resp, err := c.client.Post("http://unix"+path, "application/json", reqBody)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	return &Response{Response: resp, body: respBody}, nil
}

// HealthResponse represents the health endpoint response.
type HealthResponse struct {
	Status    string `json:"status"`
	Version   string `json:"version"`
	Uptime    string `json:"uptime"`
	Workspace string `json:"workspace"`
}

// GetHealth calls GET /health.
func (c *APIClient) GetHealth() (*HealthResponse, error) {
	resp, err := c.Get("/health")
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}
	var health HealthResponse
	if err := resp.JSON(&health); err != nil {
		return nil, err
	}
	return &health, nil
}

// VersionResponse represents the version endpoint response.
type VersionResponse struct {
	Version   string `json:"version"`
	GitCommit string `json:"git_commit,omitempty"`
	BuildTime string `json:"build_time,omitempty"`
	GoVersion string `json:"go_version,omitempty"`
}

// GetVersion calls GET /version.
func (c *APIClient) GetVersion() (*VersionResponse, error) {
	resp, err := c.Get("/version")
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}
	var version VersionResponse
	if err := resp.JSON(&version); err != nil {
		return nil, err
	}
	return &version, nil
}

// SessionStatusResponse represents the session status response.
type SessionStatusResponse struct {
	Active   bool   `json:"active"`
	Stopping bool   `json:"stopping"`
	Status   string `json:"status"`
}

// GetSessionStatus calls GET /session/status.
func (c *APIClient) GetSessionStatus() (*SessionStatusResponse, error) {
	resp, err := c.Get("/session/status")
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}
	var status SessionStatusResponse
	if err := resp.JSON(&status); err != nil {
		return nil, err
	}
	return &status, nil
}

// StartSession calls POST /session/start.
func (c *APIClient) StartSession() error {
	resp, err := c.Post("/session/start", nil)
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status: %d - %s", resp.StatusCode, resp.String())
	}
	return nil
}

// StopSession calls POST /session/stop.
func (c *APIClient) StopSession() error {
	resp, err := c.Post("/session/stop", nil)
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status: %d - %s", resp.StatusCode, resp.String())
	}
	return nil
}

// ForceStopSession calls POST /session/stop with force=true.
func (c *APIClient) ForceStopSession() error {
	resp, err := c.Post("/session/stop", map[string]bool{"force": true})
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status: %d - %s", resp.StatusCode, resp.String())
	}
	return nil
}

// Task represents a task in the API response.
type Task struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	Status      string `json:"status"`
	Priority    int    `json:"priority,omitempty"`
}

// TasksResponse represents the tasks list response.
type TasksResponse struct {
	Tasks []Task `json:"tasks"`
	Count int    `json:"count"`
}

// GetTasks calls GET /tasks.
func (c *APIClient) GetTasks() (*TasksResponse, error) {
	resp, err := c.Get("/tasks")
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}
	var tasks TasksResponse
	if err := resp.JSON(&tasks); err != nil {
		return nil, err
	}
	return &tasks, nil
}

// StartTask calls POST /tasks/:id/start.
func (c *APIClient) StartTask(taskID string) error {
	resp, err := c.Post("/tasks/"+taskID+"/start", nil)
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status: %d - %s", resp.StatusCode, resp.String())
	}
	return nil
}

// StopTask calls POST /tasks/:id/stop.
func (c *APIClient) StopTask(taskID string) error {
	resp, err := c.Post("/tasks/"+taskID+"/stop", nil)
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status: %d - %s", resp.StatusCode, resp.String())
	}
	return nil
}

// Agent represents an agent in the API response.
type Agent struct {
	ID        string `json:"id"`
	TaskID    string `json:"task_id"`
	Status    string `json:"status"`
	Worktree  string `json:"worktree,omitempty"`
	PID       int    `json:"pid,omitempty"`
	StartedAt string `json:"started_at,omitempty"`
}

// AgentsResponse represents the agents list response.
type AgentsResponse struct {
	Agents []Agent `json:"agents"`
	Count  int     `json:"count"`
}

// GetAgents calls GET /agents.
func (c *APIClient) GetAgents() (*AgentsResponse, error) {
	resp, err := c.Get("/agents")
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}
	var agents AgentsResponse
	if err := resp.JSON(&agents); err != nil {
		return nil, err
	}
	return &agents, nil
}

// GetAgent calls GET /agents/:id.
func (c *APIClient) GetAgent(agentID string) (*Agent, error) {
	resp, err := c.Get("/agents/" + agentID)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}
	var agent Agent
	if err := resp.JSON(&agent); err != nil {
		return nil, err
	}
	return &agent, nil
}

// Question represents a question in the API response.
type Question struct {
	ID         string   `json:"id"`
	TaskID     string   `json:"task_id"`
	Type       string   `json:"type"`
	Text       string   `json:"text"`
	Options    []string `json:"options,omitempty"`
	AnsweredAt string   `json:"answered_at,omitempty"`
	Answer     string   `json:"answer,omitempty"`
}

// QuestionsResponse represents the questions list response.
type QuestionsResponse struct {
	Questions    []Question `json:"questions"`
	Count        int        `json:"count"`
	PendingCount int        `json:"pending_count"`
}

// GetQuestions calls GET /questions.
func (c *APIClient) GetQuestions() (*QuestionsResponse, error) {
	resp, err := c.Get("/questions")
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}
	var questions QuestionsResponse
	if err := resp.JSON(&questions); err != nil {
		return nil, err
	}
	return &questions, nil
}

// AnswerQuestion calls POST /questions/:id/answer.
func (c *APIClient) AnswerQuestion(questionID, answer string) error {
	resp, err := c.Post("/questions/"+questionID+"/answer", map[string]string{"answer": answer})
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status: %d - %s", resp.StatusCode, resp.String())
	}
	return nil
}

// StateResponse represents the full state response.
type StateResponse struct {
	State struct {
		Session struct {
			Status    string `json:"status"`
			StartedAt string `json:"started_at,omitempty"`
		} `json:"session"`
		Agents map[string]*Agent `json:"agents"`
		Tasks  []Task            `json:"tasks"`
	} `json:"state"`
}

// GetState calls GET /state.
func (c *APIClient) GetState() (*StateResponse, error) {
	resp, err := c.Get("/state")
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}
	var state StateResponse
	if err := resp.JSON(&state); err != nil {
		return nil, err
	}
	return &state, nil
}

// Shutdown calls POST /shutdown.
func (c *APIClient) Shutdown() error {
	resp, err := c.Post("/shutdown", nil)
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status: %d - %s", resp.StatusCode, resp.String())
	}
	return nil
}
