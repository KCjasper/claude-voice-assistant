'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getRemoteAccess,
  listLanAddresses,
  pairingUrl,
} = require('../src/remote/remote-access');

test('selects private IPv4 LAN addresses and prefers physical adapters', () => {
  const addresses = listLanAddresses({
    'vEthernet (WSL)': [
      { family: 'IPv4', address: '172.20.0.1', internal: false },
    ],
    'Wi-Fi': [
      { family: 'IPv4', address: '192.168.1.20', internal: false },
      { family: 'IPv6', address: 'fe80::1', internal: false },
    ],
    Loopback: [
      { family: 'IPv4', address: '127.0.0.1', internal: true },
    ],
    Public: [
      { family: 4, address: '8.8.8.8', internal: false },
    ],
  });

  assert.deepEqual(addresses, [
    { address: '192.168.1.20', interface: 'Wi-Fi' },
    { address: '172.20.0.1', interface: 'vEthernet (WSL)' },
  ]);
});

test('keeps pairing tokens in URL fragments and returns QR access metadata', async () => {
  assert.equal(
    pairingUrl('http://192.168.1.20:8787/', 'pair / token'),
    'http://192.168.1.20:8787/#token=pair%20%2F%20token'
  );

  const access = await getRemoteAccess({
    server: {
      state: () => ({
        running: true,
        port: 8787,
        pairingToken: 'secret',
        pairingExpiresAt: 1000,
        protocolVersion: 1,
      }),
    },
    tunnel: {
      state: () => ({
        status: 'running',
        publicUrl: 'https://example.trycloudflare.com',
      }),
    },
    interfaces: {
      Ethernet: [{ family: 'IPv4', address: '10.0.0.5', internal: false }],
    },
    toDataUrl: async (value) => `data:image/png;base64,${Buffer.from(value).toString('base64')}`,
  });

  assert.equal(access.lan[0].pairingUrl, 'http://10.0.0.5:8787/#token=secret');
  assert.match(access.lan[0].qrDataUrl, /^data:image\/png;base64,/);
  assert.equal(
    access.public.pairingUrl,
    'https://example.trycloudflare.com/#token=secret'
  );
  assert.equal(access.warnings.length, 2);
});

test('does not create access URLs while the remote server is stopped', async () => {
  const access = await getRemoteAccess({
    server: { state: () => ({ running: false }) },
  });
  assert.deepEqual(access.lan, []);
  assert.equal(access.public, null);
});
