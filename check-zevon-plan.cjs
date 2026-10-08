'use strict';

// Read-only: decode, validate, and quote. No wallet connection or transactions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { Connection, PublicKey } = require('@solana/web3.js');
const sdk = require('@meteora-ag/dynamic-bonding-curve-sdk');

const WALLET = '47jKwD5fkDcspPFoiRWN5SUrLjA3zw2THZV95Qu48Pto';
const REFERENCE_CREATOR = 'ANppuXB58vHobrRo3A1zohwG4Gx6TcsNfp4JxqkuQ18E';
const SNAPSHOT_HASH = '12c6893483a51aac0372360d13b2d37344bfe52bff71e0b75e9f76fde28a8e4d';
const camel = name => name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const pick = (value, names) => Object.fromEntries(names.map(name => [name, value[name]]));
const decimal = (value, places) => {
  const digits = value.toString().padStart(places + 1, '0');
  return digits.slice(0, -places) + '.' + digits.slice(-places);
};

function buildPlan() {
  const raw = fs.readFileSync('auton-config.bin');
  assert.equal(raw.length, 1048, 'Unexpected snapshot size');
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), SNAPSHOT_HASH,
    'Reference snapshot changed');
  // Creating a Connection does not make an RPC request. None are called here.
  const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
  const program = new sdk.StateService(connection, 'confirmed').getProgram();
  assert.equal(program.programId.toBase58(), 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN');
  const c = program.coder.accounts.decode('poolConfig', raw);
  const BN = c.sqrtStartPrice.constructor;
  assert.equal(c.quoteMint.toBase58(), 'So11111111111111111111111111111111111111112');
  assert.equal(c.feeClaimer.toBase58(), REFERENCE_CREATOR);
  assert.equal(c.leftoverReceiver.toBase58(), REFERENCE_CREATOR);
  assert.equal(c.tokenDecimal, 6);
  assert.equal(c.tokenType, 0);
  assert.equal(c.tokenUpdateAuthority, 1);
  assert.equal(c.fixedTokenSupplyFlag, 1);
  assert.equal(c.preMigrationTokenSupply.toString(), '1000000000000000');
  assert.equal(c.postMigrationTokenSupply.toString(), '1000000000000000');
  assert.equal(c.poolFees.dynamicFee.initialized, 0);
  assert.equal(c.migratedPoolBaseFeeMode, 0);
  assert.ok(c.migratedPoolBaseFeeBytes.every(value => value === 0));

  const vestingNames = ['vestingPercentage', 'bpsPerPeriod', 'numberOfPeriods',
    'cliffDurationFromMigrationTime', 'frequency'];
  const curve = [];
  let reachedPadding = false;
  for (const point of c.curve) {
    if (point.sqrtPrice.isZero() && point.liquidity.isZero()) {
      reachedPadding = true;
    } else {
      assert.ok(!reachedPadding, 'Nonzero curve point after padding');
      assert.ok(!point.sqrtPrice.isZero() && !point.liquidity.isZero());
      curve.push(pick(point, ['sqrtPrice', 'liquidity']));
    }
  }
  assert.equal(curve.length, 2);
  const p = {
    poolFees: {
      baseFee: pick(c.poolFees.baseFee, ['cliffFeeNumerator', 'firstFactor',
        'secondFactor', 'thirdFactor', 'baseFeeMode']),
      dynamicFee: null,
    },
    ...pick(c, ['collectFeeMode', 'migrationOption', 'activationType', 'tokenType',
      'tokenDecimal', 'partnerLiquidityPercentage', 'partnerPermanentLockedLiquidityPercentage',
      'creatorLiquidityPercentage', 'creatorPermanentLockedLiquidityPercentage',
      'migrationQuoteThreshold', 'sqrtStartPrice', 'migrationFeeOption',
      'creatorTradingFeePercentage', 'tokenUpdateAuthority', 'poolCreationFee',
      'migratedPoolBaseFeeMode']),
    lockedVesting: pick(c.lockedVestingConfig, ['amountPerPeriod',
      'cliffDurationFromMigrationTime', 'frequency', 'numberOfPeriod', 'cliffUnlockAmount']),
    tokenSupply: pick(c, ['preMigrationTokenSupply', 'postMigrationTokenSupply']),
    migrationFee: {
      feePercentage: c.migrationFeePercentage,
      creatorFeePercentage: c.creatorMigrationFeePercentage,
    },
    migratedPoolFee: {
      collectFeeMode: c.migratedCollectFeeMode,
      dynamicFee: c.migratedDynamicFee,
      poolFeeBps: c.migratedPoolFeeBps,
    },
    partnerLiquidityVestingInfo: pick(c.partnerLiquidityVestingInfo, vestingNames),
    creatorLiquidityVestingInfo: pick(c.creatorLiquidityVestingInfo, vestingNames),
    migratedPoolMarketCapFeeSchedulerParams: {
      numberOfPeriod: 0, sqrtPriceStepBps: 0,
      schedulerExpirationDuration: 0, reductionFactor: new BN(0),
    },
    enableFirstSwapWithMinFee: Boolean(c.enableFirstSwapWithMinFee),
    compoundingFeeBps: c.migratedCompoundingFeeBps,
    padding: [0, 0],
    curve,
  };
  const schema = sdk.DynamicBondingCurveIdl.types.find(type =>
    camel(type.name).toLowerCase() === 'configparameters');
  assert.ok(schema, 'SDK ConfigParameters schema unavailable');
  assert.deepEqual(Object.keys(p).sort(), schema.type.fields.map(f => camel(f.name)).sort(),
    'Config mapper must cover every SDK input field');
  sdk.validateConfigParameters({ ...p, leftoverReceiver: new PublicKey(WALLET) });
  return { params: p, reference: c, connection, program, BN, wallet: new PublicKey(WALLET) };
}

function main() {
  const { reference: c, connection, BN } = buildPlan();
  console.log('PASS: all config input fields mapped; Meteora SDK validation passed');
  const quote = new sdk.PoolService(connection, 'confirmed').getQuoteFromInputAmount({
    config: c, swapBaseForQuote: false, amountIn: new BN('1000000000'),
    slippageBps: 0, hasReferral: false, eligibleForFirstSwapWithMinFee: false,
    currentPoint: new BN(0),
  });
  console.log('Creator / payer / feeClaimer / leftoverReceiver:', WALLET);
  console.log('Pre- and post-migration supply:', decimal(c.preMigrationTokenSupply, 6), 'ZEVON');
  console.log('Migration threshold:', decimal(c.migrationQuoteThreshold, 9), 'SOL');
  console.log('Initial 1 SOL quote:', decimal(quote.outputAmount, 6), 'ZEVON');
  const plain = value => {
    if (BN.isBN(value)) return value.toString();
    if (Array.isArray(value)) return value.map(plain);
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, plain(item)]));
    return value;
  };
  console.log('Quote details (raw units):', JSON.stringify(plain(quote), null, 2));
  console.log('Read-only check complete. No transaction created, signed, or sent.');
  console.log('Quote excludes account rent and network fees; live transaction minimum output is not set here.');
}

module.exports = { buildPlan };
if (!module.parent) {
  try { main(); } catch (error) {
    console.error('ZEVON plan check failed:', error.message);
    process.exitCode = 1;
  }
}
