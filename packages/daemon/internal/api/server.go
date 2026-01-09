package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"sync"
	"time"
)

// Server is an HTTP server that listens on a Unix socket.
type Server struct {
	socketPath string
	listener   net.Listener
	server     *http.Server
	mux        *http.ServeMux
	mu         sync.Mutex
	running    bool
}

// HealthResponse is the response from the health endpoint.
type HealthResponse struct {
	Status    string `json:"status"`
	Version   string `json:"version"`
	Uptime    string `json:"uptime"`
	Workspace string `json:"workspace"`
}

// NewServer creates a new HTTP server that will listen on the given Unix socket path.
func NewServer(socketPath string) *Server {
	mux := http.NewServeMux()
	return &Server{
		socketPath: socketPath,
		mux:        mux,
		server: &http.Server{
			Handler:      mux,
			ReadTimeout:  30 * time.Second,
			WriteTimeout: 30 * time.Second,
		},
	}
}

// RegisterHandler registers an HTTP handler for the given pattern.
func (s *Server) RegisterHandler(pattern string, handler http.Handler) {
	s.mux.Handle(pattern, handler)
}

// RegisterHandlerFunc registers an HTTP handler function for the given pattern.
func (s *Server) RegisterHandlerFunc(pattern string, handler http.HandlerFunc) {
	s.mux.HandleFunc(pattern, handler)
}

// Start begins listening on the Unix socket.
// It will remove any existing socket file before starting.
func (s *Server) Start() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.running {
		return fmt.Errorf("server already running")
	}

	// Remove existing socket if it exists
	if err := os.Remove(s.socketPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove existing socket: %w", err)
	}

	listener, err := net.Listen("unix", s.socketPath)
	if err != nil {
		return fmt.Errorf("failed to listen on socket: %w", err)
	}

	// Set socket permissions (owner read/write only)
	if err := os.Chmod(s.socketPath, 0600); err != nil {
		listener.Close()
		return fmt.Errorf("failed to set socket permissions: %w", err)
	}

	s.listener = listener
	s.running = true

	go func() {
		if err := s.server.Serve(listener); err != nil && err != http.ErrServerClosed {
			// Log error but don't panic - the server might have been shut down
		}
	}()

	return nil
}

// Stop gracefully shuts down the server.
func (s *Server) Stop(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.running {
		return nil
	}

	s.running = false

	if err := s.server.Shutdown(ctx); err != nil {
		return fmt.Errorf("failed to shutdown server: %w", err)
	}

	// Remove socket file
	if err := os.Remove(s.socketPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove socket: %w", err)
	}

	return nil
}

// IsRunning returns whether the server is currently running.
func (s *Server) IsRunning() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.running
}

// SocketPath returns the path to the Unix socket.
func (s *Server) SocketPath() string {
	return s.socketPath
}

// WriteJSON writes a JSON response with the given status code.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// WriteError writes a JSON error response.
func WriteError(w http.ResponseWriter, status int, message string) {
	WriteJSON(w, status, map[string]string{"error": message})
}
