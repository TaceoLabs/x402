/**
 * deploy-sepolia.ts — Deploy contracts to Base Sepolia for the confidential x402 demo.
 *
 * Deploys:
 *   1. Poseidon2 hasher
 *   2. MockVerifier (always-true verifier for mocked MPC)
 *   3. QueryMapLib (library used by PrivateBalance)
 *   4. PrivateBalance (confidential token contract)
 *
 * Uses real USDC on Base Sepolia — no MockUSDC deployment needed.
 * After deployment, run deposit-sepolia.ts to deposit real USDC.
 *
 * Usage: tsx deploy-sepolia.ts
 * Requires: MPC_PRIVATE_KEY, FACILITATOR_PRIVATE_KEY, AGENT_PRIVATE_KEY, SERVER_PRIVATE_KEY env vars
 *           MPC wallet needs ~0.05 ETH on Base Sepolia for deployment gas
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
} from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Configuration ──────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";
const CHAIN_ID = 84532;

// Real USDC on Base Sepolia
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`;

// Private keys from env (no defaults — these must be funded Base Sepolia wallets)
const MPC_KEY = process.env.MPC_PRIVATE_KEY as `0x${string}`;
const FACILITATOR_KEY = process.env.FACILITATOR_PRIVATE_KEY as `0x${string}`;
const AGENT_KEY = process.env.AGENT_PRIVATE_KEY as `0x${string}`;
const SERVER_KEY = process.env.SERVER_PRIVATE_KEY as `0x${string}`;

if (!MPC_KEY || !FACILITATOR_KEY || !AGENT_KEY || !SERVER_KEY) {
  console.error("Missing required env vars:");
  console.error("  MPC_PRIVATE_KEY, FACILITATOR_PRIVATE_KEY, AGENT_PRIVATE_KEY, SERVER_PRIVATE_KEY");
  process.exit(1);
}

// Path to contract artifacts — uses local ./artifacts/ by default (committed to repo)
const CONTRACTS_OUT = resolve(
  __dirname,
  process.env.CONTRACTS_OUT_DIR || "./artifacts",
);

// BabyJubJub base point (a valid point on the curve — used as mock MPC public keys)
const BABYJUBJUB_BASE = {
  x: BigInt("5299619240641551281634865583518297030282874472190772894086521144482721001553"),
  y: BigInt("16950150798460657717958625567821834550301663161624707787222815936182638968203"),
};

// ── Helpers ────────────────────────────────────────────────────────────────────

const chain = defineChain({
  ...baseSepolia,
  rpcUrls: { default: { http: [RPC_URL] } },
});

function loadArtifact(contractDir: string, contractName: string) {
  // Try flat layout first (./artifacts/ContractName.json), then Foundry layout (dir/ContractName.json)
  let artifactPath = resolve(CONTRACTS_OUT, `${contractName}.json`);
  try { readFileSync(artifactPath); } catch { artifactPath = resolve(CONTRACTS_OUT, contractDir, `${contractName}.json`); }
  const raw = JSON.parse(readFileSync(artifactPath, "utf8"));
  return {
    abi: raw.abi,
    bytecode: raw.bytecode.object as `0x${string}`,
    linkReferences: raw.bytecode.linkReferences as Record<string, Record<string, Array<{ start: number; length: number }>>>,
  };
}

function linkBytecode(
  bytecode: string,
  linkReferences: Record<string, Record<string, Array<{ start: number; length: number }>>>,
  libraries: Record<string, `0x${string}`>,
): `0x${string}` {
  let linked = bytecode;
  for (const [file, libs] of Object.entries(linkReferences)) {
    for (const [libName, offsets] of Object.entries(libs)) {
      const addr = libraries[libName];
      if (!addr) throw new Error(`Missing library address for ${file}:${libName}`);
      const addrHex = addr.slice(2).toLowerCase();
      for (const { start, length } of offsets) {
        const charStart = 2 + start * 2;
        const charLen = length * 2;
        linked = linked.slice(0, charStart) + addrHex + linked.slice(charStart + charLen);
      }
    }
  }
  return linked as `0x${string}`;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log("[Deploy] Starting deployment to Base Sepolia...\n");

  const mpcAccount = privateKeyToAccount(MPC_KEY);
  const facilitatorAccount = privateKeyToAccount(FACILITATOR_KEY);
  const agentAccount = privateKeyToAccount(AGENT_KEY);
  const serverAccount = privateKeyToAccount(SERVER_KEY);

  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
  const walletClient = createWalletClient({
    account: mpcAccount,
    chain,
    transport: http(RPC_URL),
  });

  // Check MPC wallet balance
  const mpcBalance = await publicClient.getBalance({ address: mpcAccount.address });
  console.log(`[Deploy] MPC wallet ${mpcAccount.address} balance: ${Number(mpcBalance) / 1e18} ETH`);
  if (mpcBalance < BigInt(1e16)) {
    console.error("[Deploy] MPC wallet needs at least 0.01 ETH for deployment. Fund it via faucet.");
    process.exit(1);
  }

  // 1. Deploy Poseidon2
  console.log("[Deploy] Deploying Poseidon2 hasher...");
  const poseidon2 = loadArtifact("poseidon2.sol", "Poseidon2T2_BN254");
  const poseidonHash = await walletClient.deployContract({
    abi: poseidon2.abi,
    bytecode: poseidon2.bytecode,
  });
  const poseidonReceipt = await publicClient.waitForTransactionReceipt({ hash: poseidonHash });
  const poseidonAddress = poseidonReceipt.contractAddress!;
  console.log(`[Deploy] Poseidon2 deployed at ${poseidonAddress}\n`);

  // 2. Deploy MockVerifier (always-true verifier for mocked MPC)
  console.log("[Deploy] Deploying MockVerifier...");
  const verifier = loadArtifact("MockVerifier.sol", "MockVerifier");
  const verifierHash = await walletClient.deployContract({
    abi: verifier.abi,
    bytecode: verifier.bytecode,
  });
  const verifierReceipt = await publicClient.waitForTransactionReceipt({ hash: verifierHash });
  const verifierAddress = verifierReceipt.contractAddress!;
  console.log(`[Deploy] MockVerifier deployed at ${verifierAddress}\n`);

  // 2b. Deploy ClientTransferVerifier (real on-chain ZK proof verification)
  console.log("[Deploy] Deploying ClientTransferVerifier...");
  const clientVerifier = loadArtifact("ClientTransferVerifier.sol", "ClientTransferVerifier");
  const clientVerifierHash = await walletClient.deployContract({
    abi: clientVerifier.abi,
    bytecode: clientVerifier.bytecode,
  });
  const clientVerifierReceipt = await publicClient.waitForTransactionReceipt({ hash: clientVerifierHash });
  const clientVerifierAddress = clientVerifierReceipt.contractAddress!;
  console.log(`[Deploy] ClientTransferVerifier deployed at ${clientVerifierAddress}\n`);

  // 3. Deploy QueryMapLib
  console.log("[Deploy] Deploying QueryMapLib...");
  const queryMapLib = loadArtifact("action_queue.sol", "QueryMapLib");
  const queryMapHash = await walletClient.deployContract({
    abi: queryMapLib.abi,
    bytecode: queryMapLib.bytecode,
  });
  const queryMapReceipt = await publicClient.waitForTransactionReceipt({ hash: queryMapHash });
  const queryMapAddress = queryMapReceipt.contractAddress!;
  console.log(`[Deploy] QueryMapLib deployed at ${queryMapAddress}\n`);

  // 4. Deploy PrivateBalance (with QueryMapLib linked)
  console.log("[Deploy] Deploying PrivateBalance...");
  const privBalance = loadArtifact("priv_balance.sol", "PrivateBalance");
  const linkedBytecode = linkBytecode(
    privBalance.bytecode,
    privBalance.linkReferences,
    { QueryMapLib: queryMapAddress as `0x${string}` },
  );
  const privBalanceHash = await walletClient.deployContract({
    abi: privBalance.abi,
    bytecode: linkedBytecode,
    args: [
      verifierAddress,                // _verifierAddress (MockVerifier)
      clientVerifierAddress,          // _clientVerifierAddress (MockClientVerifier)
      poseidonAddress,                // _poseidon2Address
      mpcAccount.address,             // _mpcAddress (MPC operator)
      USDC_ADDRESS,                   // _usdcAddress (real USDC on Base Sepolia)
      BABYJUBJUB_BASE,               // _mpc_pk1
      BABYJUBJUB_BASE,               // _mpc_pk2
      BABYJUBJUB_BASE,               // _mpc_pk3
      true,                           // _allow_all (no whitelist for demo)
    ],
  });
  const privBalanceReceipt = await publicClient.waitForTransactionReceipt({ hash: privBalanceHash });
  const privBalanceAddress = privBalanceReceipt.contractAddress!;
  console.log(`[Deploy] PrivateBalance deployed at ${privBalanceAddress}\n`);

  // ── Write .env.sepolia ───────────────────────────────────────────────────────

  const envContent = `# Generated by deploy-sepolia.ts — DO NOT EDIT
# Wallet keys
MPC_PRIVATE_KEY=${MPC_KEY}
FACILITATOR_PRIVATE_KEY=${FACILITATOR_KEY}
SERVER_PRIVATE_KEY=${SERVER_KEY}
AGENT_PRIVATE_KEY=${AGENT_KEY}

# Chain
CHAIN_ID=${CHAIN_ID}
RPC_URL=${RPC_URL}

# Contract addresses
USDC_ADDRESS=${USDC_ADDRESS}
POSEIDON2_ADDRESS=${poseidonAddress}
VERIFIER_ADDRESS=${verifierAddress}
CLIENT_VERIFIER_ADDRESS=${clientVerifierAddress}
PRIVATE_BALANCE_ADDRESS=${privBalanceAddress}

# Derived addresses
MPC_ADDRESS=${mpcAccount.address}
FACILITATOR_ADDRESS=${facilitatorAccount.address}
SERVER_ADDRESS=${serverAccount.address}
AGENT_ADDRESS=${agentAccount.address}

# MPC Public Keys (BabyJubJub base point used for all 3 in demo)
MPC_PK_X=${BABYJUBJUB_BASE.x.toString()}
MPC_PK_Y=${BABYJUBJUB_BASE.y.toString()}

# Mock MPC service
MPC_BALANCE_CHECK_URL=http://localhost:4023

`;

  const envPath = resolve(__dirname, ".env.sepolia");
  writeFileSync(envPath, envContent);
  console.log(`[Deploy] Contract addresses written to ${envPath}\n`);

  // ── Summary ──────────────────────────────────────────────────────────────────

  console.log("=".repeat(60));
  console.log("  Base Sepolia Deployment Complete!");
  console.log("=".repeat(60));
  console.log(`  USDC (real):     ${USDC_ADDRESS}`);
  console.log(`  Poseidon2:       ${poseidonAddress}`);
  console.log(`  MockVerifier:    ${verifierAddress}`);
  console.log(`  ClientTransferVerifier: ${clientVerifierAddress}`);
  console.log(`  PrivateBalance:  ${privBalanceAddress}`);
  console.log("");
  console.log(`  MPC Operator:    ${mpcAccount.address}`);
  console.log(`  Facilitator:     ${facilitatorAccount.address}`);
  console.log(`  Server:          ${serverAccount.address}`);
  console.log(`  Agent:           ${agentAccount.address}`);
  console.log("=".repeat(60));
  console.log("\nNext steps:");
  console.log("  1. Start mock MPC:     pnpm run mock-mpc");
  console.log("  2. Deposit USDC:       pnpm run deposit:sepolia");
  console.log("  3. Start facilitator:  pnpm run facilitator:sepolia");
  console.log("  4. Start server:       pnpm run server:sepolia");
  console.log("  5. Start dashboard:    pnpm run dashboard:sepolia");
}

main().catch((err) => {
  console.error("[Deploy] Fatal error:", err);
  process.exit(1);
});
