'use strict';

const os = require('os');
const QRCode = require('qrcode');
const { isPrivateAddress } = require('./remote-server');

const VIRTUAL_INTERFACE = /(bluetooth|docker|hyper-v|loopback|tailscale|teredo|virtual|vmware|vpn|wsl)/i;

function interfaceScore(name, address) {
  let score = VIRTUAL_INTERFACE.test(name) ? 0 : 100;
  if (/^(ethernet|en|wi-?fi|wlan)/i.test(name)) score += 20;
  if (address.startsWith('192.168.')) score += 10;
  if (address.startsWith('169.254.')) score -= 50;
  return score;
}

function listLanAddresses(interfaces = os.networkInterfaces()) {
  const candidates = [];
  for (const [name, entries] of Object.entries(interfaces || {})) {
    for (const entry of entries || []) {
      const family = entry.family === 4 ? 'IPv4' : entry.family;
      if (family !== 'IPv4' || entry.internal || !isPrivateAddress(entry.address)) continue;
      if (entry.address === '127.0.0.1') continue;
      candidates.push({
        address: entry.address,
        interface: name,
        score: interfaceScore(name, entry.address),
      });
    }
  }
  const unique = new Map();
  for (const candidate of candidates) {
    const current = unique.get(candidate.address);
    if (!current || candidate.score > current.score) unique.set(candidate.address, candidate);
  }
  return [...unique.values()]
    .sort((left, right) => right.score - left.score || left.address.localeCompare(right.address))
    .map(({ score, ...candidate }) => candidate);
}

function pairingUrl(baseUrl, pairingToken) {
  if (!baseUrl || !pairingToken) return null;
  const url = new URL(baseUrl);
  url.hash = `token=${encodeURIComponent(pairingToken)}`;
  return url.toString();
}

async function accessTarget(baseUrl, token, toDataUrl = QRCode.toDataURL) {
  const paired = pairingUrl(baseUrl, token);
  return {
    baseUrl,
    pairingUrl: paired,
    qrDataUrl: paired
      ? await toDataUrl(paired, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 320,
      })
      : null,
  };
}

async function getRemoteAccess({
  server,
  tunnel,
  interfaces,
  toDataUrl,
} = {}) {
  const serverState = server
    ? server.state()
    : { running: false, protocolVersion: 1 };
  const tunnelState = tunnel
    ? tunnel.state()
    : { status: 'stopped', publicUrl: null };
  const warnings = [];

  if (!serverState.running) {
    return {
      ok: true,
      server: serverState,
      lan: [],
      tunnel: tunnelState,
      public: null,
      warnings,
    };
  }

  const addresses = listLanAddresses(interfaces);
  const lan = await Promise.all(addresses.map(({ address, interface: interfaceName }) => (
    accessTarget(
      `http://${address}:${serverState.port}/`,
      serverState.pairingToken,
      toDataUrl
    ).then((target) => ({ ...target, address, interface: interfaceName }))
  )));
  const publicTarget = tunnelState.publicUrl
    ? await accessTarget(tunnelState.publicUrl, serverState.pairingToken, toDataUrl)
    : null;

  if (lan.length === 0) {
    warnings.push('No private IPv4 LAN address is currently available.');
  }
  if (publicTarget) {
    warnings.push(
      'This URL is exposed to the public Internet. Keep the pairing token private and stop the tunnel when finished.'
    );
    warnings.push(
      'Cloudflare Quick Tunnels are intended for testing and development, not production availability.'
    );
  }

  return {
    ok: true,
    server: serverState,
    lan,
    tunnel: tunnelState,
    public: publicTarget,
    warnings,
  };
}

module.exports = {
  getRemoteAccess,
  interfaceScore,
  listLanAddresses,
  pairingUrl,
};
