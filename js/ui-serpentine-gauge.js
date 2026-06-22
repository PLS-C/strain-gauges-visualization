/**
 * UI layer for serpentine strain gauge visualization.
 * DOM and canvas only — delegates computation to StrainGaugePhysics.
 */

(function () {
  'use strict';

  const VISUAL_STRAIN_GAIN = 120;
  const ANIMATION_SETTLE_MS = 150;
  const FORCE_ZERO_EPS = 0.5;
  const MM_TO_M = 1e-3;
  const UM_TO_M = 1e-6;
  const MM2_TO_M2 = 1e-6;

  /** Default GAUGE GEOMETRY settings (Settings panel). */
  const DEFAULT_GAUGE_GEOMETRY = {
    materialKey: 'constantan',
    l_grid_mm: 100,
    w_mm: 0.25,
    s_mm: 2,
    n: 6,
    t_um: 5,
  };

  /** Fixed reference geometry for the educational Grid detail diagram (not tied to Settings). */
  const GRID_DETAIL_REFERENCE = {
    w_mm: 0.9,
    s_mm: 2.0,
    l_grid_mm: 25,
    n: 3,
  };

  const EQUATIONS = [
    String.raw`L_{\text{total}} = n \times l_{\text{grid}} + (n-1) \times (s + w)`,
    String.raw`A_{\text{gauge}} = w \times t`,
    String.raw`\sigma = \frac{F}{A_{\text{specimen}}}`,
    String.raw`\varepsilon = \frac{\sigma}{E_{\text{specimen}}}`,
    String.raw`\Delta L_{\text{specimen}} = \varepsilon \cdot L_{\text{specimen}}`,
    String.raw`\varepsilon_{\text{lateral}} = -\nu_{\text{specimen}} \times \varepsilon`,
    String.raw`R_{\text{nominal}} = \frac{\rho \cdot L_{\text{total}}}{A_{\text{gauge}}}`,
    String.raw`R_{\text{strained}} = R_{\text{nominal}} \cdot (1 + GF \cdot \varepsilon)`,
    String.raw`R(T) = R_{\text{strained}} \cdot (1 + \alpha \cdot \Delta T)`,
    String.raw`\Delta T = T - 20`,
  ];

  const elements = {
    html: document.documentElement,
    themeToggle: document.getElementById('theme-toggle'),
    themeToggleIcon: document.getElementById('theme-toggle-icon'),
    themeToggleLabel: document.getElementById('theme-toggle-label'),
    materialSelect: document.getElementById('sg-material-select'),
    inputLGrid: document.getElementById('sg-input-l-grid'),
    inputW: document.getElementById('sg-input-w'),
    inputS: document.getElementById('sg-input-s'),
    inputN: document.getElementById('sg-input-n'),
    inputT: document.getElementById('sg-input-t'),
    inputLSpecimen: document.getElementById('sg-input-l-specimen'),
    inputASpecimen: document.getElementById('sg-input-a-specimen'),
    sliderF: document.getElementById('sg-slider-F'),
    inputForce: document.getElementById('sg-input-force'),
    forceValue: document.getElementById('sg-force-value'),
    sliderTemp: document.getElementById('sg-slider-T'),
    inputTemp: document.getElementById('sg-input-T'),
    readoutLTotal: document.getElementById('sg-readout-l-total'),
    readoutAGauge: document.getElementById('sg-readout-a-gauge'),
    readoutFMax: document.getElementById('sg-readout-f-max'),
    canvas: document.getElementById('sg-diagram-canvas'),
    detailCanvas: document.getElementById('sg-diagram-detail-canvas'),
    diagramLTotal: document.getElementById('sg-diagram-l-total'),
    diagramDeltaL: document.getElementById('sg-diagram-deltaL-value'),
    materialProperties: document.getElementById('sg-material-properties'),
    specimenProperties: document.getElementById('sg-specimen-properties'),
    equationsList: document.getElementById('sg-equations-list'),
    computedResults: document.getElementById('sg-computed-results'),
    resultsVisibilityToggle: document.getElementById('sg-results-visibility-toggle'),
    resultsBody: document.getElementById('sg-results-body'),
  };

  const ctx = elements.canvas.getContext('2d');
  const detailCtx = elements.detailCanvas.getContext('2d');

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
    renderDetailDiagram();
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

  function parsePositive(value, fallback) {
    const n = parseFloat(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function parseInteger(value, fallback) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n >= 1 ? n : fallback;
  }

  function readInputs() {
    const l_grid_mm = parsePositive(elements.inputLGrid.value, DEFAULT_GAUGE_GEOMETRY.l_grid_mm);
    const w_mm = parsePositive(elements.inputW.value, DEFAULT_GAUGE_GEOMETRY.w_mm);
    const s_mm = parseFloat(elements.inputS.value);
    const s_mm_clamped = Number.isFinite(s_mm) && s_mm >= 0 ? s_mm : DEFAULT_GAUGE_GEOMETRY.s_mm;
    const n = parseInteger(elements.inputN.value, DEFAULT_GAUGE_GEOMETRY.n);
    const t_um = parsePositive(elements.inputT.value, DEFAULT_GAUGE_GEOMETRY.t_um);
    const L_specimen_mm = parsePositive(elements.inputLSpecimen.value, 100);
    const A_specimen_mm2 = parsePositive(elements.inputASpecimen.value, 100);

    const forceFromSlider = parseFloat(elements.sliderF.value);
    const forceFromInput = parseFloat(elements.inputForce.value);
    const F = Number.isFinite(forceFromInput) ? forceFromInput : forceFromSlider;

    const tempFromSlider = parseFloat(elements.sliderTemp.value);
    const tempFromInput = parseFloat(elements.inputTemp.value);
    const T = Number.isFinite(tempFromInput) ? tempFromInput : tempFromSlider;

    return {
      materialKey: elements.materialSelect.value,
      n,
      l_grid: l_grid_mm * MM_TO_M,
      w: w_mm * MM_TO_M,
      s: s_mm_clamped * MM_TO_M,
      t: t_um * UM_TO_M,
      L_specimen: L_specimen_mm * MM_TO_M,
      A_specimen: A_specimen_mm2 * MM2_TO_M2,
      F,
      T,
      display: {
        l_grid_mm,
        w_mm,
        s_mm: s_mm_clamped,
        n,
        t_um,
        L_specimen_mm,
        A_specimen_mm2,
      },
    };
  }

  function updateForceSliderRange(forceLimits) {
    const min = forceLimits.min;
    const max = forceLimits.max;
    elements.sliderF.min = String(min);
    elements.sliderF.max = String(max);

    const step = Math.max(1, (max - min) / 1000);
    elements.sliderF.step = String(step);

    let current = parseFloat(elements.sliderF.value);
    if (Number.isNaN(current)) {
      current = 0;
    }
    current = Math.max(min, Math.min(max, current));
    elements.sliderF.value = String(current);
    elements.inputForce.value = current.toFixed(2);
  }

  function syncTemperatureInputs(T) {
    elements.sliderTemp.value = String(T);
    elements.inputTemp.value = String(T);
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

  function formatStressPaMpa(sigma) {
    const mpa = sigma / 1e6;
    if (Math.abs(mpa) >= 0.01) {
      return mpa.toFixed(3) + ' MPa (' + formatPowerOfTen(sigma, 2) + ' Pa)';
    }
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

  function formatResistance(value) {
    return formatPowerOfTen(value, 6) + ' Ω';
  }

  function formatPercent(value) {
    if (!Number.isFinite(value)) {
      return '— %';
    }
    return value.toFixed(4) + ' %';
  }

  function renderReadouts(result) {
    if (!result || !result.valid) {
      elements.readoutLTotal.textContent = '— mm';
      elements.readoutAGauge.textContent = '— mm²';
      elements.readoutFMax.textContent = '— N';
      return;
    }
    elements.readoutLTotal.textContent = formatMm(result.geometry.L_total);
    elements.readoutAGauge.textContent = formatMmSquared(result.geometry.A_gauge);
    elements.readoutFMax.textContent = formatForce(result.F_max);
  }

  function renderDiagramStats(result) {
    if (!result) {
      return;
    }
    elements.diagramLTotal.textContent = result.valid
      ? formatMm(result.geometry.L_total)
      : '— mm';
    const forceActive = result.valid && Math.abs(result.F_clamped) >= FORCE_ZERO_EPS;
    elements.diagramDeltaL.textContent = forceActive
      ? formatMm(result.deltaL_specimen)
      : '— mm';
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

  function renderPropertyGrid(container, props) {
    container.textContent = '';
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
      container.appendChild(item);
    });
  }

  function renderMaterialProperties(material) {
    if (!material) {
      elements.materialProperties.textContent = '';
      return;
    }
    renderPropertyGrid(elements.materialProperties, [
      { label: 'ρ', value: formatPowerOfTen(material.rho, 2) + ' Ω·m' },
      { label: 'α', value: material.alpha.toExponential(2) + ' 1/°C' },
      { label: 'GF', value: material.GF.toFixed(1) },
      { label: 'E_gauge', value: (material.E / 1e9).toFixed(0) + ' GPa' },
      { label: 'ν_gauge', value: material.nu.toFixed(2) },
      { label: 'σ_y_gauge', value: (material.sigma_y / 1e6).toFixed(0) + ' MPa' },
    ]);
  }

  function renderSpecimenProperties(specimen) {
    if (!specimen) {
      elements.specimenProperties.textContent = '';
      return;
    }
    renderPropertyGrid(elements.specimenProperties, [
      { label: 'E_specimen', value: (specimen.E / 1e9).toFixed(0) + ' GPa' },
      { label: 'ν_specimen', value: specimen.nu.toFixed(2) },
      { label: 'σ_y_specimen', value: (specimen.sigma_y / 1e6).toFixed(0) + ' MPa' },
    ]);
  }

  function renderComputedResults(result) {
    elements.computedResults.textContent = '';
    if (!result || !result.valid) {
      return;
    }

    const rows = [
      { label: 'L_total', value: formatMm(result.geometry.L_total) + ' (' + formatPowerOfTen(result.geometry.L_total, 2) + ' m)' },
      { label: 'A_gauge', value: formatMmSquared(result.geometry.A_gauge) + ' (' + formatPowerOfTen(result.geometry.A_gauge, 2) + ' m²)' },
      { label: 'σ', value: formatStressPaMpa(result.sigma) },
      { label: 'ε', value: result.epsilon.toExponential(4) },
      { label: 'ε_lateral', value: result.epsilon_lateral.toExponential(4) },
      { label: 'ΔL_specimen', value: formatMm(result.deltaL_specimen) },
      { label: 'R_nominal', value: formatResistance(result.R_nominal) },
      { label: 'R_strained', value: formatResistance(result.R_strained) },
      { label: 'ΔR/R', value: formatPercent(result.deltaR_ratio) },
      { label: 'R(T)', value: formatResistance(result.R_T) },
      { label: 'ΔR_thermal/R', value: formatPercent(result.deltaR_thermal_ratio) },
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

  function computeVisualRatios(result, inputs) {
    if (!result.valid || inputs.L_specimen <= 0 || Math.abs(result.F_clamped) < FORCE_ZERO_EPS) {
      return { lengthRatio: 1, widthRatio: 1 };
    }
    const axialStrain = result.deltaL_specimen / inputs.L_specimen;
    const lateralStrain = result.epsilon_lateral;
    return {
      lengthRatio: 1 + axialStrain * VISUAL_STRAIN_GAIN,
      widthRatio: 1 + lateralStrain * VISUAL_STRAIN_GAIN,
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
    resizeSingleCanvas(elements.canvas, ctx);
    resizeSingleCanvas(elements.detailCanvas, detailCtx);
    renderDiagram(lastResult, lastInputs);
    renderDetailDiagram();
  }

  function resizeSingleCanvas(canvas, context) {
    const container = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = container.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function padWidthFromW(w) {
    return 2 * w;
  }

  function drawArrowOn(context, x1, y1, x2, y2, color, lineWidth) {
    const headLen = 8;
    const angle = Math.atan2(y2 - y1, x2 - x1);

    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = lineWidth;
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();

    context.beginPath();
    context.moveTo(x2, y2);
    context.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
    context.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
    context.closePath();
    context.fill();
  }

  function drawDoubleArrowOn(context, x1, y1, x2, y2, color) {
    drawArrowOn(context, x1, y1, x2, y2, color, 1.5);
    drawArrowOn(context, x2, y2, x1, y1, color, 1.5);
  }

  function drawArrow(x1, y1, x2, y2, color, lineWidth) {
    drawArrowOn(ctx, x1, y1, x2, y2, color, lineWidth);
  }

  function drawDoubleArrow(x1, y1, x2, y2, color) {
    drawDoubleArrowOn(ctx, x1, y1, x2, y2, color);
  }

  function gaugePatternHeight(n, w, s) {
    return n * w + Math.max(0, n - 1) * s;
  }

  function buildSerpentineSegments(n, lGrid, w, s, padWidth) {
    const segments = [];
    for (let i = 0; i < n; i += 1) {
      const y = i * (w + s);
      const left = i % 2 === 0 ? padWidth : padWidth;
      const right = left + lGrid;
      segments.push({ x1: left, y: y, x2: right, y: y, w: w, row: i });
    }
    return segments;
  }

  function drawTerminalPads(context, x, y, w, patternH, fill, stroke) {
    const padR = w;
    context.fillStyle = fill;
    context.strokeStyle = stroke;
    context.lineWidth = 1.5;

    context.beginPath();
    context.ellipse(x + padR, y + w / 2, padR, padR, 0, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    context.beginPath();
    context.ellipse(x + padR, y + patternH - w / 2, padR, padR, 0, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  function drawSerpentineGauge(context, bx, by, scaleX, scaleY, n, lGrid, w, s, padWidth, options) {
    const fill = options.fill;
    const stroke = options.stroke;
    const lineWidth = options.lineWidth;
    const dashed = options.dashed;

    const patternH = gaugePatternHeight(n, w, s);
    const totalW = padWidth + lGrid;

    context.save();
    context.translate(bx, by);
    context.scale(scaleX, scaleY);

    if (dashed) {
      context.setLineDash([5, 4]);
    }

    drawTerminalPads(context, 0, 0, w, patternH, fill, stroke);

    for (let i = 0; i < n; i += 1) {
      const y = i * (w + s);
      const xStart = padWidth;
      const xEnd = xStart + lGrid;
      const dir = i % 2 === 0 ? 1 : -1;
      const segX1 = dir === 1 ? xStart : xEnd;
      const segX2 = dir === 1 ? xEnd : xStart;

      context.fillStyle = fill;
      context.strokeStyle = stroke;
      context.lineWidth = lineWidth / Math.min(scaleX, scaleY);
      context.fillRect(Math.min(segX1, segX2), y, Math.abs(segX2 - segX1), w);
      context.strokeRect(Math.min(segX1, segX2), y, Math.abs(segX2 - segX1), w);

      if (i < n - 1) {
        const nextY = (i + 1) * (w + s);
        const connectX = i % 2 === 0 ? xEnd : xStart;
        context.fillRect(connectX - w / 2, y + w, w, nextY - y);
        context.strokeRect(connectX - w / 2, y + w, w, nextY - y);
      }
    }

    context.setLineDash([]);
    context.restore();

    return { totalW, patternH };
  }

  function traceSerpentineCenterline(context, n, lGrid, w, s, padWidth) {
    const xStart = padWidth;
    const xEnd = padWidth + lGrid;

    for (let i = 0; i < n; i += 1) {
      const yCenter = i * (w + s) + w / 2;
      const left = i % 2 === 0 ? xStart : xEnd;
      const right = i % 2 === 0 ? xEnd : xStart;

      if (i === 0) {
        context.moveTo(left, yCenter);
      } else {
        context.lineTo(left, yCenter);
      }
      context.lineTo(right, yCenter);
    }
  }

  function drawSerpentineGaugeDetail(context, bx, by, scaleX, scaleY, n, lGrid, w, s, options) {
    const fill = options.fill;
    const stroke = options.stroke;
    const lineWidth = options.lineWidth;
    const patternH = gaugePatternHeight(n, w, s);
    const totalW = lGrid;
    const outlineExtra = lineWidth / Math.min(scaleX, scaleY);

    context.save();
    context.translate(bx, by);
    context.scale(scaleX, scaleY);

    context.lineCap = 'butt';
    context.lineJoin = 'miter';
    context.miterLimit = 10;

    context.beginPath();
    traceSerpentineCenterline(context, n, lGrid, w, s, 0);

    context.strokeStyle = stroke;
    context.lineWidth = w + outlineExtra * 2;
    context.stroke();

    context.beginPath();
    traceSerpentineCenterline(context, n, lGrid, w, s, 0);
    context.strokeStyle = fill;
    context.lineWidth = w;
    context.stroke();

    context.restore();

    return { totalW, patternH };
  }

  function formatDisplayMm(value) {
    const abs = Math.abs(value);
    if (abs === 0) {
      return '0 mm';
    }
    if (abs < 0.01) {
      return value.toExponential(2) + ' mm';
    }
    if (abs < 1) {
      return value.toFixed(2) + ' mm';
    }
    return value.toFixed(1) + ' mm';
  }

  function renderOverviewDiagram(result, inputs) {
    const width = elements.canvas.clientWidth;
    const height = elements.canvas.clientHeight;
    ctx.clearRect(0, 0, width, height);

    const marginTop = 50;
    const marginBottom = 70;
    const marginLeft = 48;
    const marginRight = 48;
    const drawWidth = width - marginLeft - marginRight;
    const drawHeight = height - marginTop - marginBottom;

    const display = inputs && inputs.display ? inputs.display : {
      l_grid_mm: DEFAULT_GAUGE_GEOMETRY.l_grid_mm,
      w_mm: DEFAULT_GAUGE_GEOMETRY.w_mm,
      s_mm: DEFAULT_GAUGE_GEOMETRY.s_mm,
      n: DEFAULT_GAUGE_GEOMETRY.n,
      L_specimen_mm: 100,
    };

    const origSpecW = drawWidth * 0.82;
    const origSpecH = drawHeight * 0.42;
    const defSpecW = origSpecW * animState.lengthRatio;
    const defSpecH = origSpecH * animState.widthRatio;

    const centerY = marginTop + drawHeight / 2;
    const origLeft = marginLeft + (drawWidth - origSpecW) / 2;
    const defLeft = marginLeft + (drawWidth - defSpecW) / 2;
    const origTop = centerY - origSpecH / 2;
    const defTop = centerY - defSpecH / 2;

    const forceActive = Math.abs(animState.force) >= FORCE_ZERO_EPS;
    const dimColor = getCssVar('--color-text');
    const specimenFill = getCssVar('--color-specimen-fill');
    const specimenOpacity = parseFloat(getCssVar('--color-specimen-fill-opacity')) || 0.35;
    const specimenOutline = getCssVar('--color-specimen-outline');
    const gaugeFill = getCssVar('--color-gauge-fill');
    const gaugeOutline = getCssVar('--color-gauge-outline');
    const dashedColor = getCssVar('--color-bar-dashed');

    if (forceActive) {
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = dashedColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(origLeft, origTop, origSpecW, origSpecH);
      ctx.setLineDash([]);
    }

    ctx.fillStyle = specimenFill;
    ctx.globalAlpha = specimenOpacity;
    ctx.fillRect(defLeft, defTop, defSpecW, defSpecH);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = specimenOutline;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(defLeft, defTop, defSpecW, defSpecH);

    if (!forceActive) {
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = dashedColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(origLeft, origTop, origSpecW, origSpecH);
      ctx.setLineDash([]);
    }

    const padWidth = padWidthFromW(display.w_mm);
    const patternW = padWidth + display.l_grid_mm;
    const patternH = gaugePatternHeight(display.n, display.w_mm, display.s_mm);
    const gaugeMargin = 12;
    const availW = origSpecW - gaugeMargin * 2;
    const availH = origSpecH * 0.55;
    const fitScale = Math.min(availW / patternW, availH / patternH);
    const baseScaleX = fitScale;
    const baseScaleY = fitScale;

    const origGaugeW = patternW * baseScaleX;
    const origGaugeH = patternH * baseScaleY;
    const defGaugeW = origGaugeW * animState.lengthRatio;
    const defGaugeH = origGaugeH * animState.widthRatio;

    const defGaugeX = defLeft + (defSpecW - defGaugeW) / 2;
    const defGaugeY = defTop + defSpecH * 0.22;

    drawSerpentineGauge(
      ctx,
      defGaugeX,
      defGaugeY,
      baseScaleX * animState.lengthRatio,
      baseScaleY * animState.widthRatio,
      display.n,
      display.l_grid_mm,
      display.w_mm,
      display.s_mm,
      padWidth,
      { fill: gaugeFill, stroke: gaugeOutline, lineWidth: 1.5, dashed: false }
    );

    ctx.fillStyle = dimColor;
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';

    ctx.textAlign = 'center';
    ctx.fillText('SPECIMEN (steel)', defLeft + defSpecW / 2, defTop + defSpecH + 18);

    if (result && result.valid) {
      ctx.textAlign = 'left';
      ctx.fillText('L_total ≈ ' + formatMm(result.geometry.L_total), defLeft, defTop - 8);
      ctx.fillText('n = ' + display.n, defLeft + defSpecW - 40, defTop - 8);
    }

    const dimY = defTop + defSpecH + 38;
    drawDoubleArrow(defLeft, dimY, defLeft + defSpecW, dimY, dimColor);
    ctx.textAlign = 'center';
    ctx.fillText('l_grid', defLeft + defSpecW / 2, dimY + 16);

    if (forceActive && result && result.valid) {
      const deltaY = marginTop + drawHeight + 18;
      drawDoubleArrow(defLeft + defSpecW * 0.15, deltaY, defLeft + defSpecW * 0.15 + defSpecW * 0.1, deltaY, dimColor);
      ctx.textAlign = 'left';
      ctx.fillText('ΔL_specimen', defLeft + defSpecW * 0.15 + defSpecW * 0.1 + 6, deltaY + 4);
    }

    if (forceActive) {
      const maxArrowLen = 36;
      const forceRatio = result && result.valid && result.forceLimits.max > 0
        ? Math.abs(animState.force) / result.forceLimits.max
        : 0;
      const arrowLen = 16 + forceRatio * maxArrowLen;
      const arrowY = centerY;
      const forceColor = animState.force > 0
        ? getCssVar('--color-danger')
        : getCssVar('--color-success');

      if (animState.force > 0) {
        drawArrow(defLeft - 10, arrowY, defLeft - 10 - arrowLen, arrowY, forceColor, 3);
        drawArrow(defLeft + defSpecW + 10, arrowY, defLeft + defSpecW + 10 + arrowLen, arrowY, forceColor, 3);
        ctx.fillStyle = forceColor;
        ctx.textAlign = 'right';
        ctx.fillText('← F', defLeft - 14 - arrowLen, arrowY - 8);
        ctx.textAlign = 'left';
        ctx.fillText('F →', defLeft + defSpecW + 14 + arrowLen, arrowY - 8);
      } else {
        drawArrow(defLeft - 10 - arrowLen, arrowY, defLeft - 10, arrowY, forceColor, 3);
        drawArrow(defLeft + defSpecW + 10 + arrowLen, arrowY, defLeft + defSpecW + 10, arrowY, forceColor, 3);
        ctx.fillStyle = forceColor;
        ctx.textAlign = 'right';
        ctx.fillText('F →', defLeft - 14 - arrowLen, arrowY - 8);
        ctx.textAlign = 'left';
        ctx.fillText('← F', defLeft + defSpecW + 14 + arrowLen, arrowY - 8);
      }
    }
  }

  function renderDetailDiagram() {
    const width = elements.detailCanvas.clientWidth;
    const height = elements.detailCanvas.clientHeight;
    detailCtx.clearRect(0, 0, width, height);

    const marginTop = 28;
    const marginBottom = 36;
    const marginLeft = 72;
    const marginRight = 72;
    const drawWidth = width - marginLeft - marginRight;
    const drawHeight = height - marginTop - marginBottom;

    const ref = GRID_DETAIL_REFERENCE;
    const dimColor = getCssVar('--color-text');
    const gaugeFill = getCssVar('--color-gauge-fill');
    const gaugeOutline = getCssVar('--color-gauge-outline');

    const patternW = ref.l_grid_mm;
    const patternH = gaugePatternHeight(ref.n, ref.w_mm, ref.s_mm);
    const fitScale = Math.min(drawWidth / patternW, drawHeight / patternH);
    const gaugeW = patternW * fitScale;
    const gaugeH = patternH * fitScale;
    const gaugeX = marginLeft + (drawWidth - gaugeW) / 2;
    const gaugeY = marginTop + (drawHeight - gaugeH) / 2;

    drawSerpentineGaugeDetail(
      detailCtx,
      gaugeX,
      gaugeY,
      fitScale,
      fitScale,
      ref.n,
      ref.l_grid_mm,
      ref.w_mm,
      ref.s_mm,
      { fill: gaugeFill, stroke: gaugeOutline, lineWidth: 1.5 }
    );

    detailCtx.fillStyle = dimColor;
    detailCtx.font = '600 12px "Segoe UI", system-ui, sans-serif';

    const lArrowY = gaugeY - 14;
    drawDoubleArrowOn(detailCtx, gaugeX, lArrowY, gaugeX + gaugeW, lArrowY, dimColor);
    detailCtx.textAlign = 'center';
    detailCtx.fillText('l', gaugeX + gaugeW / 2, lArrowY - 8);

    const wArrowX = gaugeX - 22;
    const wTop = gaugeY;
    const wBottom = gaugeY + ref.w_mm * fitScale;
    drawDoubleArrowOn(detailCtx, wArrowX, wTop, wArrowX, wBottom, dimColor);
    detailCtx.textAlign = 'right';
    detailCtx.fillText('w', wArrowX - 8, (wTop + wBottom) / 2 + 4);

    const sArrowX = gaugeX + gaugeW + 22;
    const sTop = gaugeY + ref.w_mm * fitScale;
    const sBottom = sTop + ref.s_mm * fitScale;
    drawDoubleArrowOn(detailCtx, sArrowX, sTop, sArrowX, sBottom, dimColor);
    detailCtx.textAlign = 'left';
    detailCtx.fillText('s', sArrowX + 8, (sTop + sBottom) / 2 + 4);
  }

  function renderDiagram(result, inputs) {
    renderOverviewDiagram(result, inputs);
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
    const result = StrainGaugePhysics.computeSerpentineGauge(inputs);
    lastResult = result;
    lastInputs = inputs;

    updateForceSliderRange(result.forceLimits);

    if (result.valid) {
      elements.sliderF.value = String(result.F_clamped);
      elements.inputForce.value = result.F_clamped.toFixed(2);
    }

    const T = Math.max(-40, Math.min(200, inputs.T));
    syncTemperatureInputs(T);

    elements.forceValue.textContent = formatForce(result.F_clamped);

    renderReadouts(result);
    renderMaterialProperties(result.material);
    renderSpecimenProperties(result.specimen);
    renderComputedResults(result);
    renderDiagramStats(result);
    setAnimationTargets(result, inputs);
  }

  function initResultsVisibilityToggle() {
    const toggle = elements.resultsVisibilityToggle;
    const body = elements.resultsBody;
    if (!toggle || !body) {
      return;
    }

    let visible = true;

    function syncVisibility() {
      body.classList.toggle('is-collapsed', !visible);
      toggle.classList.toggle('is-hidden-state', !visible);
      toggle.setAttribute('aria-pressed', String(visible));
      toggle.setAttribute(
        'aria-label',
        visible ? 'Hide equations and results' : 'Show equations and results'
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
    elements.inputLGrid.addEventListener('input', updateUI);
    elements.inputW.addEventListener('input', updateUI);
    elements.inputS.addEventListener('input', updateUI);
    elements.inputN.addEventListener('input', updateUI);
    elements.inputT.addEventListener('input', updateUI);
    elements.inputLSpecimen.addEventListener('input', updateUI);
    elements.inputASpecimen.addEventListener('input', updateUI);
    elements.sliderF.addEventListener('input', function () {
      elements.inputForce.value = elements.sliderF.value;
      updateUI();
    });
    elements.inputForce.addEventListener('input', updateUI);
    elements.sliderTemp.addEventListener('input', function () {
      elements.inputTemp.value = elements.sliderTemp.value;
      updateUI();
    });
    elements.inputTemp.addEventListener('input', updateUI);

    window.addEventListener('resize', resizeCanvas);

    const themeObserver = new MutationObserver(function () {
      renderDiagram(lastResult, lastInputs);
      renderDetailDiagram();
    });
    themeObserver.observe(elements.html, { attributes: true, attributeFilter: ['data-theme'] });
  }

  function applyDefaultGaugeGeometry() {
    elements.materialSelect.value = DEFAULT_GAUGE_GEOMETRY.materialKey;
    elements.inputLGrid.value = String(DEFAULT_GAUGE_GEOMETRY.l_grid_mm);
    elements.inputW.value = String(DEFAULT_GAUGE_GEOMETRY.w_mm);
    elements.inputS.value = String(DEFAULT_GAUGE_GEOMETRY.s_mm);
    elements.inputN.value = String(DEFAULT_GAUGE_GEOMETRY.n);
    elements.inputT.value = String(DEFAULT_GAUGE_GEOMETRY.t_um);
  }

  function init() {
    initTheme();
    applyDefaultGaugeGeometry();
    initResultsVisibilityToggle();
    bindEvents();
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
