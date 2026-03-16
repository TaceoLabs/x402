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

**Flow:**

1. Agent requests data from a paid API endpoint
2. Server responds with `402 Payment Required` and the price ($0.05 USDC)
3. Agent creates a confidential payment — Poseidon2 commitment hiding the amount, 3 encrypted secret shares (one per MPC node), EIP-712 signature
4. Facilitator checks the sender has sufficient funds (via MPC balance-check), verifies the signature, calls `transferFrom()` on the PrivateBalance contract
5. On-chain: only cryptographic commitments are stored — the $0.05 amount is never revealed
6. Mock MPC picks up the queued transfer, recovers plaintext from shares, updates balance commitments on-chain via `processMPC()`

## Prerequisites

- **Node.js** >= 20 (tested on v24.1.0)
- **pnpm** (workspace-aware)
- **Foundry** (`forge`) — for building contract artifacts
- Base Sepolia ETH in the MPC wallet (~0.05 ETH for deployment, ~0.01 ETH ongoing for `processMPC` gas)
- Base Sepolia ETH in the Facilitator wallet (~0.02 ETH for settlement gas)
- Base Sepolia USDC in the Agent wallet (get from [Circle Faucet](https://faucet.circle.com) — 20 USDC/request)
- Agent wallet needs ~0.002 ETH for `approve` + `deposit` gas

## Quick Start (Existing Contracts)

If `.env.sepolia` already exists with deployed contract addresses, you can skip deployment and go straight to running the demo.

### 1. Install dependencies

From the repo root:

```bash
cd examples/typescript
pnpm install
```

Build the frontend:

```bash
cd examples/typescript/agent-confidential
pnpm run frontend:install
pnpm run frontend:build
```

### 2. Build contract artifacts

The demo loads ABI + bytecode from Foundry build artifacts. From the `private_deposit` repo:

```bash
cd private_deposit/contracts
forge build --skip test --skip script
```

The path to the artifacts is configured via `CONTRACTS_OUT_DIR` in `.env.sepolia` (default: `../../../../private_deposit/contracts/out`).

### 3. Start Mock MPC

The mock MPC service must start first — it processes deposits and handles balance checks.

```bash
pnpm run mock-mpc
```

This starts on `:4023`. It begins with an empty balance map; balances are populated when deposit actions are processed from the on-chain queue.

### 4. Deposit USDC (if agent has no confidential balance)

The agent needs real USDC deposited into the PrivateBalance contract:

1. Get USDC from [Circle Faucet](https://faucet.circle.com) — select Base Sepolia, enter the agent address
2. Ensure agent has ~0.002 ETH for gas
3. Run the deposit script:

```bash
pnpm run deposit:sepolia
```

This calls `approve()` then `deposit()` on real Base Sepolia USDC. The mock MPC will automatically pick up the deposit action and create the balance commitment.

You can verify the deposit was processed:

```bash
curl http://localhost:4023/status
```

### 5. Start services

Open separate terminals (or background them) for each service:

```bash
# Terminal 2 — Facilitator (verify + settle payments)
pnpm run facilitator:sepolia

# Terminal 3 — Resource Server (sentiment API behind paywall)
pnpm run server:sepolia

# Terminal 4 — Dashboard (React frontend + orchestration)
pnpm run dashboard:sepolia
```

### 6. Run the demo

**Via dashboard:** Open http://localhost:4020 in your browser. Click "Enter Demo", then select a ticker (ETH, BTC, SOL) to trigger a paid API request. The UI shows the payment flow in real-time.

**Via CLI agent:** Run the agent script to make 3 consecutive paid requests:

```bash
pnpm run agent:sepolia
```

**Via curl (manual):** Trigger a payment through the dashboard API:

```bash
curl -X POST http://localhost:4020/api/pay \
  -H 'Content-Type: application/json' \
  -d '{"ticker": "ETH"}'
```

## Fresh Deployment

To deploy new contracts from scratch:

### 1. Generate wallets

You need 4 private keys. Generate them however you prefer, then export:

```bash
export MPC_PRIVATE_KEY=0x...
export FACILITATOR_PRIVATE_KEY=0x...
export AGENT_PRIVATE_KEY=0x...
export SERVER_PRIVATE_KEY=0x...
```

### 2. Fund wallets

- **MPC wallet**: ~0.05 ETH (deploys all contracts + ongoing `processMPC` gas)
- **Facilitator wallet**: ~0.02 ETH (`transferFrom` settlement transactions)
- **Agent wallet**: ~0.002 ETH (`approve` + `deposit` gas)

Use a Base Sepolia ETH faucet to fund the MPC and Facilitator wallets.

### 3. Build contract artifacts

```bash
cd private_deposit/contracts
forge build --skip test --skip script
```

### 4. Deploy

```bash
pnpm run deploy:sepolia
```

This deploys Poseidon2, MockVerifier, QueryMapLib, and PrivateBalance to Base Sepolia using real USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`). It writes all addresses and keys to `.env.sepolia`.

### 5. Start services, deposit, and run

Follow steps 3-6 from the Quick Start section above.

## Services

| Service | Port | Script | Description |
|---------|------|--------|-------------|
| Mock MPC | 4023 | `pnpm run mock-mpc` | Balance-check endpoint + action queue processor |
| Facilitator | 4022 | `pnpm run facilitator:sepolia` | Verifies payments, checks balance via MPC, settles on-chain |
| Resource Server | 4021 | `pnpm run server:sepolia` | Sentiment API behind $0.05 USDC confidential paywall |
| Dashboard | 4020 | `pnpm run dashboard:sepolia` | React frontend with live flow visualization + SSE events |
| Agent (CLI) | — | `pnpm run agent:sepolia` | Makes 3 paid requests (ETH, BTC, SOL sentiment) |

## Contracts (Base Sepolia)

| Contract | Purpose |
|----------|---------|
| PrivateBalance | Confidential token — stores Poseidon2 commitments, handles `transferFrom` + `deposit`, manages action queue |
| Poseidon2 | Hash function for balance commitments |
| MockVerifier | Always-true Groth16 verifier (placeholder for real MPC prover) |
| USDC | Real Base Sepolia USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`) |

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

## File Overview

| File | Description |
|------|-------------|
| `deploy-sepolia.ts` | Deploys all contracts to Base Sepolia, writes `.env.sepolia` |
| `deposit-sepolia.ts` | Real USDC `approve()` → `deposit()` flow |
| `mock-mpc.ts` | Mock MPC service — balance checks + action queue processing |
| `facilitator.ts` | x402 facilitator with confidential scheme + MPC balance check |
| `server.ts` | Resource server with x402 paywall middleware |
| `agent.ts` | CLI agent that makes 3 paid requests |
| `dashboard.ts` | Express backend — SSE events, status API, payment orchestration |
| `frontend/` | React UI — flow diagram, event log, on-chain view |

## Troubleshooting

**"insufficient_confidential_balance"** — The agent hasn't deposited USDC or the mock MPC hasn't processed the deposit yet. Check `curl http://localhost:4023/status` to see tracked balances.

**"nonce too low"** — Base Sepolia RPC nonce caching. Wait a few seconds and retry.

**Mock MPC not processing actions** — Ensure it's running (`curl http://localhost:4023/health`). Check logs for errors. The MPC wallet needs ETH for `processMPC` gas (~0.003 ETH per batch).

**Dashboard shows stale data** — Refresh the browser. If the frontend was rebuilt, restart the dashboard service.
