#!/usr/bin/env bash
set -euo pipefail

# Runs after configuration/sandbox/assets is copied into /workspace on every sandbox start.
# Keep this script idempotent.
mkdir -p /workspace
