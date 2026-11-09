/*
 * The colour spheres: the app's first-launch picker redrawn for the web, laid
 * over the whole gallery as the app lays it over its screen.
 *
 * It follows ThemeKit (ColorPaletteScene, ColorsContainerNode, ColorNode,
 * StartupThemePicker) rather than inventing its own motion:
 * - no gravity; every sphere but the focused one is pushed each frame towards
 *   a circle of three radii round the middle, turned 20°, at radius × 5 with a
 *   little noise — `rotateNodes(exceptFor:multiplier:)`;
 * - a sphere tapped is focused: it is driven to the middle at 1000 points a
 *   second, smoothed at 0.8, and once there it stops and becomes static, so
 *   the others bounce off it and cannot move it — `update(_:)`;
 * - collisions are elastic between equal bodies (density radius × 3), with
 *   SpriteKit's restitution of 0.2, against each other and the edges;
 * - pressed, a sphere shrinks to 0.9 and fades to 0.3 over 0.2 s; picked, it
 *   keeps its size — `NoNameNodeStyle`, without the focus growth;
 * - spheres bubble in (0 → 1.1 → 1, staggered up to 0.4 s) and the family
 *   leaving goes out along its own line, shrinking, in 0.3 s.
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

  /** `ColorNode`'s radius: 25 points, a little smaller on a phone. */
  const RADIUS = 25;
  const SMALL_RADIUS = 20;
  const SMALL_WIDTH = 520;

  /** `rotateNodes`: the circle the spheres are pushed round, in radii. */
  const ORBIT_RADII = 3;
  /** `circularShiftRadians`, -20° in SpriteKit's y-up space: +20° here. */
  const ORBIT_SHIFT = (20 * Math.PI) / 180;
  /** `StartupThemePicker`'s rotation multiplier, and the spawn kick's. */
  const ROTATION_MULTIPLIER = 5;
  const SPAWN_KICK_MULTIPLIER = 6;
  const ROTATION_NOISE = 5;

  /**
   * SpriteKit's force to this page's acceleration, per frame at 60 fps, and
   * how much speed each frame keeps: slow, as the app's spheres drift.
   */
  const FORCE_TO_ACCELERATION = 0.00011;
  const DAMPING = 0.97;

  /** `StartupThemePicker.focus(speed: 1000)`, `FocusSettings` rate 0.8. */
  const FOCUS_SPEED = 1000 / 60;
  const FOCUS_SMOOTHING = 0.8;
  /** Within this, the focused sphere stops and settles in 0.2 s. */
  const FOCUS_ARRIVAL = 10;
  const FOCUS_SETTLE_MS = 200;

  /** SpriteKit's default restitution. */
  const RESTITUTION = 0.2;

  /** `NoNameNodeStyle` while pressed, over `scaleFade`'s 0.2 s. */
  const PRESSED_SCALE = 0.9;
  const PRESSED_OPACITY = 0.3;
  const PRESS_MS = 200;

  /** `StartUpModifier`: a wait up to 0.4 s, 0.4 s to 1.1, 0.2 s back to 1. */
  const STARTUP_WAIT_MS = 400;
  const STARTUP_UP_MS = 400;
  const STARTUP_DOWN_MS = 200;
  const STARTUP_OVERSHOOT = 1.1;

  /** `ColorPaletteScene.dismissDuration`, and the kick's wait and length. */
  const DISMISS_MS = 300;
  const SPAWN_KICK_DELAY_MS = 250;
  const SPAWN_KICK_MS = 400;

  /** How far a press moves before it is a drag rather than a pick. */
  const DRAG_SLOP = 6;

  /** How long the screenshots take to cross-fade. */
  const FADE_MS = 450;

  // MARK: - State

  const stage = document.querySelector("[data-color-spheres]");
  if (!stage) return;

  const canvas = stage.querySelector("canvas");
  const context = canvas.getContext("2d");
  const familyBar = document.querySelector("[data-color-families]");
  const radioGroup = document.querySelector("[data-color-radios]");
  const caption = document.querySelector("[data-color-name]");
  const reducesMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let selected = colorNamed(readStoredColor()) || colorNamed(DEFAULT_COLOR);
  let family = selected.family;
  let nodes = [];
  let leaving = [];
  let focusedNode = null;
  let width = 0;
  let height = 0;
  let pointer = null;
  let frame = 0;
  let lastTime = 0;
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

  /** Relative luminance, to keep near-white colours visible. */
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

  function now() {
    return performance.now();
  }

  /** A value eased from `from` to `to` between `start` and `start + duration`. */
  function tween(from, to, start, duration, ease = (t) => t) {
    return { from, to, start, duration, ease };
  }

  function tweenValue(t, time) {
    if (!t) return null;
    const progress = Math.min(Math.max((time - t.start) / t.duration, 0), 1);
    return t.from + (t.to - t.from) * t.ease(progress);
  }

  const easeIn = (t) => t * t;
  const easeOut = (t) => 1 - (1 - t) * (1 - t);

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

  // MARK: - Spawning

  /**
   * `generateSpawnPositions`: a grid over the middle half of the stage, less
   * 40 points, shuffled — so the family starts loosely round the middle.
   */
  function spawnPositions(count, r) {
    const halfWidth = Math.max(width / 2 - 40, r * 2);
    const halfHeight = Math.max(height / 2 - 40, r * 2);
    const step = r * 2 * 1.1;
    const positions = [];
    for (let y = -halfHeight; y <= halfHeight; y += step) {
      for (let x = -halfWidth; x <= halfWidth; x += step) {
        positions.push({ x: width / 2 + x, y: height / 2 + y });
      }
    }
    for (let i = positions.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }
    return positions.slice(0, count);
  }

  function spawn() {
    const colors = COLORS.filter((color) => color.family === family);
    const r = radius();
    const positions = spawnPositions(colors.length, r);
    const time = now();
    focusedNode = null;

    nodes = colors.map((color, index) => {
      const position = positions[index] || { x: width / 2, y: height / 2 };
      const wait = Math.random() * STARTUP_WAIT_MS;
      return {
        color,
        r,
        x: position.x,
        y: position.y,
        vx: 0,
        vy: 0,
        isStatic: false,
        isPressed: false,
        scaleTween: reducesMotion.matches
          ? null
          : [
              tween(0, STARTUP_OVERSHOOT, time + wait, STARTUP_UP_MS, easeOut),
              tween(STARTUP_OVERSHOOT, 1, time + wait + STARTUP_UP_MS, STARTUP_DOWN_MS, easeOut),
            ],
        opacityTween: reducesMotion.matches ? null : tween(0, 1, time + wait, STARTUP_UP_MS),
        kickStart: time + SPAWN_KICK_DELAY_MS,
        settle: null,
      };
    });

    if (reducesMotion.matches) arrangeStill();
  }

  /** Reduced motion: the family laid out still, in rows across the middle. */
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

  /** `dismissColorNodes`: out along the line from the middle, shrinking. */
  function dismiss() {
    if (reducesMotion.matches) {
      leaving = [];
      return;
    }
    const time = now();
    const travel = Math.max(width, height);
    leaving = nodes.map((node) => {
      let dx = node.x - width / 2;
      let dy = node.y - height / 2;
      const length = Math.hypot(dx, dy);
      if (length < 1) {
        const angle = Math.random() * Math.PI * 2;
        dx = Math.cos(angle);
        dy = Math.sin(angle);
      } else {
        dx /= length;
        dy /= length;
      }
      return {
        color: node.color,
        r: node.r,
        fromX: node.x,
        fromY: node.y,
        toX: node.x + dx * travel,
        toY: node.y + dy * travel,
        start: time,
      };
    });
  }

  function switchFamily(next) {
    if (next === family) return;
    family = next;
    dismiss();
    spawn();
    renderFamilyBar();
    renderRadios();
    requestFrame();
  }

  // MARK: - Selection

  /** `handleTouch`: the sphere tapped becomes the selected and focused one. */
  function focus(node) {
    if (focusedNode && focusedNode !== node) {
      focusedNode.isStatic = false;
      focusedNode.settle = null;
    }
    focusedNode = node;
    node.isStatic = false;
    node.didReachFocus = false;
    select(node.color);
  }

  function select(color) {
    selected = color;
    storeColor(color.name);
    applyToPage(color);
    if (color.family !== family) {
      switchFamily(color.family);
    } else {
      renderRadios();
    }
    requestFrame();
  }

  // MARK: - Motion

  function rotationForce(node, multiplier) {
    const px = node.x - width / 2;
    const py = node.y - height / 2;
    const rx = px * Math.cos(ORBIT_SHIFT) - py * Math.sin(ORBIT_SHIFT);
    const ry = px * Math.sin(ORBIT_SHIFT) + py * Math.cos(ORBIT_SHIFT);
    const rLength = Math.hypot(rx, ry) || 1;
    const inner = node.r * ORBIT_RADII;
    const tx = (rx / rLength) * inner - px;
    const ty = (ry / rLength) * inner - py;
    const tLength = Math.hypot(tx, ty) || 1;
    const speed = node.r * multiplier;
    return {
      x: (tx / tLength) * speed + (Math.random() * 2 - 1) * ROTATION_NOISE,
      y: (ty / tLength) * speed + (Math.random() * 2 - 1) * ROTATION_NOISE,
    };
  }

  function moveFocused(node, f, time) {
    if (node.settle) {
      const progress = Math.min((time - node.settle.start) / FOCUS_SETTLE_MS, 1);
      node.x = node.settle.fromX + (width / 2 - node.settle.fromX) * progress;
      node.y = node.settle.fromY + (height / 2 - node.settle.fromY) * progress;
      return;
    }

    const dx = width / 2 - node.x;
    const dy = height / 2 - node.y;
    const distance = Math.hypot(dx, dy);
    if (distance < FOCUS_ARRIVAL) {
      // Arrived: static from here, settled on the middle in 0.2 s.
      node.isStatic = true;
      node.vx = 0;
      node.vy = 0;
      node.settle = { fromX: node.x, fromY: node.y, start: time };
      return;
    }

    const targetX = (dx / distance) * FOCUS_SPEED;
    const targetY = (dy / distance) * FOCUS_SPEED;
    node.vx += (targetX - node.vx) * FOCUS_SMOOTHING;
    node.vy += (targetY - node.vy) * FOCUS_SMOOTHING;
    node.x += node.vx * f;
    node.y += node.vy * f;
  }

  function step(f, time) {
    const isStill = reducesMotion.matches;

    nodes.forEach((node) => {
      const isDragged = pointer && pointer.node === node && pointer.isDragging;
      if (isStill || isDragged) return;

      if (node === focusedNode) {
        // Pushed off the middle by a drag, it heads back as SpriteKit's does.
        if (node.isStatic && Math.hypot(node.x - width / 2, node.y - height / 2) > FOCUS_ARRIVAL * 2) {
          node.isStatic = false;
          node.settle = null;
        }
        if (!node.isStatic || node.settle) moveFocused(node, f, time);
        return;
      }

      const isKicking = time >= node.kickStart && time < node.kickStart + SPAWN_KICK_MS;
      const force = rotationForce(node, ROTATION_MULTIPLIER);
      let ax = force.x * FORCE_TO_ACCELERATION;
      let ay = force.y * FORCE_TO_ACCELERATION;
      if (isKicking) {
        const kick = rotationForce(node, SPAWN_KICK_MULTIPLIER);
        ax += kick.x * FORCE_TO_ACCELERATION * 4;
        ay += kick.y * FORCE_TO_ACCELERATION * 4;
      }
      node.vx = (node.vx + ax * f) * DAMPING ** f;
      node.vy = (node.vy + ay * f) * DAMPING ** f;
      node.x += node.vx * f;
      node.y += node.vy * f;
    });

    if (!isStill) collide();

    leaving = leaving.filter((node) => time - node.start < DISMISS_MS);
  }

  /** Whether a sphere is moved by collisions: not the static or dragged one. */
  function inverseMass(node) {
    if (node.isStatic) return 0;
    if (pointer && pointer.node === node && pointer.isDragging) return 0;
    return 1;
  }

  function collide() {
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const reach = a.r + b.r;
        const distance = Math.hypot(dx, dy) || 0.01;
        if (distance >= reach) continue;

        const imA = inverseMass(a);
        const imB = inverseMass(b);
        const imSum = imA + imB;
        if (imSum === 0) continue;

        const nx = dx / distance;
        const ny = dy / distance;
        const overlap = reach - distance;
        a.x -= nx * overlap * (imA / imSum);
        a.y -= ny * overlap * (imA / imSum);
        b.x += nx * overlap * (imB / imSum);
        b.y += ny * overlap * (imB / imSum);

        // An elastic push along the line between them, SpriteKit's 0.2.
        const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (relative < 0) {
          const impulse = (-(1 + RESTITUTION) * relative) / imSum;
          a.vx -= impulse * imA * nx;
          a.vy -= impulse * imA * ny;
          b.vx += impulse * imB * nx;
          b.vy += impulse * imB * ny;
        }
      }
    }

    // The scene's edge loop.
    nodes.forEach((node) => {
      if (inverseMass(node) === 0) return;
      const r = node.r;
      if (node.x < r) { node.x = r; node.vx = Math.abs(node.vx) * RESTITUTION; }
      if (node.x > width - r) { node.x = width - r; node.vx = -Math.abs(node.vx) * RESTITUTION; }
      if (node.y < r) { node.y = r; node.vy = Math.abs(node.vy) * RESTITUTION; }
      if (node.y > height - r) { node.y = height - r; node.vy = -Math.abs(node.vy) * RESTITUTION; }
    });
  }

  // MARK: - Drawing

  function nodeScale(node, time) {
    let scale = 1;
    if (node.scaleTween) {
      const [up, down] = node.scaleTween;
      scale = time < down.start ? tweenValue(up, time) : tweenValue(down, time);
      if (time >= down.start + down.duration) node.scaleTween = null;
    }
    const press = node.pressTween ? tweenValue(node.pressTween, time) : 0;
    return scale * (1 - (1 - PRESSED_SCALE) * press);
  }

  function nodeOpacity(node, time) {
    let opacity = node.opacityTween ? tweenValue(node.opacityTween, time) : 1;
    if (node.opacityTween && time >= node.opacityTween.start + node.opacityTween.duration) {
      node.opacityTween = null;
    }
    const press = node.pressTween ? tweenValue(node.pressTween, time) : 0;
    return opacity * (1 - (1 - PRESSED_OPACITY) * press);
  }

  function drawSphere(x, y, r, color, opacity) {
    if (r <= 0 || opacity <= 0) return;
    context.globalAlpha = opacity;
    context.beginPath();
    context.arc(x, y, r, 0, Math.PI * 2);
    context.fillStyle = color.hex;
    context.fill();
    if (isPale(color)) {
      context.lineWidth = 1;
      context.strokeStyle = "rgba(0, 0, 0, 0.16)";
      context.stroke();
    }
  }

  function draw(time) {
    context.clearRect(0, 0, width, height);

    leaving.forEach((node) => {
      const progress = easeIn(Math.min((time - node.start) / DISMISS_MS, 1));
      drawSphere(
        node.fromX + (node.toX - node.fromX) * progress,
        node.fromY + (node.toY - node.fromY) * progress,
        node.r * (1 - progress),
        node.color,
        1 - progress
      );
    });

    const keyboardColor = focusedRadioColor();
    nodes.forEach((node) => {
      drawSphere(node.x, node.y, node.r * nodeScale(node, time), node.color, nodeOpacity(node, time));
      if (node.color === keyboardColor) {
        context.globalAlpha = 1;
        context.beginPath();
        context.arc(node.x, node.y, node.r + 6, 0, Math.PI * 2);
        context.setLineDash([3, 3]);
        context.lineWidth = 1.5;
        context.strokeStyle = "rgba(0, 0, 0, 0.6)";
        context.stroke();
        context.setLineDash([]);
      }
    });
    context.globalAlpha = 1;
  }

  function tick(time) {
    frame = 0;
    if (!isVisible || document.hidden) {
      lastTime = 0;
      return;
    }
    const f = lastTime ? Math.min((time - lastTime) / (1000 / 60), 3) : 1;
    lastTime = time;
    step(f, time);
    draw(time);
    if (!reducesMotion.matches || leaving.length || pointer || hasRunningTweens()) {
      requestFrame();
    } else {
      lastTime = 0;
    }
  }

  function hasRunningTweens() {
    return nodes.some((node) => node.scaleTween || node.opacityTween || node.pressTween);
  }

  function requestFrame() {
    if (!frame) frame = window.requestAnimationFrame(tick);
  }

  // MARK: - Size

  function resize() {
    const rect = stage.getBoundingClientRect();
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
        if (node.settle) node.settle = null;
      });
      if (reducesMotion.matches) arrangeStill();
    }
    requestFrame();
  }

  // MARK: - Pointer

  function nodeAt(x, y) {
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const node = nodes[i];
      if (Math.hypot(node.x - x, node.y - y) <= node.r + 4) return node;
    }
    return null;
  }

  function localPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function press(node, isPressed) {
    node.isPressed = isPressed;
    const current = node.pressTween ? tweenValue(node.pressTween, now()) : 0;
    node.pressTween = tween(current, isPressed ? 1 : 0, now(), PRESS_MS);
  }

  canvas.addEventListener("pointerdown", (event) => {
    const point = localPoint(event);
    const node = nodeAt(point.x, point.y);
    if (!node) return;
    canvas.setPointerCapture(event.pointerId);
    press(node, true);
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
    // The focused sphere stays put — `canMoveFocusedNode(false)`.
    const canDrag = pointer.node !== focusedNode || !pointer.node.isStatic;
    if (!pointer.isDragging && moved > DRAG_SLOP && canDrag && !reducesMotion.matches) {
      pointer.isDragging = true;
    }
    if (pointer.isDragging) {
      const node = pointer.node;
      // `touchesMoved`: the sphere under the finger, carrying its speed.
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
    press(node, false);
    pointer = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (!isCancelled && !isDragging) focus(node);
    requestFrame();
  }

  canvas.addEventListener("pointerup", (event) => endPointer(event, false));
  canvas.addEventListener("pointercancel", (event) => endPointer(event, true));

  // MARK: - Controls

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
    radioGroup.querySelectorAll("label").forEach((label) => label.remove());
    COLORS.filter((color) => color.family === family).forEach((color) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "kiwa-color";
      input.value = color.name;
      input.checked = color === selected;
      input.addEventListener("change", () => {
        const node = nodes.find((candidate) => candidate.color === color);
        if (node) focus(node); else select(color);
      });
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

  new ResizeObserver(resize).observe(stage);

  new IntersectionObserver((entries) => {
    isVisible = entries.some((entry) => entry.isIntersecting);
    if (isVisible) requestFrame();
  }).observe(stage);

  document.addEventListener("visibilitychange", requestFrame);

  reducesMotion.addEventListener("change", () => {
    leaving = [];
    nodes.forEach((node) => {
      node.scaleTween = null;
      node.opacityTween = null;
      node.settle = null;
    });
    if (reducesMotion.matches) arrangeStill();
    requestFrame();
  });
})();
