for (const group of document.querySelectorAll('[role="group"]')) {
  const buttons = [...group.querySelectorAll("button[data-group]")];
  for (const button of buttons) {
    button.addEventListener("click", () => {
      const { group: key, value } = button.dataset;
      const stage = button.closest(".stage");
      for (const choice of buttons) {
        choice.setAttribute("aria-pressed", String(choice === button));
      }
      const bilingual = key === "language" && value === "both";
      if (key === "language") stage.classList.toggle("bilingual", bilingual);
      for (const panel of stage.querySelectorAll("[data-" + key + "]")) {
        panel.hidden = !bilingual && panel.dataset[key] !== value;
      }
    });
  }
}
