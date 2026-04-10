import {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
} from "@x402/core/types";
import { getAddress } from "viem";
import { FacilitatorEvmSigner } from "../../signer";
import { ConfidentialEvmPayload, ConfidentialExtra } from "../types";
import { mercesABI } from "../constants";
import { verifyConfidential, ProofVerifier } from "./verify";

/**
 * Settle a confidential payment by calling transferFrom on-chain.
 *
 * 1. Re-verifies the payment (all checks)
 * 2. Calls transferFrom() on the Merces contract with the compressed proof
 * 3. Waits for transaction receipt
 * 4. Returns settlement response
 */
export async function settleConfidential(
  signer: FacilitatorEvmSigner,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  confidentialPayload: ConfidentialEvmPayload,
  extra: ConfidentialExtra,
  proofVerifier?: ProofVerifier,
): Promise<SettleResponse> {
  const payer = confidentialPayload.authorization.sender;

  // 1. Re-verify before settling
  const verifyResult = await verifyConfidential(
    signer,
    payload,
    requirements,
    confidentialPayload,
    extra,
    proofVerifier,
  );

  if (!verifyResult.isValid) {
    return {
      success: false,
      network: payload.accepted.network,
      transaction: "",
      errorReason: verifyResult.invalidReason ?? "verification_failed",
      payer,
    };
  }

  const confidentialToken = getAddress(extra.confidentialToken) as `0x${string}`;
  const auth = confidentialPayload.authorization;
  const ct = auth.ciphertext;

  // Build compressed proof args (zero proof if not provided)
  const compressedProof = confidentialPayload.clientProof?.compressedProof ?? ["0", "0", "0", "0"];

  try {
    // 2. Call transferFrom() on-chain
    //    Merces.transferFrom(sender, receiver, amountCommitment, beta, ciphertext, proof[4], nonce, deadline, signature)
    const tx = await signer.writeContract({
      address: confidentialToken,
      abi: mercesABI,
      functionName: "transferFrom",
      args: [
        getAddress(auth.sender),
        getAddress(auth.receiver),
        BigInt(auth.amountCommitment),
        BigInt(auth.beta),
        {
          amount: [BigInt(ct.amount[0]), BigInt(ct.amount[1]), BigInt(ct.amount[2])],
          r: [BigInt(ct.r[0]), BigInt(ct.r[1]), BigInt(ct.r[2])],
          senderPk: {
            x: BigInt(ct.senderPk.x),
            y: BigInt(ct.senderPk.y),
          },
        },
        [
          BigInt(compressedProof[0]),
          BigInt(compressedProof[1]),
          BigInt(compressedProof[2]),
          BigInt(compressedProof[3]),
        ] as readonly [bigint, bigint, bigint, bigint],
        BigInt(auth.nonce),
        BigInt(auth.deadline),
        confidentialPayload.signature,
      ],
    });

    // 3. Wait for transaction confirmation
    const receipt = await signer.waitForTransactionReceipt({ hash: tx });

    if (receipt.status !== "success") {
      return {
        success: false,
        errorReason: "transaction_reverted",
        transaction: tx,
        network: payload.accepted.network,
        payer,
      };
    }

    return {
      success: true,
      transaction: tx,
      network: payload.accepted.network,
      payer,
    };
  } catch {
    return {
      success: false,
      errorReason: "transaction_failed",
      transaction: "",
      network: payload.accepted.network,
      payer,
    };
  }
}
