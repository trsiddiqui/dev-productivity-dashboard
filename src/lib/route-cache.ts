import { Redis } from '@upstash/redis';
import { NextResponse } from 'next/server';
import { getRuntimeSettingsFingerprintForRequest } from './config';

const ROUTE_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;

type CacheStatus = 'BYPASS' | 'HIT' | 'MISS';

let redis: Redis | null | undefined;

interface MemoryCacheEntry {
  value: unknown;
  expiresAt: number;
}

type MemoryCacheStore = Map<string, MemoryCacheEntry>;

const memoryCacheStore = (() => {
  const globalScope = globalThis as typeof globalThis & {
    __dpdRouteCacheStore?: MemoryCacheStore;
  };
  if (!globalScope.__dpdRouteCacheStore) {
    globalScope.__dpdRouteCacheStore = new Map<string, MemoryCacheEntry>();
  }
  return globalScope.__dpdRouteCacheStore;
})();

function resolveRedisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_KV_REST_API_TOKEN;

  if (!url || !token) return null;
  return { url, token };
}

function getRedis(): Redis | null {
  if (redis !== undefined) return redis;

  const config = resolveRedisConfig();
  redis = config ? new Redis(config) : null;
  return redis;
}

function getMemoryCache(): MemoryCacheStore | null {
  return process.env.NODE_ENV === 'production' ? null : memoryCacheStore;
}

function normalizeRequestTarget(req: Request): string {
  const url = new URL(req.url);
  const params = Array.from(url.searchParams.entries()).sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    if (leftKey === rightKey) return leftValue.localeCompare(rightValue);
    return leftKey.localeCompare(rightKey);
  });
  const normalized = new URL(url.pathname, 'https://cache.local');

  for (const [key, value] of params) {
    normalized.searchParams.append(key, value);
  }

  return `${normalized.pathname}${normalized.search}`;
}

function buildCacheKey(req: Request, authUser: string, namespace: string): string {
  const settingsFingerprint = getRuntimeSettingsFingerprintForRequest(req, authUser);
  return ['dpd', 'route-cache', 'v2', namespace, authUser, settingsFingerprint, normalizeRequestTarget(req)].join(':');
}

function shouldCachePayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return true;

  const record = payload as Record<string, unknown>;
  if (typeof record.error === 'string' && record.error.trim()) return false;

  return !Array.isArray(record.warnings) || record.warnings.length === 0;
}

function withCacheHeaders(response: Response, status: CacheStatus): Response {
  response.headers.set('x-dpd-cache', status);
  response.headers.set('x-dpd-cache-ttl', String(ROUTE_CACHE_TTL_SECONDS));
  return response;
}

async function tryReadJsonPayload(response: Response): Promise<unknown | undefined> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) return undefined;

  try {
    return await response.clone().json();
  } catch {
    return undefined;
  }
}

export async function withCachedRouteResponse(params: {
  req: Request;
  authUser: string;
  namespace: string;
  handler: () => Promise<Response>;
  cacheIf?: (payload: unknown) => boolean;
}): Promise<Response> {
  const { req, authUser, namespace, handler, cacheIf = shouldCachePayload } = params;
  const client = getRedis();
  const memoryCache = client ? null : getMemoryCache();

  const requestTarget = normalizeRequestTarget(req);
  const cacheKey = buildCacheKey(req, authUser, namespace);

  if (client) {
    try {
      const cached = await client.get(cacheKey);
      if (cached !== null) {
        console.info(`[route-cache] HIT ${namespace} ${requestTarget}`);
        return withCacheHeaders(NextResponse.json(cached), 'HIT');
      }
    } catch (error) {
      console.error(`[route-cache] Read failed for ${namespace}`, error);
    }
  } else if (memoryCache) {
    const cached = memoryCache.get(cacheKey);
    if (cached) {
      if (cached.expiresAt > Date.now()) {
        console.info(`[route-cache] HIT ${namespace} ${requestTarget} (memory)`);
        return withCacheHeaders(NextResponse.json(cached.value), 'HIT');
      }
      memoryCache.delete(cacheKey);
    }
  } else {
    return withCacheHeaders(await handler(), 'BYPASS');
  }

  const response = await handler();
  if (response.status !== 200) {
    return withCacheHeaders(response, 'BYPASS');
  }

  const payload = await tryReadJsonPayload(response);
  if (payload === undefined || !cacheIf(payload)) {
    return withCacheHeaders(response, 'BYPASS');
  }

  try {
    if (client) {
      await client.set(cacheKey, payload, { ex: ROUTE_CACHE_TTL_SECONDS });
      console.info(`[route-cache] MISS ${namespace} ${requestTarget}`);
      return withCacheHeaders(response, 'MISS');
    }

    if (memoryCache) {
      memoryCache.set(cacheKey, {
        value: payload,
        expiresAt: Date.now() + (ROUTE_CACHE_TTL_SECONDS * 1000),
      });
      console.info(`[route-cache] MISS ${namespace} ${requestTarget} (memory)`);
      return withCacheHeaders(response, 'MISS');
    }

    return withCacheHeaders(response, 'BYPASS');
  } catch (error) {
    console.error(`[route-cache] Write failed for ${namespace}`, error);
    return withCacheHeaders(response, 'BYPASS');
  }
}
