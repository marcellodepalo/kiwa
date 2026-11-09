/*
 * The colour spheres: the app's first-launch picker (ThemeKit's
 * StartupThemePicker) redrawn for the web. Flat spheres float without gravity,
 * turn slowly round the middle and push each other aside; the one picked
 * travels to the middle and grows, the one pressed shrinks and fades, and any
 * can be dragged. One family at a time, picked in the bar under them.
 *
 * Picking a colour repaints the page: the iPhone and Duo screenshots, the
 * logo and the headline's underline. The choice is remembered in the browser.
 */
(function () {
  "use strict";

  // MARK: - Constants

  const COLORS = [
    { family: "mono", name: "Arctic Frost", hex: "#FFFFFF" },
    { family: "mono", name: "Cloud Puff", hex: "#F7F7F7" },
    { family: "mono", name: "Stone Whisper", hex: "#C7C7C7" },
    { family: "mono", name: "Silver Glaze", hex: "#A4A4A4" },
    { family: "mono", name: "Pewter Shadow", hex: "#7A7A7A" },
    { family: "mono", name: "Deep Slate", hex: "#4F4F4F" },
    { family: "mono", name: "Midnight Abyss", hex: "#000000" },
    { family: "lively", name: "Royal Plum", hex: "#453381" },
    { family: "lively", name: "King's Blue", hex: "#3D54B8" },
    { family: "lively", name: "Sky Surge", hex: "#0E98DB" },
    { family: "lively", name: "Teal Stream", hex: "#00A38E" },
    { family: "lively", name: "Forest Bolt", hex: "#1A866A" },
    { family: "lively", name: "Lizard Green", hex: "#77A339" },
    { family: "lively", name: "Zesty Lime", hex: "#9FBF35" },
    { family: "lively", name: "Sunburst Gold", hex: "#F7BC23" },
    { family: "lively", name: "Fire Ember", hex: "#EA7A00" },
    { family: "lively", name: "Crimson Flare", hex: "#D82C23" },
    { family: "lively", name: "Wild Orchid", hex: "#D21C6D" },
    { family: "lively", name: "Grape Crush", hex: "#9C397D" },
    { family: "lively", name: "Astral Violet", hex: "#8353B9" },
    { family: "lively", name: "Wisteria Bloom", hex: "#9F7DBF" },
    { family: "lively", name: "Deep Sea Siren", hex: "#116EB0" },
  ].map((color) => ({ ...color, slug: slugOf(color.name) }));

  const FAMILIES = [
    { id: "mono", label: "Mono" },
    { id: "lively", label: "Lively" },
  ];

  const DEFAULT_COLOR = "Sunburst Gold";
  const STORAGE_KEY = "kiwa.themeColor";

  /** The app's sphere: 25 points, a little smaller on a phone. */
  const RADIUS = 25;
  const SMALL_RADIUS = 21;
  const SMALL_WIDTH = 520;

  /** The app's node style: picked 1.3, pressed 0.9 and faded to 0.3. */
  const FOCUSED_SCALE = 1.3;
  const PRESSED_SCALE = 0.9;
  const PRESSED_OPACITY = 0.3;

  /** The ring around the picked sphere, as `ColorNode.border`: 1.1 × radius. */
  const RING_RATIO = 1.1;

  /** How far a press moves before it is a drag rather than a pick. */
  const DRAG_SLOP = 6;

  // Motion, per frame at 60 fps.
  const SWIRL = 0.0006;
  const PULL = 0.0009;
  const FOCUS_PULL = 0.06;
  const DAMPING = 0.94;
  const RESTITUTION = 0.35;
  const SCALE_EASE = 0.18;
  const LEAVE_SPEED = 0.12;

  /** How long the screenshots take to cross-fade. */
  const FADE_MS = 450;

  // MARK: - State

  const root = document.querySelector("[data-color-spheres]");
  if (!root) return;

  const canvas = root.querySelector("canvas");
  const context = canvas.getContext("2d");
  const familyBar = root.querySelector("[data-color-families]");
  const radioGroup = root.querySelector("[data-color-radios]");
  const caption = root.querySelector("[data-color-name]");
  const reducesMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let selected = colorNamed(readStoredColor()) || colorNamed(DEFAULT_COLOR);
  let family = selected.family;
  let nodes = [];
  let leaving = [];
  let width = 0;
  let height = 0;
  let pointer = null;
  let frame = 0;
  let isVisible = true;

  // MARK: - Helpers

  function slugOf(name) {
    return name.replace(/[^A-Za-z0-9 ]/g, "").trim().replace(/ +/g, "-").toLowerCase();
  }

  function colorNamed(name) {
    return COLORS.find((color) => color.name === name);
  }

  function readStoredColor() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      return null;
    }
  }

  function storeColor(name) {
    try {
      window.localStorage.setItem(STORAGE_KEY, name);
    } catch (error) {
      // Private windows and blocked storage: the pick lasts for this visit.
    }
  }

  /** Relative luminance, to keep near-white colours visible on the white page. */
  function luminance(hex) {
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  }

  function isPale(color) {
    return luminance(color.hex) > 0.8;
  }

  function radius() {
    return width < SMALL_WIDTH ? SMALL_RADIUS : RADIUS;
  }

  // MARK: - Page

  /** Swaps a background image with a cross-fade: the old one fades on a copy. */
  function swapBackground(element, url) {
    if (!element) return;
    const image = new Image();
    image.onload = () => {
      const previous = getComputedStyle(element).backgroundImage;
      element.style.backgroundImage = `url("${url}")`;
      if (reducesMotion.matches || !previous || previous === "none") return;

      const ghost = element.cloneNode(false);
      ghost.removeAttribute("id");
      ghost.style.backgroundImage = previous;
      ghost.style.pointerEvents = "none";
      ghost.setAttribute("aria-hidden", "true");
      element.after(ghost);
      ghost
        .animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: "ease-out" })
        .finished.then(() => ghost.remove(), () => ghost.remove());
    };
    image.src = url;
  }

  function applyToPage(color) {
    const documentStyle = document.documentElement.style;
    documentStyle.setProperty("--kiwa-theme", color.hex);
    documentStyle.setProperty("--kiwa-theme-underline", isPale(color) ? "#C7C7C7" : color.hex);
    documentStyle.setProperty("--mondays-screen-fallback", color.hex);

    const shot = `${color.family}-${color.slug}.jpg`;
    swapBackground(
      document.querySelector(".media-gallery-item-iphone .positioned-media-element.startframe"),
      `./resources/assets/iphone/colors/${shot}`
    );
    swapBackground(document.querySelector(".duo-screen"), `./resources/assets/duo/colors/${shot}`);

    document.querySelectorAll("[data-theme-logo]").forEach((logo) => {
      logo.src = `./resources/icons/${color.slug}.png`;
    });

    if (caption) caption.textContent = color.name;
  }

  // MARK: - Spheres

  function makeNode(color, index, count) {
    const angle = (index / count) * Math.PI * 2;
    const spread = Math.min(width, height) * 0.32;
    return {
      color,
      r: radius(),
      x: width / 2 + Math.cos(angle) * spread * (0.6 + Math.random() * 0.4),
      y: height / 2 + Math.sin(angle) * spread * (0.6 + Math.random() * 0.4),
      vx: 0,
      vy: 0,
      scale: reducesMotion.matches ? 1 : 0,
      opacity: 1,
      isPressed: false,
      isLeaving: false,
    };
  }

  function spawn() {
    const colors = COLORS.filter((color) => color.family === family);
    nodes = colors.map((color, index) => makeNode(color, index, colors.length));
    if (reducesMotion.matches) arrangeStill();
  }

  /** Reduced motion: the family laid out still, in rows. */
  function arrangeStill() {
    const r = radius();
    const gap = r * 2.9;
    const perRow = Math.max(1, Math.floor((width - r) / gap));
    const rows = Math.ceil(nodes.length / perRow);
    nodes.forEach((node, index) => {
      const row = Math.floor(index / perRow);
      const inRow = Math.min(perRow, nodes.length - row * perRow);
      const column = index % perRow;
      node.x = width / 2 + (column - (inRow - 1) / 2) * gap;
      node.y = height / 2 + (row - (rows - 1) / 2) * gap;
      node.vx = 0;
      node.vy = 0;
    });
  }

  function switchFamily(next) {
    if (next === family) return;
    family = next;
    leaving = reducesMotion.matches ? [] : nodes.map((node) => ({ ...node, isLeaving: true }));
    spawn();
    renderFamilyBar();
    renderRadios();
    requestFrame();
  }

  function select(color) {
    selected = color;
    storeColor(color.name);
    applyToPage(color);
    if (color.family !== family) switchFamily(color.family);
    renderRadios();
    requestFrame();
  }

  function step() {
    const cx = width / 2;
    const cy = height / 2;
    const isStill = reducesMotion.matches;

    nodes.forEach((node) => {
      const isPicked = node.color === selected;
      const isDragged = pointer && pointer.node === node && pointer.isDragging;

      const targetScale = node.isPressed ? PRESSED_SCALE : isPicked ? FOCUSED_SCALE : 1;
      const targetOpacity = node.isPressed ? PRESSED_OPACITY : 1;
      node.scale += (targetScale - node.scale) * (isStill ? 1 : SCALE_EASE);
      node.opacity += (targetOpacity - node.opacity) * (isStill ? 1 : SCALE_EASE);

      if (isStill || isDragged) return;

      const dx = node.x - cx;
      const dy = node.y - cy;
      if (isPicked) {
        node.vx += -dx * FOCUS_PULL;
        node.vy += -dy * FOCUS_PULL;
      } else {
        // Round the middle, as the app turns its nodes, and held near it.
        node.vx += -dy * SWIRL - dx * PULL;
        node.vy += dx * SWIRL - dy * PULL;
      }
      node.vx *= DAMPING;
      node.vy *= DAMPING;
      node.x += node.vx;
      node.y += node.vy;
    });

    if (!isStill) collide();

    leaving = leaving.filter((node) => {
      node.scale -= LEAVE_SPEED;
      node.x += (node.x - cx) * 0.08;
      node.y += (node.y - cy) * 0.08;
      return node.scale > 0;
    });
  }

  function isHeld(node) {
    return node.color === selected || Boolean(pointer && pointer.node === node);
  }

  function collide() {
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const reach = a.r * a.scale + b.r * b.scale + 2;
        const distance = Math.hypot(dx, dy) || 0.01;
        if (distance >= reach) continue;

        const nx = dx / distance;
        const ny = dy / distance;
        const overlap = reach - distance;
        // The picked and the dragged sphere hold their ground.
        const aHeld = isHeld(a);
        const bHeld = isHeld(b);
        const aShare = aHeld && !bHeld ? 0.1 : bHeld && !aHeld ? 0.9 : 0.5;
        a.x -= nx * overlap * aShare;
        a.y -= ny * overlap * aShare;
        b.x += nx * overlap * (1 - aShare);
        b.y += ny * overlap * (1 - aShare);

        const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (relative < 0) {
          const impulse = -(1 + RESTITUTION) * relative * 0.5;
          a.vx -= impulse * nx;
          a.vy -= impulse * ny;
          b.vx += impulse * nx;
          b.vy += impulse * ny;
        }
      }
    }

    nodes.forEach((node) => {
      const r = node.r * node.scale;
      if (node.x < r) { node.x = r; node.vx = Math.abs(node.vx) * RESTITUTION; }
      if (node.x > width - r) { node.x = width - r; node.vx = -Math.abs(node.vx) * RESTITUTION; }
      if (node.y < r) { node.y = r; node.vy = Math.abs(node.vy) * RESTITUTION; }
      if (node.y > height - r) { node.y = height - r; node.vy = -Math.abs(node.vy) * RESTITUTION; }
    });
  }

  function drawRing(node, r, offset, color, dash) {
    context.beginPath();
    context.arc(node.x, node.y, r * RING_RATIO + offset, 0, Math.PI * 2);
    context.setLineDash(dash);
    context.lineWidth = 2;
    context.strokeStyle = color;
    context.stroke();
    context.setLineDash([]);
  }

  function draw() {
    context.clearRect(0, 0, width, height);
    const focused = focusedRadioColor();

    [...leaving, ...nodes].forEach((node) => {
      const r = node.r * Math.max(node.scale, 0);
      if (r <= 0) return;
      context.globalAlpha = node.opacity;

      context.beginPath();
      context.arc(node.x, node.y, r, 0, Math.PI * 2);
      context.fillStyle = node.color.hex;
      context.fill();
      if (isPale(node.color)) {
        context.lineWidth = 1;
        context.strokeStyle = "rgba(0, 0, 0, 0.14)";
        context.stroke();
      }

      if (node.isLeaving) return;
      if (node.color === selected) {
        drawRing(node, r, 3, isPale(node.color) ? "#C7C7C7" : node.color.hex, []);
      }
      if (node.color === focused) {
        drawRing(node, r, 8, "#444444", [4, 4]);
      }
    });
    context.globalAlpha = 1;
  }

  /** Still once nothing moves: with reduced motion, after its one redraw. */
  function isSettled() {
    return reducesMotion.matches && leaving.length === 0;
  }

  function tick() {
    frame = 0;
    if (!isVisible || document.hidden) return;
    step();
    draw();
    if (!isSettled() || pointer) requestFrame();
  }

  function requestFrame() {
    if (!frame) frame = window.requestAnimationFrame(tick);
  }

  // MARK: - Size

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = window.devicePixelRatio || 1;
    const oldWidth = width;
    const oldHeight = height;
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    if (!nodes.length) {
      spawn();
    } else {
      const r = radius();
      nodes.forEach((node) => {
        node.r = r;
        if (oldWidth && oldHeight) {
          node.x *= width / oldWidth;
          node.y *= height / oldHeight;
        }
      });
      if (reducesMotion.matches) arrangeStill();
    }
    requestFrame();
  }

  // MARK: - Pointer

  function nodeAt(x, y) {
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const node = nodes[i];
      if (Math.hypot(node.x - x, node.y - y) <= node.r * Math.max(node.scale, 1) + 4) return node;
    }
    return null;
  }

  function localPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  canvas.addEventListener("pointerdown", (event) => {
    const point = localPoint(event);
    const node = nodeAt(point.x, point.y);
    if (!node) return;
    canvas.setPointerCapture(event.pointerId);
    node.isPressed = true;
    pointer = { node, startX: point.x, startY: point.y, lastX: point.x, lastY: point.y, isDragging: false };
    requestFrame();
  });

  canvas.addEventListener("pointermove", (event) => {
    const point = localPoint(event);
    if (!pointer) {
      canvas.style.cursor = nodeAt(point.x, point.y) ? "pointer" : "default";
      return;
    }
    const moved = Math.hypot(point.x - pointer.startX, point.y - pointer.startY);
    if (!pointer.isDragging && moved > DRAG_SLOP && !reducesMotion.matches) {
      pointer.isDragging = true;
      pointer.node.isPressed = false;
    }
    if (pointer.isDragging) {
      const node = pointer.node;
      node.vx = (point.x - pointer.lastX) * 0.6;
      node.vy = (point.y - pointer.lastY) * 0.6;
      node.x = Math.min(Math.max(point.x, node.r), width - node.r);
      node.y = Math.min(Math.max(point.y, node.r), height - node.r);
    }
    pointer.lastX = point.x;
    pointer.lastY = point.y;
    requestFrame();
  });

  function endPointer(event, isCancelled) {
    if (!pointer) return;
    const { node, isDragging } = pointer;
    node.isPressed = false;
    pointer = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (!isCancelled && !isDragging) select(node.color);
    requestFrame();
  }

  canvas.addEventListener("pointerup", (event) => endPointer(event, false));
  canvas.addEventListener("pointercancel", (event) => endPointer(event, true));

  // MARK: - Controls

  /** The families, as the bar under the app's spheres. */
  function renderFamilyBar() {
    familyBar.querySelectorAll("button").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.family === family));
    });
  }

  function buildFamilyBar() {
    FAMILIES.forEach(({ id, label }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "color-family";
      button.dataset.family = id;
      button.textContent = label;
      button.addEventListener("click", () => switchFamily(id));
      familyBar.append(button);
    });
    renderFamilyBar();
  }

  /**
   * The spheres for the keyboard and screen readers: a radio group of the
   * family on show, kept off screen, its focus drawn on the canvas.
   */
  function renderRadios() {
    const hadFocus = radioGroup.contains(document.activeElement);
    radioGroup.replaceChildren();
    COLORS.filter((color) => color.family === family).forEach((color) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "kiwa-color";
      input.value = color.name;
      input.checked = color === selected;
      input.addEventListener("change", () => select(color));
      input.addEventListener("focus", requestFrame);
      input.addEventListener("blur", requestFrame);
      label.append(input, document.createTextNode(color.name));
      radioGroup.append(label);
    });
    if (hadFocus) {
      const checked = radioGroup.querySelector("input:checked") || radioGroup.querySelector("input");
      if (checked) checked.focus();
    }
  }

  function focusedRadioColor() {
    const active = document.activeElement;
    if (!active || active.name !== "kiwa-color") return null;
    return colorNamed(active.value);
  }

  // MARK: - Start

  buildFamilyBar();
  renderRadios();
  applyToPage(selected);
  resize();

  new ResizeObserver(resize).observe(canvas.parentElement);

  new IntersectionObserver((entries) => {
    isVisible = entries.some((entry) => entry.isIntersecting);
    if (isVisible) requestFrame();
  }).observe(canvas);

  document.addEventListener("visibilitychange", requestFrame);

  reducesMotion.addEventListener("change", () => {
    leaving = [];
    nodes.forEach((node) => { node.scale = 1; });
    if (reducesMotion.matches) arrangeStill();
    requestFrame();
  });
})();
