const https = require('https');

const BASE_URL = 'https://collectionapi.metmuseum.org/public/collection/v1';

const SEARCH_KEYWORDS = [
  'light', 'water', 'portrait', 'landscape', 'gold', 'blue', 'red', 'sunset',
  'flowers', 'mountain', 'sea', 'forest', 'woman', 'man', 'child', 'city',
  'river', 'sky', 'moon', 'star', 'garden', 'winter', 'summer', 'spring',
  'autumn', 'horse', 'bird', 'tree', 'boat', 'rain', 'snow', 'fire',
];

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`HTTP ${res.statusCode}`));
        req.destroy();
        return;
      }
      let data = '';
      const MAX_SIZE = 5 * 1024 * 1024;
      res.on('data', (chunk) => {
        data += chunk;
        if (data.length > MAX_SIZE) {
          reject(new Error('Response too large'));
          req.destroy();
        }
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => {
      reject(new Error('Request timeout'));
      req.destroy();
    });
  });
}

function getRandomKeyword() {
  return SEARCH_KEYWORDS[Math.floor(Math.random() * SEARCH_KEYWORDS.length)];
}

class MetArtProvider {
  constructor() {
    this.pool = [];
    this.displayedIds = new Set();
    this.prefetched = null;
  }

  async refillPool() {
    const keyword = getRandomKeyword();
    const url = `${BASE_URL}/search?q=${encodeURIComponent(keyword)}&hasImages=true&isPublicDomain=true&resultsPerPage=100`;
    const result = await fetchJSON(url);

    if (!result.objectIDs || result.objectIDs.length === 0) {
      return;
    }

    const newIds = result.objectIDs.filter(id => !this.displayedIds.has(id));
    for (let i = newIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newIds[i], newIds[j]] = [newIds[j], newIds[i]];
    }

    this.pool.push(...newIds);

    if (this.displayedIds.size > 1000) {
      const oldIds = [...this.displayedIds];
      oldIds.splice(0, 500).forEach(id => this.displayedIds.delete(id));
    }
  }

  async fetchArtwork(objectId) {
    const url = `${BASE_URL}/objects/${objectId}`;
    return fetchJSON(url);
  }

  async getNext() {
    if (this.pool.length < 10) {
      await this.refillPool();
    }

    const maxAttempts = 15;
    let attempts = 0;

    while (attempts < maxAttempts) {
      // Consume prefetched result first
      if (this.prefetched) {
        const artwork = this.prefetched;
        this.prefetched = null;
        this.displayedIds.add(artwork.objectID);
        this.prefetchNext();
        return this.formatArtwork(artwork);
      }

      if (this.pool.length === 0) {
        await this.refillPool();
        if (this.pool.length === 0) return null;
      }

      const id = this.pool.shift();
      attempts++;

      try {
        const artwork = await this.fetchArtwork(id);

        if (!artwork.primaryImage || !artwork.isPublicDomain) {
          continue;
        }

        this.displayedIds.add(id);
        this.prefetchNext();

        return this.formatArtwork(artwork);
      } catch {
        continue;
      }
    }

    return null;
  }

  formatArtwork(artwork) {
    return {
      id: artwork.objectID,
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
    if (this.prefetched || this.pool.length === 0) return;
    const id = this.pool[0];
    try {
      const artwork = await this.fetchArtwork(id);
      if (artwork.primaryImage && artwork.isPublicDomain) {
        this.prefetched = artwork;
      }
    } catch {}
  }
}

module.exports = { MetArtProvider };
