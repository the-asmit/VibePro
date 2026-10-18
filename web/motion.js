/* A small, local renderer: layered source files, a moving inspection plane,
 * and packets following the edges. No video, animation library, or remote media. */
(() => {
  const preference = matchMedia("(prefers-reduced-motion: reduce)");
  const phone = matchMedia("(max-width: 650px)");
  const menu = document.querySelector("#main-menu");
  const toggle = document.querySelector(".menu-toggle");
  function setMenu(open) {
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute(
      "aria-label",
      open ? "Close navigation" : "Open navigation",
    );
    document.body.classList.toggle("nav-open", open);
    menu.inert = phone.matches && !open;
  }
  toggle.addEventListener("click", () =>
    setMenu(toggle.getAttribute("aria-expanded") !== "true"),
  );
  menu
    .querySelectorAll("a")
    .forEach((link) => link.addEventListener("click", () => setMenu(false)));
  phone.addEventListener("change", () => setMenu(false));
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      toggle.getAttribute("aria-expanded") === "true"
    ) {
      setMenu(false);
      toggle.focus();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".topbar")) setMenu(false);
  });
  setMenu(false);

  const effects = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) =>
        entry.target.classList.toggle("motion-active", entry.isIntersecting),
      );
    },
    { threshold: 0 },
  );
  document
    .querySelectorAll("#method, #verify")
    .forEach((section) => effects.observe(section));

  const canvas = document.querySelector("#security-core");
  const stage = canvas.closest(".core-stage");
  const context = canvas.getContext("2d", { alpha: true });
  const motionButton = document.querySelector("#motion-toggle");
  let paused = preference.matches;
  let visible = false;
  let frame = 0;
  let lastTime = 0;
  let time = 0.15;
  let width = 1,
    height = 1,
    scale = 1;
  let pointerX = 0,
    pointerY = 0,
    leanX = 0,
    leanY = 0;

  function updateMotion() {
    document.body.classList.toggle("motion-paused", paused);
    motionButton.setAttribute("aria-pressed", String(paused));
    motionButton.textContent = paused
      ? "Play animation ↗"
      : "Pause animation Ⅱ";
    cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
    canvas.dataset.motion = paused ? "paused" : "playing";
    if (!paused && visible && !document.hidden && context)
      frame = requestAnimationFrame(animate);
    else if (context) draw();
  }
  motionButton.addEventListener("click", () => {
    paused = !paused;
    updateMotion();
  });
  preference.addEventListener("change", () => {
    paused = preference.matches;
    updateMotion();
  });
  document.addEventListener("visibilitychange", updateMotion);
  new IntersectionObserver(
    (entries) => {
      visible = entries[0].isIntersecting;
      updateMotion();
    },
    { threshold: 0 },
  ).observe(stage);

  function resize() {
    const rect = stage.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context?.setTransform(ratio, 0, 0, ratio, 0, 0);
    scale = Math.min(width / 560, height / 570);
    if (context) draw();
  }
  stage.addEventListener(
    "pointermove",
    (event) => {
      if (paused || event.pointerType === "touch") return;
      const bounds = stage.getBoundingClientRect();
      pointerX = ((event.clientX - bounds.left) / width - 0.5) * 2;
      pointerY = ((event.clientY - bounds.top) / height - 0.5) * 2;
    },
    { passive: true },
  );
  stage.addEventListener("pointerleave", () => {
    pointerX = 0;
    pointerY = 0;
  });

  function project(x, y, z) {
    const angle = -0.62 + Math.sin(time * 0.22) * 0.08 + leanX * 0.12;
    const tilt = 0.68 + leanY * 0.065;
    const a = x * Math.cos(angle) + z * Math.sin(angle);
    const b = -x * Math.sin(angle) + z * Math.cos(angle);
    const c = y * Math.cos(tilt) - b * Math.sin(tilt);
    const depth = y * Math.sin(tilt) + b * Math.cos(tilt);
    const perspective = 920 / (920 + depth);
    return [
      width * 0.53 + a * scale * perspective,
      height * 0.455 + c * scale * perspective,
    ];
  }
  function path(points) {
    context.beginPath();
    points.forEach((point, i) => {
      const p = project(...point);
      if (i) context.lineTo(...p);
      else context.moveTo(...p);
    });
  }
  function line(points, color, weight = 1) {
    path(points);
    context.strokeStyle = color;
    context.lineWidth = weight * scale;
    context.stroke();
  }
  function polygon(points, fill, edge, weight = 0.8) {
    path(points);
    context.closePath();
    context.fillStyle = fill;
    context.fill();
    if (edge) {
      context.strokeStyle = edge;
      context.lineWidth = weight * scale;
      context.stroke();
    }
  }
  function node(point, radius, opacity = 1) {
    const position = project(...point);
    context.save();
    context.globalAlpha = opacity;
    context.shadowColor = "#8dbbff";
    context.shadowBlur = radius * 4 * scale;
    context.fillStyle = "#d6e7ff";
    context.beginPath();
    context.arc(...position, radius * scale, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
  function draw() {
    context.clearRect(0, 0, width, height);
    const glow = context.createRadialGradient(
      width * 0.53,
      height * 0.76,
      0,
      width * 0.53,
      height * 0.76,
      width * 0.47,
    );
    glow.addColorStop(0, "#4b88de13");
    glow.addColorStop(0.5, "#305d9c06");
    glow.addColorStop(1, "#305d9c00");
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);

    // A restrained floor grid gives the stack perspective without covering text.
    for (let x = -280; x <= 280; x += 56)
      line(
        [
          [x, 198, -220],
          [x, 198, 220],
        ],
        "#6687b612",
        0.6,
      );
    for (let z = -224; z <= 224; z += 56)
      line(
        [
          [-280, 198, z],
          [280, 198, z],
        ],
        "#6687b612",
        0.6,
      );
    const scan = -150 + ((Math.sin(time * 0.68) + 1) / 2) * 300;

    function inspectionPlane() {
      const p = project(0, scan, 0);
      const beam = context.createLinearGradient(
        0,
        p[1] - 40 * scale,
        0,
        p[1] + 40 * scale,
      );
      beam.addColorStop(0, "#6aa8ff08");
      beam.addColorStop(0.5, "#8abbff32");
      beam.addColorStop(1, "#6aa8ff05");
      context.save();
      context.shadowColor = "#8dbbff";
      context.shadowBlur = 18 * scale;
      polygon(
        [
          [-174, scan, -136],
          [174, scan, -136],
          [174, scan, 136],
          [-174, scan, 136],
        ],
        beam,
        "#94c1ff85",
        1.3,
      );
      context.restore();
      for (let i = 0; i < 4; i++) {
        const x = i % 2 ? 174 : -174;
        const z = i < 2 ? -136 : 136;
        line(
          [
            [x, scan - 8, z],
            [x, scan + 8, z],
          ],
          "#bed9ff",
          1.7,
        );
      }
    }

    let planeDrawn = false;
    for (let i = 5; i >= 0; i--) {
      const y = (i - 2.5) * 48 + Math.sin(time * 0.7 + i * 0.35) * 3;
      if (!planeDrawn && scan > y) {
        inspectionPlane();
        planeDrawn = true;
      }
      const hit = Math.max(0, 1 - Math.abs(scan - y) / 38);
      const left = -145 + i * 1.5;
      const right = 145 - i * 1.5;
      const back = -106;
      const front = 106;
      const gradient = context.createLinearGradient(
        width * 0.25,
        height * 0.25,
        width * 0.8,
        height * 0.7,
      );
      gradient.addColorStop(0, "#646970");
      gradient.addColorStop(0.36, "#31353b");
      gradient.addColorStop(1, "#16191e");
      polygon(
        [
          [left, y + 6, back],
          [right, y + 6, back],
          [right, y + 6, front],
          [left, y + 6, front],
        ],
        "#090d13",
        "#3b445166",
      );
      polygon(
        [
          [left, y, front],
          [right, y, front],
          [right, y + 6, front],
          [left, y + 6, front],
        ],
        "#2c3440",
        "#5c6d8644",
      );
      polygon(
        [
          [right, y, back],
          [right, y, front],
          [right, y + 6, front],
          [right, y + 6, back],
        ],
        "#121821",
        "#5e739133",
      );
      polygon(
        [
          [left, y, back],
          [right, y, back],
          [right, y, front],
          [left, y, front],
        ],
        gradient,
        `rgba(165,187,218,${0.22 + hit * 0.4})`,
        1,
      );
      line(
        [
          [left + 12, y - 0.5, back + 22],
          [right - 12, y - 0.5, back + 22],
        ],
        "#95a4b83b",
        0.7,
      );
      // Code becomes abstract tracks on each physical sheet.
      for (let row = 0; row < 8; row++) {
        const z = -62 + row * 19;
        const indent = ((row + i) % 3) * 13;
        const length = 62 + ((row * 47 + i * 31) % 100);
        const alpha = 0.12 + ((row + i) % 4) * 0.045 + hit * 0.24;
        line(
          [
            [-114 + indent, y - 1, z],
            [-114 + indent + length, y - 1, z],
          ],
          `rgba(184,203,229,${alpha})`,
          2.1,
        );
        if (row % 3 === 1)
          line(
            [
              [70, y - 1, z],
              [112, y - 1, z],
            ],
            `rgba(141,187,255,${0.18 + hit * 0.5})`,
            2.1,
          );
      }
      for (let dot = 0; dot < 3; dot++)
        node([left + 18 + dot * 10, y - 1, back + 11], 1.3, 0.35);
      const progress = (time * 0.08 + i * 0.16) % 1;
      const packet =
        progress < 0.5
          ? [left + progress * 2 * (right - left), y - 1, front]
          : [right, y - 1, front - (progress - 0.5) * 2 * (front - back)];
      node(packet, 2.3, 0.75);
    }
    if (!planeDrawn) inspectionPlane();
    // Thin vertical paths visually connect each file to the inspection plane.
    line(
      [
        [180, -148, -112],
        [180, 158, -112],
      ],
      "#7aa1d724",
    );
    node([180, scan, -112], 3, 0.85);
    stage.classList.add("canvas-ready");
    canvas.dataset.frame = String(Math.floor(time * 100));
  }
  function animate(timestamp) {
    if (paused || !visible || document.hidden) return;
    if (!lastTime || timestamp - lastTime >= (phone.matches ? 30 : 15)) {
      time += lastTime ? Math.min((timestamp - lastTime) / 1000, 0.08) : 0.016;
      lastTime = timestamp;
      leanX += (pointerX - leanX) * 0.065;
      leanY += (pointerY - leanY) * 0.065;
      draw();
    }
    frame = requestAnimationFrame(animate);
  }
  if (context) {
    new ResizeObserver(resize).observe(stage);
    resize();
  } else motionButton.hidden = true;
  updateMotion();
})();
