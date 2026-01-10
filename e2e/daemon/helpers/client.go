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

// OutputLine represents a line of agent output.
type OutputLine struct {
	Sequence  uint64 `json:"sequence"`
	Timestamp string `json:"timestamp"`
	Stream    string `json:"stream"`
	Data      string `json:"data"`
}

// AgentOutputResponse represents the agent output response.
type AgentOutputResponse struct {
	TaskID    string       `json:"task_id"`
	Lines     []OutputLine `json:"lines"`
	LineCount int          `json:"line_count"`
	LastSeq   uint64       `json:"last_seq"`
}

// GetAgentOutput calls GET /agents/:id/output.
func (c *APIClient) GetAgentOutput(taskID string) (*AgentOutputResponse, error) {
	resp, err := c.Get("/agents/" + taskID + "/output")
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}
	var output AgentOutputResponse
	if err := resp.JSON(&output); err != nil {
		return nil, err
	}
	return &output, nil
}

// GetAgentOutputSince calls GET /agents/:id/output?since=N.
func (c *APIClient) GetAgentOutputSince(taskID string, since uint64) (*AgentOutputResponse, error) {
	resp, err := c.Get(fmt.Sprintf("/agents/%s/output?since=%d", taskID, since))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}
	var output AgentOutputResponse
	if err := resp.JSON(&output); err != nil {
		return nil, err
	}
	return &output, nil
}

// KillAgent calls POST /agents/:id/kill.
func (c *APIClient) KillAgent(taskID string) error {
	resp, err := c.Post("/agents/"+taskID+"/kill", nil)
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status: %d - %s", resp.StatusCode, resp.String())
	}
	return nil
}

// RespondToAgent calls POST /agents/:id/respond.
func (c *APIClient) RespondToAgent(taskID, response string) error {
	resp, err := c.Post("/agents/"+taskID+"/respond", map[string]string{"response": response})
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status: %d - %s", resp.StatusCode, resp.String())
	}
	return nil
}

// Workflow represents a workflow in the API response.
type Workflow struct {
	WorkflowID     string                 `json:"workflow_id"`
	TaskID         string                 `json:"task_id"`
	GrimoireName   string                 `json:"grimoire_name"`
	Status         string                 `json:"status"`
	CurrentStep    int                    `json:"current_step"`
	WorktreePath   string                 `json:"worktree_path"`
	StartedAt      string                 `json:"started_at,omitempty"`
	UpdatedAt      string                 `json:"updated_at,omitempty"`
	Error          string                 `json:"error,omitempty"`
	Actions        []string               `json:"available_actions,omitempty"`
	MergeReview    map[string]interface{} `json:"merge_review,omitempty"`
	CompletedSteps map[string]interface{} `json:"completed_steps,omitempty"`
	StepOutputs    map[string]string      `json:"step_outputs,omitempty"`
}

// WorkflowsResponse represents the workflows list response.
type WorkflowsResponse struct {
	Workflows []Workflow `json:"workflows"`
	Count     int        `json:"count"`
}

// GetWorkflows calls GET /workflows.
func (c *APIClient) GetWorkflows() (*WorkflowsResponse, error) {
	resp, err := c.Get("/workflows")
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d - %s", resp.StatusCode, resp.String())
	}
	var workflows WorkflowsResponse
	if err := resp.JSON(&workflows); err != nil {
		return nil, err
	}
	return &workflows, nil
}

// GetWorkflow calls GET /workflows/:id.
func (c *APIClient) GetWorkflow(id string) (*Workflow, error) {
	resp, err := c.Get("/workflows/" + id)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d - %s", resp.StatusCode, resp.String())
	}
	var workflow Workflow
	if err := resp.JSON(&workflow); err != nil {
		return nil, err
	}
	return &workflow, nil
}

// CancelWorkflow calls POST /workflows/:id/cancel.
func (c *APIClient) CancelWorkflow(id string) error {
	resp, err := c.Post("/workflows/"+id+"/cancel", nil)
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status: %d - %s", resp.StatusCode, resp.String())
	}
	return nil
}

// RetryWorkflow calls POST /workflows/:id/retry.
func (c *APIClient) RetryWorkflow(id string) error {
	resp, err := c.Post("/workflows/"+id+"/retry", nil)
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status: %d - %s", resp.StatusCode, resp.String())
	}
	return nil
}

// ApproveMerge calls POST /workflows/:id/approve-merge.
func (c *APIClient) ApproveMerge(id string) error {
	resp, err := c.Post("/workflows/"+id+"/approve-merge", nil)
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status: %d - %s", resp.StatusCode, resp.String())
	}
	return nil
}

// RejectMerge calls POST /workflows/:id/reject-merge.
func (c *APIClient) RejectMerge(id string, reason string) error {
	body := map[string]string{}
	if reason != "" {
		body["reason"] = reason
	}
	resp, err := c.Post("/workflows/"+id+"/reject-merge", body)
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status: %d - %s", resp.StatusCode, resp.String())
	}
	return nil
}
