#!/usr/bin/env bash
set -euo pipefail

# ── Confidential x402 Demo — Local Anvil ─────────────────────────────────────
#
# One-command launcher for the full demo on a local anvil chain.
# No testnet, no faucets, no wallet funding — everything runs locally.
#
# Usage:
#   ./start-local.sh          Deploy + start all services
#   ./start-local.sh --stop   Kill anvil + all services
#   ./start-local.sh --agent  Deploy + start services + run 3 agent payments
#
# Prerequisites:
#   - anvil installed (comes with Foundry: https://book.getfoundry.sh)
#   - pnpm install + pnpm run setup done (see README)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PIDS_FILE="$SCRIPT_DIR/.demo-local-pids"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[local]${NC} $*"; }
warn() { echo -e "${YELLOW}[local]${NC} $*"; }
err()  { echo -e "${RED}[local]${NC} $*"; }

# ── Stop ──────────────────────────────────────────────────────────────────────

stop_services() {
  log "Stopping services..."
  local stopped=0

  if [[ -f "$PIDS_FILE" ]]; then
    while read -r pid; do
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null && stopped=$((stopped + 1))
      fi
    done < "$PIDS_FILE"
    rm -f "$PIDS_FILE"
  fi

  for port in 4020 4021 4022 4023 8545; do
    local pid
    pid=$(lsof -ti:"$port" 2>/dev/null || true)
    if [[ -n "$pid" ]]; then
      kill "$pid" 2>/dev/null && stopped=$((stopped + 1))
    fi
  done

  if [[ $stopped -gt 0 ]]; then
    log "Stopped $stopped process(es)"
  else
    log "No running services found"
  fi
}

if [[ "${1:-}" == "--stop" ]]; then
  stop_services
  exit 0
fi

# ── Preflight ─────────────────────────────────────────────────────────────────

if ! command -v anvil &>/dev/null; then
  err "anvil not found. Install Foundry: https://book.getfoundry.sh"
  exit 1
fi

# Kill anything on our ports
stop_services 2>/dev/null

> "$PIDS_FILE"

# ── Start Anvil ──────────────────────────────────────────────────────────────

log "Starting anvil on :8545..."
anvil --silent 2>&1 &
echo $! >> "$PIDS_FILE"
sleep 2

if ! curl -s http://127.0.0.1:8545 -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' > /dev/null 2>&1; then
  err "Anvil failed to start"
  exit 1
fi
log "Anvil ${GREEN}ready${NC} (chain 31337)"

# ── Deploy Contracts ─────────────────────────────────────────────────────────

log "Deploying contracts + seeding 100 USDC..."
pnpm run deploy 2>&1 | grep -E "^\[Deploy\]|\[Seed\]" | while read -r line; do
  echo -e "  ${CYAN}${line}${NC}"
done
log "Contracts deployed, .env written"

# ── Start Mock MPC ───────────────────────────────────────────────────────────

log "Starting Mock MPC on :4023..."
npx tsx mock-mpc.ts > /dev/null 2>&1 &
echo $! >> "$PIDS_FILE"

for i in $(seq 1 10); do
  if curl -s http://localhost:4023/health > /dev/null 2>&1; then break; fi
  sleep 1
done

if ! curl -s http://localhost:4023/health > /dev/null 2>&1; then
  err "Mock MPC failed to start"
  exit 1
fi
log "Mock MPC ${GREEN}ready${NC}"

# ── Start Facilitator ────────────────────────────────────────────────────────

log "Starting Facilitator on :4022..."
npx tsx facilitator.ts > /dev/null 2>&1 &
echo $! >> "$PIDS_FILE"

for i in $(seq 1 10); do
  if curl -s http://localhost:4022/health > /dev/null 2>&1; then break; fi
  sleep 1
done

if ! curl -s http://localhost:4022/health > /dev/null 2>&1; then
  err "Facilitator failed to start"
  exit 1
fi
log "Facilitator ${GREEN}ready${NC}"

# ── Start Server ─────────────────────────────────────────────────────────────

log "Starting Resource Server on :4021..."
npx tsx server.ts > /dev/null 2>&1 &
echo $! >> "$PIDS_FILE"

for i in $(seq 1 10); do
  if curl -s http://localhost:4021/health > /dev/null 2>&1; then break; fi
  sleep 1
done

if ! curl -s http://localhost:4021/health > /dev/null 2>&1; then
  err "Server failed to start"
  exit 1
fi
log "Server ${GREEN}ready${NC}"

# ── Start Dashboard ──────────────────────────────────────────────────────────

if [[ -d "frontend/dist" ]]; then
  log "Starting Dashboard on :4020..."
  npx tsx dashboard.ts > /dev/null 2>&1 &
  echo $! >> "$PIDS_FILE"
  sleep 2
fi

# ── Health Check ─────────────────────────────────────────────────────────────

echo ""
ALL_OK=true
for pair in "8545:Anvil" "4023:Mock MPC" "4022:Facilitator" "4021:Server"; do
  port="${pair%%:*}"
  name="${pair#*:}"
  if curl -s "http://localhost:$port/health" > /dev/null 2>&1 || \
     curl -s "http://127.0.0.1:$port" -X POST -H "Content-Type: application/json" \
       -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' > /dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} $name          :$port"
  else
    echo -e "  ${RED}✗${NC} $name          :$port"
    ALL_OK=false
  fi
done

if [[ -d "frontend/dist" ]]; then
  if curl -s http://localhost:4020/api/status > /dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} Dashboard          :4020"
  else
    echo -e "  ${YELLOW}~${NC} Dashboard          :4020 (still starting)"
  fi
fi

echo ""
if $ALL_OK; then
  log "All services running on local anvil!"
  log "Agent has 100 USDC (seeded by deploy)"
  echo ""
  log "Run agent:     ${CYAN}pnpm run agent${NC}"
  log "Open UI:       ${CYAN}http://localhost:4020${NC}"
  log "Stop:          ${CYAN}./start-local.sh --stop${NC}"
else
  warn "Some services failed to start."
fi

# ── Optional: Run Agent ──────────────────────────────────────────────────────

if [[ "${1:-}" == "--agent" ]]; then
  echo ""
  log "Running agent (3 paid requests with ZK proofs)..."
  echo ""
  pnpm run agent
fi

echo ""
log "PIDs saved to .demo-local-pids"
