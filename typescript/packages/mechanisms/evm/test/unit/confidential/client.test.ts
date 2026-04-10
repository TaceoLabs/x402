import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConfidentialEvmScheme } from "../../../src/confidential/client/scheme";
import type { ProofGenerator } from "../../../src/confidential/client/transferFrom";
import type { ClientEvmSigner } from "../../../src/signer";
import type { PaymentRequirements } from "@x402/core/types";
import { BN254_PRIME } from "../../../src/confidential/constants";

// BabyJubJub base point (valid on-curve point)
const BJJ_BASE = {
  x: "5299619240641551281634865583518297030282874472190772894086521144482721001553",
  y: "16950150798460657717958625567821834550301663161624707787222815936182638968203",
};

const MOCK_MPC_PKS: [typeof BJJ_BASE, typeof BJJ_BASE, typeof BJJ_BASE] = [BJJ_BASE, BJJ_BASE, BJJ_BASE];

const MOCK_CONTRACT = "0x5fc8d32690cc91d4c39d9d3abcbd16989f875707";

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

describe("ConfidentialEvmScheme (Client)", () => {
  let mockSigner: ClientEvmSigner;

  beforeEach(() => {
    mockSigner = {
      address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
      signTypedData: vi.fn().mockResolvedValue("0x" + "ab".repeat(65)),
      readContract: vi.fn().mockResolvedValue(12345n), // mock commit() return
    };
  });

  describe("Construction", () => {
    it("should create instance with signer", () => {
      const scheme = new ConfidentialEvmScheme(mockSigner);
      expect(scheme).toBeDefined();
      expect(scheme.scheme).toBe("confidential");
    });

    it("should accept optional proofGenerator", () => {
      const pg: ProofGenerator = vi.fn();
      const scheme = new ConfidentialEvmScheme(mockSigner, pg);
      expect(scheme).toBeDefined();
    });
  });

  describe("createPaymentPayload (legacy path — no proofGenerator)", () => {
    it("should create a valid payload with commitment and ciphertext", async () => {
      const scheme = new ConfidentialEvmScheme(mockSigner);
      const result = await scheme.createPaymentPayload(2, makeRequirements());

      expect(result.x402Version).toBe(2);
      expect(result.payload).toBeDefined();
      expect(result.payload.signature).toMatch(/^0x/);
      expect(result.payload.authorization).toBeDefined();
      expect(result.payload.authorization.sender).toBe(mockSigner.address);
      expect(result.payload.authorization.amountCommitment).toBeDefined();
      expect(result.payload.authorization.ciphertext).toBeDefined();
      expect(result.payload.authorization.ciphertext.amount).toHaveLength(3);
      expect(result.payload.authorization.ciphertext.r).toHaveLength(3);
      expect(result.payload.authorization.ciphertext.senderPk).toBeDefined();
    });

    it("should call readContract to compute commitment", async () => {
      const scheme = new ConfidentialEvmScheme(mockSigner);
      await scheme.createPaymentPayload(2, makeRequirements());
      expect(mockSigner.readContract).toHaveBeenCalled();
    });

    it("should include beta in authorization (defaults to 0 without proofGenerator)", async () => {
      const scheme = new ConfidentialEvmScheme(mockSigner);
      const result = await scheme.createPaymentPayload(2, makeRequirements());
      expect(result.payload.authorization.beta).toBeDefined();
      expect(result.payload.authorization.beta).toBe("0");
    });

    it("should sign an EIP-712 typed data message", async () => {
      const scheme = new ConfidentialEvmScheme(mockSigner);
      await scheme.createPaymentPayload(2, makeRequirements());
      expect(mockSigner.signTypedData).toHaveBeenCalledTimes(1);
    });

    it("should generate different nonces on each call", async () => {
      const scheme = new ConfidentialEvmScheme(mockSigner);
      const r1 = await scheme.createPaymentPayload(2, makeRequirements());
      const r2 = await scheme.createPaymentPayload(2, makeRequirements());
      expect(r1.payload.authorization.nonce).not.toBe(r2.payload.authorization.nonce);
    });

    it("should set receiver from payTo", async () => {
      const req = makeRequirements({ payTo: "0x1111111111111111111111111111111111111111" });
      const scheme = new ConfidentialEvmScheme(mockSigner);
      const result = await scheme.createPaymentPayload(2, req);
      expect(result.payload.authorization.receiver.toLowerCase()).toBe(
        "0x1111111111111111111111111111111111111111",
      );
    });
  });

  describe("createPaymentPayload (ZK proof path)", () => {
    it("should use proofGenerator when provided", async () => {
      const mockProofGenerator: ProofGenerator = vi.fn().mockResolvedValue({
        proof: { compressedProof: ["1", "2", "3", "4"] },
        beta: 42n,
        amountCommitment: 99999n,
        ciphertext: {
          amount: ["10", "20", "30"],
          r: ["40", "50", "60"],
          senderPk: { x: BJJ_BASE.x, y: BJJ_BASE.y },
        },
      });

      const scheme = new ConfidentialEvmScheme(mockSigner, mockProofGenerator);
      const result = await scheme.createPaymentPayload(2, makeRequirements());

      expect(mockProofGenerator).toHaveBeenCalledTimes(1);
      expect(result.payload.clientProof).toBeDefined();
      expect(result.payload.clientProof!.compressedProof).toEqual(["1", "2", "3", "4"]);
      expect(result.payload.authorization.amountCommitment).toBe("99999");
      expect(result.payload.authorization.beta).toBe("42");
    });

    it("should NOT call readContract when proofGenerator is provided", async () => {
      const mockProofGenerator: ProofGenerator = vi.fn().mockResolvedValue({
        proof: { compressedProof: ["0", "0", "0", "0"] },
        beta: 0n,
        amountCommitment: 1n,
        ciphertext: {
          amount: ["0", "0", "0"],
          r: ["0", "0", "0"],
          senderPk: { x: "0", y: "1" },
        },
      });

      const scheme = new ConfidentialEvmScheme(mockSigner, mockProofGenerator);
      await scheme.createPaymentPayload(2, makeRequirements());

      // readContract should NOT be called — commitment comes from proof
      expect(mockSigner.readContract).not.toHaveBeenCalled();
    });

    it("should pass mpcPublicKeys from requirements to proofGenerator", async () => {
      const mockProofGenerator: ProofGenerator = vi.fn().mockResolvedValue({
        proof: { compressedProof: ["0", "0", "0", "0"] },
        beta: 0n,
        amountCommitment: 1n,
        ciphertext: {
          amount: ["0", "0", "0"],
          r: ["0", "0", "0"],
          senderPk: { x: "0", y: "1" },
        },
      });

      const scheme = new ConfidentialEvmScheme(mockSigner, mockProofGenerator);
      await scheme.createPaymentPayload(2, makeRequirements());

      const call = (mockProofGenerator as ReturnType<typeof vi.fn>).mock.calls[0];
      // Third arg is mpcPublicKeys
      expect(call[2]).toEqual(MOCK_MPC_PKS);
    });
  });

  describe("error handling", () => {
    it("should throw if extra is missing confidentialToken", async () => {
      const scheme = new ConfidentialEvmScheme(mockSigner);
      const req = makeRequirements({ extra: {} });
      await expect(scheme.createPaymentPayload(2, req)).rejects.toThrow(
        /confidential extra/i,
      );
    });
  });
});
