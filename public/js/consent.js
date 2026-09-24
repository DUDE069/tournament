document.addEventListener('DOMContentLoaded', () => {
    const banner = document.getElementById('dpdpConsentBanner');
    const acceptBtn = document.getElementById('dpdpAcceptBtn');
    const declineBtn = document.getElementById('dpdpDeclineBtn');

    if (!banner || !acceptBtn || !declineBtn) return;

    // Show banner if no consent is recorded
    const currentConsent = localStorage.getItem('user_dpdp_consent');
    if (!currentConsent) {
        banner.style.display = 'flex';
    } else {
        banner.style.display = 'none';
    }

    // Handle Accept
    acceptBtn.addEventListener('click', () => {
        localStorage.setItem('user_dpdp_consent', 'granted');
        banner.style.display = 'none';
    });

    // Handle Decline
    declineBtn.addEventListener('click', () => {
        localStorage.setItem('user_dpdp_consent', 'denied');
        banner.style.display = 'none';
    });
});

window.showDpdpBanner = function(forceShow = false) {
    const banner = document.getElementById('dpdpConsentBanner');
    if (banner) {
        if (forceShow) {
            localStorage.removeItem('user_dpdp_consent');
            banner.style.display = 'flex';
        }
    }
};
