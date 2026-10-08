'use strict';

// Read-only metadata verification. No wallet access or transactions.
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');

const CID = 'bafkreifgqh2x744e7hcp5e3qnt6kyyy5agrac3teryahrykmtck7nxng7a';
const IMAGE = 'ipfs://bafybeigrf3izrcoynvaueylomb4bvt64x2urhkzzybpasn2hpbwvddw4v4';
const GATEWAYS = ['https://ipfs.io/ipfs/', 'https://gateway.pinata.cloud/ipfs/'];
const TIMEOUT_MS = 15000;

async function main() {
  if (typeof fetch !== 'function')
    throw new Error('This checker requires Node.js 18 or newer.');

  const expected = JSON.parse(fs.readFileSync('metadata.json', 'utf8'));
  if (expected.name !== 'ZEVON' || expected.symbol !== 'ZEVON' || expected.image !== IMAGE)
    throw new Error('Local metadata does not match the approved ZEVON name, symbol and image CID.');

  let bytes;
  const failures = [];
  for (const gateway of GATEWAYS) {
    console.log('Checking ' + gateway + ' (15-second timeout)...');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(gateway + CID, { signal: controller.signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 1024 * 1024) throw new Error('Metadata response exceeds 1 MiB.');
      break;
    } catch (error) {
      const reason = controller.signal.aborted ? 'timed out after 15 seconds' : error.message;
      failures.push(gateway + ': ' + reason);
      console.log('Gateway unavailable: ' + reason);
    } finally {
      clearTimeout(timer);
    }
  }
  if (!bytes)
    throw new Error('Could not retrieve metadata.\n' + failures.join('\n'));

  const metadata = JSON.parse(bytes.toString('utf8'));
  for (const field of ['name', 'symbol', 'description', 'image']) {
    if (metadata[field] !== expected[field])
      throw new Error('Published metadata differs from metadata.json: ' + field +
        '\nPublished: ' + JSON.stringify(metadata[field]) +
        '\nLocal: ' + JSON.stringify(expected[field]));
  }
  if (!isDeepStrictEqual(metadata, expected))
    throw new Error('The four primary fields match, but other metadata fields differ.');

  console.log('PASS: full published metadata JSON matches metadata.json');
  console.log('Metadata SHA-256:', createHash('sha256').update(bytes).digest('hex'));
  console.log(JSON.stringify(metadata, null, 2));
  console.log('Logo CID matches; actual logo image bytes still require verification.');
}

main().catch(error => {
  console.error('Metadata check failed:', error.message);
  process.exitCode = 1;
});
