import {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
} from "@x402/core/types";
import { getAddress } from "viem";
import { FacilitatorEvmSigner } from "../../signer";
import { ConfidentialEvmPayload, ConfidentialExtra } from "../types";
import { privateBalanceABI } from "../constants";
import { verifyConfidential, ProofVerifier } from "./verify";

/**
 * Settle a confidential payment by calling transferFrom on-chain.
 *
 * 1. Re-verifies the payment (all 12 checks)
 * 2. Calls transferFrom() on the PrivateBalance contract
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

  // Build client proof args (zero proof if not provided — contract uses MockClientVerifier)
  const clientProof = confidentialPayload.clientProof ?? {
    pA: ["0", "0"],
    pB: [["0", "0"], ["0", "0"]],
    pC: ["0", "0"],
  };

  try {
    // 2. Call transferFrom() on-chain
    const tx = await signer.writeContract({
      address: confidentialToken,
      abi: privateBalanceABI,
      functionName: "transferFrom",
      args: [
        getAddress(auth.sender),
        getAddress(auth.receiver),
        BigInt(auth.amountCommitment),
        {
          amount: [BigInt(ct.amount[0]), BigInt(ct.amount[1]), BigInt(ct.amount[2])],
          r: [BigInt(ct.r[0]), BigInt(ct.r[1]), BigInt(ct.r[2])],
          sender_pk: {
            x: BigInt(ct.senderPk.x),
            y: BigInt(ct.senderPk.y),
          },
        },
        BigInt(auth.nonce),
        BigInt(auth.deadline),
        confidentialPayload.signature,
        {
          pA: [BigInt(clientProof.pA[0]), BigInt(clientProof.pA[1])],
          // Swap pB inner coordinates: snarkjs uses [real, imag] but the EVM
          // pairing precompile (and snarkjs-generated Solidity verifiers) expect [imag, real].
          pB: [
            [BigInt(clientProof.pB[0][1]), BigInt(clientProof.pB[0][0])],
            [BigInt(clientProof.pB[1][1]), BigInt(clientProof.pB[1][0])],
          ],
          pC: [BigInt(clientProof.pC[0]), BigInt(clientProof.pC[1])],
        },
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
