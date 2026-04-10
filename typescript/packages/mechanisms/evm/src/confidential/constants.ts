/**
 * BN254 scalar field prime modulus.
 * All commitments, ciphertext shares, and field elements must be < this value.
 */
export const BN254_PRIME = BigInt(
  "0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001",
);

/**
 * Poseidon2 commitment to (0, 0) with domain separator 0xDEADBEEF.
 * Used as the "zero balance" sentinel in the Merces contract.
 */
export const ZERO_COMMITMENT = BigInt(
  "0x087f763a403ee4109adc79d4a7638af3cb8cb6a33f5b027bd1476ffa97361acb",
);

/**
 * Domain separator used by the Poseidon2 hasher in the contract.
 */
export const POSEIDON2_DOMAIN_SEP = BigInt("0xDEADBEEF");

/**
 * BabyJubJub curve parameters.
 */
export const BABY_JUBJUB_A = BigInt(168700);
export const BABY_JUBJUB_D = BigInt(168696);

/**
 * EIP-712 typed data types for the TransferFromAuthorization.
 * Must match the TRANSFER_FROM_TYPEHASH in Merces.sol:
 *   "TransferFromAuthorization(address sender,address receiver,uint256 amountCommitment,
 *    bytes32 ciphertextHash,uint256 beta,uint256 nonce,uint256 deadline)"
 */
export const transferFromTypes = {
  TransferFromAuthorization: [
    { name: "sender", type: "address" },
    { name: "receiver", type: "address" },
    { name: "amountCommitment", type: "uint256" },
    { name: "ciphertextHash", type: "bytes32" },
    { name: "beta", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/**
 * Minimal ABI for the Merces contract functions used by the confidential scheme.
 */
export const mercesABI = [
  {
    type: "function",
    name: "transferFrom",
    inputs: [
      { name: "sender", type: "address" },
      { name: "receiver", type: "address" },
      { name: "amountCommitment", type: "uint256" },
      { name: "beta", type: "uint256" },
      {
        name: "ciphertext",
        type: "tuple",
        components: [
          { name: "amount", type: "uint256[3]" },
          { name: "r", type: "uint256[3]" },
          {
            name: "senderPk",
            type: "tuple",
            components: [
              { name: "x", type: "uint256" },
              { name: "y", type: "uint256" },
            ],
          },
        ],
      },
      { name: "proof", type: "uint256[4]" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "isNonceUsed",
    inputs: [
      { name: "sender", type: "address" },
      { name: "nonce", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getBalanceCommitment",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getMpcPublicKeys",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "x", type: "uint256" },
          { name: "y", type: "uint256" },
        ],
      },
      {
        name: "",
        type: "tuple",
        components: [
          { name: "x", type: "uint256" },
          { name: "y", type: "uint256" },
        ],
      },
      {
        name: "",
        type: "tuple",
        components: [
          { name: "x", type: "uint256" },
          { name: "y", type: "uint256" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getQueueSize",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

/**
 * ABI encoding parameters for the Ciphertext struct, used for keccak256 hashing.
 * Must match the Solidity struct layout: Ciphertext { uint256[3] amount, uint256[3] r, BabyJubJub.Affine senderPk }
 */
export const ciphertextAbiType = {
  type: "tuple",
  components: [
    { name: "amount", type: "uint256[3]" },
    { name: "r", type: "uint256[3]" },
    {
      name: "senderPk",
      type: "tuple",
      components: [
        { name: "x", type: "uint256" },
        { name: "y", type: "uint256" },
      ],
    },
  ],
} as const;

/**
 * @deprecated Use `mercesABI` instead. Kept for backwards compatibility.
 */
export const privateBalanceABI = mercesABI;
