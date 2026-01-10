import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, VsCodeApi } from './App';
import type { SetupState } from '../types';

function createMockVsCodeApi(): VsCodeApi & { postMessage: ReturnType<typeof vi.fn> } {
  return {
    postMessage: vi.fn(),
  };
}

function createMockState(overrides: Partial<SetupState> = {}): SetupState {
  return {
    tools: [
      { name: 'git', available: true, version: 'git 2.40.0', installUrl: 'https://git-scm.com' },
      { name: 'claude', available: true, version: 'claude 1.0.0', installUrl: 'https://claude.ai' },
      { name: 'openspec', available: false, installUrl: 'https://openspec.dev' },
    ],
    inits: [
      { name: 'openspec', initialized: false },
      { name: 'beads', initialized: true },
    ],
    workspace: {
      isMultiRoot: false,
      folderCount: 1,
    },
    allMet: false,
    ...overrides,
  };
}

function createSessionConfigState(overrides: Partial<SetupState> = {}): SetupState {
  return {
    phase: 'session-config',
    tools: [],
    inits: [],
    workspace: {
      isMultiRoot: false,
      folderCount: 1,
    },
    allMet: true,
    availableBranches: ['main', 'develop', 'feature/test'],
    selectedBranch: null,
    sessionConfig: {
      maxConcurrentAgents: 2,
      worktreeBasePath: '.worktrees',
      autoApprove: false,
    },
    ...overrides,
  };
}

function simulateMessage(data: unknown): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data }));
  });
}

describe('App', () => {
  let mockVsCode: ReturnType<typeof createMockVsCodeApi>;

  beforeEach(() => {
    mockVsCode = createMockVsCodeApi();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loading state', () => {
    it('shows loading message initially', () => {
      render(<App vsCodeApi={mockVsCode} />);

      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('requests initial state on mount', () => {
      render(<App vsCodeApi={mockVsCode} />);

      expect(mockVsCode.postMessage).toHaveBeenCalledWith({ type: 'refresh' });
    });
  });

  describe('with state loaded', () => {
    it('renders setup container after receiving state', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({ type: 'state', payload: createMockState() });

      await waitFor(() => {
        expect(screen.getByText('Coven Setup')).toBeInTheDocument();
      });
    });

    it('displays CLI tools section', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({ type: 'state', payload: createMockState() });

      await waitFor(() => {
        expect(screen.getByText('CLI Tools')).toBeInTheDocument();
      });
    });

    it('displays repository initialization section', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({ type: 'state', payload: createMockState() });

      await waitFor(() => {
        expect(screen.getByText('Repository Initialization')).toBeInTheDocument();
      });
    });
  });

  describe('tool status display', () => {
    it('shows checkmark for available tools', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({ type: 'state', payload: createMockState() });

      await waitFor(() => {
        expect(screen.getByText('git')).toBeInTheDocument();
      });

      // Find git's parent container and check for checkmark
      const gitItem = screen.getByText('git').closest('.status-item');
      expect(gitItem?.querySelector('.status-ok')).toBeInTheDocument();
    });

    it('shows X mark for unavailable tools', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({ type: 'state', payload: createMockState() });

      await waitFor(() => {
        expect(screen.getByText('CLI Tools')).toBeInTheDocument();
      });

      // Find openspec in the CLI Tools section (which has Install link, not Initialize button)
      const toolsSection = screen.getByText('CLI Tools').closest('section')!;
      const openspecTool = within(toolsSection).getByText('openspec').closest('.status-item');
      expect(openspecTool?.querySelector('.status-missing')).toBeInTheDocument();
    });

    it('shows version for available tools', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({ type: 'state', payload: createMockState() });

      await waitFor(() => {
        expect(screen.getByText('git 2.40.0')).toBeInTheDocument();
      });
    });

    it('shows install link for unavailable tools', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({ type: 'state', payload: createMockState() });

      await waitFor(() => {
        const installLinks = screen.getAllByText('Install');
        expect(installLinks.length).toBeGreaterThan(0);
      });
    });
  });

  describe('init status display', () => {
    it('shows checkmark for initialized items', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({ type: 'state', payload: createMockState() });

      await waitFor(() => {
        expect(screen.getByText('beads')).toBeInTheDocument();
      });

      const beadsItem = screen.getByText('beads').closest('.status-item');
      expect(beadsItem?.querySelector('.status-ok')).toBeInTheDocument();
    });

    it('shows X mark for uninitialized items', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({
        type: 'state',
        payload: createMockState({
          inits: [{ name: 'testinit', initialized: false }],
        }),
      });

      await waitFor(() => {
        expect(screen.getByText('testinit')).toBeInTheDocument();
      });

      const initItem = screen.getByText('testinit').closest('.status-item');
      expect(initItem?.querySelector('.status-missing')).toBeInTheDocument();
    });

    it('shows initialize button for uninitialized items', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({ type: 'state', payload: createMockState() });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Initialize' })).toBeInTheDocument();
      });
    });
  });

  describe('user interactions', () => {
    it('sends initOpenspec message when openspec initialize clicked', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({
        type: 'state',
        payload: createMockState({
          tools: [], // Clear tools to avoid ambiguity
          inits: [
            { name: 'openspec', initialized: false },
            { name: 'beads', initialized: true },
          ],
        }),
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Initialize' })).toBeInTheDocument();
      });

      mockVsCode.postMessage.mockClear();
      fireEvent.click(screen.getByRole('button', { name: 'Initialize' }));

      expect(mockVsCode.postMessage).toHaveBeenCalledWith({ type: 'initOpenspec' });
    });

    it('sends initBeads message when beads initialize clicked', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({
        type: 'state',
        payload: createMockState({
          tools: [], // Clear tools to avoid ambiguity
          inits: [
            { name: 'openspec', initialized: true },
            { name: 'beads', initialized: false },
          ],
        }),
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Initialize' })).toBeInTheDocument();
      });

      mockVsCode.postMessage.mockClear();
      fireEvent.click(screen.getByRole('button', { name: 'Initialize' }));

      expect(mockVsCode.postMessage).toHaveBeenCalledWith({ type: 'initBeads' });
    });

    it('sends refresh message when Check Again clicked', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({ type: 'state', payload: createMockState() });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Check Again' })).toBeInTheDocument();
      });

      mockVsCode.postMessage.mockClear();
      fireEvent.click(screen.getByRole('button', { name: 'Check Again' }));

      expect(mockVsCode.postMessage).toHaveBeenCalledWith({ type: 'refresh' });
    });
  });

  describe('message handling', () => {
    it('updates state when receiving state message', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      // Initial state - git unavailable
      simulateMessage({
        type: 'state',
        payload: createMockState({
          tools: [{ name: 'git', available: false }],
          inits: [],
        }),
      });

      await waitFor(() => {
        const gitItem = screen.getByText('git').closest('.status-item');
        expect(gitItem?.querySelector('.status-missing')).toBeInTheDocument();
      });

      // Update state - git now available
      simulateMessage({
        type: 'state',
        payload: createMockState({
          tools: [{ name: 'git', available: true, version: 'git 2.40.0' }],
          inits: [],
        }),
      });

      await waitFor(() => {
        const gitItem = screen.getByText('git').closest('.status-item');
        expect(gitItem?.querySelector('.status-ok')).toBeInTheDocument();
      });
    });

    it('ignores non-state messages', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({ type: 'state', payload: createMockState() });

      await waitFor(() => {
        expect(screen.getByText('Coven Setup')).toBeInTheDocument();
      });

      // Send a different message type
      simulateMessage({ type: 'unknown', payload: null });

      // State should remain unchanged
      expect(screen.getByText('Coven Setup')).toBeInTheDocument();
    });
  });

  describe('cleanup', () => {
    it('removes message listener on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

      const { unmount } = render(<App vsCodeApi={mockVsCode} />);
      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('message', expect.any(Function));
    });
  });

  describe('multi-root workspace', () => {
    it('shows error banner when workspace is multi-root', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({
        type: 'state',
        payload: createMockState({
          workspace: { isMultiRoot: true, folderCount: 3 },
        }),
      });

      await waitFor(() => {
        expect(screen.getByText('Multi-root Workspaces Not Supported')).toBeInTheDocument();
      });
    });

    it('displays folder count in error message', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({
        type: 'state',
        payload: createMockState({
          workspace: { isMultiRoot: true, folderCount: 3 },
        }),
      });

      await waitFor(() => {
        expect(screen.getByText(/3 workspace folders/)).toBeInTheDocument();
      });
    });

    it('shows guidance to open single folder', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({
        type: 'state',
        payload: createMockState({
          workspace: { isMultiRoot: true, folderCount: 2 },
        }),
      });

      await waitFor(() => {
        expect(screen.getByText(/Please open a single folder workspace/)).toBeInTheDocument();
      });
    });

    it('does not show tools or inits sections when multi-root', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({
        type: 'state',
        payload: createMockState({
          workspace: { isMultiRoot: true, folderCount: 2 },
        }),
      });

      await waitFor(() => {
        expect(screen.getByText('Multi-root Workspaces Not Supported')).toBeInTheDocument();
      });

      expect(screen.queryByText('CLI Tools')).not.toBeInTheDocument();
      expect(screen.queryByText('Repository Initialization')).not.toBeInTheDocument();
    });

    it('still shows Check Again button when multi-root', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({
        type: 'state',
        payload: createMockState({
          workspace: { isMultiRoot: true, folderCount: 2 },
        }),
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Check Again' })).toBeInTheDocument();
      });
    });

    it('sends refresh message when Check Again clicked in multi-root state', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({
        type: 'state',
        payload: createMockState({
          workspace: { isMultiRoot: true, folderCount: 2 },
        }),
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Check Again' })).toBeInTheDocument();
      });

      mockVsCode.postMessage.mockClear();
      fireEvent.click(screen.getByRole('button', { name: 'Check Again' }));

      expect(mockVsCode.postMessage).toHaveBeenCalledWith({ type: 'refresh' });
    });
  });

  describe('session config phase', () => {
    it('renders session config view when phase is session-config', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({ type: 'state', payload: createSessionConfigState() });

      await waitFor(() => {
        expect(screen.getByText('Start Session')).toBeInTheDocument();
      });
    });

    it('displays feature branch section', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({ type: 'state', payload: createSessionConfigState() });

      await waitFor(() => {
        expect(screen.getByText('Feature Branch')).toBeInTheDocument();
      });
    });

    it('displays available branches in select', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({ type: 'state', payload: createSessionConfigState() });

      await waitFor(() => {
        expect(screen.getByText('main')).toBeInTheDocument();
        expect(screen.getByText('develop')).toBeInTheDocument();
        expect(screen.getByText('feature/test')).toBeInTheDocument();
      });
    });

    it('displays task sources section', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({ type: 'state', payload: createSessionConfigState() });

      await waitFor(() => {
        expect(screen.getByText('Task Sources')).toBeInTheDocument();
        expect(screen.getByText('Manual Tasks')).toBeInTheDocument();
      });
    });

    it('displays settings section', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({ type: 'state', payload: createSessionConfigState() });

      await waitFor(() => {
        expect(screen.getByText('Settings')).toBeInTheDocument();
        expect(screen.getByLabelText('Max Concurrent Agents')).toBeInTheDocument();
      });
    });

    it('sends selectBranch message when branch selected', async () => {
      const user = userEvent.setup();
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({ type: 'state', payload: createSessionConfigState() });

      await waitFor(() => {
        expect(screen.getByRole('combobox')).toBeInTheDocument();
      });

      mockVsCode.postMessage.mockClear();
      const select = screen.getByRole('combobox');
      await user.selectOptions(select, 'develop');

      expect(mockVsCode.postMessage).toHaveBeenCalledWith({
        type: 'selectBranch',
        payload: { name: 'develop', isNew: false },
      });
    });

    it('shows new branch input when create new is selected', async () => {
      const user = userEvent.setup();
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({ type: 'state', payload: createSessionConfigState() });

      await waitFor(() => {
        expect(screen.getByText('Create new branch')).toBeInTheDocument();
      });

      // Click the "Create new branch" radio
      const createNewRadio = screen.getByLabelText('Create new branch');
      await user.click(createNewRadio);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('feature/my-feature')).toBeInTheDocument();
      });
    });

    it('sends selectBranch message with isNew true when new branch created', async () => {
      const user = userEvent.setup();
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({ type: 'state', payload: createSessionConfigState() });

      await waitFor(() => {
        expect(screen.getByText('Create new branch')).toBeInTheDocument();
      });

      // Click the "Create new branch" radio
      const createNewRadio = screen.getByLabelText('Create new branch');
      await user.click(createNewRadio);

      mockVsCode.postMessage.mockClear();
      const input = screen.getByPlaceholderText('feature/my-feature');
      await user.type(input, 'feature/new-branch');
      fireEvent.blur(input);

      expect(mockVsCode.postMessage).toHaveBeenCalledWith({
        type: 'selectBranch',
        payload: { name: 'feature/new-branch', isNew: true },
      });
    });

    it('sends updateConfig when max agents changed', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({ type: 'state', payload: createSessionConfigState() });

      await waitFor(() => {
        expect(screen.getByLabelText('Max Concurrent Agents')).toBeInTheDocument();
      });

      mockVsCode.postMessage.mockClear();
      const input = screen.getByLabelText('Max Concurrent Agents');
      fireEvent.change(input, { target: { value: '5' } });

      expect(mockVsCode.postMessage).toHaveBeenCalledWith({
        type: 'updateConfig',
        payload: { maxConcurrentAgents: 5 },
      });
    });

    it('sends updateConfig when worktree path changed', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({ type: 'state', payload: createSessionConfigState() });

      await waitFor(() => {
        expect(screen.getByLabelText('Worktree Base Path')).toBeInTheDocument();
      });

      mockVsCode.postMessage.mockClear();
      const input = screen.getByLabelText('Worktree Base Path');
      fireEvent.change(input, { target: { value: '.custom-worktrees' } });

      expect(mockVsCode.postMessage).toHaveBeenCalledWith({
        type: 'updateConfig',
        payload: { worktreeBasePath: '.custom-worktrees' },
      });
    });

    it('sends updateConfig when autoApprove toggled', async () => {
      const user = userEvent.setup();
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({ type: 'state', payload: createSessionConfigState() });

      await waitFor(() => {
        expect(screen.getByLabelText(/Auto-approve/)).toBeInTheDocument();
      });

      mockVsCode.postMessage.mockClear();
      const checkbox = screen.getByLabelText(/Auto-approve/);
      await user.click(checkbox);

      expect(mockVsCode.postMessage).toHaveBeenCalledWith({
        type: 'updateConfig',
        payload: { autoApprove: true },
      });
    });

    it('disables Begin Session button when no branch selected', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({ type: 'state', payload: createSessionConfigState() });

      await waitFor(() => {
        const button = screen.getByRole('button', { name: 'Begin Session' });
        expect(button).toBeDisabled();
      });
    });

    it('enables Begin Session button when branch selected', async () => {
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({
        type: 'state',
        payload: createSessionConfigState({
          selectedBranch: { name: 'develop', isNew: false },
        }),
      });

      await waitFor(() => {
        const button = screen.getByRole('button', { name: 'Begin Session' });
        expect(button).not.toBeDisabled();
      });
    });

    it('sends beginSession message when Begin Session clicked', async () => {
      const user = userEvent.setup();
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({
        type: 'state',
        payload: createSessionConfigState({
          selectedBranch: { name: 'develop', isNew: false },
        }),
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Begin Session' })).not.toBeDisabled();
      });

      mockVsCode.postMessage.mockClear();
      await user.click(screen.getByRole('button', { name: 'Begin Session' }));

      expect(mockVsCode.postMessage).toHaveBeenCalledWith({ type: 'beginSession' });
    });

    it('does not send selectBranch for empty new branch name', async () => {
      const user = userEvent.setup();
      render(<App vsCodeApi={mockVsCode} />);

      simulateMessage({ type: 'state', payload: createSessionConfigState() });

      await waitFor(() => {
        expect(screen.getByText('Create new branch')).toBeInTheDocument();
      });

      // Click the "Create new branch" radio
      const createNewRadio = screen.getByLabelText('Create new branch');
      await user.click(createNewRadio);

      mockVsCode.postMessage.mockClear();
      const input = screen.getByPlaceholderText('feature/my-feature');
      // Just blur without typing anything
      fireEvent.blur(input);

      expect(mockVsCode.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'selectBranch' })
      );
    });
  });
});
