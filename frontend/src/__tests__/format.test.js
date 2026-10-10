import assert from 'node:assert/strict';
import {
  cleanUrls,
  isEthAddress,
  isHttpUrl,
  normalizeCredential,
  normalizeIdList,
  parseRoute,
  statusMeta,
} from '../format.js';

assert.equal(isEthAddress('0x0000000000000000000000000000000000000001'), true);
assert.equal(isEthAddress('0x123'), false);
assert.equal(isHttpUrl('https://example.com/a'), true);
assert.equal(isHttpUrl('ftp://example.com/a'), false);

assert.deepEqual(cleanUrls([' https://a.test ', '', 'https://b.test']), ['https://a.test', 'https://b.test']);

assert.deepEqual(parseRoute(''), { path: 'lookup', id: '', address: '' });
assert.deepEqual(parseRoute('#submit'), { path: 'submit', id: '', address: '' });
assert.deepEqual(parseRoute('#lookup?id=4'), { path: 'lookup', id: '4', address: '' });
assert.equal(parseRoute('#lookup?address=0xabc').address, '0xabc');

assert.deepEqual(normalizeIdList('["0","2"]'), ['0', '2']);
assert.equal(normalizeCredential({
  submitter: '0xabc',
  credential_type: 'PMP',
  issuing_institution: 'PMI',
  holder_name: 'Jane Doe',
  claim_details: 'issued 2022',
  profile_reference_urls: ['https://example.com/me'],
  verification_source_urls: ['https://example.org/a', 'https://example.net/b'],
  status: 'VERIFIED',
  verdict: 'VERIFIED',
  verdict_reason: 'matched',
  confidence: 90,
}, '3').holderName, 'Jane Doe');
assert.equal(normalizeCredential({ holder_name: 'Jane Doe' }, '3').id, '3');
assert.equal(statusMeta('DISPUTED').tone, 'warn');
assert.equal(statusMeta('UNVERIFIED').tone, 'bad');

console.log('format tests passed');
