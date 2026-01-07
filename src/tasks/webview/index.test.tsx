import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';

// Mock react-dom/client
const mockRender = vi.fn();
const mockCreateRoot = vi.fn(() => ({
  render: mockRender,
}));

vi.mock('react-dom/client', () => ({
  createRoot: mockCreateRoot,
}));

// Mock the App component
vi.mock('./App', () => ({
  App: () => React.createElement('div', { 'data-testid': 'app' }, 'App'),
}));

// Mock CSS import
vi.mock('./styles.css', () => ({}));

describe('tasks webview entry point', () => {
  let originalGetElementById: typeof document.getElementById;

  beforeEach(() => {
    vi.clearAllMocks();
    originalGetElementById = document.getElementById;
  });

  afterEach(() => {
    document.getElementById = originalGetElementById;
    vi.resetModules();
  });

  it('should render App when root element exists', async () => {
    const mockContainer = document.createElement('div');
    mockContainer.id = 'root';
    document.getElementById = vi.fn().mockReturnValue(mockContainer);

    // Dynamically import the module to trigger its execution
    await import('./index');

    expect(document.getElementById).toHaveBeenCalledWith('root');
    expect(mockCreateRoot).toHaveBeenCalledWith(mockContainer);
    expect(mockRender).toHaveBeenCalled();
  });

  it('should not render when root element is missing', async () => {
    document.getElementById = vi.fn().mockReturnValue(null);
    vi.resetModules();
    mockCreateRoot.mockClear();
    mockRender.mockClear();

    await import('./index');

    expect(document.getElementById).toHaveBeenCalledWith('root');
    expect(mockCreateRoot).not.toHaveBeenCalled();
    expect(mockRender).not.toHaveBeenCalled();
  });
});
