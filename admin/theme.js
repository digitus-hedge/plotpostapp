// Runs before the page draws, so a saved light/dark or Light/Vibrant choice doesn't flash.
try {
  const saved = localStorage.getItem("plotpost_admin_theme");
  if (saved === "dark" || saved === "light") document.documentElement.dataset.theme = saved;
  const look = localStorage.getItem("plotpost_admin_look");
  if (look === "vibrant") document.documentElement.dataset.look = "vibrant";
} catch (error) {
  // Storage blocked: follow the device setting and the Light look.
}
