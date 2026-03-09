import { x402Facilitator } from "@x402/core/facilitator";
import { Network } from "@x402/core/types";
import { FacilitatorEvmSigner } from "../../signer";
import { BabyJubJubPoint } from "../types";
import { ConfidentialEvmScheme } from "./scheme";

/**
 * Configuration for registering the confidential EVM scheme on a facilitator.
 */
export interface ConfidentialEvmFacilitatorConfig {
  /** The facilitator signer for on-chain operations */
  signer: FacilitatorEvmSigner;
  /** The confidential token contract address */
  confidentialToken: string;
  /** EIP-712 domain parameters */
  eip712Domain: { name: string; version: string };
  /** The 3 MPC party BabyJubJub public keys */
  mpcPublicKeys: [BabyJubJubPoint, BabyJubJubPoint, BabyJubJubPoint];
  /** Networks to register */
  networks: Network | Network[];
}

/**
 * Registers the confidential EVM scheme to an x402Facilitator instance.
 */
export function registerConfidentialEvmScheme(
  facilitator: x402Facilitator,
  config: ConfidentialEvmFacilitatorConfig,
): x402Facilitator {
  facilitator.register(
    config.networks,
    new ConfidentialEvmScheme({
      signer: config.signer,
      confidentialToken: config.confidentialToken,
      eip712Domain: config.eip712Domain,
      mpcPublicKeys: config.mpcPublicKeys,
    }),
  );

  return facilitator;
}
