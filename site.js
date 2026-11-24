const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function reveal(element, distance, duration) {
  if (!element || reducedMotion.matches) return;
  element.getAnimations().forEach(animation => animation.cancel());
  element.animate([
    {opacity: 0.3, transform: `translateY(${distance}px)`},
    {opacity: 1, transform: "translateY(0)"}
  ], {duration, easing: "cubic-bezier(.22,.8,.26,1)"});
}

function showAnnotation(stage) {
  if (reducedMotion.matches) return;
  const mark = stage.querySelector("mark");
  mark.getAnimations().forEach(animation => animation.cancel());
  mark.animate([{backgroundSize: "0% 100%"}, {backgroundSize: "100% 100%"}],
    {duration: 460, easing: "ease-out"});
  reveal(stage.querySelector(".margin > :not([hidden])"), 6, 390);
}

for (const group of document.querySelectorAll('[role="group"]')) {
  const buttons = [...group.querySelectorAll("button[data-group]")];
  for (const button of buttons) {
    button.addEventListener("click", () => {
      if (button.getAttribute("aria-pressed") === "true") return;
      const {group: key, value} = button.dataset;
      const stage = button.closest(".stage");
      const bilingual = key === "language" && value === "both";
      for (const choice of buttons) {
        choice.setAttribute("aria-pressed", String(choice === button));
      }
      if (key === "language") stage.classList.toggle("bilingual", bilingual);
      for (const panel of stage.querySelectorAll("[data-" + key + "]")) {
        panel.hidden = !bilingual && panel.dataset[key] !== value;
        if (!panel.hidden && key !== "action") reveal(panel, 3, 210);
      }
      if (key === "action") showAnnotation(stage);
    });
  }
}

if ("IntersectionObserver" in window && !reducedMotion.matches) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      if (entry.target.matches(".reading")) showAnnotation(entry.target);
      else reveal(entry.target, 0, 360);
      observer.unobserve(entry.target);
    }
  }, {threshold: 0.22});
  for (const element of document.querySelectorAll(".sample-paper, .reading")) observer.observe(element);
}
