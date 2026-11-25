import test from 'node:test';
import assert from 'node:assert/strict';
import { SlippiApiError, SlippiClient } from '../dist/services/slippi-client.js';

const validProfile = {
  data: {
    getUser: {
      displayName: 'Mango',
      connectCode: { code: 'MANG#0' },
      rankedNetplayProfile: {
        ratingOrdinal: 2310.5,
        wins: 120,
        losses: 80,
      },
    },
  },
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('looks up a player and maps the Slippi profile fields', async () => {
  let requestUrl;
  let requestOptions;

  const client = new SlippiClient({
    requestIntervalMs: 0,
    fetchImplementation: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return jsonResponse(validProfile);
    },
  });

  const player = await client.getPlayer(' mang#0 ');

  assert.equal(requestUrl, 'https://internal.slippi.gg/');
  assert.equal(requestOptions.method, 'POST');
  assert.equal(requestOptions.headers['content-type'], 'application/json');

  const requestBody = JSON.parse(requestOptions.body);
  assert.equal(requestBody.operationName, 'UserProfilePageQuery');
  assert.deepEqual(requestBody.variables, { cc: 'MANG#0', uid: 'MANG#0' });

  assert.deepEqual(player, {
    connectCode: 'MANG#0',
    displayName: 'Mango',
    rating: 2310.5,
    wins: 120,
    losses: 80,
  });
});

test('returns null when a player does not exist', async () => {
  const client = new SlippiClient({
    requestIntervalMs: 0,
    fetchImplementation: async () => jsonResponse({ data: { getUser: null } }),
  });

  assert.equal(await client.getPlayer('MANG#0'), null);
});

test('returns a profile without ranked data', async () => {
  const client = new SlippiClient({
    requestIntervalMs: 0,
    fetchImplementation: async () =>
      jsonResponse({
        data: {
          getUser: {
            displayName: 'New Player',
            rankedNetplayProfile: null,
          },
        },
      }),
  });

  assert.deepEqual(await client.getPlayer('NEW#123'), {
    connectCode: 'NEW#123',
    displayName: 'New Player',
    rating: null,
    wins: null,
    losses: null,
  });
});

test('rejects malformed Connect Codes without making a request', async () => {
  let requestCount = 0;
  const client = new SlippiClient({
    requestIntervalMs: 0,
    fetchImplementation: async () => {
      requestCount += 1;
      return jsonResponse(validProfile);
    },
  });

  await assert.rejects(() => client.getPlayer('not-a-code'), RangeError);
  assert.equal(requestCount, 0);
});

test('treats HTTP failures as API errors', async () => {
  const client = new SlippiClient({
    requestIntervalMs: 0,
    fetchImplementation: async () => jsonResponse({}, 503),
  });

  await assert.rejects(
    () => client.getPlayer('MANG#0'),
    (error) =>
      error instanceof SlippiApiError && error.statusCode === 503 && /HTTP 503/.test(error.message),
  );
});

test('treats GraphQL errors as API errors', async () => {
  const client = new SlippiClient({
    requestIntervalMs: 0,
    fetchImplementation: async () =>
      jsonResponse({
        errors: [{ message: 'upstream failure' }],
        data: { getUser: null },
      }),
  });

  await assert.rejects(() => client.getPlayer('MANG#0'), SlippiApiError);
});

test('does not mistake malformed responses for missing players', async () => {
  const client = new SlippiClient({
    requestIntervalMs: 0,
    fetchImplementation: async () => jsonResponse({ data: {} }),
  });

  await assert.rejects(() => client.getPlayer('MANG#0'), SlippiApiError);
});

test('coalesces concurrent lookups for the same Connect Code', async () => {
  let requestCount = 0;
  let releaseRequest;

  const client = new SlippiClient({
    requestIntervalMs: 0,
    cacheTtlMs: 0,
    fetchImplementation: async () => {
      requestCount += 1;
      await new Promise((resolve) => {
        releaseRequest = resolve;
      });
      return jsonResponse(validProfile);
    },
  });

  const first = client.getPlayer('MANG#0');
  const second = client.getPlayer('mang#0');

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requestCount, 1);

  releaseRequest();

  const [firstPlayer, secondPlayer] = await Promise.all([first, second]);
  assert.deepEqual(firstPlayer, secondPlayer);
  assert.equal(requestCount, 1);
});

test('serializes requests to avoid concurrent Slippi API calls', async () => {
  let activeRequests = 0;
  let maximumActiveRequests = 0;

  const client = new SlippiClient({
    requestIntervalMs: 0,
    cacheTtlMs: 0,
    fetchImplementation: async () => {
      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeRequests -= 1;
      return jsonResponse(validProfile);
    },
  });

  await Promise.all([client.getPlayer('MANG#0'), client.getPlayer('ZAIN#0')]);

  assert.equal(maximumActiveRequests, 1);
});

test('caches successful responses for the configured TTL', async () => {
  let requestCount = 0;
  const client = new SlippiClient({
    requestIntervalMs: 0,
    cacheTtlMs: 60_000,
    fetchImplementation: async () => {
      requestCount += 1;
      return jsonResponse(validProfile);
    },
  });

  await client.getPlayer('MANG#0');
  await client.getPlayer('MANG#0');

  assert.equal(requestCount, 1);
});

test('does not cache API failures', async () => {
  let requestCount = 0;
  const client = new SlippiClient({
    requestIntervalMs: 0,
    fetchImplementation: async () => {
      requestCount += 1;
      return jsonResponse({}, 503);
    },
  });

  await assert.rejects(() => client.getPlayer('MANG#0'), SlippiApiError);
  await assert.rejects(() => client.getPlayer('MANG#0'), SlippiApiError);

  assert.equal(requestCount, 2);
});

test('converts an aborted request into a timeout API error', async () => {
  const client = new SlippiClient({
    timeoutMs: 5,
    requestIntervalMs: 0,
    fetchImplementation: async (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          reject(options.signal.reason);
        });
      }),
  });

  await assert.rejects(
    () => client.getPlayer('MANG#0'),
    (error) => error instanceof SlippiApiError && /timed out/.test(error.message),
  );
});
