pragma circom 2.2.2;

include "poseidon2/poseidon2.circom";
include "circomlib/bitify.circom";

// Poseidon2(2)-based commitment matching the PrivateBalance contract's commit()
// commit(value, r) = Poseidon2([value + 0xDEADBEEF, r])[0] + value
template Commit1() {
    signal input value;
    signal input r;
    signal output c;

    var DS = 0xDEADBEEF;
    var state[2] = Poseidon2(2)([value + DS, r]);
    c <== state[0] + value;
}

// Commitment + range check (amount fits in BITSIZE bits)
template CheckAmount(BITSIZE) {
    signal input amount;
    signal input amount_r;
    signal output amount_c;

    var bits[BITSIZE] = Num2Bits(BITSIZE)(amount);
    amount_c <== Commit1()(amount, amount_r);
}

// Compute 3rd additive share: secret - r[0] - r[1]
template additive_3rd_share() {
    signal input secret;
    signal input r[2];
    signal output share;

    share <== secret - r[0] - r[1];
}

// Stripped-down transfer_client: proves commitment correctness + secret sharing
// No BabyJubJub encryption — client sends plaintext (amount, r) to server
template transfer_client_x402(AMOUNT_BITSIZE) {
    // Private inputs
    signal input amount;
    signal input amount_r;
    signal input share_amount[2];
    signal input share_amount_r[2];

    // Outputs (become public signals)
    signal output amount_c;
    signal output shares_amount[3];
    signal output shares_r[3];

    // 1. Commitment + range check
    amount_c <== CheckAmount(AMOUNT_BITSIZE)(amount, amount_r);

    // 2. Additive secret sharing — constrain shares sum to secret
    shares_amount[0] <== share_amount[0];
    shares_amount[1] <== share_amount[1];
    shares_amount[2] <== additive_3rd_share()(amount, [share_amount[0], share_amount[1]]);

    shares_r[0] <== share_amount_r[0];
    shares_r[1] <== share_amount_r[1];
    shares_r[2] <== additive_3rd_share()(amount_r, [share_amount_r[0], share_amount_r[1]]);
}

component main = transfer_client_x402(80);
