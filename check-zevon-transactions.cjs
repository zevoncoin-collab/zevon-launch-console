'use strict';

// Unsigned transaction structure check. Temporary addresses are discarded.
// This is not a launch package and cannot submit a transaction.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Keypair, PublicKey, TransactionMessage, VersionedTransaction,
  ComputeBudgetProgram } = require('@solana/web3.js');
const sdk = require('@meteora-ag/dynamic-bonding-curve-sdk');
const { buildPlan } = require(process.cwd() + '/check-zevon-plan.cjs');
const URI = 'ipfs://bafkreifgqh2x744e7hcp5e3qnt6kyyy5agrac3teryahrykmtck7nxng7a';

async function main() {
  const { params, reference, connection, program, BN, wallet } = buildPlan();
  const account = await connection.getAccountInfo(new PublicKey(
    '4YMVhJZgg8K6C5pBEYcjUCYmER3V1caobkRGrmQsJfis'), 'finalized');
  assert.ok(account && account.owner.equals(program.programId) && !account.executable);
  assert.equal(crypto.createHash('sha256').update(account.data).digest('hex'),
    '12c6893483a51aac0372360d13b2d37344bfe52bff71e0b75e9f76fde28a8e4d');
  const config = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const client = new sdk.DynamicBondingCurveClient(connection, 'confirmed');
  const quote = client.pool.getQuoteFromInputAmount({ config: reference,
    swapBaseForQuote: false, amountIn: new BN('1000000000'), slippageBps: 0,
    hasReferral: false, eligibleForFirstSwapWithMinFee: false, currentPoint: new BN(0) });
  const pair = await client.partner.createConfigAndPoolWithFirstBuy({
    ...params, config, feeClaimer: wallet, leftoverReceiver: wallet,
    quoteMint: reference.quoteMint, payer: wallet,
    preCreatePoolParam: { baseMint: mint, name: 'ZEVON', symbol: 'ZEVON',
      uri: URI, poolCreator: wallet },
    firstBuyParam: { buyer: wallet, receiver: wallet, buyAmount: new BN('1000000000'),
      minimumAmountOut: quote.outputAmount, referralTokenAccount: null },
  });
  const transactions = [pair.createConfigTx, pair.createPoolWithFirstBuyTx];
  // Provisional budgets exceed the observed rehearsal usage. No priority fee added.
  const budgets = [200000, 250000];
  const expectedSigners = [[wallet, config], [wallet, mint]];
  const blockhash = await connection.getLatestBlockhash('confirmed');
  const results = [];
  for (let index = 0; index < transactions.length; index++) {
    const tx = transactions[index];
    assert.ok(tx.instructions.some(ix => ix.programId.equals(program.programId)));
    assert.ok(tx.instructions.some(ix => ix.keys.some(key => key.pubkey.equals(config))),
      'Transaction does not use the new ZEVON config');
    assert.ok(!tx.instructions.some(ix => ix.keys.some(key =>
      key.pubkey.toBase58() === '4YMVhJZgg8K6C5pBEYcjUCYmER3V1caobkRGrmQsJfis')),
      'Reference AUTON config appears in intended launch transaction');
    const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: budgets[index] }),
      ...tx.instructions];
    const message = new TransactionMessage({ payerKey: wallet,
      recentBlockhash: blockhash.blockhash, instructions }).compileToV0Message();
    const signers = message.staticAccountKeys.slice(0, message.header.numRequiredSignatures);
    assert.deepEqual(signers.map(key => key.toBase58()).sort(),
      expectedSigners[index].map(key => key.toBase58()).sort(), 'Unexpected required signer');
    const unsigned = new VersionedTransaction(message);
    assert.ok(unsigned.signatures.every(sig => sig.every(byte => byte === 0)));
    const bytes = unsigned.serialize().length;
    assert.ok(bytes <= 1232, 'Transaction exceeds packet size limit');
    const fee = await connection.getFeeForMessage(message, 'confirmed');
    assert.notEqual(fee.value, null, 'Network fee unavailable; rerun the check');
    results.push({ label: index === 0 ? 'Create ZEVON config' : 'Create ZEVON pool + 1 SOL buy',
      bytes, computeBudget: budgets[index], feeLamports: fee.value });
  }
  console.log('PASS: both unsigned transactions use a new ZEVON config, not AUTON config');
  console.log('PASS: only expected wallet and temporary config/mint signatures required');
  for (const result of results) console.log(result.label + ': ' + result.bytes +
    ' bytes | compute budget ' + result.computeBudget + ' | estimated fee ' + result.feeLamports / 1e9 + ' SOL');
  console.log('Creator / feeClaimer / leftoverReceiver:', wallet.toBase58());
  console.log('Buy: 1 SOL | Minimum output: 31,438,793.605717 ZEVON (exact initial quote)');
  assert.equal(quote.outputAmount.toString(), '31438793605717');
  console.log('Pool creation and initial buy remain together in transaction 2. Config creation is transaction 1.');
  console.log('Structure check only: new-config pool transaction not simulated against mainnet state yet.');
  console.log('Nothing signed, saved, or submitted. Temporary addresses discarded; final addresses will be reviewed separately.');
}

main().catch(error => {
  console.error('ZEVON transaction check stopped:', error.message);
  process.exitCode = 1;
});
