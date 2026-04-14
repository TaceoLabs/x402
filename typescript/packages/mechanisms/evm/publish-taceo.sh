#!/usr/bin/env bash
#
# publish-taceo.sh — publish our fork's @x402/evm to npm as @taceo/x402-evm.
#
# Why: the confidential scheme lives in this package as a sibling of `exact/`,
# which is where it belongs for the eventual upstream PR to Coinbase. But while
# it's in the fork it needs a different name on npm (Coinbase owns @x402).
# This script renames the package at publish time while leaving the source
# tree's package.json unchanged so the upstream PR stays clean.
#
# What it does:
#   1. Build the package via tsup (runs from workspace root).
#   2. Snapshot package.json.
#   3. Rewrite name "@x402/evm" → "@taceo/x402-evm" in the snapshot.
#   4. pnpm publish (which also rewrites workspace:~ deps to concrete versions).
#   5. Restore the original package.json.
#
# Prerequisites:
#   - `@taceo` scope created on npm (https://www.npmjs.com/org/create)
#   - `npm login` (or NPM_TOKEN env var) with publish rights to the @taceo scope
#   - pnpm 10.7.0+
#
# Usage:
#   From the repo root:
#     pnpm --filter @x402/evm build
#     cd typescript/packages/mechanisms/evm && ./publish-taceo.sh
#
#   Dry run (recommended first):
#     ./publish-taceo.sh --dry-run

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

DRY_RUN=""
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN="--dry-run"
  echo "[publish] DRY RUN — will not actually publish"
fi

PKG_JSON="package.json"
BACKUP="package.json.pre-publish.bak"

if [[ ! -d "dist" ]]; then
  echo "[publish] dist/ missing — run 'pnpm --filter @x402/evm build' first" >&2
  exit 1
fi

# Snapshot then rewrite name field.
cp "$PKG_JSON" "$BACKUP"
trap 'mv "$BACKUP" "$PKG_JSON"; echo "[publish] restored original package.json"' EXIT

node --input-type=module -e "
  import { readFileSync, writeFileSync } from 'node:fs';
  const pkg = JSON.parse(readFileSync('$PKG_JSON', 'utf8'));
  if (pkg.name !== '@x402/evm') {
    console.error('[publish] unexpected package name:', pkg.name);
    process.exit(1);
  }
  pkg.name = '@taceo/x402-evm';
  // Keep a pointer back to the fork for provenance.
  pkg.repository = {
    type: 'git',
    url: 'https://github.com/TaceoLabs/x402',
    directory: 'typescript/packages/mechanisms/evm',
  };
  writeFileSync('$PKG_JSON', JSON.stringify(pkg, null, 2) + '\n');
"

echo "[publish] package.json renamed to @taceo/x402-evm — running pnpm publish"
pnpm publish --access public --no-git-checks $DRY_RUN
echo "[publish] done"
