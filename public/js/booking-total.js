(() => {
  const form = document.querySelector("[data-booking-review]");
  if (!form) return;
  function update() {
    const quantity = form.hasAttribute("data-quick-total") ? Math.max(1, Math.min(20, Number(form.elements.quantity.value) || 1)) : 1;
    const base = Number(form.dataset.baseTotal) * quantity;
    const extra = [...form.querySelectorAll(".option-checkbox:checked")].reduce((sum, input) => sum + Number(input.dataset.price), 0);
    document.querySelectorAll("[data-final-total]").forEach(el => { el.textContent = (base + extra).toLocaleString("ja-JP"); });
  }
  form.addEventListener("input", update); form.addEventListener("change", update); update();
})();
