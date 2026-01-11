import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, _resetVsCodeApi, VsCodeApi } from './App';
import { ReviewState, ReviewMessageToWebview } from '../types';

describe('Review App', () => {
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

  const mockState: ReviewState = {
    workflowId: 'workflow-123',
    taskId: 'task-123',
    title: 'Test Task',
    description: 'Test description',
    acceptanceCriteria: '- Criterion 1\n- Criterion 2',
    stepOutputs: [
      { step_id: 'step-1', step_name: 'implement', summary: 'Task completed successfully', exit_code: 0 },
      { step_id: 'step-2', step_name: 'test', summary: 'All tests passed', exit_code: 0 },
    ],
    completedAt: Date.now(),
    durationMs: 60000,
    changedFiles: [
      { path: 'file1.ts', linesAdded: 10, linesDeleted: 5, changeType: 'modified' },
      { path: 'file2.ts', linesAdded: 20, linesDeleted: 0, changeType: 'added' },
    ],
    totalLinesAdded: 30,
    totalLinesDeleted: 5,
    status: 'pending',
    checkResults: [],
    checksEnabled: false,
  };

  function sendState(state: ReviewState): void {
    const event = new MessageEvent('message', {
      data: { type: 'state', payload: state } as ReviewMessageToWebview,
    });
    window.dispatchEvent(event);
  }

  describe('Loading State', () => {
    it('shows loading message initially', () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      expect(screen.getByText('Loading review...')).toBeDefined();
    });

    it('sends refresh message on mount', () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      expect(mockVsCodeApi.postMessage).toHaveBeenCalledWith({ type: 'refresh' });
    });
  });

  describe('Review Display', () => {
    it('displays task title', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState(mockState));

      await waitFor(() => {
        expect(screen.getByText('Test Task')).toBeDefined();
      });
    });

    it('displays description', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState(mockState));

      await waitFor(() => {
        expect(screen.getByText('Test description')).toBeDefined();
      });
    });

    it('displays acceptance criteria', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState(mockState));

      await waitFor(() => {
        expect(screen.getByText('Acceptance Criteria')).toBeDefined();
        expect(screen.getByText(/Criterion 1/)).toBeDefined();
        expect(screen.getByText(/Criterion 2/)).toBeDefined();
      });
    });

    it('displays step outputs', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState(mockState));

      await waitFor(() => {
        expect(screen.getByText('Step Outputs')).toBeDefined();
        expect(screen.getByText('implement')).toBeDefined();
        expect(screen.getByText('Task completed successfully')).toBeDefined();
        expect(screen.getByText('test')).toBeDefined();
        expect(screen.getByText('All tests passed')).toBeDefined();
      });
    });

    it('displays duration when available', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState(mockState));

      await waitFor(() => {
        expect(screen.getByText(/Duration: 1m 0s/)).toBeDefined();
      });
    });
  });

  describe('Changed Files', () => {
    it('displays changed files section', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState(mockState));

      await waitFor(() => {
        expect(screen.getByText('Changed Files')).toBeDefined();
      });
    });

    it('displays file list', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState(mockState));

      await waitFor(() => {
        expect(screen.getByText('file1.ts')).toBeDefined();
        expect(screen.getByText('file2.ts')).toBeDefined();
      });
    });

    it('displays total line changes', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState(mockState));

      await waitFor(() => {
        // Use getAllByText since line counts appear both in summary and individual files
        expect(screen.getAllByText('+30').length).toBeGreaterThan(0);
        expect(screen.getAllByText('-5').length).toBeGreaterThan(0);
        expect(screen.getByText('2 files')).toBeDefined();
      });
    });

    it('shows no changes message when no files', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState({ ...mockState, changedFiles: [] }));

      await waitFor(() => {
        expect(screen.getByText('No changes detected')).toBeDefined();
      });
    });
  });

  describe('View Diff', () => {
    it('sends viewDiff message when clicking view diff button', async () => {
      const user = userEvent.setup();
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState(mockState));

      await waitFor(() => {
        expect(screen.getByText('file1.ts')).toBeDefined();
      });

      const viewDiffButtons = screen.getAllByText('View Diff');
      await user.click(viewDiffButtons[0]);

      expect(mockVsCodeApi.postMessage).toHaveBeenCalledWith({
        type: 'viewDiff',
        payload: { filePath: 'file1.ts' },
      });
    });

    it('sends viewAllChanges message when clicking view all', async () => {
      const user = userEvent.setup();
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState(mockState));

      await waitFor(() => {
        expect(screen.getByText('View All Changes')).toBeDefined();
      });

      await user.click(screen.getByText('View All Changes'));

      expect(mockVsCodeApi.postMessage).toHaveBeenCalledWith({
        type: 'viewAllChanges',
      });
    });
  });

  describe('Pre-Merge Checks', () => {
    it('shows pre-merge checks section when enabled', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState({ ...mockState, checksEnabled: true }));

      await waitFor(() => {
        expect(screen.getByText('Pre-Merge Checks')).toBeDefined();
      });
    });

    it('hides pre-merge checks section when disabled', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState({ ...mockState, checksEnabled: false }));

      await waitFor(() => {
        expect(screen.queryByText('Pre-Merge Checks')).toBeNull();
      });
    });

    it('sends runChecks message when clicking run checks', async () => {
      const user = userEvent.setup();
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState({ ...mockState, checksEnabled: true }));

      await waitFor(() => {
        expect(screen.getByText('Run Checks')).toBeDefined();
      });

      await user.click(screen.getByText('Run Checks'));

      expect(mockVsCodeApi.postMessage).toHaveBeenCalledWith({
        type: 'runChecks',
      });
    });

    it('displays check results', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() =>
        sendState({
          ...mockState,
          checksEnabled: true,
          checkResults: [
            { command: 'npm test', status: 'passed', durationMs: 5000 },
            { command: 'npm run lint', status: 'failed', exitCode: 1 },
          ],
        })
      );

      await waitFor(() => {
        expect(screen.getByText('npm test')).toBeDefined();
        expect(screen.getByText('npm run lint')).toBeDefined();
      });
    });
  });

  describe('Approval Flow', () => {
    it('sends approve message when clicking approve', async () => {
      const user = userEvent.setup();
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState(mockState));

      await waitFor(() => {
        expect(screen.getByText('Approve & Merge')).toBeDefined();
      });

      await user.click(screen.getByText('Approve & Merge'));

      expect(mockVsCodeApi.postMessage).toHaveBeenCalledWith({
        type: 'approve',
        payload: { feedback: undefined },
      });
    });

    it('includes feedback in approve message', async () => {
      const user = userEvent.setup();
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState(mockState));

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Add feedback/)).toBeDefined();
      });

      const feedbackInput = screen.getByPlaceholderText(/Add feedback/);
      await user.type(feedbackInput, 'Great work!');
      await user.click(screen.getByText('Approve & Merge'));

      expect(mockVsCodeApi.postMessage).toHaveBeenCalledWith({
        type: 'approve',
        payload: { feedback: 'Great work!' },
      });
    });

    it('disables approve button when checking', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState({ ...mockState, status: 'checking' }));

      await waitFor(() => {
        const approveButton = screen.getByText('Approve & Merge');
        expect(approveButton.closest('button')).toHaveProperty('disabled', true);
      });
    });

    it('disables approve button when checks failed', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() =>
        sendState({
          ...mockState,
          checksEnabled: true,
          checkResults: [{ command: 'npm test', status: 'failed' }],
        })
      );

      await waitFor(() => {
        const approveButton = screen.getByText('Approve & Merge');
        expect(approveButton.closest('button')).toHaveProperty('disabled', true);
      });
    });
  });

  describe('Revert Flow', () => {
    it('shows revert dialog when clicking revert', async () => {
      const user = userEvent.setup();
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState(mockState));

      await waitFor(() => {
        expect(screen.getByText('Revert Changes')).toBeDefined();
      });

      await user.click(screen.getByText('Revert Changes'));

      await waitFor(() => {
        expect(screen.getByText(/Are you sure you want to revert/)).toBeDefined();
      });
    });

    it('sends revert message when confirming', async () => {
      const user = userEvent.setup();
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState(mockState));

      await waitFor(() => {
        expect(screen.getByText('Revert Changes')).toBeDefined();
      });

      await user.click(screen.getByText('Revert Changes'));

      await waitFor(() => {
        expect(screen.getByText(/Are you sure you want to revert/)).toBeDefined();
      });

      // Type reason
      const reasonInput = screen.getByPlaceholderText(/Reason for reverting/);
      await user.type(reasonInput, 'Needs more work');

      // Click the Revert button in the dialog (not the original button)
      const revertButtons = screen.getAllByText('Revert');
      await user.click(revertButtons[revertButtons.length - 1]);

      expect(mockVsCodeApi.postMessage).toHaveBeenCalledWith({
        type: 'revert',
        payload: { reason: 'Needs more work' },
      });
    });

    it('closes dialog when clicking cancel', async () => {
      const user = userEvent.setup();
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() => sendState(mockState));

      await user.click(screen.getByText('Revert Changes'));

      await waitFor(() => {
        expect(screen.getByText(/Are you sure you want to revert/)).toBeDefined();
      });

      await user.click(screen.getByText('Cancel'));

      await waitFor(() => {
        expect(screen.queryByText(/Are you sure you want to revert/)).toBeNull();
      });
    });
  });

  describe('Override Flow', () => {
    it('shows override button when checks failed', async () => {
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() =>
        sendState({
          ...mockState,
          checksEnabled: true,
          checkResults: [{ command: 'npm test', status: 'failed' }],
        })
      );

      await waitFor(() => {
        expect(screen.getByText('Override Checks')).toBeDefined();
      });
    });

    it('sends overrideChecks message when confirming', async () => {
      const user = userEvent.setup();
      render(<App vsCodeApi={mockVsCodeApi} />);
      act(() =>
        sendState({
          ...mockState,
          checksEnabled: true,
          checkResults: [{ command: 'npm test', status: 'failed' }],
        })
      );

      await waitFor(() => {
        expect(screen.getByText('Override Checks')).toBeDefined();
      });

      await user.click(screen.getByText('Override Checks'));

      await waitFor(() => {
        expect(screen.getByText(/Pre-merge checks failed/)).toBeDefined();
      });

      const reasonInput = screen.getByPlaceholderText(/Reason for override/);
      await user.type(reasonInput, 'Test is flaky');

      await user.click(screen.getByText('Override & Approve'));

      expect(mockVsCodeApi.postMessage).toHaveBeenCalledWith({
        type: 'overrideChecks',
        payload: { reason: 'Test is flaky' },
      });
    });
  });
});
