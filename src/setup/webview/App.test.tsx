import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
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
    allMet: false,
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
});
