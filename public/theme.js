// Theme toggle: daylight (default) or sunset. A per-viewer display preference, kept in localStorage.
(function () {
  var KEY = "coworking-theme";
  var root = document.documentElement;

  function read() {
    try {
      return localStorage.getItem(KEY) === "sunset" ? "sunset" : "daylight";
    } catch (e) {
      return "daylight";
    }
  }

  function apply(theme) {
    if (theme === "sunset") root.setAttribute("data-theme", "sunset");
    else root.removeAttribute("data-theme");
  }

  // Runs in <head>, so the theme is set before first paint
  apply(read());

  // The button exists from the start so app.js can place it inside the auth bar
  var btn = document.createElement("button");
  btn.type = "button";
  btn.id = "theme-toggle";

  function sync() {
    var sunset = read() === "sunset";
    btn.textContent = sunset ? "\u{1F307}" : "\u{1F3D9}\uFE0F";
    btn.title = sunset ? "Switch to daylight" : "Switch to sunset";
    btn.setAttribute("aria-label", btn.title);
  }

  btn.addEventListener("click", function () {
    var next = read() === "sunset" ? "daylight" : "sunset";
    try {
      localStorage.setItem(KEY, next);
    } catch (e) {}
    apply(next);
    sync();
    window.dispatchEvent(new Event("themechange"));
  });

  sync();
  window.themeToggleBtn = btn;

  // Default sunset name color: the daylight color's hue, lifted to a pale, bright tint
  // so it reads on the dark blue panes (black -> light grey, #0000ff -> #9999ff).
  window.sunsetDefaultColor = function (hex) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex || "")) hex = "#000000";
    var r = parseInt(hex.slice(1, 3), 16) / 255;
    var g = parseInt(hex.slice(3, 5), 16) / 255;
    var b = parseInt(hex.slice(5, 7), 16) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2, s = 0, h = 0, d = max - min;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    l = Math.max(l, 0.8);
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l - c / 2;
    var rgb =
      h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
      h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return "#" + rgb.map(function (v) {
      return Math.round((v + m) * 255).toString(16).padStart(2, "0");
    }).join("");
  };

  // Pages without an auth bar (login, signup, ...): put it first in the header's right-hand links
  document.addEventListener("DOMContentLoaded", function () {
    if (btn.isConnected || document.getElementById("auth-bar")) return;
    var header = document.getElementById("site-header");
    var right = header && header.lastElementChild;
    if (right) right.insertBefore(btn, right.firstChild);
  });
})();
