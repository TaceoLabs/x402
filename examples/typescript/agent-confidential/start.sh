#!/usr/bin/env bash
set -euo pipefail

# ── Confidential x402 Demo — Start All Services ──────────────────────────────
#
# Usage:
#   ./start.sh              Start all 4 services (MPC, facilitator, server, dashboard)
#   ./start.sh --deposit    Also run USDC deposit before starting services
#   ./start.sh --stop       Kill all running services
#
# Prerequisites:
#   - .env.sepolia exists with keys + contract addresses
#   - pnpm install + pnpm build done (see README)
#   - Frontend built (pnpm run frontend:build)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PIDS_FILE="$SCRIPT_DIR/.demo-pids"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log()  { echo -e "${GREEN}[demo]${NC} $*"; }
warn() { echo -e "${YELLOW}[demo]${NC} $*"; }
err()  { echo -e "${RED}[demo]${NC} $*"; }

# ── Stop ──────────────────────────────────────────────────────────────────────

stop_services() {
  log "Stopping services..."
  local stopped=0

  # Kill by saved PIDs
  if [[ -f "$PIDS_FILE" ]]; then
    while read -r pid; do
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null && stopped=$((stopped + 1))
      fi
    done < "$PIDS_FILE"
    rm -f "$PIDS_FILE"
  fi

  # Also kill anything on our ports
  for port in 4020 4021 4022 4023; do
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

# ── Preflight Checks ─────────────────────────────────────────────────────────

if [[ ! -f ".env.sepolia" ]]; then
  err ".env.sepolia not found. Run 'pnpm run generate-wallets' or get it from a teammate."
  exit 1
fi

# Check that contracts are deployed (PRIVATE_BALANCE_ADDRESS should be set)
if ! grep -q "PRIVATE_BALANCE_ADDRESS=0x" .env.sepolia; then
  err "No contract addresses in .env.sepolia. Run 'pnpm run deploy:sepolia' first."
  exit 1
fi

# Check for built frontend
if [[ ! -d "frontend/dist" ]]; then
  warn "Frontend not built. Building now..."
  pnpm run frontend:install && pnpm run frontend:build
fi

# Kill any existing services on our ports
stop_services 2>/dev/null

# ── Start Services ────────────────────────────────────────────────────────────

> "$PIDS_FILE"

log "Starting Mock MPC on :4023..."
pnpm run mock-mpc > /dev/null 2>&1 &
echo $! >> "$PIDS_FILE"

# Wait for MPC to be ready
for i in $(seq 1 15); do
  if curl -s http://localhost:4023/health > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -s http://localhost:4023/health > /dev/null 2>&1; then
  err "Mock MPC failed to start. Check logs with: pnpm run mock-mpc"
  exit 1
fi
log "Mock MPC ${GREEN}ready${NC}"

# ── Optional Deposit ──────────────────────────────────────────────────────────

if [[ "${1:-}" == "--deposit" ]]; then
  log "Running USDC deposit..."
  pnpm run deposit:sepolia
  # Wait for MPC to process the deposit
  warn "Waiting for MPC to process deposit..."
  sleep 10
  BALANCE=$(curl -s http://localhost:4023/status | python3 -c "import sys,json; b=json.load(sys.stdin)['balances']; print(list(b.values())[0]['balanceUSDC'] if b else '0')" 2>/dev/null || echo "unknown")
  log "Agent balance: $BALANCE USDC"
fi

# ── Check Balance ─────────────────────────────────────────────────────────────

BALANCE_COUNT=$(curl -s http://localhost:4023/status | python3 -c "import sys,json; print(len(json.load(sys.stdin)['balances']))" 2>/dev/null || echo "0")
if [[ "$BALANCE_COUNT" == "0" ]]; then
  warn "No balances found. You may need to deposit first: ./start.sh --deposit"
fi

# ── Facilitator (must start before server — server fetches payment kinds on init)

log "Starting Facilitator on :4022..."
pnpm run facilitator:sepolia > /dev/null 2>&1 &
echo $! >> "$PIDS_FILE"

for i in $(seq 1 15); do
  if curl -s http://localhost:4022/health > /dev/null 2>&1; then break; fi
  sleep 1
done

if ! curl -s http://localhost:4022/health > /dev/null 2>&1; then
  err "Facilitator failed to start."
  exit 1
fi
log "Facilitator ${GREEN}ready${NC}"

# ── Server (needs facilitator running) ────────────────────────────────────────

log "Starting Resource Server on :4021..."
pnpm run server:sepolia > /dev/null 2>&1 &
echo $! >> "$PIDS_FILE"

# ── Dashboard ─────────────────────────────────────────────────────────────────

log "Starting Dashboard on :4020..."
pnpm run dashboard:sepolia > /dev/null 2>&1 &
echo $! >> "$PIDS_FILE"

# Wait for server and dashboard
log "Waiting for remaining services..."
for i in $(seq 1 20); do
  sleep 1
  if curl -s http://localhost:4021/health > /dev/null 2>&1 && \
     curl -s http://localhost:4020/api/status > /dev/null 2>&1; then
    break
  fi
done

# ── Health Check ──────────────────────────────────────────────────────────────

echo ""
ALL_OK=true
for pair in "4023:Mock MPC" "4022:Facilitator" "4021:Server" "4020:Dashboard"; do
  port="${pair%%:*}"
  name="${pair#*:}"
  if curl -s "http://localhost:$port/health" > /dev/null 2>&1 || curl -s "http://localhost:$port/api/status" > /dev/null 2>&1; then
    printf "  ${GREEN}✓${NC} %-20s :${port}\n" "$name"
  else
    printf "  ${RED}✗${NC} %-20s :${port}\n" "$name"
    ALL_OK=false
  fi
done

echo ""
if $ALL_OK; then
  log "All services running! Open ${CYAN}http://localhost:4020${NC}"
  log "Stop with: ${CYAN}./start.sh --stop${NC}"
else
  warn "Some services failed to start. Check logs by running them individually."
fi

echo ""
log "PIDs saved to .demo-pids — services running in background"
log "View MPC balances: ${CYAN}curl http://localhost:4023/status${NC}"
