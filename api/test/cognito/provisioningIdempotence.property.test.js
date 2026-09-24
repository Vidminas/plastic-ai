/**
 * Feature: cognito-login-migration, Property 8: Provisioning is idempotent.
 *
 * Models the cognito-init service's list-then-create-by-name shell command
 * (docker-compose.override.yml) as a JS function over a fake Cognito registry,
 * and asserts that running it N>=1 times yields at most one pool and one app
 * client per configured name.
 */

class FakeCognito {
  constructor() {
    this.pools = [];
    this.clientsByPool = {};
    this._seq = 0;
  }

  _nextId(prefix) {
    this._seq += 1;
    return `${prefix}-${this._seq}`;
  }

  resolvePoolIdByName(name) {
    const match = this.pools.find((p) => p.Name === name);
    return match ? match.Id : 'None';
  }

  createUserPool(name) {
    const id = this._nextId('pool');
    this.pools.push({ Id: id, Name: name });
    this.clientsByPool[id] = [];
    return id;
  }

  resolveClientIdByName(poolId, clientName) {
    const clients = this.clientsByPool[poolId] || [];
    const match = clients.find((c) => c.ClientName === clientName);
    return match ? match.ClientId : 'None';
  }

  createUserPoolClient(poolId, clientName) {
    const id = this._nextId('client');
    if (!this.clientsByPool[poolId]) {
      this.clientsByPool[poolId] = [];
    }
    this.clientsByPool[poolId].push({ ClientId: id, ClientName: clientName });
    return id;
  }

  countPoolsNamed(name) {
    return this.pools.filter((p) => p.Name === name).length;
  }

  countClientsNamedInPool(poolId, name) {
    return (this.clientsByPool[poolId] || []).filter((c) => c.ClientName === name).length;
  }
}

function provision(registry, poolName, clientName) {
  let poolId = registry.resolvePoolIdByName(poolName);
  if (poolId === 'None' || poolId === '' || poolId == null) {
    poolId = registry.createUserPool(poolName);
  }
  let clientId = registry.resolveClientIdByName(poolId, clientName);
  if (clientId === 'None' || clientId === '' || clientId == null) {
    clientId = registry.createUserPoolClient(poolId, clientName);
  }
  return { poolId, clientId };
}

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick(rng, arr) {
  return arr[randInt(rng, 0, arr.length - 1)];
}

function makeStartingState(rng, poolName, clientName) {
  const registry = new FakeCognito();
  const unrelatedNames = ['other-pool', 'legacy-pool', 'staging-pool', 'librechat-dev'];
  const scenario = randInt(rng, 0, 3);
  if (scenario >= 1) {
    const poolId = registry.createUserPool(poolName);
    if (scenario >= 2) {
      registry.createUserPoolClient(poolId, clientName);
    }
  }
  const unrelatedCount = randInt(rng, 0, 3);
  for (let i = 0; i < unrelatedCount; i += 1) {
    const name = pick(rng, unrelatedNames);
    const id = registry.createUserPool(name);
    if (rng() < 0.5) {
      registry.createUserPoolClient(id, pick(rng, ['app', 'admin-client', 'other-client']));
    }
  }
  return registry;
}

describe('Feature: cognito-login-migration, Property 8: Provisioning is idempotent', () => {
  const CONFIGS = [
    { poolName: 'plastic-ai-users', clientName: 'plastic-ai-web' },
    { poolName: 'plastic-ai-pool', clientName: 'plastic-ai-client' },
    { poolName: 'p', clientName: 'c' },
  ];

  test('running provision one or more times yields at most one pool and one client per configured name', () => {
    const ITERATIONS = 150;
    let checked = 0;
    for (let i = 0; i < ITERATIONS; i += 1) {
      const rng = makeRng(0x9e3779b9 ^ (i * 2654435761));
      const { poolName, clientName } = pick(rng, CONFIGS);
      const registry = makeStartingState(rng, poolName, clientName);
      const unrelatedSnapshot = registry.pools.filter((p) => p.Name !== poolName).map((p) => p.Name);
      const runCount = randInt(rng, 1, 6);
      let last = null;
      for (let r = 0; r < runCount; r += 1) {
        last = provision(registry, poolName, clientName);
      }
      expect(registry.countPoolsNamed(poolName)).toBe(1);
      const resolvedPoolId = registry.resolvePoolIdByName(poolName);
      expect(last.poolId).toBe(resolvedPoolId);
      expect(resolvedPoolId).not.toBe('None');
      expect(registry.countClientsNamedInPool(resolvedPoolId, clientName)).toBe(1);
      expect(registry.resolveClientIdByName(resolvedPoolId, clientName)).toBe(last.clientId);
      expect(last.clientId).not.toBe('None');
      const unrelatedAfter = registry.pools.filter((p) => p.Name !== poolName).map((p) => p.Name).sort();
      expect(unrelatedAfter).toEqual([...unrelatedSnapshot].sort());
      checked += 1;
    }
    expect(checked).toBe(ITERATIONS);
  });

  test('a second run creates nothing new after the first run provisions from empty', () => {
    const { poolName, clientName } = CONFIGS[0];
    const registry = new FakeCognito();
    const first = provision(registry, poolName, clientName);
    const poolsAfterFirst = registry.pools.length;
    const clientsAfterFirst = (registry.clientsByPool[first.poolId] || []).length;
    const second = provision(registry, poolName, clientName);
    expect(second.poolId).toBe(first.poolId);
    expect(second.clientId).toBe(first.clientId);
    expect(registry.pools.length).toBe(poolsAfterFirst);
    expect((registry.clientsByPool[first.poolId] || []).length).toBe(clientsAfterFirst);
  });
});
