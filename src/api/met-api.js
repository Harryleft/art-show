const https = require('https');

const BASE_URL = 'https://collectionapi.metmuseum.org/public/collection/v1';
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10000;
const MIN_POOL_SIZE = 10;
const MAX_FETCH_ATTEMPTS = 15;
const DISPLAYED_HISTORY_LIMIT = 1000;
const DISPLAYED_HISTORY_TRIM_COUNT = 500;

const SEARCH_KEYWORDS = [
  'light', 'water', 'portrait', 'landscape', 'gold', 'blue', 'red', 'sunset',
  'flowers', 'mountain', 'sea', 'forest', 'woman', 'man', 'child', 'city',
  'river', 'sky', 'moon', 'star', 'garden', 'winter', 'summer', 'spring',
  'autumn', 'horse', 'bird', 'tree', 'boat', 'rain', 'snow', 'fire',
];

function normalizeObjectId(id) {
  const numericId = Number(id);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) {
    return null;
  }
  return numericId;
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    let req = null;
    let settled = false;
    let totalBytes = 0;
    const chunks = [];

    const settle = (error, value) => {
      if (settled) return;
      settled = true;

      if (error) {
        reject(error);
        return;
      }

      resolve(value);
    };

    const fail = (error, shouldDestroy = true) => {
      if (settled) return;
      settle(error);
      if (shouldDestroy && req && typeof req.destroy === 'function' && !req.destroyed) {
        req.destroy();
      }
    };

    try {
      req = https.get(url, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          fail(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        res.on('data', (chunk) => {
          if (settled) return;

          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buffer.length;

          if (totalBytes > MAX_RESPONSE_SIZE) {
            fail(new Error('Response too large'));
            return;
          }

          chunks.push(buffer);
        });

        res.on('error', (error) => {
          fail(error);
        });

        res.on('end', () => {
          if (settled) return;

          try {
            const data = Buffer.concat(chunks, totalBytes).toString('utf8');
            settle(null, JSON.parse(data));
          } catch (e) {
            settle(new Error(`JSON parse error: ${e.message}`));
          }
        });
      });
    } catch (error) {
      settle(error);
      return;
    }

    req.on('error', (error) => {
      settle(error);
    });

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      fail(new Error('Request timeout'));
    });
  });
}

function getRandomKeyword() {
  return SEARCH_KEYWORDS[Math.floor(Math.random() * SEARCH_KEYWORDS.length)];
}

class MetArtProvider {
  constructor() {
    this.pool = [];
    this.poolIds = new Set();
    this.displayedIds = new Set();
    this.prefetched = null;
    this.prefetchPromise = null;
    this.prefetchId = null;
    this.refillPromise = null;
    this.nextPromise = Promise.resolve();
  }

  async refillPool() {
    if (this.refillPromise) {
      return this.refillPromise;
    }

    this.refillPromise = this.refillPoolOnce();

    try {
      return await this.refillPromise;
    } finally {
      this.refillPromise = null;
    }
  }

  async refillPoolOnce() {
    const keyword = getRandomKeyword();
    const url = `${BASE_URL}/search?q=${encodeURIComponent(keyword)}&hasImages=true&isPublicDomain=true&resultsPerPage=100`;
    const result = await fetchJSON(url);

    this.addToPool(result?.objectIDs);
  }

  async fetchArtwork(objectId) {
    const url = `${BASE_URL}/objects/${objectId}`;
    return fetchJSON(url);
  }

  async getNext() {
    const next = this.nextPromise.then(() => this.getNextSerial());
    this.nextPromise = next.catch(() => null);
    return next.catch(() => null);
  }

  async getNextSerial() {
    let attempts = 0;

    while (attempts < MAX_FETCH_ATTEMPTS) {
      const prefetchedArtwork = await this.consumePrefetched();
      if (prefetchedArtwork) {
        return this.finalizeArtwork(prefetchedArtwork);
      }

      if (this.pool.length < MIN_POOL_SIZE) {
        await this.ensurePool(MIN_POOL_SIZE);
      }

      if (this.pool.length === 0) {
        await this.ensurePool(1);
        if (this.pool.length === 0) return null;
      }

      const id = this.takeNextPoolId();
      if (id === null) {
        return null;
      }

      attempts++;

      try {
        const artwork = await this.fetchArtwork(id);
        if (!this.isDisplayableArtwork(artwork, id)) {
          continue;
        }

        return this.finalizeArtwork(artwork);
      } catch {
        continue;
      }
    }

    return null;
  }

  formatArtwork(artwork) {
    return {
      id: normalizeObjectId(artwork.objectID),
      title: artwork.title || 'Untitled',
      artist: artwork.artistDisplayName || 'Unknown Artist',
      date: artwork.objectDate || '',
      medium: artwork.medium || '',
      department: artwork.department || '',
      museum: 'The Metropolitan Museum of Art',
      imageUrl: artwork.primaryImage,
      imageSmall: artwork.primaryImageSmall || artwork.primaryImage,
      artistUrl: artwork.artistWikidata_URL || '',
      objectUrl: artwork.objectURL || `https://www.metmuseum.org/art/collection/search/${artwork.objectID}`,
    };
  }

  async prefetchNext() {
    if (this.prefetched) {
      return this.prefetched;
    }

    if (this.prefetchPromise) {
      return this.prefetchPromise;
    }

    const id = this.takeNextPoolId();
    if (id === null) {
      return null;
    }

    this.prefetchId = id;
    this.prefetchPromise = this.fetchPrefetchedArtwork(id);

    try {
      return await this.prefetchPromise;
    } finally {
      if (this.prefetchId === id) {
        this.prefetchId = null;
      }
      this.prefetchPromise = null;
    }
  }

  async fetchPrefetchedArtwork(id) {
    try {
      const artwork = await this.fetchArtwork(id);
      if (this.isDisplayableArtwork(artwork, id)) {
        this.prefetched = artwork;
        return artwork;
      }
    } catch {
      return null;
    }

    return null;
  }

  async consumePrefetched() {
    if (this.prefetchPromise) {
      await this.prefetchPromise;
    }

    if (!this.prefetched) {
      return null;
    }

    const artwork = this.prefetched;
    this.prefetched = null;

    // 兼容旧状态或测试直接写入 prefetched 的情况，避免同一 ID 留在 pool 里。
    this.removePoolId(artwork.objectID);

    if (!this.isDisplayableArtwork(artwork)) {
      return null;
    }

    return artwork;
  }

  finalizeArtwork(artwork) {
    this.rememberDisplayed(artwork.objectID);
    this.prefetchNext();
    return this.formatArtwork(artwork);
  }

  async ensurePool(minSize) {
    this.syncPoolIds();
    if (this.pool.length >= minSize) {
      return;
    }

    try {
      await this.refillPool();
    } catch {
      // API 临时失败时让 getNext 返回 null 或尝试现有池，避免主进程收到异常。
    }
  }

  addToPool(objectIds) {
    if (!Array.isArray(objectIds)) {
      return;
    }

    this.syncPoolIds();

    const seenIncoming = new Set();
    const candidateIds = [];
    for (const rawId of objectIds) {
      const id = normalizeObjectId(rawId);
      if (id === null || seenIncoming.has(id)) {
        continue;
      }

      seenIncoming.add(id);

      if (
        this.displayedIds.has(id)
        || this.poolIds.has(id)
        || this.prefetchId === id
        || normalizeObjectId(this.prefetched?.objectID) === id
      ) {
        continue;
      }

      candidateIds.push(id);
    }

    for (let i = candidateIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidateIds[i], candidateIds[j]] = [candidateIds[j], candidateIds[i]];
    }

    for (const id of candidateIds) {
      this.pool.push(id);
      this.poolIds.add(id);
    }
  }

  takeNextPoolId() {
    this.syncPoolIds();

    const id = this.pool.shift();
    if (id === undefined) {
      return null;
    }

    this.poolIds.delete(id);
    return id;
  }

  removePoolId(rawId) {
    const id = normalizeObjectId(rawId);
    if (id === null) {
      return;
    }

    this.syncPoolIds();
    if (!this.poolIds.has(id)) {
      return;
    }

    this.pool = this.pool.filter(poolId => poolId !== id);
    this.poolIds.delete(id);
  }

  syncPoolIds() {
    const deduplicatedPool = [];
    const poolIds = new Set();
    const prefetchedId = normalizeObjectId(this.prefetched?.objectID);

    for (const rawId of this.pool) {
      const id = normalizeObjectId(rawId);
      if (
        id === null
        || poolIds.has(id)
        || this.displayedIds.has(id)
        || this.prefetchId === id
        || prefetchedId === id
      ) {
        continue;
      }

      deduplicatedPool.push(id);
      poolIds.add(id);
    }

    this.pool = deduplicatedPool;
    this.poolIds = poolIds;
  }

  isDisplayableArtwork(artwork, expectedId = null) {
    if (!artwork || typeof artwork !== 'object') {
      return false;
    }

    const objectId = normalizeObjectId(artwork.objectID);
    const expectedObjectId = normalizeObjectId(expectedId);

    if (objectId === null) {
      return false;
    }

    if (expectedObjectId !== null && objectId !== expectedObjectId) {
      return false;
    }

    return (
      artwork.isPublicDomain === true
      && typeof artwork.primaryImage === 'string'
      && artwork.primaryImage.trim() !== ''
      && !this.displayedIds.has(objectId)
    );
  }

  rememberDisplayed(rawId) {
    const id = normalizeObjectId(rawId);
    if (id === null) {
      return;
    }

    this.displayedIds.add(id);

    if (this.displayedIds.size > DISPLAYED_HISTORY_LIMIT) {
      const oldIds = [...this.displayedIds].slice(0, DISPLAYED_HISTORY_TRIM_COUNT);
      oldIds.forEach(oldId => this.displayedIds.delete(oldId));
    }
  }
}

module.exports = { MetArtProvider, fetchJSON };
