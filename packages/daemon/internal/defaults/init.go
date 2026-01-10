// Package defaults handles initialization of default grimoires and spells.
// Defaults are copied to .coven as visible, editable files rather than
// being embedded magic in the binary.
package defaults

import (
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

//go:embed spells/*.md
var defaultSpells embed.FS

//go:embed grimoires/*.yaml
var defaultGrimoires embed.FS

// InitResult contains the result of initializing defaults.
type InitResult struct {
	// SpellsCopied lists the spell files that were copied.
	SpellsCopied []string

	// SpellsSkipped lists the spell files that were skipped (already exist).
	SpellsSkipped []string

	// GrimoiresCopied lists the grimoire files that were copied.
	GrimoiresCopied []string

	// GrimoiresSkipped lists the grimoire files that were skipped (already exist).
	GrimoiresSkipped []string
}

// TotalCopied returns the total number of files copied.
func (r *InitResult) TotalCopied() int {
	return len(r.SpellsCopied) + len(r.GrimoiresCopied)
}

// TotalSkipped returns the total number of files skipped.
func (r *InitResult) TotalSkipped() int {
	return len(r.SpellsSkipped) + len(r.GrimoiresSkipped)
}

// Initialize copies default grimoires and spells to the .coven directory.
// It does NOT overwrite existing files to preserve user customizations.
// Returns a result indicating what was copied and what was skipped.
func Initialize(covenDir string) (*InitResult, error) {
	result := &InitResult{}

	// Initialize spells
	spellsDir := filepath.Join(covenDir, "spells")
	if err := initializeFromFS(defaultSpells, "spells", spellsDir, ".md", &result.SpellsCopied, &result.SpellsSkipped); err != nil {
		return nil, fmt.Errorf("failed to initialize spells: %w", err)
	}

	// Initialize grimoires
	grimoiresDir := filepath.Join(covenDir, "grimoires")
	if err := initializeFromFS(defaultGrimoires, "grimoires", grimoiresDir, ".yaml", &result.GrimoiresCopied, &result.GrimoiresSkipped); err != nil {
		return nil, fmt.Errorf("failed to initialize grimoires: %w", err)
	}

	return result, nil
}

// initializeFromFS copies files from an embedded FS to a target directory.
func initializeFromFS(fsys embed.FS, srcDir, destDir, ext string, copied, skipped *[]string) error {
	// Ensure destination directory exists
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", destDir, err)
	}

	// Read source directory
	entries, err := fs.ReadDir(fsys, srcDir)
	if err != nil {
		return fmt.Errorf("failed to read embedded directory %s: %w", srcDir, err)
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		// Skip files that don't match the extension
		if !strings.HasSuffix(entry.Name(), ext) {
			continue
		}

		srcPath := filepath.Join(srcDir, entry.Name())
		destPath := filepath.Join(destDir, entry.Name())

		// Check if destination file already exists
		if _, err := os.Stat(destPath); err == nil {
			// File exists, skip it
			*skipped = append(*skipped, entry.Name())
			continue
		}

		// Read source file
		content, err := fs.ReadFile(fsys, srcPath)
		if err != nil {
			return fmt.Errorf("failed to read embedded file %s: %w", srcPath, err)
		}

		// Write to destination
		if err := os.WriteFile(destPath, content, 0644); err != nil {
			return fmt.Errorf("failed to write file %s: %w", destPath, err)
		}

		*copied = append(*copied, entry.Name())
	}

	return nil
}

// SpellNames returns the names of all default spells (without .md extension).
func SpellNames() ([]string, error) {
	entries, err := fs.ReadDir(defaultSpells, "spells")
	if err != nil {
		return nil, err
	}

	var names []string
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") {
			continue
		}
		names = append(names, strings.TrimSuffix(entry.Name(), ".md"))
	}
	return names, nil
}

// GrimoireNames returns the names of all default grimoires (without .yaml extension).
func GrimoireNames() ([]string, error) {
	entries, err := fs.ReadDir(defaultGrimoires, "grimoires")
	if err != nil {
		return nil, err
	}

	var names []string
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".yaml") {
			continue
		}
		names = append(names, strings.TrimSuffix(entry.Name(), ".yaml"))
	}
	return names, nil
}
