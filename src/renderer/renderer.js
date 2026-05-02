const img = document.getElementById('artwork-img');
const loading = document.getElementById('loading');
const errorOverlay = document.getElementById('error-overlay');
const artTitle = document.getElementById('art-title');
const artArtist = document.getElementById('art-artist');
const artMedium = document.getElementById('art-medium');
const artMuseum = document.getElementById('art-museum');
const progressFill = document.getElementById('progress-fill');

let currentConfig = { interval: 10 };
let countdownTimer = null;
let progressTimer = null;
let countdownSeconds = 0;
let retryTimer = null;
let currentLoadId = 0;
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 5;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms)),
  ]);
}

function clearTimers() {
  if (countdownTimer) clearTimeout(countdownTimer);
  if (progressTimer) clearInterval(progressTimer);
  if (retryTimer) clearTimeout(retryTimer);
  countdownTimer = null;
  progressTimer = null;
  retryTimer = null;
}

async function loadArtwork() {
  clearTimers();
  const loadId = ++currentLoadId;
  loading.classList.remove('hidden');
  errorOverlay.classList.add('hidden');

  try {
    const artwork = await withTimeout(window.artShow.getNextArtwork(), 30000);
    if (loadId !== currentLoadId) return;

    if (!artwork) {
      consecutiveFailures++;
      loading.classList.add('hidden');
      if (consecutiveFailures <= MAX_CONSECUTIVE_FAILURES) {
        errorOverlay.classList.remove('hidden');
        retryTimer = setTimeout(loadArtwork, 3000);
      }
      return;
    }

    const imageUrl = artwork.imageSmall || artwork.imageUrl;
    await loadImage(imageUrl);
    if (loadId !== currentLoadId) return;

    consecutiveFailures = 0;
    displayInfo(artwork);
    startCountdown();

    // Background load HD image
    if (artwork.imageSmall && artwork.imageUrl !== artwork.imageSmall) {
      const hd = new Image();
      hd.onload = () => {
        if (loadId === currentLoadId) img.src = artwork.imageUrl;
      };
      hd.src = artwork.imageUrl;
    }
  } catch {
    if (loadId !== currentLoadId) return;
    consecutiveFailures++;
    loading.classList.add('hidden');
    if (consecutiveFailures <= MAX_CONSECUTIVE_FAILURES) {
      errorOverlay.classList.remove('hidden');
      retryTimer = setTimeout(loadArtwork, 5000);
    }
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    img.classList.remove('loaded');
    img.classList.add('fading');

    const tempImg = new Image();
    const timeout = setTimeout(() => {
      tempImg.onload = null;
      tempImg.onerror = null;
      reject(new Error('Image load timeout'));
    }, 20000);

    tempImg.onload = () => {
      clearTimeout(timeout);
      img.src = url;
      img.classList.remove('fading');
      img.classList.add('loaded');
      loading.classList.add('hidden');
      resolve();
    };
    tempImg.onerror = () => {
      clearTimeout(timeout);
      loading.classList.add('hidden');
      reject(new Error('Image load failed'));
    };
    tempImg.src = url;
  });
}

function displayInfo(artwork) {
  artTitle.textContent = artwork.title;
  artArtist.textContent = [artwork.artist, artwork.date].filter(Boolean).join(', ');
  artMedium.textContent = artwork.medium;
  artMuseum.textContent = artwork.museum;
}

function startCountdown() {
  if (countdownTimer) clearTimeout(countdownTimer);
  if (progressTimer) clearInterval(progressTimer);

  countdownSeconds = currentConfig.interval * 60;
  progressFill.style.width = '0%';

  const totalSeconds = countdownSeconds;

  progressTimer = setInterval(() => {
    countdownSeconds--;
    if (countdownSeconds <= 0) {
      clearInterval(progressTimer);
      progressFill.style.width = '100%';
      return;
    }
    const pct = ((totalSeconds - countdownSeconds) / totalSeconds) * 100;
    progressFill.style.width = pct + '%';
  }, 1000);

  countdownTimer = setTimeout(() => {
    loadArtwork();
  }, totalSeconds * 1000);
}

function showKeywordInput(currentKeywords) {
  // Defensive: ensure currentKeywords is always an array
  const safeKeywords = Array.isArray(currentKeywords) ? currentKeywords : [];

  const existing = document.getElementById('keyword-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'keyword-modal';
  modal.innerHTML = `
    <div id="keyword-backdrop"></div>
    <div id="keyword-dialog">
      <div id="keyword-title">Search Keywords</div>
      <input id="keyword-input" type="text" placeholder="e.g. landscape, portrait, sunset">
      <div id="keyword-hint">Comma-separated. Leave empty to use defaults.</div>
      <div id="keyword-actions">
        <button id="keyword-cancel">Cancel</button>
        <button id="keyword-save">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const input = document.getElementById('keyword-input');
  input.value = safeKeywords.join(', ');
  input.focus();
  input.select();

  const closeModal = () => modal.remove();

  document.getElementById('keyword-cancel').addEventListener('click', closeModal);
  document.getElementById('keyword-backdrop').addEventListener('click', closeModal);

  let saving = false;
  const save = async () => {
    if (saving) return;
    saving = true;
    const keywords = input.value.split(',').map(k => k.trim()).filter(k => k.length > 0);
    try {
      await window.artShow.setKeywords(keywords);
    } catch { /* ignore IPC errors */ }
    closeModal();
    // Refresh artwork so new keywords take effect immediately
    consecutiveFailures = 0;
    loadArtwork();
  };

  document.getElementById('keyword-save').addEventListener('click', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') closeModal();
  });
}

async function init() {
  try {
    currentConfig = await window.artShow.getConfig();
  } catch {}

  window.artShow.onNextArtwork(() => {
    loadArtwork();
  });

  window.artShow.onConfigChanged((newConfig) => {
    currentConfig = newConfig;
    startCountdown();
  });

  window.artShow.onPromptKeywords((currentKeywords) => {
    showKeywordInput(currentKeywords);
  });

  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.artShow.showContextMenu();
  });

  await loadArtwork();
}

init();
