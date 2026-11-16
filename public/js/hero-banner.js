/**
 * NPC Esports - Hero Banner Showcase & Dynamic Slideshow Engine
 * -------------------------------------------------------------
 * Features:
 *  - 5-second initial countdown with smooth progress bar
 *  - Cinematic transition: Heading/Subtext -> Bottom-Left corner
 *                          Button ("Explore Our Socials") -> Bottom-Right corner
 *  - Full, unobstructed center stage for banner images and videos
 *  - Dynamic Firestore real-time sync with Admin Panel uploads
 *  - Touch swipe gestures for mobile users
 *  - Slideshow engine supporting both image & video slides
 *  - Interactive indicators, prev/next controls, pause on hover
 *  - Replay Intro button for instant demo re-testing
 */

import { db } from "./firebase.js";
import {
  collection, query, where, orderBy, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Configurable default banners (used if Firestore collection is empty or offline)
const DEFAULT_BANNERS = [
  {
    id: 'banner-gaming-arena',
    type: 'image',
    url: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=1920&q=80',
    tag: 'LIVE PLATFORM',
    heading: 'Daily Competitive Custom Rooms',
    subtext: 'Join Top BGMI & Free Fire Squads',
    btnText: 'Explore Our Socials'
  },
  {
    id: 'banner-championship',
    type: 'image',
    url: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1920&q=80',
    tag: 'MEGA TOURNAMENT',
    heading: 'Grand Championship Arena • ₹50,000 Prize Pool',
    subtext: 'Compete for the Title & Instant Cash Rewards',
    btnText: 'Explore Our Socials'
  },
  {
    id: 'banner-cashout',
    type: 'image',
    url: 'https://images.unsplash.com/photo-1560253023-3ec5d502959f?auto=format&fit=crop&w=1920&q=80',
    tag: 'INSTANT CASHOUT',
    heading: 'Automated Room Verification & Fast Payouts',
    subtext: 'Direct UPI, Paytm & Bank Transfers',
    btnText: 'Explore Our Socials'
  },
  {
    id: 'banner-video-highlight',
    type: 'video',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    poster: 'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?auto=format&fit=crop&w=1920&q=80',
    tag: 'PRO SHOWCASE',
    heading: 'Stream Highlights & Pro Tournaments',
    subtext: 'Watch Live Broadcasts & Tournament Recaps',
    btnText: 'Explore Our Socials'
  }
];

const INTRO_DELAY_MS = 5000;    // 5 seconds initial countdown before showcase starts
const SLIDE_DURATION_MS = 6000; // 6 seconds per banner slide in showcase mode

let currentSlideIndex = 0;
let isShowcaseActive = false;
let introTimerId = null;
let introIntervalId = null;
let slideIntervalId = null;
let isHovered = false;
let introStartTime = 0;
let activeBanners = [...DEFAULT_BANNERS];

// DOM Elements cache
let heroSection, sliderContainer, timerHud, timerProgress, timerLabel, indicatorsContainer, prevBtn, nextBtn, demoReplayBtn;

function initHeroBannerEngine() {
  heroSection = document.getElementById('home');
  if (!heroSection) return;

  sliderContainer = document.getElementById('heroSlider');
  timerHud = document.getElementById('heroTimerHud');
  timerProgress = document.getElementById('heroTimerProgress');
  timerLabel = document.getElementById('heroTimerLabel');
  indicatorsContainer = document.getElementById('heroIndicators');
  prevBtn = document.getElementById('heroPrevBtn');
  nextBtn = document.getElementById('heroNextBtn');

  // Ensure hero button displays 'Explore Our Socials'
  const heroBtn = document.getElementById('heroMainBtn');
  if (heroBtn) {
    heroBtn.textContent = 'Explore Our Socials';
  }

  // Create Replay button in HUD if not existing
  if (timerHud && !document.getElementById('heroDemoReplayBtn')) {
    demoReplayBtn = document.createElement('button');
    demoReplayBtn.id = 'heroDemoReplayBtn';
    demoReplayBtn.className = 'hero-demo-replay-btn';
    demoReplayBtn.innerHTML = '↺ Replay Intro';
    demoReplayBtn.title = 'Replay the 5s intro animation';
    demoReplayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      resetToInitialState();
    });
    timerHud.appendChild(demoReplayBtn);
  } else {
    demoReplayBtn = document.getElementById('heroDemoReplayBtn');
  }

  // Attach indicator click events
  setupIndicatorEvents();

  // Attach Arrow navigation events
  if (prevBtn) {
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      goToPrevSlide();
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      goToNextSlide();
    });
  }

  // Mobile Touch Gestures (Swipe Left / Swipe Right)
  setupMobileTouchGestures();

  // Pause slideshow on hover so user can read/watch undisturbed
  heroSection.addEventListener('mouseenter', () => { isHovered = true; });
  heroSection.addEventListener('mouseleave', () => { isHovered = false; });

  // Start real-time Firestore sync with Admin Panel
  listenToFirestoreBanners();

  // Start initial 5-second countdown
  startIntroCountdown();
}

/**
 * Mobile Touch Gestures (Swipe Left / Swipe Right)
 */
function setupMobileTouchGestures() {
  if (!heroSection) return;
  let touchStartX = 0;
  let touchStartY = 0;

  heroSection.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches[0]) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }
  }, { passive: true });

  heroSection.addEventListener('touchend', (e) => {
    if (!e.changedTouches || !e.changedTouches[0]) return;
    const diffX = touchStartX - e.changedTouches[0].clientX;
    const diffY = touchStartY - e.changedTouches[0].clientY;

    // Detect horizontal swipe (ignore vertical scrolling)
    if (Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY)) {
      if (diffX > 0) {
        goToNextSlide(); // Swipe left -> Next slide
      } else {
        goToPrevSlide(); // Swipe right -> Previous slide
      }
      if (isShowcaseActive) startSlideShowLoop();
    }
  }, { passive: true });
}

/**
 * Starts the initial 5-second countdown timer.
 */
function startIntroCountdown() {
  clearInterval(introIntervalId);
  clearTimeout(introTimerId);
  clearInterval(slideIntervalId);

  isShowcaseActive = false;
  heroSection.classList.remove('hero-showcase-active');

  if (timerProgress) timerProgress.style.width = '0%';
  introStartTime = performance.now();

  const updateTick = () => {
    const elapsed = performance.now() - introStartTime;
    const progress = Math.min(100, (elapsed / INTRO_DELAY_MS) * 100);
    const remainingSeconds = Math.max(0, Math.ceil((INTRO_DELAY_MS - elapsed) / 1000));

    if (timerProgress) {
      timerProgress.style.width = `${progress}%`;
    }
    if (timerLabel) {
      timerLabel.innerHTML = `Banner showcase starts in <strong style="color:#00ff88;">${remainingSeconds}</strong>s`;
    }

    if (elapsed >= INTRO_DELAY_MS) {
      clearInterval(introIntervalId);
      triggerShowcaseMode();
    }
  };

  introIntervalId = setInterval(updateTick, 50);
}

/**
 * Triggers the transition into showcase mode:
 *  - Adds class .hero-showcase-active to .hero
 *  - CSS animates Heading -> Bottom-Left, Button -> Bottom-Right
 *  - Slideshow starts auto-rotating
 */
function triggerShowcaseMode() {
  isShowcaseActive = true;
  heroSection.classList.add('hero-showcase-active');

  if (timerProgress) timerProgress.style.width = '100%';
  updateHudSlideNumber();

  // Play video on current slide if it is a video slide
  playActiveSlideVideo(currentSlideIndex);

  // Start auto-advancing slides
  startSlideShowLoop();
}

/**
 * Starts periodic slideshow transition
 */
function startSlideShowLoop() {
  clearInterval(slideIntervalId);

  slideIntervalId = setInterval(() => {
    if (!isHovered && isShowcaseActive) {
      goToNextSlide();
    }
  }, SLIDE_DURATION_MS);
}

function getTotalSlides() {
  const slides = document.querySelectorAll('.hero-slide');
  return slides.length || activeBanners.length || 4;
}

function updateHudSlideNumber() {
  if (timerLabel) {
    timerLabel.innerHTML = `<span style="color:#00ff88;font-weight:700;">Showcase Active</span> • Slide <span id="heroCurrentSlideNum">${currentSlideIndex + 1}</span>/${getTotalSlides()}`;
  }
}

function goToSlide(index) {
  const slides = document.querySelectorAll('.hero-slide');
  const dots = document.querySelectorAll('.hero-indicator-dot');
  if (!slides.length) return;

  pauseAllSlideVideos();

  currentSlideIndex = (index + slides.length) % slides.length;

  slides.forEach((slide, idx) => {
    if (idx === currentSlideIndex) {
      slide.classList.add('active');
    } else {
      slide.classList.remove('active');
    }
  });

  dots.forEach((dot, idx) => {
    if (idx === currentSlideIndex) {
      dot.classList.add('active');
    } else {
      dot.classList.remove('active');
    }
  });

  updateHudSlideNumber();
  playActiveSlideVideo(currentSlideIndex);
}

function goToNextSlide() {
  goToSlide(currentSlideIndex + 1);
}

function goToPrevSlide() {
  goToSlide(currentSlideIndex - 1);
}

function playActiveSlideVideo(slideIndex) {
  const slides = document.querySelectorAll('.hero-slide');
  if (slides[slideIndex]) {
    const video = slides[slideIndex].querySelector('video');
    if (video) {
      video.currentTime = 0;
      video.play().catch(() => {});
    }
  }
}

function pauseAllSlideVideos() {
  const videos = document.querySelectorAll('.hero-slide video');
  videos.forEach((vid) => {
    try { vid.pause(); } catch (err) {}
  });
}

function setupIndicatorEvents() {
  const dots = document.querySelectorAll('.hero-indicator-dot');
  dots.forEach((dot) => {
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetIndex = parseInt(dot.getAttribute('data-slide'), 10);
      if (!isNaN(targetIndex)) {
        goToSlide(targetIndex);
        if (isShowcaseActive) startSlideShowLoop();
      }
    });
  });
}

function resetToInitialState() {
  goToSlide(0);
  startIntroCountdown();
}

/**
 * Real-time Firestore sync with Admin Panel hero_banners collection
 */
function listenToFirestoreBanners() {
  try {
    const q = query(
      collection(db, "hero_banners"),
      where("active", "==", true),
      orderBy("order", "asc")
    );

    onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        const fetched = [];
        snapshot.forEach(docSnap => {
          fetched.push({ id: docSnap.id, ...docSnap.data() });
        });
        if (fetched.length > 0) {
          activeBanners = fetched;
          renderDynamicBanners(fetched);
        }
      }
    }, (err) => {
      console.debug("[Hero Banner] Firestore sync (using active defaults):", err);
    });
  } catch (e) {
    console.debug("[Hero Banner] Notice:", e);
  }
}

/**
 * Dynamically renders banners received from Firestore
 */
function renderDynamicBanners(banners) {
  if (!sliderContainer || !banners || banners.length === 0) return;

  let slidesHtml = "";
  let dotsHtml = "";

  banners.forEach((b, idx) => {
    const isActive = idx === currentSlideIndex;

    if (b.type === 'video') {
      slidesHtml += `
        <div class="hero-slide video-slide ${isActive ? 'active' : ''}" data-index="${idx}">
          <video class="hero-slide-video" autoplay muted loop playsinline poster="${b.poster || ''}">
            <source src="${b.url}" type="video/mp4">
          </video>
          <div class="hero-slide-overlay"></div>
          <div class="hero-slide-caption">
            <span class="hero-slide-pill"><span class="live-dot"></span> ${b.tag || 'PRO SHOWCASE'}</span>
            <h3 class="hero-slide-heading">${b.heading || 'Live Tournament Showcase'}</h3>
          </div>
        </div>
      `;
    } else {
      slidesHtml += `
        <div class="hero-slide ${isActive ? 'active' : ''}" data-index="${idx}">
          <div class="hero-slide-bg" style="background-image: url('${b.url}');"></div>
          <div class="hero-slide-overlay"></div>
          <div class="hero-slide-caption">
            <span class="hero-slide-pill"><span class="live-dot"></span> ${b.tag || 'FEATURED'}</span>
            <h3 class="hero-slide-heading">${b.heading || 'Esports Tournament'}</h3>
          </div>
        </div>
      `;
    }

    dotsHtml += `
      <button class="hero-indicator-dot ${isActive ? 'active' : ''}" data-slide="${idx}" aria-label="Slide ${idx + 1}"></button>
    `;
  });

  sliderContainer.innerHTML = slidesHtml;

  if (indicatorsContainer) {
    indicatorsContainer.innerHTML = dotsHtml;
    setupIndicatorEvents();
  }

  updateHudSlideNumber();
  if (isShowcaseActive) {
    playActiveSlideVideo(currentSlideIndex);
  }
}

// Public API
window.HeroBannerEngine = {
  resetToInitialState,
  triggerShowcaseMode,
  goToSlide,
  nextSlide: goToNextSlide,
  prevSlide: goToPrevSlide,
  renderDynamicBanners
};

// Initialize once DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initHeroBannerEngine);
} else {
  initHeroBannerEngine();
}
