#!/usr/bin/env bash
set -euo pipefail

node --experimental-default-type=module --experimental-strip-types --test --test-concurrency=1 tests/asana_core.test.ts
bash tests/skill_automation.sh
