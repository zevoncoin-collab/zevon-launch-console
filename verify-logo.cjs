'use strict';

// Read-only verification of the existing ZEVON logo. No wallet access.
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const CID = 'bafybeigrf3izrcoynvaueylomb4bvt64x2urhkzzybpasn2hpbwvddw4v4';
const APPROVED_GIT_BLOB = 'dcdab4708f9a2e3b84f67cf7337b5b2081c18a44';
const GATEWAYS = ['https://ipfs.io/ipfs/', 'https://gateway.pinata.cloud/ipfs/'];
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

async function main() {
  if (typeof fetch !== 'function')
    throw new Error('This checker requires Node.js 18 or newer.');
  const local = fs.readFileSync('logo.png');
  const blobHash = createHash('sha1')
    .update(Buffer.from('blob ' + local.length + '\0'))
    .update(local).digest('hex');
  if (blobHash !== APPROVED_GIT_BLOB)
    throw new Error('Local logo.png differs from the existing repository logo; review it before proceeding.');
  if (!local.subarray(0, 8).equals(PNG_SIGNATURE))
    throw new Error('Local logo.png does not have a PNG signature.');

  let published;
  const failures = [];
  for (const gateway of GATEWAYS) {
    console.log('Checking logo at ' + gateway + ' (15-second timeout)...');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(gateway + CID, { signal: controller.signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      published = Buffer.from(await response.arrayBuffer());
      break;
    } catch (error) {
      const reason = controller.signal.aborted ? 'timed out after 15 seconds' : error.message;
      failures.push(gateway + ': ' + reason);
      console.log('Gateway unavailable: ' + reason);
    } finally {
      clearTimeout(timer);
    }
  }
  if (!published)
    throw new Error('Could not retrieve logo.\n' + failures.join('\n'));
  if (!published.equals(local))
    throw new Error('Published image bytes differ from the saved repository logo. No files were changed.');

  console.log('PASS: published image matches existing logo.png byte for byte');
  console.log('Image bytes:', published.length);
  console.log('Image SHA-256:', createHash('sha256').update(published).digest('hex'));
  console.log('Logo CID:', CID);
}

main().catch(error => {
  console.error('Logo check failed:', error.message);
  process.exitCode = 1;
});
