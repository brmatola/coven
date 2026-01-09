import { describe, it, expect } from 'vitest';
import { App } from './App';

describe('Review Webview Index', () => {
  it('exports App component', () => {
    expect(App).toBeDefined();
    expect(typeof App).toBe('function');
  });
});
