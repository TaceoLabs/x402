import { describe, it, expect } from "vitest";
import {
  randomFieldElement,
  createSecretShares,
  createCiphertext,
  hashCiphertext,
  isOnBabyJubJubCurve,
  isInField,
  generateEphemeralKeyPair,
} from "../../../src/confidential/crypto";
import { BN254_PRIME, BABY_JUBJUB_A, BABY_JUBJUB_D } from "../../../src/confidential/constants";

describe("Confidential Crypto Utilities", () => {
  describe("randomFieldElement", () => {
    it("should return a value in [0, BN254_PRIME)", () => {
      const val = randomFieldElement();
      expect(val).toBeGreaterThanOrEqual(0n);
      expect(val).toBeLessThan(BN254_PRIME);
    });

    it("should return different values on successive calls", () => {
      const a = randomFieldElement();
      const b = randomFieldElement();
      expect(a).not.toBe(b);
    });
  });

  describe("isInField", () => {
    it("should accept 0", () => {
      expect(isInField(0n)).toBe(true);
    });

    it("should accept PRIME - 1", () => {
      expect(isInField(BN254_PRIME - 1n)).toBe(true);
    });

    it("should reject PRIME", () => {
      expect(isInField(BN254_PRIME)).toBe(false);
    });

    it("should reject negative values", () => {
      expect(isInField(-1n)).toBe(false);
    });
  });

  describe("isOnBabyJubJubCurve", () => {
    it("should accept the identity point (0, 1)", () => {
      expect(isOnBabyJubJubCurve(0n, 1n)).toBe(true);
    });

    it("should accept the base point", () => {
      const Bx = BigInt("5299619240641551281634865583518297030282874472190772894086521144482721001553");
      const By = BigInt("16950150798460657717958625567821834550301663161624707787222815936182638968203");
      expect(isOnBabyJubJubCurve(Bx, By)).toBe(true);
    });

    it("should reject an arbitrary off-curve point", () => {
      expect(isOnBabyJubJubCurve(1n, 2n)).toBe(false);
    });

    it("should reject values >= PRIME", () => {
      expect(isOnBabyJubJubCurve(BN254_PRIME, 1n)).toBe(false);
    });
  });

  describe("createSecretShares", () => {
    it("should produce 3 shares that sum to the original value mod PRIME", () => {
      const value = 50000n; // 0.05 USDC
      const [s1, s2, s3] = createSecretShares(value);

      const sum = ((s1 + s2 + s3) % BN254_PRIME + BN254_PRIME) % BN254_PRIME;
      expect(sum).toBe(value);
    });

    it("should produce shares in the BN254 field", () => {
      const [s1, s2, s3] = createSecretShares(1000000n);
      expect(s1).toBeGreaterThanOrEqual(0n);
      expect(s1).toBeLessThan(BN254_PRIME);
      expect(s2).toBeGreaterThanOrEqual(0n);
      expect(s2).toBeLessThan(BN254_PRIME);
      expect(s3).toBeGreaterThanOrEqual(0n);
      expect(s3).toBeLessThan(BN254_PRIME);
    });

    it("should produce different shares on each call", () => {
      const [a1, a2, a3] = createSecretShares(100n);
      const [b1, b2, b3] = createSecretShares(100n);
      // Extremely unlikely to get the same random shares
      expect(a1 === b1 && a2 === b2).toBe(false);
    });
  });

  describe("generateEphemeralKeyPair", () => {
    it("should return a point on the BabyJubJub curve", () => {
      const { x, y } = generateEphemeralKeyPair();
      expect(isOnBabyJubJubCurve(x, y)).toBe(true);
    });
  });

  describe("createCiphertext", () => {
    it("should return a ciphertext with 3 amount shares, 3 r shares, and a senderPk", () => {
      const ct = createCiphertext(50000n, 12345n);

      expect(ct.amount).toHaveLength(3);
      expect(ct.r).toHaveLength(3);
      expect(ct.senderPk).toBeDefined();
      expect(ct.senderPk.x).toBeDefined();
      expect(ct.senderPk.y).toBeDefined();
    });

    it("should produce amount shares that sum to the original amount", () => {
      const amount = 50000n;
      const ct = createCiphertext(amount, 99999n);

      const sum = ct.amount.reduce(
        (acc, s) => ((acc + BigInt(s)) % BN254_PRIME + BN254_PRIME) % BN254_PRIME,
        0n,
      );
      expect(sum).toBe(amount);
    });

    it("should produce r shares that sum to the original randomness", () => {
      const r = 12345n;
      const ct = createCiphertext(50000n, r);

      const sum = ct.r.reduce(
        (acc, s) => ((acc + BigInt(s)) % BN254_PRIME + BN254_PRIME) % BN254_PRIME,
        0n,
      );
      expect(sum).toBe(r);
    });
  });

  describe("hashCiphertext", () => {
    it("should return a deterministic keccak256 hash", () => {
      const ct = {
        amount: ["100", "200", "300"] as [string, string, string],
        r: ["400", "500", "600"] as [string, string, string],
        senderPk: { x: "1", y: "2" },
      };

      const h1 = hashCiphertext(ct);
      const h2 = hashCiphertext(ct);
      expect(h1).toBe(h2);
      expect(h1).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it("should produce different hashes for different ciphertexts", () => {
      const ct1 = {
        amount: ["100", "200", "300"] as [string, string, string],
        r: ["400", "500", "600"] as [string, string, string],
        senderPk: { x: "1", y: "2" },
      };
      const ct2 = {
        ...ct1,
        amount: ["101", "200", "300"] as [string, string, string],
      };

      expect(hashCiphertext(ct1)).not.toBe(hashCiphertext(ct2));
    });
  });
});
