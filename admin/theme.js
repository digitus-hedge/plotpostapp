// Runs before the page draws, so a saved light/dark choice doesn't flash.
try {
  const saved = localStorage.getItem("plotpost_admin_theme");
  if (saved === "dark" || saved === "light") document.documentElement.dataset.theme = saved;
} catch (error) {
  // Storage blocked: follow the device setting.
}
