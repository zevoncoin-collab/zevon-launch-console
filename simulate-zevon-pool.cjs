'use strict';

// Read-only rehearsal using the live AUTON config. Never sign or submit this transaction.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const web3 = require('@solana/web3.js');
const spl = require('@solana/spl-token');
const sdk = require('@meteora-ag/dynamic-bonding-curve-sdk');
const { buildPlan } = require(process.cwd() + '/check-zevon-plan.cjs');
const URI = 'ipfs://bafkreifgqh2x744e7hcp5e3qnt6kyyy5agrac3teryahrykmtck7nxng7a';
const decimal = (amount, places) => {
  const digits = amount.toString().padStart(places + 1, '0');
  return digits.slice(0, -places) + '.' + digits.slice(-places);
};

function asInfo(account) {
  assert.ok(account, 'Missing simulated account');
  assert.equal(account.data[1], 'base64');
  return { ...account, owner: new web3.PublicKey(account.owner),
    data: Buffer.from(account.data[0], 'base64') };
}

async function main() {
  const { reference, connection, program, BN, wallet } = buildPlan();
  const config = new web3.PublicKey('4YMVhJZgg8K6C5pBEYcjUCYmER3V1caobkRGrmQsJfis');
  const live = await connection.getAccountInfo(config, 'finalized');
  assert.ok(live && !live.executable && live.owner.equals(program.programId));
  assert.equal(crypto.createHash('sha256').update(live.data).digest('hex'),
    '12c6893483a51aac0372360d13b2d37344bfe52bff71e0b75e9f76fde28a8e4d');
  const baseMint = web3.Keypair.generate().publicKey;
  const client = new sdk.DynamicBondingCurveClient(connection, 'confirmed');
  const quote = client.pool.getQuoteFromInputAmount({
    config: reference, swapBaseForQuote: false, amountIn: new BN('1000000000'),
    slippageBps: 0, hasReferral: false, currentPoint: new BN(0),
    eligibleForFirstSwapWithMinFee: false,
  });
  const tx = await client.creator.createPoolWithFirstBuy({
    createPoolParam: { config, baseMint, name: 'ZEVON', symbol: 'ZEVON',
      uri: URI, poolCreator: wallet, payer: wallet },
    firstBuyParam: { buyer: wallet, receiver: wallet,
      buyAmount: new BN('1000000000'), minimumAmountOut: quote.outputAmount,
      referralTokenAccount: null },
  });
  // Extra compute is a rehearsal ceiling, not a chosen live transaction setting.
  tx.instructions.unshift(web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }));
  const pool = sdk.deriveDbcPoolAddress(reference.quoteMint, baseMint, config);
  const baseVault = sdk.deriveDbcTokenVaultAddress(pool, baseMint);
  const quoteVault = sdk.deriveDbcTokenVaultAddress(pool, reference.quoteMint);
  const ata = spl.getAssociatedTokenAddressSync(baseMint, wallet);
  const metadata = sdk.deriveMintMetadata(baseMint);
  const addresses = [wallet, baseMint, pool, ata, metadata, baseVault, quoteVault];
  const before = await connection.getBalance(wallet, 'confirmed');
  const blockhash = await connection.getLatestBlockhash('confirmed');
  const message = new web3.TransactionMessage({ payerKey: wallet,
    recentBlockhash: blockhash.blockhash, instructions: tx.instructions }).compileToV0Message();
  const unsigned = new web3.VersionedTransaction(message);
  assert.ok(unsigned.signatures.every(sig => sig.every(byte => byte === 0)));
  const bytes = unsigned.serialize().length;
  assert.ok(bytes <= 1232, 'Transaction exceeds packet limit: ' + bytes + ' bytes');
  console.log('REHEARSAL ONLY: uses AUTON config; recipient addresses in that config are not your ZEVON recipients.');
  console.log('Simulating pool creation + 1 SOL first buy in one unsigned transaction...');
  const simulation = await connection.simulateTransaction(unsigned, {
    sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
    accounts: { encoding: 'base64', addresses: addresses.map(address => address.toBase58()) },
  });
  if (simulation.value.err) {
    console.error('Simulation logs:', (simulation.value.logs || []).join('\n'));
    throw new Error('Simulation failed: ' + JSON.stringify(simulation.value.err));
  }
  const accounts = simulation.value.accounts;
  assert.equal(accounts?.length, addresses.length);
  const mint = spl.unpackMint(baseMint, asInfo(accounts[1]), spl.TOKEN_PROGRAM_ID);
  assert.equal(mint.decimals, 6);
  assert.equal(mint.supply.toString(), '1000000000000000');
  const tokenAccount = spl.unpackAccount(ata, asInfo(accounts[3]), spl.TOKEN_PROGRAM_ID);
  assert.ok(tokenAccount.owner.equals(wallet) && tokenAccount.mint.equals(baseMint));
  assert.equal(tokenAccount.amount.toString(), quote.outputAmount.toString(), 'First buy differs from quote');
  const poolInfo = asInfo(accounts[2]);
  assert.ok(poolInfo.owner.equals(program.programId));
  const state = program.coder.accounts.decode('virtualPool', poolInfo.data).poolState;
  assert.ok(state.creator.equals(wallet) && state.baseMint.equals(baseMint) && state.config.equals(config));
  assert.equal(state.isMigrated, 0);
  // Verify the simulated Metaplex metadata strings and immutability.
  const data = asInfo(accounts[4]).data;
  let offset = 65; // Metadata key, update authority, mint.
  const readString = () => {
    const size = data.readUInt32LE(offset); offset += 4;
    const value = data.subarray(offset, offset + size).toString('utf8').replace(/\0+$/, '');
    offset += size; return value;
  };
  assert.equal(data[0], 4);
  assert.equal(new web3.PublicKey(data.subarray(33, 65)).toBase58(), baseMint.toBase58());
  assert.equal(readString(), 'ZEVON');
  assert.equal(readString(), 'ZEVON');
  assert.equal(readString(), URI);
  offset += 2; // Seller fee basis points.
  const hasCreators = data[offset++];
  assert.ok(hasCreators === 0 || hasCreators === 1);
  if (hasCreators) { const count = data.readUInt32LE(offset); offset += 4 + count * 34; }
  offset += 1; // Primary sale happened.
  assert.equal(data[offset], 0, 'Metadata is mutable');
  console.log('PASS: pool creation and 1 SOL first buy simulation succeeded');
  console.log('PASS: creator, 1 billion supply, 6 decimals, metadata URI, and immutable metadata verified');
  console.log('Simulated ZEVON received:', decimal(tokenAccount.amount, 6));
  console.log('Mint authority after creation:', mint.mintAuthority?.toBase58() || 'None');
  console.log('Freeze authority after creation:', mint.freezeAuthority?.toBase58() || 'None');
  console.log('Simulation slot:', simulation.context.slot);
  console.log('Compute units:', simulation.value.unitsConsumed);
  console.log('Transaction bytes:', bytes);
  console.log('Pool/mint/metadata/vault/ATA account rent:',
    accounts.slice(1).reduce((sum, account) => sum + account.lamports, 0) / 1e9, 'SOL');
  console.log('Simulated wallet decrease:', (before - accounts[0].lamports) / 1e9, 'SOL (balance reads may differ by slot)');
  const fee = await connection.getFeeForMessage(message, 'confirmed');
  console.log('Estimated pool/buy network fee:', fee.value === null ? 'Unavailable' : fee.value / 1e9 + ' SOL');
  console.log('No transaction signed or submitted. Temporary mint address discarded.');
  console.log('Final launch must use your new ZEVON config, not the reference config used here.');
}

main().catch(error => {
  console.error('ZEVON pool simulation stopped:', error.message);
  process.exitCode = 1;
});
