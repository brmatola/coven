/**
 * E2E test fixtures for Coven VS Code extension.
 *
 * Provides utilities to create test workspaces with various configurations.
 */
export {
  // Configuration types
  type FixtureConfig,
  type MockAgentConfig,
  // Preset configurations
  presets,
  // Sample content
  sampleBeads,
  sampleGrimoire,
  sampleSource,
  // Workspace creation
  createWorkspace,
  createPresetWorkspace,
  // Helpers
  createBead,
  createGrimoire,
  // Mock agent utilities
  ensureMockAgentBuilt,
} from './setup';

export {
  type TestGrimoire,
  installTestGrimoires,
  createTaskWithGrimoire,
  cleanupTestGrimoires,
} from './grimoires';
