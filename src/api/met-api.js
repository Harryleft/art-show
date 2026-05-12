const https = require('https');

const BASE_URL = 'https://collectionapi.metmuseum.org/public/collection/v1';
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10000;
const MAX_FETCH_ATTEMPTS = 15;
const DISPLAYED_HISTORY_LIMIT = 5000;
const DISPLAYED_HISTORY_TRIM_COUNT = 2000;
const MIN_POOL_SIZE = 5;

// Art historical periods used for random year-range searches.
// Each refill picks a random sub-range within a random period so the
// same keyword returns different object IDs on different calls.
const ART_PERIODS = [
  [-5000, -3000],  // Neolithic
  [-3000, -1000],  // Bronze Age
  [-1000, -500],   // Iron Age
  [-500, 0],       // Classical Antiquity
  [0, 500],        // Late Antiquity
  [500, 1000],     // Early Medieval
  [1000, 1300],    // High Medieval
  [1300, 1500],    // Late Medieval / Early Renaissance
  [1500, 1600],    // Renaissance
  [1600, 1700],    // Baroque
  [1700, 1750],    // Rococo
  [1750, 1800],    // Neoclassical
  [1800, 1850],    // Romanticism
  [1850, 1900],    // Impressionism / Post-Impressionism
  [1900, 1930],    // Modernism
  [1930, 1960],    // Mid-Century
  [1960, 2000],    // Contemporary
  [2000, 2025],    // 21st Century
];

const SEARCH_KEYWORDS = [
  'light', 'water', 'portrait', 'landscape', 'gold', 'blue', 'red', 'sunset',
  'flowers', 'mountain', 'sea', 'forest', 'woman', 'man', 'child', 'city',
  'river', 'sky', 'moon', 'star', 'garden', 'winter', 'summer', 'spring',
  'autumn', 'horse', 'bird', 'tree', 'boat', 'rain', 'snow', 'fire',
  'architecture', 'music', 'dance', 'love', 'war', 'peace', 'night', 'dream',
  'angel', 'sword', 'shield', 'castle', 'bridge', 'harbor', 'market', 'temple',
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
    this.usedKeywords = [];
    this.customKeywords = [];
    this._keywordVersion = 0;
    this._refillCount = 0;
  }

  setCustomKeywords(keywords) {
    this.customKeywords = Array.isArray(keywords) ? keywords.filter(k => typeof k === 'string' && k.trim()) : [];
    this.usedKeywords = [];
    // Clear pool and prefetch state so stale results from old keywords
    // do not continue to appear or get written back by in-flight promises.
    this.pool = [];
    this.poolIds = new Set();
    this.prefetched = null;
    this.prefetchPromise = null;
    this.prefetchId = null;
    this.refillPromise = null;
    // Bump version so any in-flight refill/prefetch can detect it's stale.
    this._keywordVersion = (this._keywordVersion || 0) + 1;
  }

  getKeywords() {
    return this.customKeywords.length > 0 ? this.customKeywords : SEARCH_KEYWORDS;
  }

  pickKeyword() {
    const pool = this.getKeywords();
    const available = pool.filter(k => !this.usedKeywords.includes(k));
    if (available.length > 0) {
      const keyword = available[Math.floor(Math.random() * available.length)];
      this.usedKeywords.push(keyword);
      return keyword;
    }
    // All keywords used — reset rotation.
    // Keep at most half (rounded down) of the pool as "recent" to avoid
    // immediate repeats, but never keep more than we have keywords.
    const keepCount = Math.min(5, Math.max(0, Math.floor(pool.length / 2) - 1));
    const recent = this.usedKeywords.slice(-keepCount);
    this.usedKeywords = [...recent];
    const fresh = pool.filter(k => !recent.includes(k));
    // If fresh is still empty (pool has 0 or 1 keyword), fall back to full pool
    if (fresh.length === 0) {
      this.usedKeywords = [];
      return pool[Math.floor(Math.random() * pool.length)];
    }
    return fresh[Math.floor(Math.random() * fresh.length)];
  }

  static getRandomYearRange() {
    const period = ART_PERIODS[Math.floor(Math.random() * ART_PERIODS.length)];
    const span = period[1] - period[0];
    // Pick a ~50-200 year window within the period
    const windowSize = Math.min(200, Math.max(50, Math.floor(Math.random() * span * 0.6)));
    const offset = Math.floor(Math.random() * (span - windowSize));
    return {
      dateBegin: period[0] + offset,
      dateEnd: period[0] + offset + windowSize,
    };
  }

  async refillPool() {
    if (this.refillPromise) {
      return this.refillPromise;
    }

    // Alternate between standard keyword search and year-range-randomized search
    // so the same keyword can produce different result sets over time.
    this._refillCount++;
    const useYearRange = this._refillCount % 2 === 0;
    const yearRange = useYearRange ? MetArtProvider.getRandomYearRange() : null;

    // Run 3 keyword searches in parallel for faster pool accumulation.
    // Pick unique keywords for each slot.
    const keywords = [];
    for (let i = 0; i < 3; i++) {
      const kw = this.pickKeyword();
      if (kw) keywords.push(kw);
    }

    if (keywords.length === 0) {
      this.refillPromise = Promise.resolve();
      return this.refillPromise;
    }

    const searches = keywords.map(kw => this.refillPoolOnce({ keyword: kw, yearRange }));
    this.refillPromise = Promise.all(searches).catch(() => {});

    try {
      return await this.refillPromise;
    } finally {
      this.refillPromise = null;
    }
  }

  async refillPoolOnce({ keyword, yearRange } = {}) {
    const versionAtStart = this._keywordVersion || 0;
    const kw = keyword || this.pickKeyword();
    let url = `${BASE_URL}/search?q=${encodeURIComponent(kw)}&hasImages=true`;

    if (yearRange) {
      url += `&dateBegin=${yearRange.dateBegin}&dateEnd=${yearRange.dateEnd}`;
    }

    const result = await fetchJSON(url);

    // If keywords changed while we were fetching, discard stale results.
    if (this._keywordVersion !== versionAtStart) return;

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
    const versionAtStart = this._keywordVersion;
    let attempts = 0;
    let customKeywordFailed = false;

    while (attempts < MAX_FETCH_ATTEMPTS) {
      if (this._keywordVersion !== versionAtStart) return null;

      const prefetchedArtwork = await this.consumePrefetched();
      if (prefetchedArtwork) {
        return this.finalizeArtwork(prefetchedArtwork);
      }

      if (this.pool.length < MIN_POOL_SIZE) {
        await this.refillPool();
      }

      if (this.pool.length === 0) {
        // Pool still empty after refill — try one more time with a fresh keyword
        this.usedKeywords = [];
        await this.refillPool();
        if (this.pool.length === 0 && this.customKeywords.length > 0 && !customKeywordFailed) {
          // Custom keywords produced no results — fall back to defaults
          customKeywordFailed = true;
          const savedCustom = this.customKeywords;
          this.customKeywords = [];
          this.usedKeywords = [];
          try {
            await this.refillPool();
          } finally {
            this.customKeywords = savedCustom;
          }
        }
        // Last resort: force a year-range search — this produces a different
        // subset of results than keyword-only searches, so it can uncover IDs
        // that broad keyword searches might not reach.
        if (this.pool.length === 0) {
          await this.refillPoolOnce({ yearRange: MetArtProvider.getRandomYearRange() });
        }
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

    if (this.customKeywords.length > 0 && !customKeywordFailed) {
      customKeywordFailed = true;
      const savedCustom = this.customKeywords;
      this.customKeywords = [];
      this.usedKeywords = [];
      this.pool = [];
      this.poolIds = new Set();

      try {
        return await this.getNextSerial();
      } finally {
        this.customKeywords = savedCustom;
        this.usedKeywords = [];
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
      const result = await this.prefetchPromise;
      if (!result) {
        // Prefetch failed (network error or undisplayable) — reclaim the ID
        // so it can be retried or filtered naturally by getNextSerial.
        this.addToPool([id]);
      }
      return result;
    } finally {
      if (this.prefetchId === id) {
        this.prefetchId = null;
      }
      this.prefetchPromise = null;
    }
  }

  async fetchPrefetchedArtwork(id) {
    const versionAtStart = this._keywordVersion;
    try {
      const artwork = await this.fetchArtwork(id);
      if (this._keywordVersion !== versionAtStart) return null;
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
    const versionAtEntry = this._keywordVersion;

    if (this.prefetchPromise) {
      await this.prefetchPromise;
    }

    if (this._keywordVersion !== versionAtEntry) {
      this.prefetched = null;
      return null;
    }

    if (!this.prefetched) {
      return null;
    }

    const artwork = this.prefetched;
    this.prefetched = null;

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

  getDisplayedIds() {
    return [...this.displayedIds];
  }

  loadDisplayedIds(ids) {
    if (!Array.isArray(ids)) return;
    for (const rawId of ids) {
      const id = normalizeObjectId(rawId);
      if (id !== null) this.displayedIds.add(id);
    }
  }
}

module.exports = { MetArtProvider, fetchJSON };
