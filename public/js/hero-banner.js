/**
 * NPC Esports - Hero Banner Showcase & Dynamic Slideshow Engine
 * -------------------------------------------------------------
 * Features:
 *  - Silent 5-second background countdown (zero HUD clutter)
 *  - Smooth corner gliding animation: Title/Description -> Bottom-Left, Button -> Bottom-Right
 *  - Dynamic Slide Text: Heading & Subtext cross-fade on every slide change to reflect the active banner
 *  - Admin Panel synchronized: Media, Title, and Description entered by admin render live
 *  - Mobile touch swipe navigation
 *  - Unobstructed center stage for videos and images
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
    heading: 'Join Competitive Esports Tournaments',
    subtext: 'Play. Compete. Win Rewards.',
    btnText: 'Explore Our Socials'
  },
  {
    id: 'banner-championship',
    type: 'image',
    url: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1920&q=80',
    heading: 'BGMI & Free Fire Grand Championship',
    subtext: 'Daily Squad Battles • ₹50,000 Grand Prize Pool',
    btnText: 'Explore Our Socials'
  },
  {
    id: 'banner-cashout',
    type: 'image',
    url: 'https://images.unsplash.com/photo-1560253023-3ec5d502959f?auto=format&fit=crop&w=1920&q=80',
    heading: 'Automated Room Verification & Fast Payouts',
    subtext: 'Direct UPI, Paytm & Bank Transfers with Zero Delay',
    btnText: 'Explore Our Socials'
  },
  {
    id: 'banner-video-highlight',
    type: 'video',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    poster: 'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?auto=format&fit=crop&w=1920&q=80',
    heading: 'Stream Highlights & Pro Tournaments',
    subtext: 'Watch Live Broadcasts & Match Highlights',
    btnText: 'Explore Our Socials'
  }
];

const INTRO_DELAY_MS = 5000;    // 5 seconds silent background countdown before showcase starts
const SLIDE_DURATION_MS = 6000; // 6 seconds per banner slide in showcase mode

let currentSlideIndex = 0;
let isShowcaseActive = false;
let introTimerId = null;
let slideIntervalId = null;
let isHovered = false;
let activeBanners = [...DEFAULT_BANNERS];

// DOM Elements cache
let heroSection, sliderContainer, indicatorsContainer, prevBtn, nextBtn, headingEl, subtextEl, heroBtn;

function initHeroBannerEngine() {
  heroSection = document.getElementById('home');
  if (!heroSection) return;

  sliderContainer = document.getElementById('heroSlider');
  indicatorsContainer = document.getElementById('heroIndicators');
  prevBtn = document.getElementById('heroPrevBtn');
  nextBtn = document.getElementById('heroNextBtn');
  headingEl = document.getElementById('heroMainHeading');
  subtextEl = document.getElementById('heroMainSubtext');
  heroBtn = document.getElementById('heroMainBtn');

  if (heroBtn) {
    heroBtn.textContent = 'Explore Our Socials';
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

  // Start real-time Firestore sync with Admin Panel hero_banners
  listenToFirestoreBanners();

  // Initialize initial banner text
  updateSlideText(0);

  // Start silent 5-second background countdown
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

    if (Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY)) {
      if (diffX > 0) {
        goToNextSlide();
      } else {
        goToPrevSlide();
      }
      if (isShowcaseActive) startSlideShowLoop();
    }
  }, { passive: true });
}

/**
 * Starts the silent 5-second background countdown timer.
 * No visible HUD or progress bar is displayed.
 */
function startIntroCountdown() {
  clearTimeout(introTimerId);
  clearInterval(slideIntervalId);

  isShowcaseActive = false;
  heroSection.classList.remove('hero-showcase-active');

  introTimerId = setTimeout(() => {
    triggerShowcaseMode();
  }, INTRO_DELAY_MS);
}

/**
 * Triggers the transition into showcase mode:
 *  - Adds class .hero-showcase-active to .hero
 *  - Heading/Subtext glides to Bottom-Left corner
 *  - Button glides to Bottom-Right corner
 *  - Center stage is 100% unobstructed
 *  - Slideshow starts auto-rotating
 */
function triggerShowcaseMode() {
  isShowcaseActive = true;
  heroSection.classList.add('hero-showcase-active');

  playActiveSlideVideo(currentSlideIndex);
  startSlideShowLoop();
}

function startSlideShowLoop() {
  clearInterval(slideIntervalId);

  slideIntervalId = setInterval(() => {
    if (!isHovered && isShowcaseActive) {
      goToNextSlide();
    }
  }, SLIDE_DURATION_MS);
}

/**
 * Smoothly updates the Title and Description in the bottom-left card
 * to match the currently displayed banner slide (as entered in the Admin Panel)
 */
function updateSlideText(index) {
  if (!headingEl || !subtextEl) return;
  const banner = activeBanners[index];
  if (!banner) return;

  const targetHeading = banner.heading || banner.title || 'Join Competitive Esports Tournaments';
  const targetSubtext = banner.subtext || banner.description || 'Play. Compete. Win Rewards.';
  const targetBtnText = banner.btnText || 'Explore Our Socials';

  // Smooth cross-fade transition
  headingEl.style.opacity = '0';
  subtextEl.style.opacity = '0';

  setTimeout(() => {
    headingEl.textContent = targetHeading;
    subtextEl.textContent = targetSubtext;
    if (heroBtn && targetBtnText) {
      heroBtn.textContent = targetBtnText;
    }
    headingEl.style.opacity = '1';
    subtextEl.style.opacity = '1';
  }, 220);
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

  // Dynamically synchronize the Title & Description to match the active slide
  updateSlideText(currentSlideIndex);

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
      console.debug("[Hero Banner] Firestore sync notice:", err);
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
        </div>
      `;
    } else {
      slidesHtml += `
        <div class="hero-slide ${isActive ? 'active' : ''}" data-index="${idx}">
          <div class="hero-slide-bg" style="background-image: url('${b.url}');"></div>
          <div class="hero-slide-overlay"></div>
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

  // Update text with active slide data
  updateSlideText(currentSlideIndex);

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
