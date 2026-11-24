const previews = {
  read: ["read", "Nota 阅读器，目录在左侧，语言切换位于正文上方", "在中文、英文和中英对照之间切换，接着上一句往下读。"],
  note: ["note", "高亮的选文和与其对应的两条页边批注", "在句子旁边记下疑问，点开已有批注还可以接着回复。"],
  ask: ["ask", "对话输入框里带有两处可独立移除的选文", "把几处选文放进同一个问题，一起交给 Agent。"]
};
for (const button of document.querySelectorAll("[data-mode]")) {
  button.addEventListener("click", () => {
    for (const tab of document.querySelectorAll("[data-mode]")) tab.setAttribute("aria-pressed", String(tab === button));
    const [file, alt, caption] = previews[button.dataset.mode];
    const image = document.getElementById("shot");
    image.src = "assets/" + file + ".webp";
    image.alt = alt;
    document.getElementById("caption").textContent = caption;
  });
}
