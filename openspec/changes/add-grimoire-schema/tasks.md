## 1. Schema Creation

- [ ] 1.1 Create `schemas/grimoire-schema.json` with JSON Schema draft-07
- [ ] 1.2 Define grimoire root object schema
- [ ] 1.3 Define step discriminated union (type → specific fields)
- [ ] 1.4 Define agent step schema with all fields
- [ ] 1.5 Define script step schema with all fields
- [ ] 1.6 Define loop step schema with nested steps reference
- [ ] 1.7 Define merge step schema with all fields
- [ ] 1.8 Add descriptions to all properties for hover docs
- [ ] 1.9 Add enum constraints for known values (step types, on_fail, etc.)
- [ ] 1.10 Add timeout pattern validation (Go duration format)

## 2. IDE Integration

- [ ] 2.1 Add recommended `.vscode/settings.json` snippet to docs
- [ ] 2.2 Test schema with VS Code YAML extension
- [ ] 2.3 Verify autocomplete works for all fields
- [ ] 2.4 Verify validation errors appear inline

## 3. Documentation

- [ ] 3.1 Add "IDE Setup" section to grimoires.md
- [ ] 3.2 Document schema file location
- [ ] 3.3 Add troubleshooting for schema not loading
