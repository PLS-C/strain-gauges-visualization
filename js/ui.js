/**
 * UI layer — DOM, events, and diagram rendering only.
 * No physics formulas; delegates computation to StrainGaugePhysics.
 */

(function () {
  'use strict';

  const VISUAL_STRAIN_GAIN = 800;
  const A_REF = 0.0001;
  const BAR_WIDTH_MIN = 24;
  const BAR_WIDTH_MAX = 120;
  const BAR_WIDTH_SCALE = 80;
  const ANIMATION_SETTLE_MS = 150;
  const FORCE_ZERO_EPS = 0.5;
  const FORCE_INPUT_MIN = -10000;
  const FORCE_INPUT_MAX = 10000;

  const EQUATIONS = [
    String.raw`\sigma = \frac{F}{A}`,
    String.raw`\varepsilon = \frac{\sigma}{E} = \frac{F}{A \cdot E}`,
    String.raw`\Delta L = \varepsilon \cdot L`,
    String.raw`\varepsilon_{\text{lateral}} = -\nu \cdot \varepsilon`,
    String.raw`A' = A \cdot (1 + \varepsilon_{\text{lateral}})^2`,
    String.raw`R_{\text{nominal}} = \frac{\rho \cdot L}{A}`,
    String.raw`R_{\text{strained}} = R_{\text{nominal}} \cdot (1 + GF \cdot \varepsilon)`,
    String.raw`R(T) = R_{\text{strained}} \cdot (1 + \alpha \cdot \Delta T)`,
    String.raw`\Delta T = T - T_{\text{nominal}}`,
  ];

  const elements = {
    html: document.documentElement,
    themeToggle: document.getElementById('theme-toggle'),
    themeToggleIcon: document.getElementById('theme-toggle-icon'),
    themeToggleLabel: document.getElementById('theme-toggle-label'),
    materialSelect: document.getElementById('material-select'),
    inputL: document.getElementById('input-L'),
    inputA: document.getElementById('input-A'),
    sliderF: document.getElementById('slider-F'),
    inputF: document.getElementById('input-F'),
    forceValue: document.getElementById('force-value'),
    inputT: document.getElementById('input-T'),
    canvas: document.getElementById('diagram-canvas'),
    diagramDeltaLLabel: document.getElementById('diagram-deltaL-label'),
    diagramDeltaLValue: document.getElementById('diagram-deltaL-value'),
    diagramAreaLabel: document.getElementById('diagram-area-label'),
    diagramAreaValue: document.getElementById('diagram-area-value'),
    materialProperties: document.getElementById('material-properties'),
    equationsList: document.getElementById('equations-list'),
    computedResults: document.getElementById('computed-results'),
    computedResultsVisibilityToggle: document.getElementById('computed-results-visibility-toggle'),
    computedResultsSection: document.getElementById('computed-results-section'),
  };

  const ctx = elements.canvas.getContext('2d');

  let animState = {
    lengthRatio: 1,
    widthRatio: 1,
    targetLengthRatio: 1,
    targetWidthRatio: 1,
    force: 0,
    targetForce: 0,
    animating: false,
  };

  let lastResult = null;
  let lastInputs = null;
  let lastAnimTime = null;

  function getCssVar(name) {
    return getComputedStyle(elements.html).getPropertyValue(name).trim();
  }

  function initTheme() {
    const saved = localStorage.getItem('strain-gauge-theme');
    if (saved === 'light' || saved === 'dark') {
      elements.html.setAttribute('data-theme', saved);
    }
    updateThemeToggleLabel();
  }

  function toggleTheme() {
    const current = elements.html.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    elements.html.setAttribute('data-theme', next);
    localStorage.setItem('strain-gauge-theme', next);
    updateThemeToggleLabel();
    renderDiagram(lastResult, lastInputs);
  }

  function updateThemeToggleLabel() {
    const theme = elements.html.getAttribute('data-theme') || 'dark';
    if (theme === 'dark') {
      elements.themeToggleIcon.textContent = '☀';
      elements.themeToggleLabel.textContent = 'Bright Mode';
    } else {
      elements.themeToggleIcon.textContent = '☾';
      elements.themeToggleLabel.textContent = 'Dark Mode';
    }
  }

  function readInputs() {
    const forceFromSlider = parseFloat(elements.sliderF.value);
    const forceFromInput = parseFloat(elements.inputF.value);
    let F = Number.isFinite(forceFromInput) ? forceFromInput : forceFromSlider;
    if (Number.isFinite(F)) {
      F = Math.max(FORCE_INPUT_MIN, Math.min(FORCE_INPUT_MAX, F));
    }

    return {
      materialKey: elements.materialSelect.value,
      L: parseFloat(elements.inputL.value),
      A: parseFloat(elements.inputA.value),
      F,
      T: parseFloat(elements.inputT.value),
    };
  }

  function updateForceSliderRange() {
    const min = FORCE_INPUT_MIN;
    const max = FORCE_INPUT_MAX;
    elements.sliderF.min = String(min);
    elements.sliderF.max = String(max);
    elements.inputF.min = String(min);
    elements.inputF.max = String(max);

    const step = Math.max(1, (max - min) / 1000);
    elements.sliderF.step = String(step);

    let current = parseFloat(elements.inputF.value);
    if (Number.isNaN(current)) {
      current = parseFloat(elements.sliderF.value);
    }
    if (Number.isNaN(current)) {
      current = 0;
    }
    current = Math.max(min, Math.min(max, current));
    elements.sliderF.value = String(current);
    elements.inputF.value = current.toFixed(2);
  }

  function formatForce(value) {
    const abs = Math.abs(value);
    if (abs >= 1e6) {
      return value.toExponential(2) + ' N';
    }
    if (abs >= 1000) {
      return value.toFixed(1) + ' N';
    }
    return value.toFixed(2) + ' N';
  }

  function toSuperscriptExponent(exp) {
    const superscriptDigits = '⁰¹²³⁴⁵⁶⁷⁸⁹';
    return String(exp).replace(/-/g, '⁻').replace(/\d/g, function (digit) {
      return superscriptDigits[digit];
    });
  }

  function formatPowerOfTen(value, digits) {
    digits = digits === undefined ? 2 : digits;
    if (typeof value !== 'number' || isNaN(value)) {
      return '-';
    }
    if (value === 0) {
      return '0.00 × 10⁰';
    }
    const exp = Math.floor(Math.log10(Math.abs(value)));
    const mantissa = value / Math.pow(10, exp);
    return mantissa.toFixed(digits) + ' × 10' + toSuperscriptExponent(exp);
  }

  function formatStress(sigma) {
    return formatPowerOfTen(sigma, 2) + ' Pa';
  }

  function formatMm(value) {
    const mm = value * 1000;
    const abs = Math.abs(mm);
    if (abs === 0) {
      return '0.000 mm';
    }
    if (abs < 0.001) {
      return mm.toExponential(3) + ' mm';
    }
    if (abs < 1) {
      return mm.toFixed(4) + ' mm';
    }
    return mm.toFixed(3) + ' mm';
  }

  function formatMmSquared(value) {
    const mm2 = value * 1e6;
    const abs = Math.abs(mm2);
    if (abs === 0) {
      return '0.000 mm²';
    }
    if (abs < 0.001) {
      return mm2.toExponential(3) + ' mm²';
    }
    if (abs < 1) {
      return mm2.toFixed(4) + ' mm²';
    }
    return mm2.toFixed(3) + ' mm²';
  }

  function renderDiagramStats(result, inputs) {
    if (!result || !inputs) {
      return;
    }

    const forceActive = result.valid && Math.abs(result.F_clamped) >= FORCE_ZERO_EPS;

    elements.diagramDeltaLLabel.textContent = 'ΔL';
    elements.diagramDeltaLValue.textContent = result.valid
      ? formatMm(result.deltaL)
      : '— mm';

    elements.diagramAreaLabel.textContent = forceActive ? "A'" : 'A';
    const areaM2 = forceActive ? result.A_prime : inputs.A;
    elements.diagramAreaValue.textContent = result.valid && inputs.A > 0
      ? formatMmSquared(areaM2)
      : '— mm²';
  }
  function formatNumber(value) {
    return formatPowerOfTen(value, 2);
  }

  function formatResistance(value) {
    return formatPowerOfTen(value, 6) + ' Ω';
  }

  function renderEquations() {
    elements.equationsList.textContent = '';
    EQUATIONS.forEach(function (latex) {
      const div = document.createElement('div');
      div.className = 'equation-item';
      if (typeof katex !== 'undefined') {
        try {
          katex.render(latex, div, { throwOnError: false, displayMode: true });
        } catch (err) {
          const pre = document.createElement('pre');
          pre.textContent = latex;
          div.appendChild(pre);
        }
      } else {
        const pre = document.createElement('pre');
        pre.textContent = latex;
        div.appendChild(pre);
      }
      elements.equationsList.appendChild(div);
    });
  }

  function renderMaterialProperties(material) {
    elements.materialProperties.textContent = '';
    if (!material) {
      return;
    }

    const props = [
      { label: 'E', value: (material.E / 1e9).toFixed(0) + ' GPa' },
      { label: 'ν', value: material.nu.toFixed(2) },
      { label: 'GF', value: material.GF.toFixed(1) },
      { label: 'ρ', value: formatPowerOfTen(material.rho, 2) + ' Ω·m' },
      { label: 'α', value: material.alpha.toExponential(2) + ' 1/°C' },
      { label: 'σ_y', value: (material.sigma_y / 1e6).toFixed(0) + ' MPa' },
    ];

    props.forEach(function (prop) {
      const item = document.createElement('div');
      item.className = 'property-item';

      const name = document.createElement('span');
      name.className = 'property-name';
      name.textContent = prop.label;

      const value = document.createElement('span');
      value.className = 'property-value';
      value.textContent = prop.value;

      item.appendChild(name);
      item.appendChild(value);
      elements.materialProperties.appendChild(item);
    });
  }

  function renderComputedResults(result, inputs) {
    elements.computedResults.textContent = '';

    const rows = [
      { label: 'σ (Stress)', value: formatStress(result.sigma) },
      { label: 'ε (Strain)', value: formatNumber(result.epsilon) + ' ε' },
      { label: 'ΔL', value: formatNumber(result.deltaL) + ' m' },
      {
        label: result.F_clamped === 0 ? "A (no deformation)" : "A'",
        value: formatNumber(result.F_clamped === 0 ? inputs.A : result.A_prime) + ' m²',
      },
      { label: 'R_nominal', value: formatResistance(result.R_nominal) },
      { label: 'R_strained', value: formatResistance(result.R_strained) },
      { label: 'R(T)', value: formatResistance(result.R_T) },
    ];
    

    rows.forEach(function (row) {
      const div = document.createElement('div');
      div.className = 'result-row';

      const label = document.createElement('span');
      label.className = 'result-label';
      label.textContent = row.label;

      const value = document.createElement('span');
      value.className = 'result-value';
      value.textContent = row.value;

      div.appendChild(label);
      div.appendChild(value);
      elements.computedResults.appendChild(div);
    });
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function visualBarWidthPx(A) {
    if (!A || A <= 0) {
      return BAR_WIDTH_SCALE;
    }
    return clamp(BAR_WIDTH_MIN, BAR_WIDTH_SCALE * Math.sqrt(A / A_REF), BAR_WIDTH_MAX);
  }

  function computeVisualRatios(result, inputs) {
    if (!result.valid || inputs.L <= 0 || inputs.A <= 0 || Math.abs(result.F_clamped) < FORCE_ZERO_EPS) {
      return { lengthRatio: 1, widthRatio: 1 };
    }

    const axialStrain = result.deltaL / inputs.L;
    const widthRatioPhysical = Math.sqrt(result.A_prime / inputs.A);
    const lateralDelta = widthRatioPhysical - 1;

    return {
      lengthRatio: 1 + axialStrain * VISUAL_STRAIN_GAIN,
      widthRatio: 1 + lateralDelta * VISUAL_STRAIN_GAIN,
    };
  }

  function setAnimationTargets(result, inputs) {
    const ratios = computeVisualRatios(result, inputs);
    animState.targetLengthRatio = ratios.lengthRatio;
    animState.targetWidthRatio = ratios.widthRatio;
    animState.targetForce = result.valid ? result.F_clamped : 0;
    startAnimation();
  }

  function startAnimation() {
    if (animState.animating) {
      return;
    }
    animState.animating = true;
    requestAnimationFrame(animationFrame);
  }

  function animationFrame(timestamp) {
    if (lastAnimTime === null) {
      lastAnimTime = timestamp;
    }
    const deltaMs = Math.min(timestamp - lastAnimTime, 32);
    lastAnimTime = timestamp;

    const lerpFactor = 1 - Math.exp(-deltaMs / (ANIMATION_SETTLE_MS / 3));
    animState.lengthRatio += (animState.targetLengthRatio - animState.lengthRatio) * lerpFactor;
    animState.widthRatio += (animState.targetWidthRatio - animState.widthRatio) * lerpFactor;
    animState.force += (animState.targetForce - animState.force) * lerpFactor;

    const lengthDone = Math.abs(animState.lengthRatio - animState.targetLengthRatio) < 0.0001;
    const widthDone = Math.abs(animState.widthRatio - animState.targetWidthRatio) < 0.0001;
    const forceDone = Math.abs(animState.force - animState.targetForce) < 0.01;

    if (lengthDone) {
      animState.lengthRatio = animState.targetLengthRatio;
    }
    if (widthDone) {
      animState.widthRatio = animState.targetWidthRatio;
    }
    if (forceDone) {
      animState.force = animState.targetForce;
    }

    renderDiagram(lastResult, lastInputs);

    if (!lengthDone || !widthDone || !forceDone) {
      requestAnimationFrame(animationFrame);
    } else {
      animState.animating = false;
      lastAnimTime = null;
    }
  }

  function resizeCanvas() {
    const container = elements.canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = container.clientHeight;
    elements.canvas.width = width * dpr;
    elements.canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderDiagram(lastResult, lastInputs);
  }

  function drawHatchedWall(x, y, width, height) {
    const hatchColor = getCssVar('--color-wall-hatch');
    ctx.fillStyle = getCssVar('--color-bg-elevated');
    ctx.fillRect(x, y, width, height);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();

    ctx.strokeStyle = hatchColor;
    ctx.lineWidth = 1.5;
    const spacing = 8;
    for (let i = -height; i < width + height; i += spacing) {
      ctx.beginPath();
      ctx.moveTo(x + i, y);
      ctx.lineTo(x + i + height, y + height);
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = getCssVar('--color-border');
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);
  }

  function drawArrow(x1, y1, x2, y2, color, lineWidth) {
    const headLen = 8;
    const angle = Math.atan2(y2 - y1, x2 - x1);

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  function drawDoubleArrow(x, y1, y2, color) {
    drawArrow(x, y1, x, y2, color, 1.5);
    drawArrow(x, y2, x, y1, color, 1.5);
  }

  function renderDiagram(result, inputs) {
    const width = elements.canvas.clientWidth;
    const height = elements.canvas.clientHeight;
    ctx.clearRect(0, 0, width, height);

    const wallHeight = 36;
    const marginTop = wallHeight + 20;
    const marginBottom = 80;
    const marginLeft = 80;
    const marginRight = 100;

    const drawHeight = height - marginTop - marginBottom;
    const drawWidth = width - marginLeft - marginRight;

    const origLength = drawHeight * 0.65;
    const inputA = inputs && inputs.A > 0 ? inputs.A : A_REF;
    const origBarWidth = visualBarWidthPx(inputA);

    const defLength = origLength * animState.lengthRatio;
    const defBarWidth = origBarWidth * animState.widthRatio;

    const centerX = marginLeft + drawWidth / 2;
    const wallTop = 10;
    const wallWidth = origBarWidth + 60;
    const wallX = centerX - wallWidth / 2;

    drawHatchedWall(wallX, wallTop, wallWidth, wallHeight);

    const origTop = wallTop + wallHeight;
    const origLeft = centerX - origBarWidth / 2;

    const defTop = origTop;
    const defLeft = centerX - defBarWidth / 2;

    const fillColor = getCssVar('--color-bar-fill');
    const fillOpacity = parseFloat(getCssVar('--color-bar-fill-opacity')) || 0.35;
    ctx.fillStyle = fillColor;
    ctx.globalAlpha = fillOpacity;
    ctx.fillRect(defLeft, defTop, defBarWidth, defLength);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = getCssVar('--color-bar-outline');
    ctx.lineWidth = 2.5;
    ctx.strokeRect(defLeft, defTop, defBarWidth, defLength);

    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = getCssVar('--color-bar-dashed');
    ctx.lineWidth = 2;
    ctx.strokeRect(origLeft, origTop, origBarWidth, origLength);
    ctx.setLineDash([]);

    const dimColor = getCssVar('--color-text');
    ctx.fillStyle = dimColor;
    ctx.font = '600 14px "Segoe UI", system-ui, sans-serif';

    const lArrowX = origLeft + origBarWidth + 24;
    drawDoubleArrow(lArrowX, origTop, origTop + origLength, dimColor);
    ctx.textAlign = 'left';
    ctx.fillText('L', lArrowX + 10, origTop + origLength / 2 + 5);

    const forceActive = Math.abs(animState.force) >= FORCE_ZERO_EPS;
    const areaLabel = forceActive ? "A'" : 'A';
    const areaLabelX = defLeft - 28;
    ctx.textAlign = 'right';
    ctx.fillText(areaLabel, areaLabelX, defTop + defLength);

    ctx.beginPath();
    ctx.strokeStyle = dimColor;
    ctx.lineWidth = 1.5;
    ctx.moveTo(areaLabelX + 5, defTop);
    ctx.lineTo(defLeft - 4, defTop);
    ctx.moveTo(areaLabelX + 5, defTop + defLength);
    ctx.lineTo(defLeft - 4, defTop + defLength);
    ctx.stroke();

    if (forceActive) {
      const origBottom = origTop + origLength;
      const defBottom = defTop + defLength;
      const deltaArrowX = origLeft + origBarWidth + 24;
      let arrowY1 = origBottom;
      let arrowY2 = defBottom;

      if (Math.abs(arrowY2 - arrowY1) < 8) {
        const mid = (arrowY1 + arrowY2) / 2;
        arrowY1 = mid - 4;
        arrowY2 = mid + 4;
      }

      drawDoubleArrow(deltaArrowX, arrowY1, arrowY2, dimColor);
      ctx.fillStyle = dimColor;
      ctx.textAlign = 'left';
      ctx.fillText('ΔL', deltaArrowX + 10, (origBottom + defBottom) / 2 + 5);
    }

    if (forceActive) {
      const maxArrowLen = 50;
      const forceRatio = result && result.valid
        ? Math.abs(animState.force) / result.forceLimits.max
        : 0;
      const arrowLen = 20 + forceRatio * maxArrowLen;
      const arrowX = centerX;
      const arrowStartY = defTop + defLength + 15;
      const forceColor = animState.force > 0
        ? getCssVar('--color-danger')
        : getCssVar('--color-success');

      if (animState.force > 0) {
        drawArrow(arrowX, arrowStartY, arrowX, arrowStartY + arrowLen, forceColor, 3);
        ctx.fillStyle = forceColor;
        ctx.textAlign = 'left';
        ctx.fillText('F', arrowX + 12, arrowStartY + arrowLen - 2);
      } else {
        drawArrow(arrowX, arrowStartY + arrowLen, arrowX, arrowStartY, forceColor, 3);
        ctx.fillStyle = forceColor;
        ctx.textAlign = 'left';
        ctx.fillText('F', arrowX + 12, arrowStartY + 4);
      }
    }
  }

  function showError(message) {
    var banner = document.getElementById('js-error-banner');
    if (banner) {
      banner.hidden = false;
      banner.textContent = message;
    }
  }

  function updateUI() {
    if (typeof StrainGaugePhysics === 'undefined') {
      showError('physics-strain-gauge.js failed to load. Use http://localhost:8080/');
      return;
    }
    const inputs = readInputs();
    const result = StrainGaugePhysics.computeStrainGauge(inputs);
    lastResult = result;
    lastInputs = inputs;

    updateForceSliderRange();

    if (result.valid) {
      elements.sliderF.value = String(result.F_clamped);
      elements.inputF.value = result.F_clamped.toFixed(2);
    }

    elements.forceValue.textContent = formatForce(result.F_clamped);

    renderMaterialProperties(result.material);
    renderComputedResults(result, inputs);
    renderDiagramStats(result, inputs);
    setAnimationTargets(result, inputs);
  }

  function initComputedResultsVisibilityToggle() {
    const toggle = elements.computedResultsVisibilityToggle;
    const section = elements.computedResultsSection;
    if (!toggle || !section) {
      return;
    }

    let visible = true;

    function syncVisibility() {
      section.classList.toggle('is-section-collapsed', !visible);
      toggle.classList.toggle('is-hidden-state', !visible);
      toggle.setAttribute('aria-pressed', String(visible));
      toggle.setAttribute(
        'aria-label',
        visible ? 'Hide computed results' : 'Show computed results'
      );
    }

    toggle.addEventListener('click', function () {
      visible = !visible;
      syncVisibility();
    });

    syncVisibility();
  }

  function bindEvents() {
    elements.themeToggle.addEventListener('click', toggleTheme);

    elements.materialSelect.addEventListener('change', updateUI);
    elements.inputL.addEventListener('input', updateUI);
    elements.inputA.addEventListener('input', updateUI);
    elements.sliderF.addEventListener('input', function () {
      elements.inputF.value = elements.sliderF.value;
      updateUI();
    });
    elements.inputF.addEventListener('input', updateUI);
    elements.inputT.addEventListener('input', updateUI);

    window.addEventListener('resize', resizeCanvas);

    const themeObserver = new MutationObserver(function () {
      renderDiagram(lastResult, lastInputs);
    });
    themeObserver.observe(elements.html, { attributes: true, attributeFilter: ['data-theme'] });
  }

  function init() {
    initTheme();
    bindEvents();
    initComputedResultsVisibilityToggle();
    resizeCanvas();
    updateUI();
    renderEquations();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
