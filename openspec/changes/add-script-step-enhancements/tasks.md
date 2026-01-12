## 1. Script Step Fields

- [ ] 1.1 Add `env` and `workdir` fields to script step schema
- [ ] 1.2 Update grimoire validation to check new fields
- [ ] 1.3 Implement `env` merging in script executor (workflow env + step env)
- [ ] 1.4 Implement `workdir` resolution (relative to worktree root)
- [ ] 1.5 Add template rendering for `env` values
- [ ] 1.6 Write unit tests for env and workdir handling

## 2. Secrets Context

- [ ] 2.1 Implement secrets loader from `.coven/secrets.yaml`
- [ ] 2.2 Implement environment variable fallback for missing secrets
- [ ] 2.3 Add `{{.secrets}}` to template context
- [ ] 2.4 Implement secret redaction in log output
- [ ] 2.5 Add `.coven/secrets.yaml` to default `.gitignore` on init
- [ ] 2.6 Write unit tests for secrets loading and redaction

## 3. E2E Tests

- [ ] 3.1 E2E test: script step with custom env variables
- [ ] 3.2 E2E test: script step with workdir
- [ ] 3.3 E2E test: secrets template rendering
- [ ] 3.4 E2E test: verify secrets are redacted in logs

## 4. Documentation

- [ ] 4.1 Update steps.md with env and workdir documentation
- [ ] 4.2 Add secrets management section to orchestration docs
- [ ] 4.3 Add examples showing env, workdir, and secrets usage
