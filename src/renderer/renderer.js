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
    const artwork = await window.artShow.getNextArtwork();
    if (loadId !== currentLoadId) return;

    if (!artwork) {
      retryTimer = setTimeout(loadArtwork, 3000);
      return;
    }

    const imageUrl = artwork.imageSmall || artwork.imageUrl;
    await loadImage(imageUrl);
    if (loadId !== currentLoadId) return;

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
    retryTimer = setTimeout(loadArtwork, 5000);
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    img.classList.remove('loaded');
    img.classList.add('fading');

    const timeout = setTimeout(() => {
      reject(new Error('Image load timeout'));
    }, 20000);

    const tempImg = new Image();
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

  document.getElementById('artwork-container').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.artShow.showContextMenu();
  });

  document.getElementById('widget').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.artShow.showContextMenu();
  });

  await loadArtwork();
}

init();
