## 1. Basic Includes

- [ ] 1.1 Implement `include` template function
- [ ] 1.2 Resolve included files from `.coven/spells/` directory
- [ ] 1.3 Parse and render included file as template
- [ ] 1.4 Support nested includes (A includes B includes C)
- [ ] 1.5 Implement circular include detection
- [ ] 1.6 Return clear error for missing include files
- [ ] 1.7 Write unit tests for basic includes

## 2. Parameterized Includes

- [ ] 2.1 Parse keyword arguments in include call
- [ ] 2.2 Create new context with passed variables
- [ ] 2.3 Add `{{.parent}}` reference to original context
- [ ] 2.4 Support both literal and variable arguments
- [ ] 2.5 Write unit tests for parameterized includes

## 3. Error Handling

- [ ] 3.1 Clear error for file not found
- [ ] 3.2 Clear error for circular include (show chain)
- [ ] 3.3 Clear error for template parse failure in included file
- [ ] 3.4 Include file path in error messages

## 4. E2E Tests

- [ ] 4.1 E2E test: spell with simple include
- [ ] 4.2 E2E test: spell with parameterized include
- [ ] 4.3 E2E test: nested includes

## 5. Documentation

- [ ] 5.1 Add "Spell Includes" section to spells.md
- [ ] 5.2 Document variable passing syntax
- [ ] 5.3 Add examples for common patterns (output format, coding standards)
