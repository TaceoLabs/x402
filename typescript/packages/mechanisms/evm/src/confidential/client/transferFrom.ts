import { PaymentRequirements, PaymentPayloadResult } from "@x402/core/types";
import { getAddress } from "viem";
import { ClientEvmSigner } from "../../signer";
import { transferFromTypes } from "../constants";
import { ConfidentialEvmPayload, ConfidentialExtra, ConfidentialCiphertext, Groth16Proof, BabyJubJubPoint } from "../types";
import { randomFieldElement, createCiphertext, hashCiphertext } from "../crypto";

/**
 * Callback type for generating a ZK proof of commitment + secret sharing + encryption.
 * Returns the proof, commitment, and ciphertext (encrypted shares from circuit output).
 */
export type ProofGenerator = (
  amount: bigint,
  r: bigint,
  mpcPublicKeys: [BabyJubJubPoint, BabyJubJubPoint, BabyJubJubPoint],
) => Promise<{
  proof: Groth16Proof;
  amountCommitment: bigint;
  ciphertext: ConfidentialCiphertext;
}>;

/**
 * Creates a confidential transferFrom payload with EIP-712 signature.
 *
 * 1. Generates random blinding factor and computes Poseidon2 commitment (via on-chain call or ZK proof)
 * 2. Creates 3-of-3 secret shares of amount and randomness
 * 3. Signs EIP-712 TransferFrom authorization
 * 4. Returns the payload
 */
export async function createTransferFromPayload(
  signer: ClientEvmSigner,
  x402Version: number,
  paymentRequirements: PaymentRequirements,
  proofGenerator?: ProofGenerator,
): Promise<PaymentPayloadResult> {
  const extra = paymentRequirements.extra as unknown as ConfidentialExtra;
  if (!extra?.confidentialToken || !extra?.eip712Domain) {
    throw new Error(
      "Payment requirements missing confidential extra (confidentialToken, eip712Domain)",
    );
  }

  const amount = BigInt(paymentRequirements.amount);
  const receiver = getAddress(paymentRequirements.payTo);
  const chainId = parseInt(paymentRequirements.network.split(":")[1]);
  const confidentialToken = getAddress(extra.confidentialToken) as `0x${string}`;

  // 1. Generate random blinding factor
  const r = randomFieldElement();

  let amountCommitment: bigint;
  let ciphertext: ConfidentialCiphertext;
  let clientProof: Groth16Proof | undefined;

  if (proofGenerator) {
    // ZK proof path: circuit computes commitment + encrypted shares
    const result = await proofGenerator(amount, r, extra.mpcPublicKeys);
    amountCommitment = result.amountCommitment;
    ciphertext = result.ciphertext;
    clientProof = result.proof;
  } else {
    // Legacy path: on-chain commitment + plaintext shares
    amountCommitment = (await signer.readContract({
      address: confidentialToken,
      abi: [
        {
          type: "function",
          name: "commit",
          inputs: [
            { name: "input", type: "uint256" },
            { name: "randomness", type: "uint256" },
          ],
          outputs: [{ name: "", type: "uint256" }],
          stateMutability: "view",
        },
      ],
      functionName: "commit",
      args: [amount, r],
    })) as bigint;

    ciphertext = createCiphertext(amount, r);
  }

  // 4. Generate random nonce and compute deadline
  const nonce = randomFieldElement();
  const now = Math.floor(Date.now() / 1000);
  const deadline = BigInt(now + paymentRequirements.maxTimeoutSeconds);

  // 5. Compute ciphertext hash for signing
  const ciphertextHash = hashCiphertext(ciphertext);

  // 6. Sign EIP-712 TransferFrom authorization
  const domain = {
    name: extra.eip712Domain.name,
    version: extra.eip712Domain.version,
    chainId,
    verifyingContract: confidentialToken,
  };

  const message = {
    sender: getAddress(signer.address),
    receiver,
    amountCommitment,
    ciphertextHash,
    nonce,
    deadline,
  };

  const signature = await signer.signTypedData({
    domain,
    types: transferFromTypes,
    primaryType: "TransferFrom",
    message,
  });

  // 7. Build the payload
  const payload: ConfidentialEvmPayload = {
    signature,
    authorization: {
      sender: getAddress(signer.address),
      receiver,
      amountCommitment: amountCommitment.toString(),
      ciphertext,
      nonce: nonce.toString(),
      deadline: deadline.toString(),
    },
    clientProof,
    blindingFactor: r.toString(),
  };

  return {
    x402Version,
    payload,
  };
}
