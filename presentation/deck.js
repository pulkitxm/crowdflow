Reveal.initialize({
  hash: true,
  controls: true,
  controlsTutorial: false,
  progress: true,
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
});

const progressCar = document.querySelector('.progress-car');

function placeProgressCar() {
  const progressBar = document.querySelector('.reveal .progress');
  if (!progressCar || !progressBar) return;

  const progress = Math.max(0, Math.min(1, Reveal.getProgress()));
  const travel = Math.max(0, progressBar.clientWidth - progressCar.offsetWidth - 12);
  progressCar.style.transform = `translateX(${progress * travel + 6}px)`;
  requestAnimationFrame(placeProgressCar);
}

Reveal.on('ready', placeProgressCar);
