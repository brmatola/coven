import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, _resetVsCodeApi, VsCodeApi } from './App';
import { TaskDetailState, Task } from '../types';

describe('Task Detail App', () => {
  let mockVsCodeApi: VsCodeApi;
  let postedMessages: unknown[];

  beforeEach(() => {
    postedMessages = [];
    mockVsCodeApi = {
      postMessage: vi.fn((msg) => {
        postedMessages.push(msg);
      }),
    };
    _resetVsCodeApi();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const mockTask: Task = {
    id: 'task-123',
    title: 'Test Task',
    description: 'Test description',
    status: 'ready',
    priority: 'medium',
    dependencies: [],
    sourceId: 'beads',
    createdAt: Date.now() - 3600000,
    updatedAt: Date.now(),
  };

  const mockState: TaskDetailState = {
    task: mockTask,
    isLoading: false,
    isSaving: false,
    error: null,
    canStart: true,
    canDelete: true,
    blockingTasks: [],
  };

  function sendState(state: TaskDetailState): void {
    const event = new MessageEvent('message', {
      data: { type: 'state', payload: state },
    });
    window.dispatchEvent(event);
  }

  describe('Loading State', () => {
    it('should show loading message initially', () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      expect(screen.getByText('Loading task details...')).toBeDefined();
    });

    it('should send ready message on mount', () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      expect(mockVsCodeApi.postMessage).toHaveBeenCalledWith({ type: 'ready' });
    });
  });

  describe('Task Display', () => {
    it('should display task title', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState(mockState));

      await waitFor(() => {
        expect(screen.getByDisplayValue('Test Task')).toBeDefined();
      });
    });

    it('should display task description', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState(mockState));

      await waitFor(() => {
        expect(screen.getByDisplayValue('Test description')).toBeDefined();
      });
    });

    it('should display task status badge', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState(mockState));

      await waitFor(() => {
        expect(screen.getByText('Ready')).toBeDefined();
      });
    });

    it('should display task priority badge', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState(mockState));

      await waitFor(() => {
        expect(screen.getByText('Medium')).toBeDefined();
      });
    });

    it('should display task ID', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState(mockState));

      await waitFor(() => {
        expect(screen.getByText('task-123')).toBeDefined();
      });
    });
  });

  describe('Error Handling', () => {
    it('should display error when task not found', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);

      act(() =>
        sendState({
          task: null,
          isLoading: false,
          isSaving: false,
          error: 'Task not found',
          canStart: false,
          canDelete: false,
          blockingTasks: [],
        })
      );

      await waitFor(() => {
        expect(screen.getByText('Task not found')).toBeDefined();
      });
    });

    it('should display error banner with task', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);

      act(() =>
        sendState({
          ...mockState,
          error: 'Failed to save',
        })
      );

      await waitFor(() => {
        expect(screen.getByText('Failed to save')).toBeDefined();
        // Task should still be displayed
        expect(screen.getByDisplayValue('Test Task')).toBeDefined();
      });
    });
  });

  describe('Blocking Tasks', () => {
    it('should display blocking tasks section when blocked', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);

      act(() =>
        sendState({
          ...mockState,
          task: { ...mockTask, status: 'blocked' },
          blockingTasks: [
            { id: 'blocker-1', title: 'Blocking Task', status: 'working' },
          ],
        })
      );

      await waitFor(() => {
        expect(screen.getByText('Blocked by 1 task')).toBeDefined();
        expect(screen.getByText('Blocking Task')).toBeDefined();
      });
    });
  });

  describe('Task Actions', () => {
    it('should show Start Task button when canStart is true', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState(mockState));

      await waitFor(() => {
        expect(screen.getByText('Start Task')).toBeDefined();
      });
    });

    it('should hide Start Task button when canStart is false', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);

      act(() =>
        sendState({
          ...mockState,
          canStart: false,
        })
      );

      await waitFor(() => {
        expect(screen.queryByText('Start Task')).toBeNull();
      });
    });

    it('should send startTask message when Start Task clicked', async () => {
      const user = userEvent.setup();
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState(mockState));

      await waitFor(() => screen.getByText('Start Task'));

      await user.click(screen.getByText('Start Task'));

      expect(postedMessages).toContainEqual({ type: 'startTask' });
    });

    it('should show Delete Task button when canDelete is true', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState(mockState));

      await waitFor(() => {
        expect(screen.getByText('Delete Task')).toBeDefined();
      });
    });

    it('should send deleteTask message when Delete Task clicked', async () => {
      const user = userEvent.setup();
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState(mockState));

      await waitFor(() => screen.getByText('Delete Task'));

      await user.click(screen.getByText('Delete Task'));

      expect(postedMessages).toContainEqual({ type: 'deleteTask' });
    });
  });

  describe('Editing', () => {
    it('should render title input with correct value', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState(mockState));

      await waitFor(() => {
        const input = screen.getByDisplayValue('Test Task');
        expect(input).toBeDefined();
        expect((input as HTMLInputElement).tagName.toLowerCase()).toBe('input');
      });
    });

    it('should render description textarea', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState(mockState));

      await waitFor(() => {
        const textarea = screen.getByDisplayValue('Test description');
        expect(textarea).toBeDefined();
      });
    });

    it('should show saving indicator when isSaving is true', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);

      act(() =>
        sendState({
          ...mockState,
          isSaving: true,
        })
      );

      await waitFor(() => {
        expect(screen.getByText('Saving...')).toBeDefined();
      });
    });
  });

  describe('Metadata', () => {
    it('should display metadata section', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState(mockState));

      await waitFor(() => {
        expect(screen.getByText('Metadata')).toBeDefined();
      });
    });

    it('should display source label', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState(mockState));

      await waitFor(() => {
        expect(screen.getByText('Source')).toBeDefined();
      });
    });
  });
});
