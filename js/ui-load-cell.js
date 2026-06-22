/**
 * Load cell UI layer — DOM, events, and diagram rendering only.
 * No physics formulas; delegates computation to LoadCellPhysics.
 */

(function () {
  'use strict';

  const FORCE_ZERO_EPS = 0.001;
  const FORCE_MAX_GRAM = 10000;
  const DEFAULT_K = 0.001;
  const BEAM_DEFLECTION_RATIO = 0.18;
  const ANIMATION_SETTLE_MS = 150;

  const elements = {
    html: document.documentElement,
    themeToggle: document.getElementById('theme-toggle'),
    themeToggleIcon: document.getElementById('theme-toggle-icon'),
    themeToggleLabel: document.getElementById('theme-toggle-label'),
    inputVs: document.getElementById('lc-input-Vs'),
    sliderF: document.getElementById('lc-slider-F'),
    inputFGram: document.getElementById('lc-input-F-gram'),
    inputGF: document.getElementById('lc-input-GF'),
    inputR1: document.getElementById('lc-input-R1'),
    inputR2: document.getElementById('lc-input-R2'),
    inputR3: document.getElementById('lc-input-R3'),
    inputR4: document.getElementById('lc-input-R4'),
    btnResetR: document.getElementById('lc-btn-reset-r'),
    warningBanner: document.getElementById('lc-warning-banner'),
    bridgeCanvas: document.getElementById('lc-bridge-canvas'),
    beamCanvas: document.getElementById('lc-beam-canvas'),
    equationsList: document.getElementById('lc-equations-list'),
    computedResults: document.getElementById('lc-computed-results'),
    voValue: document.getElementById('lc-vo-value'),
  };

  const bridgeCtx = elements.bridgeCanvas ? elements.bridgeCanvas.getContext('2d') : null;
  const beamCtx = elements.beamCanvas ? elements.beamCanvas.getContext('2d') : null;

  let storedNominals = { R1: 100, R2: 100, R3: 100, R4: 100 };
  let lastForceWasZero = true;
  let lastResult = null;
  let lastInputs = null;

  let animState = {
    deflectionRatio: 0,
    targetDeflectionRatio: 0,
    forceGram: 0,
    targetForceGram: 0,
    animating: false,
  };
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
    renderBridgeCanvas(lastResult);
    renderBeamCanvas(lastResult);
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

  function parseNum(input, fallback) {
    const value = parseFloat(input.value);
    return Number.isFinite(value) ? value : fallback;
  }

  function readResistanceNominals() {
    return {
      R1_nom: parseNum(elements.inputR1, storedNominals.R1),
      R2_nom: parseNum(elements.inputR2, storedNominals.R2),
      R3_nom: parseNum(elements.inputR3, storedNominals.R3),
      R4_nom: parseNum(elements.inputR4, storedNominals.R4),
    };
  }

  function readInputs() {
    const F_gram = parseNum(elements.inputFGram, 0);
    const nominals = readResistanceNominals();
    return {
      Vs: parseNum(elements.inputVs, 5),
      F_gram: Math.max(0, Math.min(FORCE_MAX_GRAM, F_gram)),
      GF: parseNum(elements.inputGF, 2.0),
      k: DEFAULT_K,
      R1_nom: nominals.R1_nom,
      R2_nom: nominals.R2_nom,
      R3_nom: nominals.R3_nom,
      R4_nom: nominals.R4_nom,
      forceActive: F_gram > FORCE_ZERO_EPS,
    };
  }

  function syncForceControls(F_gram) {
    const clamped = Math.max(0, Math.min(FORCE_MAX_GRAM, F_gram));
    elements.sliderF.value = String(clamped);
    elements.inputFGram.value = clamped.toFixed(2);
  }

  function setResistanceInputsLocked(locked) {
    const inputs = [elements.inputR1, elements.inputR2, elements.inputR3, elements.inputR4];
    inputs.forEach(function (input) {
      input.disabled = locked;
      input.classList.toggle('lc-input-locked', locked);
    });
  }

  function updateResistanceDisplays(result) {
    if (!result || !result.valid) {
      return;
    }
    elements.inputR1.value = result.R1.toFixed(4);
    elements.inputR2.value = result.R2.toFixed(4);
    elements.inputR3.value = result.R3.toFixed(4);
    elements.inputR4.value = result.R4.toFixed(4);
  }

  function restoreNominalResistanceInputs() {
    elements.inputR1.value = storedNominals.R1.toFixed(2);
    elements.inputR2.value = storedNominals.R2.toFixed(2);
    elements.inputR3.value = storedNominals.R3.toFixed(2);
    elements.inputR4.value = storedNominals.R4.toFixed(2);
  }

  function snapshotNominalsFromInputs() {
    storedNominals = {
      R1: parseNum(elements.inputR1, 100),
      R2: parseNum(elements.inputR2, 100),
      R3: parseNum(elements.inputR3, 100),
      R4: parseNum(elements.inputR4, 100),
    };
  }

  function handleForceTransition(inputs) {
    const forceActive = inputs.forceActive;

    if (lastForceWasZero && forceActive) {
      snapshotNominalsFromInputs();
      setResistanceInputsLocked(true);
    } else if (!lastForceWasZero && !forceActive) {
      restoreNominalResistanceInputs();
      setResistanceInputsLocked(false);
    } else if (forceActive) {
      setResistanceInputsLocked(true);
    } else {
      setResistanceInputsLocked(false);
    }

    lastForceWasZero = !forceActive;
  }

  function resetAll() {
    elements.inputR1.value = '100';
    elements.inputR2.value = '100';
    elements.inputR3.value = '100';
    elements.inputR4.value = '100';
    storedNominals = { R1: 100, R2: 100, R3: 100, R4: 100 };
    syncForceControls(0);
    lastForceWasZero = true;
    setResistanceInputsLocked(false);
    updateUI();
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

  function formatNumber(value, digits) {
    digits = digits === undefined ? 4 : digits;
    if (typeof value !== 'number' || isNaN(value)) {
      return '—';
    }
    const abs = Math.abs(value);
    if (abs >= 1000 || (abs > 0 && abs < 0.0001)) {
      return formatPowerOfTen(value, 2);
    }
    return value.toFixed(digits);
  }

  function formatResistance(value) {
    if (typeof value !== 'number' || isNaN(value)) {
      return '— Ω';
    }
    if (Math.abs(value) >= 1000 || (value > 0 && value < 0.01)) {
      return formatPowerOfTen(value, 4) + ' Ω';
    }
    return value.toFixed(4) + ' Ω';
  }

  function formatVoltage(value) {
    if (typeof value !== 'number' || isNaN(value)) {
      return '— V';
    }
    return value.toFixed(6) + ' V';
  }

  function latexNum(value, digits) {
    return formatNumber(value, digits === undefined ? 4 : digits);
  }

  function renderKatex(latex, container) {
    container.textContent = '';
    if (typeof katex !== 'undefined') {
      try {
        katex.render(latex, container, { throwOnError: false, displayMode: true });
      } catch (err) {
        const pre = document.createElement('pre');
        pre.textContent = latex;
        container.appendChild(pre);
      }
    } else {
      const pre = document.createElement('pre');
      pre.textContent = latex;
      container.appendChild(pre);
    }
  }

  function buildEquationLatex(result) {
    if (!result || !result.valid) {
      return [];
    }

    const Vs = result.Vs;
    const R1 = result.R1;
    const R2 = result.R2;
    const R3 = result.R3;
    const R4 = result.R4;
    const Va = result.Va;
    const Vb = result.Vb;
    const Vo = result.Vo;
    return [
      String.raw`V_o = V_a - V_b = ${latexNum(Va)} - ${latexNum(Vb)} = ${latexNum(Vo)}\ \text{V}`,
      String.raw`V_a = \frac{R_3}{R_2 + R_3} \times V_s = \frac{${latexNum(R3)}}{${latexNum(R2)} + ${latexNum(R3)}} \times ${latexNum(Vs)} = ${latexNum(Va)}\ \text{V}`,
      String.raw`V_b = \frac{R_4}{R_1 + R_4} \times V_s = \frac{${latexNum(R4)}}{${latexNum(R1)} + ${latexNum(R4)}} \times ${latexNum(Vs)} = ${latexNum(Vb)}\ \text{V}`,
    ];
  }

  function renderEquations(result) {
    elements.equationsList.textContent = '';
    const equations = buildEquationLatex(result);
    equations.forEach(function (latex) {
      const div = document.createElement('div');
      div.className = 'equation-item';
      renderKatex(latex, div);
      elements.equationsList.appendChild(div);
    });
  }

  function renderComputedResults(result) {
    if (!result || !result.valid) {
      elements.voValue.textContent = '0.000000 V';
      return;
    }

    elements.voValue.textContent = formatVoltage(result.Vo);
  }

  function renderWarnings(result) {
    if (!result || !result.warnings || result.warnings.length === 0) {
      elements.warningBanner.hidden = true;
      elements.warningBanner.textContent = '';
      return;
    }
    elements.warningBanner.hidden = false;
    elements.warningBanner.textContent = result.warnings.join(' ');
  }

  function resizeCanvas(canvas, ctx, renderFn) {
    if (!canvas || !ctx) {
      return;
    }
    const container = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = container.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderFn();
  }

  function resizeCanvases() {
    resizeCanvas(elements.bridgeCanvas, bridgeCtx, function () {
      renderBridgeCanvas(lastResult);
    });
    resizeCanvas(elements.beamCanvas, beamCtx, function () {
      renderBeamCanvas(lastResult);
    });
  }

  function drawHatchedWall(ctx, x, y, width, height) {
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

  function drawArrow(ctx, x1, y1, x2, y2, color, lineWidth) {
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

  function drawOpenResistor(ctx, x1, y1, x2, y2, color) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) {
      return;
    }
    const ux = dx / len;
    const uy = dy / len;
    const margin = len * 0.18;
    const bodyLen = len * 0.52;
    const bodyW = 8;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const angle = Math.atan2(dy, dx);

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(midX - ux * bodyLen / 2, midY - uy * bodyLen / 2);
    ctx.stroke();

    ctx.save();
    ctx.translate(midX, midY);
    ctx.rotate(angle);
    ctx.strokeRect(-bodyLen / 2, -bodyW / 2, bodyLen, bodyW);
    ctx.restore();

    ctx.beginPath();
    ctx.moveTo(midX + ux * bodyLen / 2, midY + uy * bodyLen / 2);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function drawVoltageSource(ctx, cx, cy, radius, wireColor, textColor) {
    ctx.strokeStyle = wireColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = textColor;
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('+', cx, cy - radius * 0.45);
    ctx.fillText('−', cx, cy + radius * 0.45);
  }

  function addStadiumHolePath(ctx, pillLeftX, pillRightX, cy, radius) {
    const leftCX = pillLeftX + radius;
    const rightCX = pillRightX - radius;
    ctx.moveTo(leftCX, cy - radius);
    ctx.lineTo(rightCX, cy - radius);
    ctx.arc(rightCX, cy, radius, -Math.PI / 2, Math.PI / 2, false);
    ctx.lineTo(leftCX, cy + radius);
    ctx.arc(leftCX, cy, radius, Math.PI / 2, -Math.PI / 2, false);
    ctx.closePath();
  }

  function addRotatedStadiumHolePath(ctx, cutoutCenterX, cutoutW, endR, beamLeft, beamRight, beamTop, beamHeight, deflect) {
    const yTop = beamYAtX(cutoutCenterX, beamLeft, beamRight, beamTop, deflect);
    const cyMid = yTop + beamHeight / 2;
    const angle = Math.atan(beamSlopeAtX(cutoutCenterX, beamLeft, beamRight, deflect));

    ctx.save();
    ctx.translate(cutoutCenterX, cyMid);
    ctx.rotate(angle);
    addStadiumHolePath(ctx, -cutoutW / 2, cutoutW / 2, 0, endR);
    ctx.restore();

    return cyMid;
  }

  const BEAM_EDGE_STEPS = 28;

  function traceBeamOutline(ctx, beamLeft, beamRight, beamTop, beamHeight, deflect) {
    const span = beamRight - beamLeft;
    for (let i = 0; i <= BEAM_EDGE_STEPS; i++) {
      const x = beamLeft + (span * i) / BEAM_EDGE_STEPS;
      const y = beamYAtX(x, beamLeft, beamRight, beamTop, deflect);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    for (let i = 0; i <= BEAM_EDGE_STEPS; i++) {
      const x = beamRight - (span * i) / BEAM_EDGE_STEPS;
      const y = beamYAtX(x, beamLeft, beamRight, beamTop, deflect) + beamHeight;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function fillBeamBody(ctx, deflect, beamLeft, beamRight, beamTop, beamHeight, cutoutCenterX, cutoutW, endR) {
    ctx.beginPath();
    traceBeamOutline(ctx, beamLeft, beamRight, beamTop, beamHeight, deflect);
    ctx.fillStyle = getCssVar('--color-beam-fill');
    ctx.globalAlpha = 0.55;
    ctx.fill();

    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    addRotatedStadiumHolePath(ctx, cutoutCenterX, cutoutW, endR, beamLeft, beamRight, beamTop, beamHeight, deflect);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    ctx.beginPath();
    addRotatedStadiumHolePath(ctx, cutoutCenterX, cutoutW, endR, beamLeft, beamRight, beamTop, beamHeight, deflect);
    ctx.fillStyle = getCssVar('--color-bg-elevated');
    ctx.fill();
  }

  function strokeBeamBody(ctx, deflect, beamLeft, beamRight, beamTop, beamHeight, cutoutCenterX, cutoutW, endR, strokeStyle) {
    ctx.strokeStyle = strokeStyle || getCssVar('--color-beam-outline');
    ctx.lineWidth = 2;

    ctx.beginPath();
    traceBeamOutline(ctx, beamLeft, beamRight, beamTop, beamHeight, deflect);
    ctx.stroke();

    ctx.beginPath();
    addRotatedStadiumHolePath(ctx, cutoutCenterX, cutoutW, endR, beamLeft, beamRight, beamTop, beamHeight, deflect);
    ctx.stroke();
  }

  function resistorColor(result, gaugeKey) {
    const neutral = getCssVar('--color-resistor-neutral');
    const tension = getCssVar('--color-tension');
    const compression = getCssVar('--color-compression');

    if (!result || !result.valid || !result.forceActive) {
      return neutral;
    }

    const current = result[gaugeKey];
    const nominal = result[gaugeKey + '_nom'];
    if (current > nominal) {
      return tension;
    }
    if (current < nominal) {
      return compression;
    }
    return neutral;
  }

  function renderBridgeCanvas(result) {
    if (!bridgeCtx) {
      return;
    }
    const ctx = bridgeCtx;
    const width = elements.bridgeCanvas.clientWidth;
    const height = elements.bridgeCanvas.clientHeight;
    ctx.clearRect(0, 0, width, height);

    const cx = width * 0.56;
    const cy = height * 0.5;
    const half = Math.min(width * 0.28, height * 0.34);
    const top = cy - half;
    const bottom = cy + half;
    const left = cx - half;
    const right = cx + half;

    const wireColor = getCssVar('--color-label');
    const textColor = getCssVar('--color-text');
    const accentColor = getCssVar('--color-accent');

    const srcCx = left - 100;
    const srcCy = cy;
    const srcR = 16;

    ctx.strokeStyle = wireColor;
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(cx, top);
    ctx.lineTo(srcCx, top);
    ctx.lineTo(srcCx, srcCy - srcR);
    ctx.moveTo(cx, bottom);
    ctx.lineTo(srcCx, bottom);
    ctx.lineTo(srcCx, srcCy + srcR);
    ctx.moveTo(left, cy);
    ctx.lineTo(right, cy);
    ctx.stroke();

    drawVoltageSource(ctx, srcCx, srcCy, srcR, wireColor, textColor);

    ctx.fillStyle = textColor;
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('V', srcCx - srcR - 14, srcCy - 2);
    ctx.fillText('s', srcCx - srcR - 6, srcCy - 2);

    drawOpenResistor(ctx, cx, top, left, cy, resistorColor(result, 'R1'));
    drawOpenResistor(ctx, cx, top, right, cy, resistorColor(result, 'R2'));
    drawOpenResistor(ctx, right, cy, cx, bottom, resistorColor(result, 'R3'));
    drawOpenResistor(ctx, left, cy, cx, bottom, resistorColor(result, 'R4'));

    ctx.strokeStyle = wireColor;
    ctx.lineWidth = 1.5;
    ctx.fillStyle = getCssVar('--color-bg-card');
    [left, right].forEach(function (jx) {
      ctx.beginPath();
      ctx.arc(jx, cy, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    ctx.fillStyle = textColor;
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('b', left - 14, cy + 1);
    ctx.fillText('a', right + 14, cy + 1);

    ctx.fillStyle = accentColor;
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('−', left - 14, cy - 14);
    ctx.fillText('+', right + 14, cy - 14);

    const voCx = cx;
    const voCy = cy;
    const voR = 16;
    ctx.beginPath();
    ctx.arc(voCx, voCy, voR, 0, Math.PI * 2);
    ctx.fillStyle = getCssVar('--color-bg-card');
    ctx.fill();
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = accentColor;
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('V', voCx - 4, voCy);
    ctx.fillText('o', voCx + 4, voCy);

    if (result && result.valid) {
      ctx.font = '500 11px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = getCssVar('--color-text-muted');
      ctx.textAlign = 'center';
      //ctx.fillText('R1 = ' + formatResistance(result.R1), (cx + left) / 2 - 8, (top + cy) / 2 - 14);
      //ctx.fillText('R2 = ' + formatResistance(result.R2), (cx + right) / 2 + 8, (top + cy) / 2 - 14);
      //ctx.fillText('R3 = ' + formatResistance(result.R3), (cx + right) / 2 + 8, (cy + bottom) / 2 + 16);
      //ctx.fillText('R4 = ' + formatResistance(result.R4), (cx + left) / 2 - 8, (cy + bottom) / 2 + 16);
      
      // Draw "R1 =" and the resistance value on two separate lines (with line spacing)
      const r1LabelX = (cx + left) / 2 - 8;
      let r1LabelY = (top + cy) / 2 - 14;
      ctx.fillText('R1 =', r1LabelX, r1LabelY);
      ctx.fillText(formatResistance(result.R1), r1LabelX-30, r1LabelY + 13);
      // Draw "R2 =" and the resistance value on two separate lines (with line spacing)
      const r2LabelX = (cx + right) / 2 + 8;
      let r2LabelY = (top + cy) / 2 - 14;
      ctx.fillText('R2 =', r2LabelX, r2LabelY);
      ctx.fillText(formatResistance(result.R2), r2LabelX + 30, r2LabelY + 13);

      // Draw "R3 =" and the resistance value on two separate lines (with line spacing)
      const r3LabelX = (cx + right) / 2 + 8;
      let r3LabelY = (cy + bottom) / 2 + 16;
      ctx.fillText('R3 =', r3LabelX, r3LabelY);
      ctx.fillText(formatResistance(result.R3), r3LabelX + 30, r3LabelY + 13);

      // Draw "R4 =" and the resistance value on two separate lines (with line spacing)
      const r4LabelX = (cx + left) / 2 - 8;
      let r4LabelY = (cy + bottom) / 2 + 16;
      ctx.fillText('R4 =', r4LabelX, r4LabelY);
      ctx.fillText(formatResistance(result.R4), r4LabelX - 30, r4LabelY + 13);
    }
  }

  function gaugeBeamColor(result, gaugeKey, isTension) {
    const neutral = getCssVar('--color-gauge-neutral');
    const tension = getCssVar('--color-tension');
    const compression = getCssVar('--color-compression');

    if (!result || !result.valid || !result.forceActive) {
      return neutral;
    }
    return isTension ? tension : compression;
  }

  function beamYAtX(x, beamLeft, beamRight, beamTop, deflection) {
    const t = (x - beamLeft) / (beamRight - beamLeft);
    return beamTop + deflection * t * t;
  }

  function beamSlopeAtX(x, beamLeft, beamRight, deflection) {
    const beamLength = beamRight - beamLeft;
    const t = (x - beamLeft) / beamLength;
    return (2 * deflection * t) / beamLength;
  }

  function renderBeamCanvas(result) {
    if (!beamCtx) {
      return;
    }
    const ctx = beamCtx;
    const width = elements.beamCanvas.clientWidth;
    const height = elements.beamCanvas.clientHeight;
    ctx.clearRect(0, 0, width, height);

    const wallWidth = 28;
    const beamLeft = wallWidth + 20;
    const beamRight = width - 50;
    const beamLength = beamRight - beamLeft;
    const beamTop = height * 0.42;
    const beamHeight = 36;
    const cutoutW = beamLength * 0.42;
    const cutoutH = beamHeight * 0.55;
    const endR = cutoutH * 0.48;
    const cutoutCenterX = beamLeft + beamLength * 0.42;
    const pillLeftX = cutoutCenterX - cutoutW / 2;
    const pillRightX = cutoutCenterX + cutoutW / 2;
    const leftBulbCX = pillLeftX + endR;
    const rightBulbCX = pillRightX - endR;

    const deflection = animState.deflectionRatio * beamLength * BEAM_DEFLECTION_RATIO;
    const forceActive = result && result.valid && result.forceActive;

    function yTop(x) {
      return beamYAtX(x, beamLeft, beamRight, beamTop, deflection);
    }

    function yBot(x) {
      return yTop(x) + beamHeight;
    }

    drawHatchedWall(ctx, 8, beamTop - 20, wallWidth, beamHeight + 40);

    if (forceActive) {
      ctx.setLineDash([6, 4]);
      strokeBeamBody(
        ctx, 0, beamLeft, beamRight, beamTop, beamHeight,
        cutoutCenterX, cutoutW, endR,
        getCssVar('--color-bar-dashed')
      );
      ctx.setLineDash([]);
    }

    fillBeamBody(ctx, deflection, beamLeft, beamRight, beamTop, beamHeight, cutoutCenterX, cutoutW, endR);
    strokeBeamBody(ctx, deflection, beamLeft, beamRight, beamTop, beamHeight, cutoutCenterX, cutoutW, endR);

    const gaugeW = 28;
    const gaugeH = 10;
    const g1x = leftBulbCX;
    const g2x = rightBulbCX;
    const gaugeGap = 2;

    function drawGaugeOnSurface(x, isTop, color, label) {
      const slope = beamSlopeAtX(x, beamLeft, beamRight, deflection);
      const angle = Math.atan(slope);
      const surfaceY = isTop ? yTop(x) : yBot(x);
      const rectY = isTop ? -gaugeH - gaugeGap : gaugeGap;

      ctx.save();
      ctx.translate(x, surfaceY);
      ctx.rotate(angle);

      ctx.fillStyle = color;
      ctx.fillRect(-gaugeW / 2, rectY, gaugeW, gaugeH);
      ctx.strokeStyle = getCssVar('--color-border');
      ctx.lineWidth = 1;
      ctx.strokeRect(-gaugeW / 2, rectY, gaugeW, gaugeH);

      ctx.fillStyle = getCssVar('--color-text');
      ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(label, 0, isTop ? rectY - 4 : rectY + gaugeH + 12);

      ctx.restore();
    }

    const r1Label = forceActive ? 'R1 Tension' : 'R1';
    const r2Label = forceActive ? 'R2 Compression' : 'R2';
    const r3Label = forceActive ? 'R3 Tension' : 'R3';
    const r4Label = forceActive ? 'R4 Compression' : 'R4';

    drawGaugeOnSurface(g1x, true, gaugeBeamColor(result, 'R1', true), r1Label);
    drawGaugeOnSurface(g2x, true, gaugeBeamColor(result, 'R2', false), r2Label);
    drawGaugeOnSurface(g1x, false, gaugeBeamColor(result, 'R4', false), r4Label);
    drawGaugeOnSurface(g2x, false, gaugeBeamColor(result, 'R3', true), r3Label);

    const padW = 22;
    const padH = 10;
    const padX = beamRight - padW + 4;
    const padCenterX = padX + padW / 2;
    const padTopY = yTop(padCenterX) - padH;

    ctx.fillStyle = getCssVar('--color-load-pad');
    ctx.fillRect(padX, padTopY, padW, padH);
    ctx.strokeStyle = getCssVar('--color-beam-outline');
    ctx.lineWidth = 1.5;
    ctx.strokeRect(padX, padTopY, padW, padH);

    if (forceActive) {
      const forceRatio = Math.min(1, animState.forceGram / FORCE_MAX_GRAM);
      const arrowLen = 16 + forceRatio * 40;
      const loadX = padCenterX;
      const loadY = padTopY;
      const forceColor = getCssVar('--color-danger');
      drawArrow(ctx, loadX, loadY - arrowLen / 2 - 4, loadX, loadY - 2, forceColor, 3);
      ctx.fillStyle = forceColor;
      ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('F', loadX, loadY - arrowLen / 2 - 8);
    }
  }

  function setAnimationTargets(result, inputs) {
    const forceGram = inputs && inputs.F_gram > FORCE_ZERO_EPS ? inputs.F_gram : 0;
    animState.targetDeflectionRatio = forceGram / FORCE_MAX_GRAM;
    animState.targetForceGram = forceGram;
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
    animState.deflectionRatio += (animState.targetDeflectionRatio - animState.deflectionRatio) * lerpFactor;
    animState.forceGram += (animState.targetForceGram - animState.forceGram) * lerpFactor;

    const defDone = Math.abs(animState.deflectionRatio - animState.targetDeflectionRatio) < 0.0001;
    const forceDone = Math.abs(animState.forceGram - animState.targetForceGram) < 0.01;

    if (defDone) {
      animState.deflectionRatio = animState.targetDeflectionRatio;
    }
    if (forceDone) {
      animState.forceGram = animState.targetForceGram;
    }

    renderBeamCanvas(lastResult);

    if (!defDone || !forceDone) {
      requestAnimationFrame(animationFrame);
    } else {
      animState.animating = false;
      lastAnimTime = null;
    }
  }

  function showError(message) {
    var banner = document.getElementById('js-error-banner');
    if (banner) {
      banner.hidden = false;
      banner.textContent = message;
    }
  }

  function warnIfFileProtocol() {
    if (window.location.protocol === 'file:') {
      showError(
        'Open this page via http://localhost:8080/load_cells.html (not file://). ' +
        'Start the server: docker compose -f docker/docker-compose.yml up -d'
      );
    }
  }

  function updateUI() {
    if (typeof LoadCellPhysics === 'undefined') {
      showError('physics-load-cell.js failed to load. Use http://localhost:8080/');
      return;
    }

    const inputs = readInputs();
    handleForceTransition(inputs);
    syncForceControls(inputs.F_gram);

    const computeInputs = Object.assign({}, inputs);
    if (inputs.forceActive) {
      computeInputs.R1_nom = storedNominals.R1;
      computeInputs.R2_nom = storedNominals.R2;
      computeInputs.R3_nom = storedNominals.R3;
      computeInputs.R4_nom = storedNominals.R4;
    }

    const result = LoadCellPhysics.computeLoadCell(computeInputs);
    lastResult = result;
    lastInputs = inputs;

    if (result.valid && inputs.forceActive) {
      updateResistanceDisplays(result);
    }

    renderWarnings(result);
    renderEquations(result);
    renderComputedResults(result);
    renderBridgeCanvas(result);
    renderBeamCanvas(result);
    setAnimationTargets(result, inputs);
  }

  function bindEvents() {
    elements.themeToggle.addEventListener('click', toggleTheme);
    elements.inputVs.addEventListener('input', updateUI);
    elements.inputGF.addEventListener('input', updateUI);
    elements.inputR1.addEventListener('input', updateUI);
    elements.inputR2.addEventListener('input', updateUI);
    elements.inputR3.addEventListener('input', updateUI);
    elements.inputR4.addEventListener('input', updateUI);
    elements.btnResetR.addEventListener('click', resetAll);

    elements.sliderF.addEventListener('input', function () {
      elements.inputFGram.value = parseFloat(elements.sliderF.value).toFixed(2);
      updateUI();
    });

    elements.inputFGram.addEventListener('input', function () {
      updateUI();
    });

    window.addEventListener('resize', resizeCanvases);

    const themeObserver = new MutationObserver(function () {
      renderBridgeCanvas(lastResult);
      renderBeamCanvas(lastResult);
    });
    themeObserver.observe(elements.html, { attributes: true, attributeFilter: ['data-theme'] });
  }

  function init() {
    initTheme();
    warnIfFileProtocol();
    bindEvents();
    resizeCanvases();
    updateUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
