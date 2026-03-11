/**
 * dashboard.ts — Backend API for the confidential x402 payment demo frontend.
 *
 * Orchestrates payments step-by-step (not using wrapAxiosWithPayment) so we can
 * emit SSE events at each stage for the frontend to visualize.
 *
 * Usage: tsx dashboard.ts
 * Requires: .env file, facilitator on :4022, server on :4021
 */

import { config } from "dotenv";
config();

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import express from "express";
import type { Request, Response } from "express";
import axios from "axios";
import {
  createWalletClient,
  http,
  defineChain,
} from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { publicActions } from "viem";
import { x402Client, x402HTTPClient } from "@x402/axios";
import { ConfidentialEvmScheme } from "@x402/evm/confidential/client";
import { toClientEvmSigner } from "@x402/evm";
import type { Network } from "@x402/core/types";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Configuration ──────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const CHAIN_ID = parseInt(process.env.CHAIN_ID || "31337");
const AGENT_KEY = process.env.AGENT_PRIVATE_KEY as `0x${string}`;
const SERVER_URL = process.env.SERVER_URL || "http://localhost:4021";
const PRIVATE_BALANCE_ADDRESS = process.env.PRIVATE_BALANCE_ADDRESS as `0x${string}`;

if (!AGENT_KEY) {
  console.error("Missing AGENT_PRIVATE_KEY. Run 'pnpm run deploy' first.");
  process.exit(1);
}

// ── Chain & x402 Client ─────────────────────────────────────────────────────────

const chain = CHAIN_ID === 84532
  ? defineChain({ ...baseSepolia, rpcUrls: { default: { http: [RPC_URL] } } })
  : defineChain({
      id: CHAIN_ID,
      name: "Anvil",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [RPC_URL] } },
    });

const account = privateKeyToAccount(AGENT_KEY);
const viemClient = createWalletClient({
  account,
  chain,
  transport: http(RPC_URL),
}).extend(publicActions);

const signer = toClientEvmSigner(account, viemClient);
const NETWORK: Network = `eip155:${CHAIN_ID}`;

const client = new x402Client();
client.register(NETWORK, new ConfidentialEvmScheme(signer));
const httpClient = new x402HTTPClient(client);

// ── ABI fragments for reading contract state ────────────────────────────────────

const PRIVATE_BALANCE_ABI = [
  {
    name: "getBalanceCommitment",
    type: "function",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

// ── SSE Broadcast ───────────────────────────────────────────────────────────────

const sseClients = new Set<Response>();

function broadcast(event: Record<string, unknown>) {
  const data = JSON.stringify(event, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  for (const res of sseClients) {
    res.write(`data: ${data}\n\n`);
  }
}

/** Delay between SSE events so the frontend can animate each step visibly */
const STEP_DELAY_MS = 1200;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Express App ─────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// CORS for Vite dev server
app.use((_req: Request, res: Response, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (_req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Serve built frontend
app.use(express.static(resolve(__dirname, "frontend/dist")));

// ── SSE Events ──────────────────────────────────────────────────────────────────

app.get("/api/events", (_req: Request, res: Response) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("\n");
  sseClients.add(res);
  _req.on("close", () => sseClients.delete(res));
});

// ── Status ──────────────────────────────────────────────────────────────────────

app.get("/api/status", async (_req: Request, res: Response) => {
  try {
    const MPC_URL = process.env.MPC_BALANCE_CHECK_URL;
    const [serverHealth, facilitatorHealth, mpcHealth] = await Promise.allSettled([
      axios.get(`${SERVER_URL}/health`, { timeout: 2000 }),
      axios.get("http://localhost:4022/health", { timeout: 2000 }),
      MPC_URL ? axios.get(`${MPC_URL}/health`, { timeout: 2000 }) : Promise.reject("not configured"),
    ]);

    // Read agent balance commitment
    let agentCommitment: string | undefined;
    try {
      if (PRIVATE_BALANCE_ADDRESS) {
        const result = await viemClient.readContract({
          address: PRIVATE_BALANCE_ADDRESS,
          abi: PRIVATE_BALANCE_ABI,
          functionName: "getBalanceCommitment",
          args: [account.address],
        });
        agentCommitment = `0x${result.toString(16)}`;
      }
    } catch {
      // Contract may not be deployed yet
    }

    res.json({
      agent: {
        address: account.address,
        balanceCommitment: agentCommitment,
      },
      server: {
        status: serverHealth.status === "fulfilled" ? "online" : "offline",
        url: SERVER_URL,
      },
      facilitator: {
        status: facilitatorHealth.status === "fulfilled" ? "online" : "offline",
      },
      mpc: {
        status: mpcHealth.status === "fulfilled" ? "online" : "offline",
      },
      chain: { id: CHAIN_ID, rpc: RPC_URL, name: CHAIN_ID === 84532 ? "Base Sepolia" : "Anvil" },
    });
  } catch {
    res.status(500).json({ error: "Failed to check status" });
  }
});

// ── Payment API ─────────────────────────────────────────────────────────────────

app.post("/api/pay", async (req: Request, res: Response) => {
  const { ticker } = req.body;
  const url = `${SERVER_URL}/v1/sentiment?ticker=${ticker}`;

  try {
    // Step 1: Initial request
    broadcast({ step: 1, type: "request_start", ticker, url, timestamp: Date.now() });
    await delay(STEP_DELAY_MS);

    const initialResponse = await axios.get(url, {
      validateStatus: () => true,
    });

    if (initialResponse.status !== 402) {
      broadcast({
        step: 2,
        type: "error",
        message: `Expected 402 Payment Required, got ${initialResponse.status}`,
        timestamp: Date.now(),
      });
      return res.status(400).json({ error: `Unexpected status ${initialResponse.status}` });
    }

    // Step 2: Parse payment requirements from 402 response
    const paymentRequired = httpClient.getPaymentRequiredResponse(
      (name: string) => initialResponse.headers[name.toLowerCase()] as string | undefined,
      initialResponse.data,
    );
    broadcast({ step: 2, type: "payment_required", timestamp: Date.now() });
    await delay(STEP_DELAY_MS);

    // Step 3-4: Create confidential payment payload
    broadcast({ step: 3, type: "creating_payment", timestamp: Date.now() });
    await delay(STEP_DELAY_MS);

    const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);

    // Extract payload details for the frontend
    const payload = paymentPayload.payload as Record<string, unknown>;
    const auth = payload?.authorization as Record<string, unknown> | undefined;

    broadcast({
      step: 4,
      type: "payment_created",
      payload: {
        scheme: paymentPayload.accepted.scheme,
        amountCommitment: auth?.amountCommitment as string | undefined,
        sender: auth?.sender as string | undefined,
        receiver: auth?.receiver as string | undefined,
        nonce: auth?.nonce as string | undefined,
        deadline: auth?.deadline as string | undefined,
        hasCiphertext: !!auth?.ciphertext,
        hasSignature: !!payload?.signature,
      },
      timestamp: Date.now(),
    });
    await delay(STEP_DELAY_MS);

    // Step 5: Encode payment header and resend
    const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
    broadcast({ step: 5, type: "payment_sent", timestamp: Date.now() });
    await delay(STEP_DELAY_MS);

    // Step 6: Server receives payment, forwards to facilitator for verify + settle
    broadcast({ step: 6, type: "verifying", timestamp: Date.now() });

    const paidResponse = await axios.get(url, {
      headers: paymentHeaders,
      validateStatus: () => true,
    });
    await delay(STEP_DELAY_MS);

    if (paidResponse.status !== 200) {
      broadcast({
        step: 7,
        type: "error",
        message: `Payment failed with status ${paidResponse.status}: ${JSON.stringify(paidResponse.data)}`,
        timestamp: Date.now(),
      });
      return res.status(paidResponse.status).json({ error: "Payment rejected", details: paidResponse.data });
    }

    // Step 7: Parse settlement response from headers
    let settleResponse;
    try {
      settleResponse = httpClient.getPaymentSettleResponse(
        (name: string) => paidResponse.headers[name.toLowerCase()] as string | undefined,
      );
    } catch {
      // Settlement response header may be missing if server doesn't include it
    }

    if (settleResponse?.success) {
      broadcast({
        step: 7,
        type: "settled",
        transaction: settleResponse.transaction,
        network: settleResponse.network,
        timestamp: Date.now(),
      });
    }
    await delay(STEP_DELAY_MS);

    // Step 8: Response data
    broadcast({
      step: 8,
      type: "response_received",
      data: paidResponse.data,
      timestamp: Date.now(),
    });

    return res.json({
      success: true,
      data: paidResponse.data,
      settlement: settleResponse,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    broadcast({ type: "error", message, timestamp: Date.now() });
    return res.status(500).json({ error: message });
  }
});

// ── SPA Fallback ────────────────────────────────────────────────────────────────

app.get("*", (_req: Request, res: Response) => {
  res.sendFile(resolve(__dirname, "frontend/dist/index.html"));
});

// ── Start ───────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.DASHBOARD_PORT || "4020");
app.listen(PORT, () => {
  console.log(`\n[Dashboard] http://localhost:${PORT}`);
  console.log(`[Dashboard] Agent: ${account.address}`);
  console.log(`[Dashboard] Server: ${SERVER_URL}`);
  console.log(`[Dashboard] Contract: ${PRIVATE_BALANCE_ADDRESS || "not set"}`);
  console.log(`[Dashboard] Network: ${NETWORK}\n`);
  console.log(`[Dashboard] In dev mode, run 'cd frontend && pnpm dev' for hot reload\n`);
});
