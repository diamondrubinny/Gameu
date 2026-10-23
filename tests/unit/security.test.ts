import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FailureLimiter, TokenBucket } from '../../src/server/rate-limit';
import { isAllowedHostHeader } from '../../src/server/security';
import { safeResolve } from '../../src/server/static';
import { isLoopback, lanAddresses } from '../../src/server/network';

describe('safeResolve', () => {
  const root = path.resolve('/srv/public');
  it('resolves normal files', () => {
    expect(safeResolve(root, 'c/index.html')).toBe(path.join(root, 'c', 'index.html'));
  });
  it('blocks traversal, encoded traversal, dotfiles, backslashes and unknown types', () => {
    for (const bad of ['../secret.html', '%2e%2e/secret.html', 'a/../../x.js', '.env', 'x/.git/config.txt', '..%5c..%5cwin.ini', 'file.exe', 'a%00.html', '%E0%A4%A']) {
      expect(safeResolve(root, bad), bad).toBeNull();
    }
  });
});

describe('isAllowedHostHeader (DNS rebinding guard)', () => {
  it('accepts localhost and IP literals', () => {
    for (const ok of ['localhost:8080', '127.0.0.1:8080', '192.168.1.20:8080', '[::1]:8080', '10.0.0.5']) expect(isAllowedHostHeader(ok), ok).toBe(true);
  });
  it('rejects domain names and missing hosts', () => {
    for (const bad of [undefined, '', 'evil.com', 'attacker.example:8080', '127.0.0.1.nip.io']) expect(isAllowedHostHeader(bad), String(bad)).toBe(false);
  });
});

describe('rate limiting', () => {
  it('token bucket refills over time', () => {
    let t = 0;
    const b = new TokenBucket(2, 1, () => t);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
    t += 1000;
    expect(b.take()).toBe(true);
  });
  it('failure limiter blocks after N failures, then unblocks', () => {
    let t = 0;
    const f = new FailureLimiter(3, 60_000, 10_000, () => t);
    f.fail('ip');
    f.fail('ip');
    expect(f.isBlocked('ip')).toBe(false);
    f.fail('ip');
    expect(f.isBlocked('ip')).toBe(true);
    t += 10_001;
    expect(f.isBlocked('ip')).toBe(false);
  });
});

describe('network', () => {
  it('detects loopback addresses', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopback('192.168.1.2')).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });
  it('lists private IPv4 first, skipping internal and link-local', () => {
    const ips = lanAddresses({
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true, netmask: '', mac: '', cidr: null }],
      a: [{ address: '172.20.0.2', family: 'IPv4', internal: false, netmask: '', mac: '', cidr: null }],
      b: [{ address: '192.168.1.7', family: 'IPv4', internal: false, netmask: '', mac: '', cidr: null }],
      c: [{ address: '169.254.3.3', family: 'IPv4', internal: false, netmask: '', mac: '', cidr: null }],
    });
    expect(ips).toEqual(['192.168.1.7', '172.20.0.2']);
  });
});
