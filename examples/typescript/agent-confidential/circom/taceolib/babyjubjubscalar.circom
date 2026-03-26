pragma circom 2.2.2;

include "circomlib/comparators.circom";
include "circomlib/compconstant.circom";
include "circomlib/mux1.circom";
include "circomlib/bitify.circom";

// calculates (a + b) % p, where a, b < p and p = BabyJubJub ScalarField
// Does not check whether inputs are in range
template AddModP() {
    signal input a;
    signal input b;
    signal output out;
    signal output out_bits[251];

    var fr = 2736030358979909402780800718157159386076813972158567259200215660948447373041;

    signal sum <== a + b; // No overflow
    out <-- sum % fr;
    signal x <-- sum \ fr;
    sum === x * fr + out;

    // We constrain out to be < p
    out_bits <== Num2Bits(251)(out);
    // CompConstant enforces <=, so compare against (fr - 1).
    component cmp_const = CompConstant(fr-1);
    for(var i=0; i<251; i++) {
        cmp_const.in[i] <== out_bits[i];
    }
    cmp_const.in[251] <== 0;
    cmp_const.in[252] <== 0;
    cmp_const.in[253] <== 0;
    cmp_const.out === 0;

    // x must either be 0 or 1
    x * (x - 1) === 0;
}

// calculates (a + b + c) % p, where a, b, c < p and p = BabyJubJub ScalarField
// Does not check whether inputs are in range
template Add3ModP() {
    signal input a;
    signal input b;
    signal input c;
    signal output out;

    var fr = 2736030358979909402780800718157159386076813972158567259200215660948447373041;

    signal sum <== a + b + c; // No overflow
    out <-- sum % fr;
    signal x <-- sum \ fr;
    sum === x * fr + out;

    // We constrain out to be < p
    signal bits[251] <== Num2Bits(251)(out);
    // CompConstant enforces <=, so compare against (fr - 1).
    component cmp_const = CompConstant(fr-1);
    for(var i=0; i<251; i++) {
        cmp_const.in[i] <== bits[i];
    }
    cmp_const.in[251] <== 0;
    cmp_const.in[252] <== 0;
    cmp_const.in[253] <== 0;
    cmp_const.out === 0;

    // x must either be 0 or 1 or 2
    signal zero_or_one <== x * (x - 1);
    zero_or_one * (x - 2) === 0;
}

// Implement a * B mod P (= BabyJubJub ScalarField) via a double-add-ladder.
// Does not check whether inputs are in range
template MulModP(B_NUM_BITS) {
    assert(B_NUM_BITS > 0);

    signal input a;
    signal input b;
    signal output out;

    var b_bits[B_NUM_BITS] = Num2Bits(B_NUM_BITS)(b);

    signal result[B_NUM_BITS];
    result[0] <== Mux1()([0, a], b_bits[B_NUM_BITS - 1]);

    component dbl[B_NUM_BITS-1];
    component dbladd[B_NUM_BITS-1];
    for(var i = 0; i < B_NUM_BITS - 1; i++) {
        // double and add
        dbladd[i] = Add3ModP();
        dbladd[i].a <== result[i];
        dbladd[i].b <== result[i];
        dbladd[i].c <== a;

        // only double
        dbl[i] = AddModP();
        dbl[i].a <== result[i];
        dbl[i].b <== result[i];

        result[i + 1] <== Mux1()([dbl[i].out, dbladd[i].out], b_bits[B_NUM_BITS - 2 - i]);
    }
    out <== result[B_NUM_BITS - 1];
}

// calculates (p-a) % p, where a < p and p = BabyJubJub ScalarField
template NegModP(){
    signal input a;
    signal output out;

    var fr = 2736030358979909402780800718157159386076813972158567259200215660948447373041;

    signal sub <== fr - a;
    // If sub == fr (i.e., a == 0), we need to set it to zero
    signal is_zero <== IsZero()(a);
    out <== sub * (1 - is_zero);
}
