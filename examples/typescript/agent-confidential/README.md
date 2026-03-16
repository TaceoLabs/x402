# Confidential x402 Agent Demo

End-to-end demo of **privacy-preserving machine-to-machine payments** using [x402](https://github.com/coinbase/x402) and [TACEO's](https://taceo.io) confidential payment scheme on **Base Sepolia**.

An AI agent pays $0.05 USDC per API request — but unlike standard x402 where payment amounts are visible on-chain, this scheme **hides amounts** behind Poseidon2 hash commitments and encrypts the real values into secret shares for MPC operators.

## Architecture

```
Agent ──► Resource Server (:4021) ──► Facilitator (:4022) ──► Base Sepolia
               (paywall)              (verify + settle)       (PrivateBalance contract)
                                           │
                                      Mock MPC (:4023)
                                        ├── POST /balance-check
                                        └── poll loop: read_queue → processMPC
```

**Payment flow:**

1. Agent requests data from a paid API endpoint
2. Server responds with `402 Payment Required` and the price ($0.05 USDC)
3. Agent creates a confidential payment — Poseidon2 commitment hiding the amount, 3 encrypted secret shares (one per MPC node), EIP-712 signature
4. Facilitator checks the sender has sufficient funds (via MPC balance-check), verifies the signature, calls `transferFrom()` on the PrivateBalance contract
5. On-chain: only cryptographic commitments are stored — the $0.05 amount is never revealed
6. Mock MPC picks up the queued transfer, recovers plaintext from shares, updates balance commitments on-chain via `processMPC()`

## Prerequisites

- **Node.js** >= 20
- **pnpm**

No Foundry required — contract artifacts are committed in the `artifacts/` directory.

## Setup from Scratch

### 1. Clone and install

```bash
git clone -b feat/standalone-demo https://github.com/TaceoLabs/x402.git
cd x402/examples/typescript
pnpm install

# Build the @x402 workspace packages (required — they're unpublished TypeScript)
cd ../..
pnpm --filter @x402/core build && pnpm --filter @x402/extensions build && \
pnpm --filter @x402/evm build && pnpm --filter @x402/axios build && \
pnpm --filter @x402/express build

cd examples/typescript/agent-confidential
pnpm run frontend:install
pnpm run frontend:build
```

### 2. Generate wallets

```bash
pnpm run generate-wallets
```

This creates 4 fresh wallets (MPC, Facilitator, Agent, Server) and writes `.env.sepolia` with the private keys and Base Sepolia configuration.

### 3. Fund wallets

You need testnet ETH and USDC on Base Sepolia:

| Wallet | What to fund | Why |
|--------|-------------|-----|
| **MPC** | ~0.05 ETH | Deploys contracts + ongoing `processMPC` gas |
| **Facilitator** | ~0.02 ETH | `transferFrom` settlement transactions |
| **Agent** | ~0.002 ETH | `approve` + `deposit` gas |
| **Agent** | 20 USDC | Real USDC to deposit into the confidential system |

**ETH faucets** (Base Sepolia):
- https://www.alchemy.com/faucets/base-sepolia
- https://www.coinbase.com/faucets/base-ethereum-sepolia

**USDC faucet** (Base Sepolia):
- https://faucet.circle.com — select "Base Sepolia", enter the Agent address, request USDC

The wallet addresses are printed by `generate-wallets` and also in `.env.sepolia`.

### 4. Deploy contracts

```bash
pnpm run deploy:sepolia
```

This deploys Poseidon2, MockVerifier, QueryMapLib, and PrivateBalance to Base Sepolia using real USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`). It updates `.env.sepolia` with all deployed contract addresses.

### 5. Start the Mock MPC

```bash
pnpm run mock-mpc
```

Starts on `:4023`. Must be running before depositing or making payments — it processes the on-chain action queue and handles balance checks from the facilitator.

### 6. Deposit USDC

```bash
pnpm run deposit:sepolia
```

This calls `approve()` then `deposit()` to move real USDC into the PrivateBalance contract. The mock MPC automatically picks up the deposit action and creates the agent's balance commitment.

Verify it worked:

```bash
curl http://localhost:4023/status
# Should show the agent's balance (e.g. 20.000000 USDC)
```

### 7. Start services

Open separate terminals for each:

```bash
# Terminal 2 — Facilitator (verify + settle payments)
pnpm run facilitator:sepolia

# Terminal 3 — Resource Server (sentiment API behind paywall)
pnpm run server:sepolia

# Terminal 4 — Dashboard (React frontend + orchestration)
pnpm run dashboard:sepolia
```

### 8. Run the demo

**Dashboard (recommended):** Open http://localhost:4020. Click "Enter Demo", then pick a ticker (ETH, BTC, SOL) to trigger a paid API request. The UI shows the full payment flow in real-time with live animations.

**CLI agent:** Makes 3 consecutive paid requests automatically:

```bash
pnpm run agent:sepolia
```

**curl:**

```bash
curl -X POST http://localhost:4020/api/pay \
  -H 'Content-Type: application/json' \
  -d '{"ticker": "ETH"}'
```

## Quick Start (Existing Deployment)

If you already have `.env.sepolia` with deployed contract addresses (e.g. shared by a teammate), skip steps 2-4 and go straight to starting services:

```bash
pnpm run mock-mpc          # Terminal 1 — must start first
pnpm run deposit:sepolia    # Only if agent has no balance yet
pnpm run facilitator:sepolia # Terminal 2
pnpm run server:sepolia     # Terminal 3
pnpm run dashboard:sepolia  # Terminal 4
# Open http://localhost:4020
```

## Services

| Service | Port | Script | Description |
|---------|------|--------|-------------|
| Mock MPC | 4023 | `mock-mpc` | Balance-check endpoint + action queue processor |
| Facilitator | 4022 | `facilitator:sepolia` | Verifies payments, checks balance via MPC, settles on-chain |
| Resource Server | 4021 | `server:sepolia` | Sentiment API behind $0.05 USDC confidential paywall |
| Dashboard | 4020 | `dashboard:sepolia` | React frontend with live flow visualization + SSE events |
| Agent (CLI) | — | `agent:sepolia` | Makes 3 paid requests (ETH, BTC, SOL sentiment) |

## Contracts

| Contract | Purpose |
|----------|---------|
| **PrivateBalance** | Confidential token — Poseidon2 commitments, `transferFrom`, `deposit`, action queue |
| **Poseidon2** | Hash function for balance commitments |
| **MockVerifier** | Always-true Groth16 verifier (placeholder for real MPC prover) |
| **USDC** | Real Base Sepolia USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`) |

Pre-compiled contract artifacts are in `artifacts/`. If you need to rebuild them from source, see the [private_deposit](https://github.com/TaceoLabs/private_deposit) repo (`forge build --skip test --skip script`).

## What's Real vs Mocked

| Component | Status |
|-----------|--------|
| x402 protocol flow (402 → sign → settle) | Real |
| EIP-712 signatures | Real |
| Poseidon2 commitments | Real |
| Ciphertext secret shares (3-of-3) | Real |
| BabyJubJub encryption | Real |
| On-chain settlement (`transferFrom`) | Real (Base Sepolia) |
| USDC deposits (`approve` → `deposit`) | Real (Base Sepolia USDC) |
| On-chain queue processing (`processMPC`) | Real (Base Sepolia) |
| Groth16 ZK proof verification | Mocked (MockVerifier always returns true) |
| MPC network (3 nodes) | Mocked (single service recovers shares locally) |

## Files

| File | Description |
|------|-------------|
| `generate-wallets.ts` | Creates 4 wallets, writes `.env.sepolia` template |
| `deploy-sepolia.ts` | Deploys all contracts to Base Sepolia |
| `deposit-sepolia.ts` | Real USDC `approve()` → `deposit()` flow |
| `mock-mpc.ts` | Mock MPC — balance checks + action queue processing |
| `facilitator.ts` | x402 facilitator with confidential scheme + MPC balance check |
| `server.ts` | Resource server with x402 paywall middleware |
| `agent.ts` | CLI agent that makes 3 paid requests |
| `dashboard.ts` | Express backend — SSE events, status API, payment orchestration |
| `frontend/` | React UI — flow diagram, event log, on-chain view |
| `artifacts/` | Pre-compiled Solidity contract ABIs and bytecode |

## Troubleshooting

**"insufficient_confidential_balance"** — The agent hasn't deposited USDC or the mock MPC hasn't processed the deposit yet. Check `curl http://localhost:4023/status` to see tracked balances. Make sure mock-mpc is running.

**"nonce too low"** — Base Sepolia RPC nonce caching. Wait a few seconds and retry the command.

**Mock MPC not processing actions** — Ensure it's running (`curl http://localhost:4023/health`). The MPC wallet needs ETH for `processMPC` gas (~0.003 ETH per batch).

**Deploy fails with "MPC wallet needs at least 0.01 ETH"** — Fund the MPC wallet address (shown in `.env.sepolia` as `MPC_ADDRESS`) with Base Sepolia ETH from a faucet.

**Dashboard shows stale data** — Hard refresh the browser. If the frontend was rebuilt, restart the dashboard service.

**MPC balance persistence** — The mock MPC saves balances to `.mpc-balances.json` so they survive restarts. Delete this file to reset to a clean state (you'll need to re-deposit).
