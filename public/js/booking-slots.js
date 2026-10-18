(() => {
  const picker = document.querySelector("[data-slot-picker]");
  if (!picker) return;
  const form = picker.closest("form"), date = form.elements.date;
  const quantity = form.elements.quantity || form.elements.totalQuantity;
  const shop = form.elements.shopId, container = picker.querySelector("[data-slots]");
  const status = picker.querySelector("[data-slot-status]"), retry = picker.querySelector("[data-slot-retry]");
  const messages = JSON.parse(picker.querySelector("[data-slot-messages]").textContent);
  const buttons = Array.from(form.querySelectorAll('button[type="submit"]'));
  let controller, sequence = 0, pending = false, submitting = false;
  let desired = picker.dataset.initialTime, timer;
  function syncButtons() {
    const selected = form.querySelector('input[name="time"]:checked:not(:disabled)');
    buttons.forEach(button => { button.disabled = pending || submitting || !selected; });
  }
  async function update() {
    const request = ++sequence;
    controller?.abort(); controller = new AbortController();
    pending = true; container.replaceChildren(); retry.hidden = true; status.textContent = messages.loading; syncButtons();
    try {
      if (!date.value || !date.validity.valid || !quantity || !Number.isInteger(Number(quantity.value)) || Number(quantity.value) < 1) throw new Error(messages.generic);
      const query = new URLSearchParams({ date: date.value, shopId: shop.value, totalQuantity: quantity.value });
      const response = await fetch("/api/available-slots?" + query, { signal: controller.signal, headers: { Accept: "application/json" }, cache: "no-store" });
      const slots = await response.json();
      if (!response.ok || !Array.isArray(slots)) throw new Error(slots.error || messages.service_unavailable);
      if (request !== sequence) return;
      for (const slot of slots) {
        const label = document.createElement("label");
        label.className = "relative block";
        const input = document.createElement("input");
        input.type = "radio"; input.name = "time"; input.value = slot.time; input.required = true;
        input.disabled = !slot.isAvailable; input.checked = slot.isAvailable && slot.time === desired;
        input.className = "peer sr-only";
        const box = document.createElement("span");
        box.className = "block border border-sub1 rounded-lg py-3 text-center cursor-pointer peer-checked:bg-accent peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-disabled:opacity-40 peer-disabled:cursor-not-allowed";
        const title = document.createElement("span"); title.className = "block font-bold"; title.textContent = slot.time;
        const note = document.createElement("span"); note.className = "block text-xs mt-1";
        note.textContent = slot.reason === "past_date" ? messages.past_date : slot.isFull ? messages.full : messages.available.replace("{count}", slot.remaining);
        box.append(title, note); label.append(input, box); container.append(label);
      }
      desired = ""; status.textContent = slots.some(s => s.isAvailable) ? "" : slots.some(s => s.reason === "past_date") ? messages.past_date : messages.slot_full;
    } catch (error) {
      if (request !== sequence || error.name === "AbortError") return;
      status.textContent = error.message || messages.service_unavailable; retry.hidden = false;
    } finally {
      if (request === sequence) { pending = false; syncButtons(); }
    }
  }
  date.addEventListener("change", () => { desired = ""; update(); });
  quantity?.addEventListener("input", () => {
    desired = form.querySelector('input[name="time"]:checked')?.value || "";
    pending = true; syncButtons(); clearTimeout(timer); timer = setTimeout(update, 200);
  });
  container.addEventListener("change", syncButtons);
  retry.addEventListener("click", update);
  form.addEventListener("submit", event => {
    if (submitting || pending || !form.querySelector('input[name="time"]:checked:not(:disabled)')) { event.preventDefault(); return; }
    submitting = true; syncButtons();
  });
  window.addEventListener("pageshow", event => { if (event.persisted) { submitting = false; update(); } });
  update();
})();
