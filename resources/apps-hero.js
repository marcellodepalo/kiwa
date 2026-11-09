(function () {
  document.addEventListener("DOMContentLoaded", function(event) {
    const heroContainer = document.querySelector("[data-apps-hero]");
    const toggleButtons = document.querySelectorAll("[data-apps-toggle]");
    //const pricingStoreButtonContainer = document.querySelector("[data-pricing-store-button]");
    //const userAgent = navigator.userAgent

    //let platform;
    //if (/iPhone/.test(userAgent)) {
    //  platform = "iphone";
    //} else if (/iPad/.test(userAgent)) {
    //  platform = "ipad";
    //} else {
    //  platform = "mac";
    //}

    //heroContainer.dataset.appsHero = platform;
    //pricingStoreButtonContainer.dataset.pricingStoreButton = platform;

    toggleButtons.forEach(toggleButton => {
      toggleButton.addEventListener("click", () => {
        heroContainer.dataset.appsHero = toggleButton.dataset.appsToggle;
      });
      toggleButton.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          heroContainer.dataset.appsHero = toggleButton.dataset.appsToggle;
        }
      });
    });
  });
})();