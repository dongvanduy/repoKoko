document.addEventListener("submit", event => {
  const message = event.target.dataset.confirm;
  if (message && !window.confirm(message)) event.preventDefault();
});

document.querySelectorAll("input[type=file][data-max-files]").forEach(input => {
  input.addEventListener("change", () => {
    const message = input.files.length > Number(input.dataset.maxFiles)
      ? "Vui lòng chọn tối đa " + input.dataset.maxFiles + " ảnh." : "";
    input.setCustomValidity(message);
    if (message) input.reportValidity();
  });
});
