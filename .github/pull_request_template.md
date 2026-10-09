## What and why

<!-- One or two sentences. Link the issue or the OpenSpec change (openspec/changes/<name>). -->

## Checklist

- [ ] `node --test tools/hanger/test/` passes
- [ ] `node tools/hanger/test/canary-leak.js` prints `canary hits: 0` (privacy canary stays green)
- [ ] `openspec validate --all --strict` passes (behavior changes have an OpenSpec change)
- [ ] No new runtime dependencies; nothing leaves the machine
- [ ] Docs only claim what is implemented and validated
- [ ] Fixtures and examples use synthetic data (no real hostname, username, serial or process list)
- [ ] Schema changes, if any, are logged in `tools/hanger/SCHEMA-CHANGELOG.md`
