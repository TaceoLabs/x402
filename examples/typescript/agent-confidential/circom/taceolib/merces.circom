pragma circom 2.2.2;

include "circomlib/bitify.circom";
include "precomputations.circom";
include "compression.circom";
include "commit.circom";
include "encryption.circom";

template range_check_with_output_flag(BITSIZE) {
    assert(BITSIZE <= 254);
    assert(BITSIZE > 0);
    signal input in;
    signal output valid;
    signal output in_bits[BITSIZE];

    // Num2Bits_strict with taceo_precomputation
    component aliasCheck = AliasCheck();
    component n2b = TACEO_PRECOMPUTATION_Num2Bits(254);
    in ==> n2b.in;

    for (var i=0; i<254; i++) {
        n2b.out[i] ==> aliasCheck.in[i];
    }
    for (var i=0; i<BITSIZE; i++) {
        in_bits[i] <== n2b.out[i];
    }

    // Sum up all bits above BITSIZE
    // Works since bits are enforced to be 0 or 1 already.
    // Thus this sum cannot overflow and if at least one bit is 1, sum > 0
    var sum = 0;
    for (var i=BITSIZE; i<254; i++) {
        sum += n2b.out[i];
    }

    component isZero = IsZero();
    isZero.in <== sum;
    valid <== isZero.out;
}

// Checks the size of amount and computes a commitment
template check_amount(AMOUNT_BITSIZE) {
    signal input amount;
    signal input amount_r;
    signal output out;
    signal output out_bits[AMOUNT_BITSIZE];

    out_bits <== TACEO_PRECOMPUTATION_Num2Bits(AMOUNT_BITSIZE)(amount);
    out <== commit1()(amount, amount_r);
}


template deposit_inner() {
    signal input old_balance;
    signal input old_r;
    signal input amount;
    signal input new_r;
    signal output old_c;
    signal output new_c;

    signal new_balance <== old_balance + amount;
    var old_commitment = commit1()(old_balance, old_r);
    var new_commitment = commit1()(new_balance, new_r);
    old_c <== old_commitment;
    new_c <== new_commitment;
}

// Valid output:
// There is no sender, so we just return true
template deposit() {
    signal input old_balance;
    signal input old_r;
    signal input amount; // Public
    signal input new_r;
    signal output old_c;
    signal output new_c;
    signal output valid;

    component deposit = deposit_inner();
    deposit.old_balance <== old_balance;
    deposit.old_r <== old_r;
    deposit.amount <== amount;
    deposit.new_r <== new_r;
    old_c <== deposit.old_c;
    new_c <== deposit.new_c;

    valid <== 1;
}

// Valid output:
// We check whether the sender had enough balance.
template withdraw(BALANCE_BITSIZE) {
    signal input old_balance;
    signal input old_r;
    signal input amount; // Public
    signal input new_r;
    signal output old_c;
    signal output new_c;
    signal output valid;

    signal new_balance <== old_balance - amount;
    component new_balance_range_check = range_check_with_output_flag(125);
    new_balance_range_check.in <== new_balance;
    valid <== new_balance_range_check.valid;
    var old_commitment = commit1()(old_balance, old_r);
    var new_commitment = commit1()(new_balance, new_r);
    old_c <== old_commitment;
    new_c <== new_commitment;
}

// Valid output:
// We check whether the sender had enough balance.
// We don't include amount range checks in valid since the registration of the transfer already includes this check. So at this point the amount is already proven to be in range.
template transfer(BALANCE_BITSIZE) {
    signal input sender_old_balance;
    signal input sender_old_r;
    signal input receiver_old_balance;
    signal input receiver_old_r;
    signal input amount;
    signal input amount_r;
    signal input sender_new_r;
    signal input receiver_new_r;
    signal output sender_old_c;
    signal output sender_new_c;
    signal output receiver_old_c;
    signal output receiver_new_c;
    signal output amount_c;
    signal output valid;

    // No range check, since the registration of the transfer already includes this check. So at this point the amount is already proven to be in range.
    amount_c <== commit1()(amount, amount_r);

    component withdraw = withdraw(BALANCE_BITSIZE);
    withdraw.old_balance <== sender_old_balance;
    withdraw.old_r <== sender_old_r;
    withdraw.amount <== amount;
    withdraw.new_r <== sender_new_r;
    sender_old_c <== withdraw.old_c;
    sender_new_c <== withdraw.new_c;

    component deposit = deposit_inner();
    deposit.old_balance <== receiver_old_balance;
    deposit.old_r <== receiver_old_r;
    deposit.amount <== amount;
    deposit.new_r <== receiver_new_r;
    receiver_old_c <== deposit.old_c;
    receiver_new_c <== deposit.new_c;
    valid <== withdraw.valid;
}

template transfer_batched(N, BALANCE_BITSIZE) {
    signal input sender_old_balance[N];
    signal input sender_old_r[N];
    signal input receiver_old_balance[N];
    signal input receiver_old_r[N];
    signal input amount[N];
    signal input amount_r[N];
    signal input sender_new_r[N];
    signal input receiver_new_r[N];
    signal output sender_old_commitment[N];
    signal output sender_new_commitment[N];
    signal output receiver_old_commitment[N];
    signal output receiver_new_commitment[N];
    signal output amount_commitment[N];
    signal output valid[N];

    component transactions[N];
    for (var i=0; i<N; i++) {
        transactions[i] = transfer(BALANCE_BITSIZE);
        transactions[i].sender_old_balance <== sender_old_balance[i];
        transactions[i].sender_old_r <== sender_old_r[i];
        transactions[i].receiver_old_balance <== receiver_old_balance[i];
        transactions[i].receiver_old_r <== receiver_old_r[i];
        transactions[i].amount <== amount[i];
        transactions[i].amount_r <== amount_r[i];
        transactions[i].sender_new_r <== sender_new_r[i];
        transactions[i].receiver_new_r <== receiver_new_r[i];

        sender_old_commitment[i] <== transactions[i].sender_old_c;
        sender_new_commitment[i] <== transactions[i].sender_new_c;
        receiver_old_commitment[i] <== transactions[i].receiver_old_c;
        receiver_new_commitment[i] <== transactions[i].receiver_new_c;
        amount_commitment[i] <== transactions[i].amount_c;
        valid[i] <== transactions[i].valid;
    }
}

template transfer_batched_compressed(N, BALANCE_BITSIZE, T) {
    signal input sender_old_balance[N];
    signal input sender_old_r[N];
    signal input receiver_old_balance[N];
    signal input receiver_old_r[N];
    signal input amount[N];
    signal input amount_r[N];
    signal input sender_new_r[N];
    signal input receiver_new_r[N];
    signal input alpha; // Public input for compression
    signal output beta;
    signal output gamma;

    // Calling the old component
    component transaction_batched = transfer_batched(N, BALANCE_BITSIZE);
    transaction_batched.sender_old_balance <== sender_old_balance;
    transaction_batched.sender_old_r <== sender_old_r;
    transaction_batched.receiver_old_balance <== receiver_old_balance;
    transaction_batched.receiver_old_r <== receiver_old_r;
    transaction_batched.amount <== amount;
    transaction_batched.amount_r <== amount_r;
    transaction_batched.sender_new_r <== sender_new_r;
    transaction_batched.receiver_new_r <== receiver_new_r;

    // Compressing the outputs
    var q[6 * N];
    for (var i = 0; i < N; i++) {
        q[6 * i] = transaction_batched.sender_old_commitment[i];
        q[6 * i + 1] = transaction_batched.sender_new_commitment[i];
        q[6 * i + 2] = transaction_batched.receiver_old_commitment[i];
        q[6 * i + 3] = transaction_batched.receiver_new_commitment[i];
        q[6 * i + 4] = transaction_batched.amount_commitment[i];
        q[6 * i + 5] = transaction_batched.valid[i];
    }

    component compression = Compression(6 * N, T);
    compression.q <== q;
    compression.alpha <== alpha;
    beta <== compression.beta;
    gamma <== compression.gamma;
}

template additive_3rd_share() {
    signal input secret;
    signal input r[2];
    signal output share;

    share <== secret - r[0] - r[1];
}

template transfer_client(AMOUNT_BITSIZE) {
    // Transaction amount and randomness used for commitment
    signal input amount;
    signal input amount_r;
    // Encryptions
    signal input encrypt_sk;
    signal input mpc_pks[3][2]; // Public
    // Secret shares
    signal input share_amount[2];
    signal input share_amount_r[2];
    // Outputs
    signal output encrypt_pk[2];
    signal output amount_c;
    signal output ciphertexts[3][2];

    // 1. Commitment to the amount using the provided randomness including range check
    component amount_comm = check_amount(AMOUNT_BITSIZE);
    amount_comm.amount <== amount;
    amount_comm.amount_r <== amount_r;
    amount_c <== amount_comm.out;

     // 2. Additive secret sharing of amount and amount_r using
    signal share_amount_[3];
    signal share_amount_r_[3];
    for (var i = 0; i < 2; i++) {
        share_amount_[i] <== share_amount[i];
        share_amount_r_[i] <== share_amount_r[i];
    }
    share_amount_[2] <== additive_3rd_share()(amount, [share_amount_[0], share_amount_[1]]);
    share_amount_r_[2] <== additive_3rd_share()(amount_r, [share_amount_r_[0], share_amount_r_[1]]);

    // 3. Encryptions of secret shares
    // Ensure sk is in field Fr
    component sk_range_check = BabyJubJubIsInFr();
    sk_range_check.in <== encrypt_sk;
    // Encrypt secret shares
    for (var i = 0; i < 3; i++) {
        var symkey = derive_sym_key_bits()(sk_range_check.out_bits, mpc_pks[i]);
        ciphertexts[i] <== encrypt2()(symkey, 0, [share_amount_[i], share_amount_r_[i]]);
    }

    // 4. proof the correct public key was used for encryption
    component pk_calc = BabyJubJubScalarGeneratorBits();
    pk_calc.e <== sk_range_check.out_bits;
    encrypt_pk[0] <== pk_calc.out.x;
    encrypt_pk[1] <== pk_calc.out.y;
}
