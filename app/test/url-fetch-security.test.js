'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const {
  fetchUrl,
  isPublicAddress,
  resolveTarget,
  validateUrl,
} = require('../src/ai/url-fetch');

function response(statusCode, headers, body = '') {
  const stream = new PassThrough();
  stream.statusCode = statusCode;
  stream.headers = headers;
  queueMicrotask(() => stream.end(body));
  return stream;
}

function requestRouter(routes, { remoteAddress = '93.184.216.34' } = {}) {
  return (url, options, callback) => {
    const request = new EventEmitter();
    request.destroy = () => {};
    request.options = options;

    queueMicrotask(() => {
      const socket = new EventEmitter();
      socket.remoteAddress = remoteAddress;
      request.emit('socket', socket);
      const route = routes[url.href];
      if (!route) return request.emit('error', new Error(`No route for ${url.href}`));
      callback(response(route.status, route.headers, route.body));
    });

    return request;
  };
}

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

test('address policy blocks local, private, link-local, multicast and metadata ranges', () => {
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '169.254.169.254',
    '192.168.1.10',
    '224.0.0.1',
    '168.63.129.16',
    '::1',
    'fd00::1',
    'fe80::1',
    'ff02::1',
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});

test('URL validation rejects localhost, metadata hosts and embedded credentials', () => {
  assert.throws(() => validateUrl('http://localhost/test'), { code: 'FETCH_SSRF_BLOCKED' });
  assert.throws(() => validateUrl('http://metadata.google.internal/'), {
    code: 'FETCH_SSRF_BLOCKED',
  });
  assert.throws(() => validateUrl('https://user:pass@example.com/'), {
    code: 'FETCH_CREDENTIALS_BLOCKED',
  });
});

test('DNS validation rejects private and mixed public/private answers', async () => {
  await assert.rejects(
    resolveTarget(new URL('https://private.example/'), async () => [
      { address: '10.0.0.5', family: 4 },
    ]),
    { code: 'FETCH_SSRF_BLOCKED' }
  );
  await assert.rejects(
    resolveTarget(new URL('https://mixed.example/'), async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]),
    { code: 'FETCH_SSRF_BLOCKED' }
  );
});

test('redirect destinations are revalidated and private redirects are blocked', async () => {
  const result = await fetchUrl('https://public.example/start', {
    lookupImpl: async (hostname) => {
      if (hostname === 'private.example') return [{ address: '10.0.0.8', family: 4 }];
      return publicLookup();
    },
    requestImpl: requestRouter({
      'https://public.example/start': {
        status: 302,
        headers: { location: 'http://private.example/admin' },
      },
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'FETCH_SSRF_BLOCKED');
});

test('redirect loops and excessive redirects stop deterministically', async () => {
  const loop = await fetchUrl('https://public.example/a', {
    lookupImpl: publicLookup,
    requestImpl: requestRouter({
      'https://public.example/a': {
        status: 302,
        headers: { location: '/a' },
      },
    }),
  });
  assert.equal(loop.code, 'FETCH_REDIRECT_LOOP');

  const limited = await fetchUrl('https://public.example/1', {
    lookupImpl: publicLookup,
    maxRedirects: 1,
    requestImpl: requestRouter({
      'https://public.example/1': {
        status: 302,
        headers: { location: '/2' },
      },
      'https://public.example/2': {
        status: 302,
        headers: { location: '/3' },
      },
    }),
  });
  assert.equal(limited.code, 'FETCH_REDIRECT_LIMIT');
});

test('response type and byte limits return structured errors', async () => {
  const binary = await fetchUrl('https://public.example/image', {
    lookupImpl: publicLookup,
    requestImpl: requestRouter({
      'https://public.example/image': {
        status: 200,
        headers: { 'content-type': 'image/png' },
        body: 'not-really-an-image',
      },
    }),
  });
  assert.equal(binary.code, 'FETCH_CONTENT_TYPE_BLOCKED');

  const large = await fetchUrl('https://public.example/large', {
    lookupImpl: publicLookup,
    maxBytes: 8,
    requestImpl: requestRouter({
      'https://public.example/large': {
        status: 200,
        headers: { 'content-type': 'text/plain' },
        body: 'more than eight bytes',
      },
    }),
  });
  assert.equal(large.code, 'FETCH_RESPONSE_TOO_LARGE');
});

test('public text responses use the pinned DNS result and return cleaned text', async () => {
  let requestOptions;
  const requestImpl = (url, options, callback) => {
    requestOptions = options;
    return requestRouter({
      'https://public.example/page': {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: '<style>hidden</style><h1>Hello</h1><p>public page</p>',
      },
    })(url, options, callback);
  };

  const result = await fetchUrl('https://public.example/page', {
    lookupImpl: publicLookup,
    requestImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.text, 'Hello public page');
  assert.equal(result.contentType, 'text/html');
  const pinned = await new Promise((resolve, reject) => {
    requestOptions.lookup('public.example', {}, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
  assert.deepEqual(pinned, { address: '93.184.216.34', family: 4 });
});

test('the connected socket address is checked against DNS rebinding', async () => {
  const result = await fetchUrl('https://public.example/', {
    lookupImpl: publicLookup,
    requestImpl: requestRouter({
      'https://public.example/': {
        status: 200,
        headers: { 'content-type': 'text/plain' },
        body: 'should not be returned',
      },
    }, { remoteAddress: '127.0.0.1' }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'FETCH_SSRF_BLOCKED');
});
