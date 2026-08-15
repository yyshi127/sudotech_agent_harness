const copyButton = document.querySelector("#copy-checksum")
const checksum = document.querySelector("#checksum")

copyButton?.addEventListener("click", async () => {
  if (!checksum) return

  try {
    await navigator.clipboard.writeText(checksum.textContent.trim())
    copyButton.textContent = "已复制"
    window.setTimeout(() => {
      copyButton.textContent = "复制"
    }, 1600)
  } catch {
    copyButton.textContent = "复制失败"
  }
})
