document.addEventListener("submit", event => {
  const message = event.target.dataset.confirm;
  if (message && !window.confirm(message)) event.preventDefault();
});

document.querySelectorAll("input[type=file][data-max-file-size]").forEach(input => {
  input.addEventListener("change", () => {
    const files = [...input.files], limit = Number(input.dataset.maxFileSize);
    const message = files.length > Number(input.dataset.maxFiles) ? "Vui lòng chọn tối đa " + input.dataset.maxFiles + " ảnh."
      : files.some(file => file.size > limit) ? "Mỗi ảnh không được vượt quá 5 MiB. Vui lòng giảm dung lượng ảnh." : "";
    input.setCustomValidity(message);
    if (message) input.reportValidity();
  });
});
