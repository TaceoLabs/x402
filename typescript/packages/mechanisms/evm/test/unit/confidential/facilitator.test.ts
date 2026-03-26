import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConfidentialEvmScheme } from "../../../src/confidential/facilitator/scheme";
import { ConfidentialEvmScheme as ClientScheme } from "../../../src/confidential/client/scheme";
import type { ClientEvmSigner, FacilitatorEvmSigner } from "../../../src/signer";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import type { ProofVerifier } from "../../../src/confidential/facilitator/verify";
import { ZERO_COMMITMENT, BN254_PRIME } from "../../../src/confidential/constants";
import type { BabyJubJubPoint, ConfidentialEvmPayload } from "../../../src/confidential/types";

// BabyJubJub base point
const BJJ_BASE: BabyJubJubPoint = {
  x: "5299619240641551281634865583518297030282874472190772894086521144482721001553",
  y: "16950150798460657717958625567821834550301663161624707787222815936182638968203",
};

const MOCK_CONTRACT = "0x5fc8d32690cc91d4c39d9d3abcbd16989f875707";
const MOCK_MPC_PKS: [BabyJubJubPoint, BabyJubJubPoint, BabyJubJubPoint] = [BJJ_BASE, BJJ_BASE, BJJ_BASE];

function makeRequirements(overrides?: Partial<PaymentRequirements>): PaymentRequirements {
  return {
    scheme: "confidential",
    network: "eip155:31337",
    amount: "50000",
    asset: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
    payTo: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    maxTimeoutSeconds: 300,
    extra: {
      confidentialToken: MOCK_CONTRACT,
      eip712Domain: { name: "ConfidentialToken", version: "1" },
      mpcPublicKeys: MOCK_MPC_PKS,
    },
    ...overrides,
  };
}

describe("ConfidentialEvmScheme (Facilitator)", () => {
  let facilitator: ConfidentialEvmScheme;
  let mockFacilitatorSigner: FacilitatorEvmSigner;
  let client: ClientScheme;
  let mockClientSigner: ClientEvmSigner;

  beforeEach(() => {
    mockClientSigner = {
      address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
      signTypedData: vi.fn().mockResolvedValue("0x" + "ab".repeat(65)),
      readContract: vi.fn().mockResolvedValue(12345n),
    };
    client = new ClientScheme(mockClientSigner);

    mockFacilitatorSigner = {
      getAddresses: vi.fn().mockReturnValue(["0x70997970C51812dc3A010C7d01b50e0d17dc79C8"]),
      readContract: vi.fn().mockImplementation(async (args: { functionName: string; args?: unknown[] }) => {
        if (args.functionName === "isNonceUsed") return false;
        if (args.functionName === "getBalanceCommitment") return 99999n; // non-zero = has balance
        if (args.functionName === "commit") return 12345n; // mock commit
        return 0n;
      }),
      verifyTypedData: vi.fn().mockResolvedValue(true),
      writeContract: vi.fn().mockResolvedValue("0x" + "ff".repeat(32)),
      sendTransaction: vi.fn().mockResolvedValue("0x" + "ff".repeat(32)),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }),
      getCode: vi.fn().mockResolvedValue("0x"),
    };

    facilitator = new ConfidentialEvmScheme({
      signer: mockFacilitatorSigner,
      confidentialToken: MOCK_CONTRACT,
      eip712Domain: { name: "ConfidentialToken", version: "1" },
      mpcPublicKeys: MOCK_MPC_PKS,
    });
  });

  async function createValidPayload(): Promise<{ fullPayload: PaymentPayload; requirements: PaymentRequirements }> {
    const requirements = makeRequirements();
    const paymentPayload = await client.createPaymentPayload(2, requirements);
    const fullPayload: PaymentPayload = {
      ...paymentPayload,
      accepted: requirements,
      resource: { url: "test", description: "", mimeType: "" },
    };
    return { fullPayload, requirements };
  }

  describe("Construction", () => {
    it("should create instance with config", () => {
      expect(facilitator).toBeDefined();
      expect(facilitator.scheme).toBe("confidential");
    });

    it("should return extra with contract and MPC keys", () => {
      const extra = facilitator.getExtra("eip155:31337");
      expect(extra).toBeDefined();
      expect((extra as Record<string, unknown>).confidentialToken).toBe(MOCK_CONTRACT);
      expect((extra as Record<string, unknown>).mpcPublicKeys).toEqual(MOCK_MPC_PKS);
    });

    it("should return signer addresses", () => {
      const signers = facilitator.getSigners("eip155:31337");
      expect(signers).toContain("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
    });
  });

  describe("verify", () => {
    it("should accept a valid confidential payload", async () => {
      const { fullPayload, requirements } = await createValidPayload();
      const result = await facilitator.verify(fullPayload, requirements);
      expect(result.isValid).toBe(true);
      expect(result.payer).toBe(mockClientSigner.address);
    });

    it("should reject if scheme doesn't match", async () => {
      const { fullPayload, requirements } = await createValidPayload();
      fullPayload.accepted = { ...requirements, scheme: "exact" };
      const badReq = { ...requirements, scheme: "exact" };

      const result = await facilitator.verify(fullPayload, badReq);
      expect(result.isValid).toBe(false);
    });

    it("should reject if network doesn't match", async () => {
      const { fullPayload, requirements } = await createValidPayload();
      // Payload was accepted on eip155:31337, but requirements say eip155:1
      const badReq = { ...requirements, network: "eip155:1" as const };

      const result = await facilitator.verify(fullPayload, badReq);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("network_mismatch");
    });

    it("should reject if receiver doesn't match payTo", async () => {
      const { fullPayload, requirements } = await createValidPayload();
      const badReq = { ...requirements, payTo: "0x1111111111111111111111111111111111111111" };

      const result = await facilitator.verify(fullPayload, badReq);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("receiver_mismatch");
    });

    it("should reject if deadline is expired", async () => {
      const { fullPayload, requirements } = await createValidPayload();
      // Set deadline to the past
      const payload = fullPayload.payload as ConfidentialEvmPayload;
      payload.authorization.deadline = "0";

      const result = await facilitator.verify(fullPayload, requirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("deadline_expired");
    });

    it("should reject if commitment is outside BN254 field", async () => {
      const { fullPayload, requirements } = await createValidPayload();
      const payload = fullPayload.payload as ConfidentialEvmPayload;
      payload.authorization.amountCommitment = BN254_PRIME.toString();

      const result = await facilitator.verify(fullPayload, requirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("commitment_not_in_field");
    });

    it("should reject if nonce already used", async () => {
      mockFacilitatorSigner.readContract = vi.fn().mockImplementation(
        async (args: { functionName: string }) => {
          if (args.functionName === "isNonceUsed") return true;
          if (args.functionName === "getBalanceCommitment") return 99999n;
          if (args.functionName === "commit") return 12345n;
          return 0n;
        },
      );

      const { fullPayload, requirements } = await createValidPayload();
      const result = await facilitator.verify(fullPayload, requirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("nonce_already_used");
    });

    it("should reject if sender has zero commitment (no balance)", async () => {
      mockFacilitatorSigner.readContract = vi.fn().mockImplementation(
        async (args: { functionName: string }) => {
          if (args.functionName === "isNonceUsed") return false;
          if (args.functionName === "getBalanceCommitment") return ZERO_COMMITMENT;
          if (args.functionName === "commit") return 12345n;
          return 0n;
        },
      );

      const { fullPayload, requirements } = await createValidPayload();
      const result = await facilitator.verify(fullPayload, requirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("no_balance");
    });

    it("should reject if EIP-712 signature is invalid", async () => {
      mockFacilitatorSigner.verifyTypedData = vi.fn().mockResolvedValue(false);

      const { fullPayload, requirements } = await createValidPayload();
      const result = await facilitator.verify(fullPayload, requirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("invalid_signature");
    });

    it("should reject if commitment doesn't match recomputed value", async () => {
      mockFacilitatorSigner.readContract = vi.fn().mockImplementation(
        async (args: { functionName: string }) => {
          if (args.functionName === "isNonceUsed") return false;
          if (args.functionName === "getBalanceCommitment") return 99999n;
          if (args.functionName === "commit") return 99999n; // Different from the 12345n the client used
          return 0n;
        },
      );

      const { fullPayload, requirements } = await createValidPayload();
      const result = await facilitator.verify(fullPayload, requirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("commitment_mismatch");
    });

    it("should reject if payload format is invalid", async () => {
      const requirements = makeRequirements();
      const badPayload: PaymentPayload = {
        x402Version: 2,
        payload: { notAValidPayload: true } as unknown as Record<string, unknown>,
        accepted: requirements,
        resource: { url: "test", description: "", mimeType: "" },
      };

      const result = await facilitator.verify(badPayload, requirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("invalid_confidential_payload_format");
    });
  });

  describe("verify with proofVerifier", () => {
    it("should reject if client proof is missing when verifier is configured", async () => {
      const proofVerifier: ProofVerifier = vi.fn().mockResolvedValue(true);
      const facilitatorWithProof = new ConfidentialEvmScheme({
        signer: mockFacilitatorSigner,
        confidentialToken: MOCK_CONTRACT,
        eip712Domain: { name: "ConfidentialToken", version: "1" },
        mpcPublicKeys: MOCK_MPC_PKS,
        proofVerifier,
      });

      const { fullPayload, requirements } = await createValidPayload();
      // Remove client proof
      (fullPayload.payload as ConfidentialEvmPayload).clientProof = undefined;

      const result = await facilitatorWithProof.verify(fullPayload, requirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("missing_client_proof");
    });

    it("should reject if proof verification returns false", async () => {
      const proofVerifier: ProofVerifier = vi.fn().mockResolvedValue(false);
      const facilitatorWithProof = new ConfidentialEvmScheme({
        signer: mockFacilitatorSigner,
        confidentialToken: MOCK_CONTRACT,
        eip712Domain: { name: "ConfidentialToken", version: "1" },
        mpcPublicKeys: MOCK_MPC_PKS,
        proofVerifier,
      });

      const { fullPayload, requirements } = await createValidPayload();
      // Add a proof so it passes the "missing" check
      (fullPayload.payload as ConfidentialEvmPayload).clientProof = {
        pA: ["1", "2"],
        pB: [["3", "4"], ["5", "6"]],
        pC: ["7", "8"],
      };

      const result = await facilitatorWithProof.verify(fullPayload, requirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("invalid_client_proof");
    });

    it("should pass 15 public signals to the proof verifier", async () => {
      const proofVerifier: ProofVerifier = vi.fn().mockResolvedValue(true);
      const facilitatorWithProof = new ConfidentialEvmScheme({
        signer: mockFacilitatorSigner,
        confidentialToken: MOCK_CONTRACT,
        eip712Domain: { name: "ConfidentialToken", version: "1" },
        mpcPublicKeys: MOCK_MPC_PKS,
        proofVerifier,
      });

      const { fullPayload, requirements } = await createValidPayload();
      (fullPayload.payload as ConfidentialEvmPayload).clientProof = {
        pA: ["1", "2"],
        pB: [["3", "4"], ["5", "6"]],
        pC: ["7", "8"],
      };

      await facilitatorWithProof.verify(fullPayload, requirements);

      // ProofVerifier should receive 15 public signals
      const calls = (proofVerifier as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBe(1);
      expect(calls[0][1]).toHaveLength(15);
    });
  });

  describe("settle", () => {
    it("should call writeContract with transferFrom on success", async () => {
      const { fullPayload, requirements } = await createValidPayload();
      const result = await facilitator.settle(fullPayload, requirements);

      expect(result.success).toBe(true);
      expect(result.transaction).toMatch(/^0x/);
      expect(mockFacilitatorSigner.writeContract).toHaveBeenCalled();
    });

    it("should return failure if verification fails", async () => {
      mockFacilitatorSigner.verifyTypedData = vi.fn().mockResolvedValue(false);

      const { fullPayload, requirements } = await createValidPayload();
      const result = await facilitator.settle(fullPayload, requirements);

      expect(result.success).toBe(false);
      expect(result.errorReason).toBe("invalid_signature");
    });

    it("should return failure if transaction reverts", async () => {
      mockFacilitatorSigner.waitForTransactionReceipt = vi
        .fn()
        .mockResolvedValue({ status: "reverted" });

      const { fullPayload, requirements } = await createValidPayload();
      const result = await facilitator.settle(fullPayload, requirements);

      expect(result.success).toBe(false);
      expect(result.errorReason).toBe("transaction_reverted");
    });

    it("should reject invalid payload format", async () => {
      const requirements = makeRequirements();
      const badPayload: PaymentPayload = {
        x402Version: 2,
        payload: { bad: true } as unknown as Record<string, unknown>,
        accepted: requirements,
        resource: { url: "", description: "", mimeType: "" },
      };

      const result = await facilitator.settle(badPayload, requirements);
      expect(result.success).toBe(false);
      expect(result.errorReason).toBe("invalid_confidential_payload_format");
    });
  });
});
