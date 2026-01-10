/**
 * E2E test fixtures for Coven VS Code extension.
 *
 * Provides utilities to create test workspaces with various configurations.
 */
export {
  // Configuration types
  type FixtureConfig,
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
} from './setup';
