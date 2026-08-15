function updateRaceProgress(animate = true) {
  const totalSlides = Reveal.getTotalSlides();
  const currentSlide = Reveal.getSlidePastCount();
  const progress = totalSlides > 1 ? currentSlide / (totalSlides - 1) : 0;
  const travel = Math.max(0, window.innerWidth - 108) * progress;
  const car = document.querySelector(".race-progress-car");
  if (!animate && car) car.style.transition = "none";
  document.documentElement.style.setProperty("--race-progress", `${travel.toFixed(1)}px`);
  if (!animate && car) {
    car.getBoundingClientRect();
    car.style.removeProperty("transition");
  }
}

Reveal.initialize({
  hash: true,
  controls: true,
  controlsTutorial: false,
  progress: true,
  fragments: false,
  slideNumber: "c/t",
  showSlideNumber: "speaker",
  transition: "fade",
  transitionSpeed: "fast",
  backgroundTransition: "fade",
  defaultTiming: 31,
  center: false,
  width: 1600,
  height: 900,
  margin: 0.035,
  minScale: 0.15,
  maxScale: 2,
  plugins: [RevealNotes],
}).then(() => updateRaceProgress(false));

Reveal.on("slidechanged", () => updateRaceProgress(true));
window.addEventListener("resize", () => updateRaceProgress(false));
