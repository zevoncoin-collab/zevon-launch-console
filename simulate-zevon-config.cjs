'use strict';

// Simulation only. No transaction signatures, submission, or saved secret keys.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Keypair, PublicKey, TransactionMessage, VersionedTransaction } = require('@solana/web3.js');
const sdk = require('@meteora-ag/dynamic-bonding-curve-sdk');
const { buildPlan } = require(process.cwd() + '/check-zevon-plan.cjs');

async function main() {
  const { params, reference, connection, program, wallet } = buildPlan();
  const originalAddress = new PublicKey('4YMVhJZgg8K6C5pBEYcjUCYmER3V1caobkRGrmQsJfis');
  const snapshot = await connection.getAccountInfo(originalAddress, 'finalized');
  assert.ok(snapshot && !snapshot.executable, 'Reference config account unavailable');
  assert.ok(snapshot.owner.equals(program.programId), 'Reference config owner changed');
  assert.equal(crypto.createHash('sha256').update(snapshot.data).digest('hex'),
    '12c6893483a51aac0372360d13b2d37344bfe52bff71e0b75e9f76fde28a8e4d',
    'Live reference config changed; stop and inspect');

  // An unused temporary address for this simulation. The key is never signed or saved.
  const configAddress = Keypair.generate().publicKey;
  const client = new sdk.DynamicBondingCurveClient(connection, 'confirmed');
  const tx = await client.partner.createConfig({
    ...params, config: configAddress, feeClaimer: wallet, leftoverReceiver: wallet,
    quoteMint: reference.quoteMint, payer: wallet,
  });
  assert.equal(tx.instructions.length, 1, 'Unexpected config transaction instructions');
  assert.ok(tx.instructions[0].programId.equals(program.programId), 'Unexpected program');
  const blockhash = await connection.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({
    payerKey: wallet, recentBlockhash: blockhash.blockhash, instructions: tx.instructions,
  }).compileToV0Message();
  const unsigned = new VersionedTransaction(message);
  assert.ok(unsigned.signatures.every(sig => sig.every(byte => byte === 0)));
  console.log('Simulating unsigned config creation on mainnet...');
  const simulation = await connection.simulateTransaction(unsigned, {
    sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
    accounts: { encoding: 'base64', addresses: [configAddress.toBase58()] },
  });
  if (simulation.value.err) {
    console.error('Simulation logs:', (simulation.value.logs || []).join('\n'));
    throw new Error('Simulation failed: ' + JSON.stringify(simulation.value.err));
  }
  const account = simulation.value.accounts?.[0];
  assert.ok(account, 'RPC did not return simulated config account');
  assert.equal(account.owner, program.programId.toBase58());
  assert.equal(account.data[1], 'base64');
  const createdBytes = Buffer.from(account.data[0], 'base64');
  const created = program.coder.accounts.decode('poolConfig', createdBytes);
  // Compare all decoded fields, including derived thresholds, supply, and curve.
  assert.deepEqual(created, { ...reference, feeClaimer: wallet, leftoverReceiver: wallet },
    'Simulated config differs from AUTON beyond the two intended wallet replacements');
  console.log('PASS: mainnet config simulation succeeded');
  console.log('PASS: all 43 config fields match AUTON, with your feeClaimer and leftoverReceiver');
  console.log('Simulation slot:', simulation.context.slot);
  console.log('Compute units:', simulation.value.unitsConsumed);
  console.log('Config account rent:', account.lamports / 1e9, 'SOL');
  console.log('Config account size:', createdBytes.length, 'bytes');
  const fee = await connection.getFeeForMessage(message, 'confirmed');
  console.log('Estimated config network fee:', fee.value === null ? 'Unavailable' : fee.value / 1e9 + ' SOL');
  console.log('This checks config creation only. Pool creation and initial buy still need simulation.');
  console.log('No transaction signed or submitted. Temporary config address discarded.');
}

main().catch(error => {
  console.error('ZEVON config simulation stopped:', error.message);
  process.exitCode = 1;
});
