'use strict';

const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');
const cancellation = require('../tasks/cancellation');

const DEFAULT_MAX_BYTES = 200 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_TEXT_CHARS = 8_000;

const blockedIpv4 = new net.BlockList();
const blockedIpv6 = new net.BlockList();

[
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
].forEach(([address, prefix]) => blockedIpv4.addSubnet(address, prefix, 'ipv4'));

blockedIpv4.addAddress('168.63.129.16', 'ipv4');

[
  ['::', 96],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:2::', 48],
  ['2001:10::', 28],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
].forEach(([address, prefix]) => blockedIpv6.addSubnet(address, prefix, 'ipv6'));

const blockedHostnames = new Set([
  'instance-data',
  'metadata',
  'metadata.google.internal',
  'metadata.google',
]);

class FetchPolicyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FetchPolicyError';
    this.code = code;
    this.details = details;
  }
}

function failure(code, error, details = {}) {
  return { ok: false, code, error, ...details };
}

function normalizedHostname(hostname) {
  return hostname
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return !blockedIpv4.check(address, 'ipv4');
  if (family === 6) return !blockedIpv6.check(address, 'ipv6');
  return false;
}

function validateUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new FetchPolicyError('FETCH_INVALID_URL', 'The URL is invalid.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchPolicyError('FETCH_PROTOCOL_BLOCKED', 'Only HTTP and HTTPS URLs are allowed.');
  }
  if (url.username || url.password) {
    throw new FetchPolicyError('FETCH_CREDENTIALS_BLOCKED', 'URLs containing credentials are not allowed.');
  }

  const hostname = normalizedHostname(url.hostname);
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || blockedHostnames.has(hostname)
  ) {
    throw new FetchPolicyError('FETCH_SSRF_BLOCKED', 'Local and metadata hosts are not allowed.');
  }

  return { url, hostname };
}

async function resolveTarget(url, lookupImpl = dns.promises.lookup) {
  const { hostname } = validateUrl(url.href);
  const literalFamily = net.isIP(hostname);
  let addresses;

  if (literalFamily) {
    addresses = [{ address: hostname, family: literalFamily }];
  } else {
    try {
      const result = await lookupImpl(hostname, { all: true, verbatim: true });
      addresses = Array.isArray(result) ? result : [result];
    } catch (error) {
      throw new FetchPolicyError('FETCH_DNS_FAILED', `DNS lookup failed for ${hostname}.`, {
        cause: error.message,
      });
    }
  }

  if (!addresses.length) {
    throw new FetchPolicyError('FETCH_DNS_FAILED', `DNS lookup returned no addresses for ${hostname}.`);
  }

  const normalized = addresses.map((entry) => ({
    address: entry.address,
    family: Number(entry.family) || net.isIP(entry.address),
  }));
  const blocked = normalized.find((entry) => !isPublicAddress(entry.address));
  if (blocked) {
    throw new FetchPolicyError('FETCH_SSRF_BLOCKED', 'The destination resolves to a non-public address.', {
      hostname,
      address: blocked.address,
    });
  }

  return normalized[0];
}

function pinnedLookup(target) {
  return (_hostname, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    if (options?.all) return callback(null, [target]);
    callback(null, target.address, target.family);
  };
}

function allowedContentType(value) {
  const type = String(value || '').split(';', 1)[0].trim().toLowerCase();
  if (!type) return false;
  return (
    type.startsWith('text/')
    || type === 'application/json'
    || type.endsWith('+json')
    || type === 'application/xml'
    || type.endsWith('+xml')
    || type === 'application/xhtml+xml'
    || type === 'application/javascript'
    || type === 'application/x-javascript'
    || type === 'application/x-www-form-urlencoded'
  );
}

function extractText(buffer, contentType) {
  const raw = buffer.toString('utf8');
  if (!String(contentType).toLowerCase().includes('html')) return raw.trim();
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function defaultRequest(url, options, callback) {
  return (url.protocol === 'https:' ? https : http).get(url, options, callback);
}

async function fetchStep(rawUrl, context) {
  cancellation.throwIfAborted(context.signal);
  const { url } = validateUrl(rawUrl);
  if (context.visited.has(url.href)) {
    throw new FetchPolicyError('FETCH_REDIRECT_LOOP', 'A redirect loop was detected.');
  }
  context.visited.add(url.href);

  const target = await resolveTarget(url, context.lookupImpl);
  cancellation.throwIfAborted(context.signal);

  return new Promise((resolve, reject) => {
    let request;
    let response;
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      context.signal?.removeEventListener('abort', onAbort);
      fn(value);
    };
    const stopRequest = (error) => {
      try { response?.destroy(error); } catch {}
      try { request?.destroy(error); } catch {}
    };
    const onAbort = () => {
      const error = cancellation.isAbortError(context.signal.reason)
        ? context.signal.reason
        : cancellation.createAbortError();
      finish(reject, error);
      stopRequest(error);
    };
    const blockConnectedAddress = (address) => {
      if (!address || isPublicAddress(address) || settled) return;
      const error = new FetchPolicyError(
        'FETCH_SSRF_BLOCKED',
        'The connection reached a non-public address.',
        { address }
      );
      finish(resolve, failure(error.code, error.message, error.details));
      stopRequest(error);
    };

    context.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      request = context.requestImpl(url, {
        headers: {
          'User-Agent': 'VoiceAssistant/0.1',
          'Accept': 'text/html,text/plain,application/json,application/xml;q=0.9,*/*;q=0.1',
        },
        lookup: pinnedLookup(target),
        timeout: context.timeoutMs,
      }, (res) => {
        response = res;
        const status = Number(res.statusCode) || 0;
        const location = res.headers?.location;

        if (status >= 300 && status < 400 && location) {
          res.resume?.();
          if (context.redirectCount >= context.maxRedirects) {
            return finish(
              resolve,
              failure('FETCH_REDIRECT_LIMIT', `Redirect limit exceeded (${context.maxRedirects}).`)
            );
          }

          let redirectUrl;
          try {
            redirectUrl = new URL(location, url).href;
          } catch {
            return finish(resolve, failure('FETCH_INVALID_REDIRECT', 'The redirect URL is invalid.'));
          }

          return finish(resolve, fetchStep(redirectUrl, {
            ...context,
            redirectCount: context.redirectCount + 1,
          }));
        }

        if (status < 200 || status >= 300) {
          res.resume?.();
          return finish(resolve, failure('FETCH_HTTP_ERROR', `The server returned HTTP ${status}.`, {
            status,
            url: url.href,
          }));
        }

        const contentType = res.headers?.['content-type'] || '';
        if (!allowedContentType(contentType)) {
          res.resume?.();
          return finish(
            resolve,
            failure('FETCH_CONTENT_TYPE_BLOCKED', 'The response content type is not allowed.', {
              contentType: contentType || null,
            })
          );
        }

        const declaredLength = Number(res.headers?.['content-length']) || 0;
        if (declaredLength > context.maxBytes) {
          res.resume?.();
          return finish(
            resolve,
            failure('FETCH_RESPONSE_TOO_LARGE', `The response exceeds ${context.maxBytes} bytes.`)
          );
        }

        const chunks = [];
        let received = 0;
        res.on('data', (chunk) => {
          if (settled) return;
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          received += buffer.length;
          if (received > context.maxBytes) {
            finish(
              resolve,
              failure('FETCH_RESPONSE_TOO_LARGE', `The response exceeds ${context.maxBytes} bytes.`)
            );
            return stopRequest();
          }
          chunks.push(buffer);
        });
        res.on('end', () => {
          if (settled) return;
          const text = extractText(Buffer.concat(chunks), contentType);
          finish(resolve, {
            ok: true,
            url: url.href,
            status,
            contentType: String(contentType).split(';', 1)[0],
            text: text.slice(0, context.maxTextChars) || '(No readable text content.)',
            truncated: text.length > context.maxTextChars,
          });
        });
        res.on('error', (error) => {
          finish(resolve, failure('FETCH_RESPONSE_ERROR', 'The response stream failed.', {
            cause: error.message,
          }));
        });
      });
    } catch (error) {
      return finish(resolve, failure('FETCH_REQUEST_ERROR', 'The request could not be started.', {
        cause: error.message,
      }));
    }

    request.on('socket', (socket) => {
      const verify = () => blockConnectedAddress(socket.remoteAddress);
      if (socket.remoteAddress) verify();
      else {
        socket.once('connect', verify);
        socket.once('secureConnect', verify);
      }
    });
    request.on('timeout', () => {
      finish(resolve, failure('FETCH_TIMEOUT', `The request timed out after ${context.timeoutMs}ms.`));
      stopRequest();
    });
    request.on('error', (error) => {
      if (cancellation.isAbortError(error) && context.signal?.aborted) {
        return finish(reject, error);
      }
      finish(resolve, failure('FETCH_NETWORK_ERROR', 'The request failed.', {
        cause: error.message,
      }));
    });
  });
}

async function fetchUrl(rawUrl, opts = {}) {
  try {
    return await fetchStep(rawUrl, {
      signal: opts.signal,
      lookupImpl: opts.lookupImpl || dns.promises.lookup,
      requestImpl: opts.requestImpl || defaultRequest,
      timeoutMs: opts.timeoutMs || DEFAULT_TIMEOUT_MS,
      maxBytes: opts.maxBytes || DEFAULT_MAX_BYTES,
      maxRedirects: opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
      maxTextChars: opts.maxTextChars || DEFAULT_MAX_TEXT_CHARS,
      redirectCount: 0,
      visited: new Set(),
    });
  } catch (error) {
    if (cancellation.isAbortError(error) || opts.signal?.aborted) throw error;
    if (error instanceof FetchPolicyError) {
      return failure(error.code, error.message, error.details);
    }
    return failure('FETCH_INTERNAL_ERROR', 'The fetch operation failed.', {
      cause: error.message,
    });
  }
}

module.exports = {
  FetchPolicyError,
  allowedContentType,
  fetchUrl,
  isPublicAddress,
  resolveTarget,
  validateUrl,
};
