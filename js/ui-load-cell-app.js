/**
 * Load cell application UI — Web Serial, real-time charts, calibration.
 */
(function () {
  'use strict';

  const MAX_POINTS = 2000;
  const CAL_ROWS = 4;
  const CAL_EXPORT_SCHEMA_VERSION = 1;
  const CAL_EXPORT_FILENAME = 'load-cell-calibration.json';
  const BAUD_MIN = 300;
  const BAUD_MAX = 2000000;
  const MOVING_AVERAGE_MIN = 0;
  const MOVING_AVERAGE_MAX = 100;
  const CHART_LEFT_PADDING = 10;
  const Y_LABEL_TICK_GAP = 8;

  const elements = {
    html: document.documentElement,
    themeToggle: document.getElementById('theme-toggle'),
    themeToggleIcon: document.getElementById('theme-toggle-icon'),
    themeToggleLabel: document.getElementById('theme-toggle-label'),
    serialWarning: document.getElementById('lca-serial-warning'),
    inputBaud: document.getElementById('lca-input-baud'),
    btnConnect: document.getElementById('lca-btn-connect'),
    btnDisconnect: document.getElementById('lca-btn-disconnect'),
    btnStreamToggle: document.getElementById('lca-btn-stream-toggle'),
    btnClearGraph: document.getElementById('lca-btn-clear-graph'),
    serialRaw: document.getElementById('lca-serial-raw'),
    adcNumber: document.getElementById('lca-adc-number'),
    adcMa: document.getElementById('lca-adc-ma'),
    sensorChart: document.getElementById('lca-sensor-chart'),
    weightChart: document.getElementById('lca-weight-chart'),
    calChart: document.getElementById('lca-cal-chart'),
    sensorShowRaw: document.getElementById('lca-sensor-show-raw'),
    sensorShowMa: document.getElementById('lca-sensor-show-ma'),
    sensorShowScale: document.getElementById('lca-sensor-show-scale'),
    sensorShowGrid: document.getElementById('lca-sensor-show-grid'),
    sensorFixedLimits: document.getElementById('lca-sensor-fixed-limits'),
    sensorXMin: document.getElementById('lca-sensor-x-min'),
    sensorXMax: document.getElementById('lca-sensor-x-max'),
    sensorYMin: document.getElementById('lca-sensor-y-min'),
    sensorYMax: document.getElementById('lca-sensor-y-max'),
    sensorResetAxes: document.getElementById('lca-sensor-reset-axes'),
    weightShowTrace: document.getElementById('lca-weight-show-trace'),
    weightShowScale: document.getElementById('lca-weight-show-scale'),
    weightShowGrid: document.getElementById('lca-weight-show-grid'),
    weightFixedLimits: document.getElementById('lca-weight-fixed-limits'),
    weightXMin: document.getElementById('lca-weight-x-min'),
    weightXMax: document.getElementById('lca-weight-x-max'),
    weightYMin: document.getElementById('lca-weight-y-min'),
    weightYMax: document.getElementById('lca-weight-y-max'),
    weightResetAxes: document.getElementById('lca-weight-reset-axes'),
    calShowPoints: document.getElementById('lca-cal-show-points'),
    calShowFit: document.getElementById('lca-cal-show-fit'),
    calShowScale: document.getElementById('lca-cal-show-scale'),
    calShowGrid: document.getElementById('lca-cal-show-grid'),
    calFixedLimits: document.getElementById('lca-cal-fixed-limits'),
    calXMin: document.getElementById('lca-cal-x-min'),
    calXMax: document.getElementById('lca-cal-x-max'),
    calYMin: document.getElementById('lca-cal-y-min'),
    calYMax: document.getElementById('lca-cal-y-max'),
    calResetAxes: document.getElementById('lca-cal-reset-axes'),
    inputAverage: document.getElementById('lca-input-average'),
    btnUpdateCal: document.getElementById('lca-btn-update-cal'),
    btnExportCal: document.getElementById('lca-btn-export-cal'),
    btnImportCal: document.getElementById('lca-btn-import-cal'),
    inputImportCal: document.getElementById('lca-input-import-cal'),
    calError: document.getElementById('lca-cal-error'),
    equationTransfer: document.getElementById('lca-equation-transfer'),
    equationInverse: document.getElementById('lca-equation-inverse'),
    weightValue: document.getElementById('lca-weight-value'),
    calInputsW: [],
    calInputsL: [],
  };

  for (let i = 1; i <= CAL_ROWS; i++) {
    elements.calInputsW.push(document.getElementById('lca-cal-w-' + i));
    elements.calInputsL.push(document.getElementById('lca-cal-l-' + i));
  }

  const sensorCtx = elements.sensorChart ? elements.sensorChart.getContext('2d') : null;
  const weightCtx = elements.weightChart ? elements.weightChart.getContext('2d') : null;
  const calCtx = elements.calChart ? elements.calChart.getContext('2d') : null;

  let serialPort = null;
  let serialReader = null;
  let serialAbort = null;
  let lineBuffer = '';
  let timeOrigin = null;
  let recentAdcValues = [];
  let calibrationReady = false;
  let calibration = null;
  let calibrationPoints = [];
  let isConnected = false;
  let isStreamPaused = false;
  let discardNextSampleAfterResume = false;

  const sensorChartOptions = {
    showRaw: true,
    showMa: true,
    showScale: true,
    showGrid: true,
    fixedLimits: false,
    xMin: null,
    xMax: null,
    yMin: null,
    yMax: null,
  };

  const weightChartOptions = {
    showTrace: true,
    showScale: true,
    showGrid: true,
    fixedLimits: false,
    xMin: null,
    xMax: null,
    yMin: null,
    yMax: null,
  };

  const calChartOptions = {
    showPoints: true,
    showFit: true,
    showScale: true,
    showGrid: true,
    fixedLimits: false,
    xMin: null,
    xMax: null,
    yMin: null,
    yMax: null,
  };

  const sensorSeries = {
    raw: [],
    ma: [],
  };
  const weightSeries = {
    values: [],
  };

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
    redrawAllCharts();
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

  function parseNumInput(input, fallback) {
    const value = parseFloat(input.value);
    return Number.isFinite(value) ? value : fallback;
  }

  function parseOptionalLimit(input) {
    if (!input || input.value.trim() === '') {
      return null;
    }
    const value = parseFloat(input.value);
    return Number.isFinite(value) ? value : null;
  }

  function getAverageWindow() {
    const n = Math.floor(parseNumInput(elements.inputAverage, 0));
    return Math.max(0, Math.min(100, n));
  }

  function pushLimited(arr, point) {
    arr.push(point);
    if (arr.length > MAX_POINTS) {
      arr.shift();
    }
  }

  function formatNumber(value) {
    if (!Number.isFinite(value)) {
      return '—';
    }
    if (Math.abs(value) >= 1e6 || (Math.abs(value) > 0 && Math.abs(value) < 0.01)) {
      return value.toExponential(4);
    }
    return value.toFixed(4).replace(/\.?0+$/, function (match) {
      return match.includes('.') ? '' : match;
    });
  }

  function formatSerialStringCode(line) {
    const escaped = line
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return '"' + escaped + '\\n"';
  }

  function hasGraphData() {
    return sensorSeries.raw.length > 0 ||
      sensorSeries.ma.length > 0 ||
      weightSeries.values.length > 0;
  }

  function updateClearGraphButton() {
    if (!elements.btnClearGraph) {
      return;
    }
    elements.btnClearGraph.disabled = !isConnected && !hasGraphData();
  }

  function formatTickLabel(value, isTime) {
    if (!Number.isFinite(value)) {
      return '';
    }
    if (isTime) {
      const abs = Math.abs(value);
      if (abs >= 100) {
        return value.toFixed(0);
      }
      if (abs >= 10) {
        return value.toFixed(1);
      }
      return value.toFixed(2);
    }
    return formatNumber(value);
  }

  function formatYTickLabel(value) {
    if (!Number.isFinite(value)) {
      return '';
    }
    if (Math.abs(value - Math.round(value)) < 1e-6) {
      return String(Math.round(value));
    }
    return value.toFixed(4).replace(/\.?0+$/, function (match) {
      return match.includes('.') ? '' : match;
    });
  }

  function computeNiceTicks(min, max, targetCount) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return [];
    }
    if (min === max) {
      return [min];
    }
    const span = max - min;
    const rawStep = span / Math.max(1, targetCount - 1);
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const normalized = rawStep / magnitude;
    let niceNormalized;
    if (normalized <= 1) {
      niceNormalized = 1;
    } else if (normalized <= 2) {
      niceNormalized = 2;
    } else if (normalized <= 5) {
      niceNormalized = 5;
    } else {
      niceNormalized = 10;
    }
    const step = niceNormalized * magnitude;
    const ticks = [];
    const start = Math.ceil(min / step) * step;
    for (let tick = start; tick <= max + step * 0.001; tick += step) {
      ticks.push(tick);
    }
    if (ticks.length === 0) {
      ticks.push(min, max);
    }
    return ticks;
  }

  function computeChartLeftLayout(ctx, bounds, yLabel) {
    const yTicks = computeNiceTicks(bounds.minY, bounds.maxY, 6);
    const tickFont = '10px system-ui, sans-serif';
    const axisLabelFont = '11px system-ui, sans-serif';
    ctx.save();
    ctx.font = tickFont;
    let maxTickWidth = 0;
    yTicks.forEach(function (tick) {
      maxTickWidth = Math.max(maxTickWidth, ctx.measureText(formatYTickLabel(tick)).width);
    });
    const eightDigitWidth = ctx.measureText('12345678').width;
    ctx.font = axisLabelFont;
    const labelMetrics = ctx.measureText(yLabel || '');
    const rotatedLabelWidth = (labelMetrics.actualBoundingBoxAscent || 11)
      + (labelMetrics.actualBoundingBoxDescent || 0)
      + 2;
    const yLabelColumn = Math.max(14, rotatedLabelWidth);
    const tickColumn = Math.max(maxTickWidth, eightDigitWidth) + 6;
    ctx.restore();
    return {
      leftPadding: CHART_LEFT_PADDING,
      yLabelColumn: yLabelColumn,
      tickColumn: tickColumn,
      left: CHART_LEFT_PADDING + yLabelColumn + tickColumn + Y_LABEL_TICK_GAP,
    };
  }

  function resolveAxisBounds(autoBounds, options) {
    if (!options.fixedLimits) {
      return autoBounds;
    }

    let minX = options.xMin !== null ? options.xMin : autoBounds.minX;
    let maxX = options.xMax !== null ? options.xMax : autoBounds.maxX;
    let minY = options.yMin !== null ? options.yMin : autoBounds.minY;
    let maxY = options.yMax !== null ? options.yMax : autoBounds.maxY;

    if (minX >= maxX) {
      minX = autoBounds.minX;
      maxX = autoBounds.maxX;
    }
    if (minY >= maxY) {
      minY = autoBounds.minY;
      maxY = autoBounds.maxY;
    }

    return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
  }

  function setLimitInputsEnabled(limitInputs, enabled) {
    limitInputs.forEach(function (input) {
      if (input) {
        input.disabled = !enabled;
      }
    });
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

  function computeAxisBounds(points, valueKeys) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    points.forEach(function (pt) {
      if (!Number.isFinite(pt.t)) {
        return;
      }
      minX = Math.min(minX, pt.t);
      maxX = Math.max(maxX, pt.t);
      valueKeys.forEach(function (key) {
        const y = pt[key];
        if (Number.isFinite(y)) {
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      });
    });

    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
      minX = 0;
      maxX = 1;
    }
    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
      minY = 0;
      maxY = 1;
    }
    if (minY === maxY) {
      minY -= 1;
      maxY += 1;
    }
    if (maxX === minX) {
      maxX = minX + 1;
    }

    const yPad = (maxY - minY) * 0.08 || 1;
    return {
      minX: minX,
      maxX: maxX,
      minY: minY - yPad,
      maxY: maxY + yPad,
    };
  }

  function drawChartFrame(ctx, width, height, xLabel, yLabel, margin) {
    const m = margin || { top: 16, right: 16, bottom: 40, left: 60, yLabelColumn: 14, tickColumn: 40 };
    const leftPadding = m.leftPadding != null ? m.leftPadding : CHART_LEFT_PADDING;
    const layout = {
      leftPadding: leftPadding,
      yLabelColumn: m.yLabelColumn != null ? m.yLabelColumn : 14,
      tickColumn: m.tickColumn != null ? m.tickColumn : Math.max(40, m.left - 20),
    };
    const plotW = width - m.left - m.right;
    const plotH = height - m.top - m.bottom;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = getCssVar('--color-bg-elevated');
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = getCssVar('--color-border');
    ctx.lineWidth = 1;
    ctx.strokeRect(m.left, m.top, plotW, plotH);

    ctx.fillStyle = getCssVar('--color-text-muted');
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(xLabel, m.left + plotW / 2, height - 8);
    ctx.save();
    ctx.translate(leftPadding + layout.yLabelColumn / 2, m.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();

    return { margin: m, plotW: plotW, plotH: plotH, layout: layout };
  }

  function drawGridAndTicks(ctx, bounds, frame, displayOptions) {
    const xTicks = computeNiceTicks(bounds.minX, bounds.maxX, 6);
    const yTicks = computeNiceTicks(bounds.minY, bounds.maxY, 6);
    const gridColor = getCssVar('--color-border');
    const textColor = getCssVar('--color-text-muted');
    const isTime = displayOptions.isTime !== false;

    if (displayOptions.showGrid) {
      ctx.save();
      ctx.strokeStyle = gridColor;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      xTicks.forEach(function (tick) {
        const mapped = mapPoint(bounds, frame, tick, bounds.minY);
        ctx.beginPath();
        ctx.moveTo(mapped.x, frame.margin.top);
        ctx.lineTo(mapped.x, frame.margin.top + frame.plotH);
        ctx.stroke();
      });
      yTicks.forEach(function (tick) {
        const mapped = mapPoint(bounds, frame, bounds.minX, tick);
        ctx.beginPath();
        ctx.moveTo(frame.margin.left, mapped.y);
        ctx.lineTo(frame.margin.left + frame.plotW, mapped.y);
        ctx.stroke();
      });
      ctx.restore();
    }

    if (!displayOptions.showScale) {
      return;
    }

    ctx.fillStyle = textColor;
    ctx.font = '10px system-ui, sans-serif';

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    xTicks.forEach(function (tick) {
      const mapped = mapPoint(bounds, frame, tick, bounds.minY);
      ctx.fillText(formatTickLabel(tick, isTime), mapped.x, frame.margin.top + frame.plotH + 4);
    });

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const leftPadding = frame.layout.leftPadding != null ? frame.layout.leftPadding : CHART_LEFT_PADDING;
    const tickX = leftPadding + frame.layout.yLabelColumn + frame.layout.tickColumn - 6;
    yTicks.forEach(function (tick) {
      const mapped = mapPoint(bounds, frame, bounds.minX, tick);
      ctx.fillText(formatYTickLabel(tick), tickX, mapped.y);
    });
  }

  function mapPoint(bounds, frame, t, y) {
    const x = frame.margin.left + ((t - bounds.minX) / (bounds.maxX - bounds.minX)) * frame.plotW;
    const yNorm = (y - bounds.minY) / (bounds.maxY - bounds.minY);
    const py = frame.margin.top + frame.plotH - yNorm * frame.plotH;
    return { x: x, y: py };
  }

  function drawTimeSeriesLine(ctx, width, height, points, key, color, bounds, frame) {
    if (!points.length) {
      return;
    }
    ctx.beginPath();
    let started = false;
    points.forEach(function (pt) {
      const y = pt[key];
      if (!Number.isFinite(y)) {
        started = false;
        return;
      }
      const mapped = mapPoint(bounds, frame, pt.t, y);
      if (!started) {
        ctx.moveTo(mapped.x, mapped.y);
        started = true;
      } else {
        ctx.lineTo(mapped.x, mapped.y);
      }
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function renderSensorChart() {
    if (!sensorCtx || !elements.sensorChart) {
      return;
    }
    const width = elements.sensorChart.parentElement.clientWidth;
    const height = elements.sensorChart.parentElement.clientHeight;

    const combined = [];
    const len = Math.max(sensorSeries.raw.length, sensorSeries.ma.length);
    for (let i = 0; i < len; i++) {
      combined.push({
        t: (sensorSeries.raw[i] && sensorSeries.raw[i].t) || (sensorSeries.ma[i] && sensorSeries.ma[i].t),
        raw: sensorSeries.raw[i] ? sensorSeries.raw[i].y : NaN,
        ma: sensorSeries.ma[i] ? sensorSeries.ma[i].y : NaN,
      });
    }

    const autoBounds = computeAxisBounds(combined, ['raw', 'ma']);
    const bounds = resolveAxisBounds(autoBounds, sensorChartOptions);
    const displayOpts = {
      showGrid: sensorChartOptions.showGrid,
      showScale: sensorChartOptions.showScale,
      isTime: true,
    };
    const layout = computeChartLeftLayout(sensorCtx, bounds, 'Sensor value (ADC level)');
    const frame = drawChartFrame(sensorCtx, width, height, 'time (s)', 'Sensor value (ADC level)', {
      top: 16,
      right: 16,
      bottom: 40,
      left: layout.left,
      leftPadding: layout.leftPadding,
      yLabelColumn: layout.yLabelColumn,
      tickColumn: layout.tickColumn,
    });
    drawGridAndTicks(sensorCtx, bounds, frame, displayOpts);
    if (sensorChartOptions.showRaw) {
      drawTimeSeriesLine(sensorCtx, width, height, combined, 'raw', getCssVar('--color-accent'), bounds, frame);
    }
    if (sensorChartOptions.showMa) {
      drawTimeSeriesLine(sensorCtx, width, height, combined, 'ma', getCssVar('--color-success'), bounds, frame);
    }
  }

  function renderWeightChart() {
    if (!weightCtx || !elements.weightChart) {
      return;
    }
    const width = elements.weightChart.parentElement.clientWidth;
    const height = elements.weightChart.parentElement.clientHeight;

    const points = weightSeries.values.map(function (pt) {
      return { t: pt.t, w: pt.y };
    });
    const autoBounds = computeAxisBounds(points, ['w']);
    const bounds = resolveAxisBounds(autoBounds, weightChartOptions);
    const displayOpts = {
      showGrid: weightChartOptions.showGrid,
      showScale: weightChartOptions.showScale,
      isTime: true,
    };
    const layout = computeChartLeftLayout(weightCtx, bounds, 'Weight (g)');
    const frame = drawChartFrame(weightCtx, width, height, 'time (s)', 'Weight (g)', {
      top: 16,
      right: 16,
      bottom: 40,
      left: layout.left,
      leftPadding: layout.leftPadding,
      yLabelColumn: layout.yLabelColumn,
      tickColumn: layout.tickColumn,
    });
    drawGridAndTicks(weightCtx, bounds, frame, displayOpts);
    if (weightChartOptions.showTrace) {
      drawTimeSeriesLine(weightCtx, width, height, points, 'w', getCssVar('--color-success'), bounds, frame);
    }
  }

  function computeCalAutoBounds() {
    let minW = Infinity;
    let maxW = -Infinity;
    let minL = Infinity;
    let maxL = -Infinity;

    const points = calibration && calibrationPoints.length
      ? calibrationPoints
      : (function () {
          const data = readCalibrationTable();
          if (!data) {
            return [];
          }
          return data.weights.map(function (w, idx) {
            return { w: w, l: data.levels[idx] };
          });
        }());

    points.forEach(function (pt) {
      minW = Math.min(minW, pt.w);
      maxW = Math.max(maxW, pt.w);
      minL = Math.min(minL, pt.l);
      maxL = Math.max(maxL, pt.l);
    });

    if (calibration && points.length) {
      const fitMinW = minW;
      const fitMaxW = maxW;
      const lineL1 = LoadCellAppPhysics.computeSensorLevel(fitMinW, calibration.m, calibration.C);
      const lineL2 = LoadCellAppPhysics.computeSensorLevel(fitMaxW, calibration.m, calibration.C);
      if (Number.isFinite(lineL1)) {
        minL = Math.min(minL, lineL1);
        maxL = Math.max(maxL, lineL1);
      }
      if (Number.isFinite(lineL2)) {
        minL = Math.min(minL, lineL2);
        maxL = Math.max(maxL, lineL2);
      }
    }

    if (!Number.isFinite(minW) || !Number.isFinite(maxW) || !Number.isFinite(minL) || !Number.isFinite(maxL)) {
      return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    }
    if (minW === maxW) {
      maxW = minW + 1;
    }
    if (minL === maxL) {
      minL -= 1;
      maxL += 1;
    }

    const padW = (maxW - minW) * 0.08 || 1;
    const padL = (maxL - minL) * 0.08 || 1;
    return {
      minX: minW - padW,
      maxX: maxW + padW,
      minY: minL - padL,
      maxY: maxL + padL,
    };
  }

  function renderCalChart() {
    if (!calCtx || !elements.calChart) {
      return;
    }

    const width = elements.calChart.parentElement.clientWidth;
    const height = elements.calChart.parentElement.clientHeight;

    const autoBounds = computeCalAutoBounds();
    const bounds = resolveAxisBounds(autoBounds, calChartOptions);
    const displayOpts = {
      showGrid: calChartOptions.showGrid,
      showScale: calChartOptions.showScale,
      isTime: false,
    };
    const layout = computeChartLeftLayout(calCtx, bounds, 'ADC level');
    const frame = drawChartFrame(calCtx, width, height, 'True weight (g)', 'ADC level', {
      top: 16,
      right: 16,
      bottom: 40,
      left: layout.left,
      leftPadding: layout.leftPadding,
      yLabelColumn: layout.yLabelColumn,
      tickColumn: layout.tickColumn,
    });
    drawGridAndTicks(calCtx, bounds, frame, displayOpts);

    if (!calibration) {
      return;
    }

    if (calChartOptions.showPoints) {
      calibrationPoints.forEach(function (pt) {
        const mapped = mapPoint(bounds, frame, pt.w, pt.l);
        calCtx.beginPath();
        calCtx.arc(mapped.x, mapped.y, 4, 0, Math.PI * 2);
        calCtx.fillStyle = getCssVar('--color-accent');
        calCtx.fill();
      });
    }

    if (calChartOptions.showFit) {
      let minW = Infinity;
      let maxW = -Infinity;
      calibrationPoints.forEach(function (pt) {
        minW = Math.min(minW, pt.w);
        maxW = Math.max(maxW, pt.w);
      });
      const lineL1 = LoadCellAppPhysics.computeSensorLevel(minW, calibration.m, calibration.C);
      const lineL2 = LoadCellAppPhysics.computeSensorLevel(maxW, calibration.m, calibration.C);
      if (Number.isFinite(lineL1) && Number.isFinite(lineL2)) {
        const p1 = mapPoint(bounds, frame, minW, lineL1);
        const p2 = mapPoint(bounds, frame, maxW, lineL2);
        calCtx.beginPath();
        calCtx.moveTo(p1.x, p1.y);
        calCtx.lineTo(p2.x, p2.y);
        calCtx.strokeStyle = getCssVar('--color-success');
        calCtx.lineWidth = 2;
        calCtx.stroke();
      }
    }
  }

  function redrawAllCharts() {
    resizeCanvas(elements.sensorChart, sensorCtx, renderSensorChart);
    resizeCanvas(elements.weightChart, weightCtx, renderWeightChart);
    resizeCanvas(elements.calChart, calCtx, renderCalChart);
  }

  function showSerialWarning(message) {
    elements.serialWarning.hidden = false;
    elements.serialWarning.textContent = message;
  }

  function hideSerialWarning() {
    elements.serialWarning.hidden = true;
    elements.serialWarning.textContent = '';
  }

  function setConnected(connected) {
    isConnected = connected;
    elements.btnConnect.disabled = connected;
    elements.btnDisconnect.disabled = !connected;
    elements.inputBaud.disabled = connected;
    if (!connected) {
      isStreamPaused = false;
      discardNextSampleAfterResume = false;
    }
    updateStreamToggleButton();
    updateClearGraphButton();
  }

  function updateStreamToggleButton() {
    if (!elements.btnStreamToggle) {
      return;
    }
    elements.btnStreamToggle.disabled = !isConnected;
    elements.btnStreamToggle.textContent = isStreamPaused ? 'Play' : 'Pause';
  }

  function pauseStream() {
    if (!isConnected || isStreamPaused) {
      return;
    }
    isStreamPaused = true;
    lineBuffer = '';
    updateStreamToggleButton();
  }

  function resumeStream() {
    if (!isConnected || !isStreamPaused) {
      return;
    }
    lineBuffer = '';
    recentAdcValues = [];
    timeOrigin = null;
    discardNextSampleAfterResume = true;
    isStreamPaused = false;
    updateStreamToggleButton();
  }

  function toggleStream() {
    if (isStreamPaused) {
      resumeStream();
    } else {
      pauseStream();
    }
  }

  function clearGraphData() {
    timeOrigin = null;
    recentAdcValues = [];
    sensorSeries.raw = [];
    sensorSeries.ma = [];
    weightSeries.values = [];
    redrawAllCharts();
    updateClearGraphButton();
  }

  function resetStreamData() {
    clearGraphData();
    elements.serialRaw.textContent = '—';
    elements.adcNumber.textContent = '—';
    elements.adcMa.textContent = '—';
    if (!calibrationReady) {
      elements.weightValue.textContent = '—';
    }
  }

  async function disconnectSerial() {
    if (serialAbort) {
      serialAbort.abort();
      serialAbort = null;
    }
    if (serialReader) {
      try {
        await serialReader.cancel();
      } catch (err) {
        /* ignore */
      }
      serialReader = null;
    }
    if (serialPort) {
      try {
        await serialPort.close();
      } catch (err) {
        /* ignore */
      }
      serialPort = null;
    }
    lineBuffer = '';
    setConnected(false);
    resetStreamData();
  }

  function processLine(line) {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    if (discardNextSampleAfterResume) {
      discardNextSampleAfterResume = false;
      clearGraphData();
      return;
    }

    elements.serialRaw.textContent = formatSerialStringCode(trimmed);
    const adc = parseFloat(trimmed);
    if (!Number.isFinite(adc)) {
      elements.adcNumber.textContent = '—';
      return;
    }

    elements.adcNumber.textContent = formatNumber(adc);

    if (timeOrigin === null) {
      timeOrigin = performance.now();
    }
    const t = (performance.now() - timeOrigin) / 1000;

    recentAdcValues.push(adc);
    if (recentAdcValues.length > 100) {
      recentAdcValues.shift();
    }

    const windowSize = getAverageWindow();
    let maValue = null;
    if (windowSize > 0) {
      maValue = LoadCellAppPhysics.movingAverage(recentAdcValues, windowSize);
      elements.adcMa.textContent = formatNumber(maValue);
    } else {
      elements.adcMa.textContent = '—';
    }

    pushLimited(sensorSeries.raw, { t: t, y: adc });
    if (windowSize > 0 && maValue !== null) {
      pushLimited(sensorSeries.ma, { t: t, y: maValue });
    }

    if (calibrationReady && windowSize > 0 && maValue !== null && calibration) {
      const weight = LoadCellAppPhysics.computeWeight(maValue, calibration.m, calibration.intercept);
      if (weight !== null) {
        elements.weightValue.textContent = formatNumber(weight);
        pushLimited(weightSeries.values, { t: t, y: weight });
      }
    }

    updateClearGraphButton();
    renderSensorChart();
    renderWeightChart();
  }

  async function readSerialLoop(port, signal) {
    const decoder = new TextDecoder();
    serialReader = port.readable.getReader();

    try {
      while (!signal.aborted) {
        const result = await serialReader.read();
        if (result.done) {
          break;
        }
        if (isStreamPaused) {
          lineBuffer = '';
          continue;
        }
        lineBuffer += decoder.decode(result.value, { stream: true });
        let newlineIndex = lineBuffer.indexOf('\n');
        while (newlineIndex !== -1) {
          const line = lineBuffer.slice(0, newlineIndex).replace(/\r$/, '');
          lineBuffer = lineBuffer.slice(newlineIndex + 1);
          processLine(line);
          newlineIndex = lineBuffer.indexOf('\n');
        }
      }
    } catch (err) {
      if (!signal.aborted) {
        showSerialWarning('Serial read error: ' + err.message);
      }
    } finally {
      if (serialReader) {
        try {
          serialReader.releaseLock();
        } catch (releaseErr) {
          /* ignore */
        }
        serialReader = null;
      }
    }
  }

  async function connectSerial() {
    if (!navigator.serial) {
      showSerialWarning('Web Serial API is not supported in this browser. Use Chrome or Edge over http://localhost:8080.');
      return;
    }

    hideSerialWarning();
    const baudRate = Math.floor(parseNumInput(elements.inputBaud, 9600));

    try {
      serialPort = await navigator.serial.requestPort();
      await serialPort.open({ baudRate: baudRate });
      serialAbort = new AbortController();
      setConnected(true);
      timeOrigin = null;
      await readSerialLoop(serialPort, serialAbort.signal);
    } catch (err) {
      if (err.name !== 'NotFoundError') {
        showSerialWarning('Could not connect: ' + err.message);
      }
      await disconnectSerial();
    }
  }

  function renderEquation(el, latex) {
    if (!el || typeof katex === 'undefined') {
      return;
    }
    el.textContent = '';
    katex.render(latex, el, { throwOnError: false, displayMode: true });
  }

  function readCalibrationTable() {
    const weights = [];
    const levels = [];
    for (let i = 0; i < CAL_ROWS; i++) {
      const w = parseFloat(elements.calInputsW[i].value);
      const l = parseFloat(elements.calInputsL[i].value);
      if (!Number.isFinite(w) || !Number.isFinite(l)) {
        return null;
      }
      if (elements.calInputsW[i].value.trim() === '' || elements.calInputsL[i].value.trim() === '') {
        return null;
      }
      weights.push(w);
      levels.push(l);
    }
    return { weights: weights, levels: levels };
  }

  function showCalError(message) {
    if (!elements.calError) {
      return;
    }
    elements.calError.hidden = false;
    elements.calError.textContent = message;
  }

  function hideCalError() {
    if (!elements.calError) {
      return;
    }
    elements.calError.hidden = true;
  }

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function isIntegerInRange(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
  }

  function buildCalibrationExport() {
    const table = readCalibrationTable();
    const baudRate = Math.floor(parseNumInput(elements.inputBaud, 9600));
    const movingAverage = getAverageWindow();
    const calibration = [];

    if (table) {
      for (let i = 0; i < CAL_ROWS; i++) {
        calibration.push({ w: table.weights[i], l: table.levels[i] });
      }
    } else {
      for (let i = 0; i < CAL_ROWS; i++) {
        const w = parseFloat(elements.calInputsW[i].value);
        const l = parseFloat(elements.calInputsL[i].value);
        calibration.push({
          w: Number.isFinite(w) ? w : 0,
          l: Number.isFinite(l) ? l : 0,
        });
      }
    }

    return {
      schemaVersion: CAL_EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      baudRate: baudRate,
      movingAverage: movingAverage,
      calibration: calibration,
    };
  }

  function validateCalibrationImport(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, message: 'Invalid calibration file: expected a JSON object.' };
    }

    if (!isFiniteNumber(data.schemaVersion)) {
      return { ok: false, message: 'Invalid calibration file: missing or invalid schemaVersion.' };
    }

    if (data.schemaVersion !== CAL_EXPORT_SCHEMA_VERSION) {
      return {
        ok: false,
        message: 'Unsupported schema version: ' + data.schemaVersion + '.',
      };
    }

    if (!isIntegerInRange(data.baudRate, BAUD_MIN, BAUD_MAX)) {
      return {
        ok: false,
        message: 'Invalid baudRate: must be an integer between ' + BAUD_MIN + ' and ' + BAUD_MAX + '.',
      };
    }

    if (!isIntegerInRange(data.movingAverage, MOVING_AVERAGE_MIN, MOVING_AVERAGE_MAX)) {
      return {
        ok: false,
        message: 'Invalid movingAverage: must be an integer between ' + MOVING_AVERAGE_MIN + ' and ' + MOVING_AVERAGE_MAX + '.',
      };
    }

    if (!Array.isArray(data.calibration) || data.calibration.length !== CAL_ROWS) {
      return { ok: false, message: 'calibration must have exactly ' + CAL_ROWS + ' points.' };
    }

    const calibration = [];
    for (let i = 0; i < CAL_ROWS; i++) {
      const point = data.calibration[i];
      if (!point || typeof point !== 'object' || Array.isArray(point)) {
        return { ok: false, message: 'Invalid calibration point at row ' + (i + 1) + '.' };
      }
      if (!isFiniteNumber(point.w) || !isFiniteNumber(point.l)) {
        return { ok: false, message: 'Invalid numbers in calibration row ' + (i + 1) + '.' };
      }
      calibration.push({ w: point.w, l: point.l });
    }

    return {
      ok: true,
      payload: {
        baudRate: data.baudRate,
        movingAverage: data.movingAverage,
        calibration: calibration,
      },
    };
  }

  function applyCalibrationImport(payload) {
    elements.inputBaud.value = String(payload.baudRate);
    elements.inputAverage.value = String(payload.movingAverage);
    for (let i = 0; i < CAL_ROWS; i++) {
      elements.calInputsW[i].value = String(payload.calibration[i].w);
      elements.calInputsL[i].value = String(payload.calibration[i].l);
    }
  }

  function downloadCalibrationJson(jsonText) {
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = CAL_EXPORT_FILENAME;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function exportCalibration() {
    const payload = buildCalibrationExport();
    const jsonText = JSON.stringify(payload, null, 2);

    try {
      if (typeof window.showSaveFilePicker === 'function') {
        const handle = await window.showSaveFilePicker({
          suggestedName: CAL_EXPORT_FILENAME,
          types: [{
            description: 'JSON',
            accept: { 'application/json': ['.json'] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(jsonText);
        await writable.close();
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') {
        return;
      }
      if (err && err.name !== 'NotSupportedError') {
        showCalError('Could not export calibration: ' + err.message);
        return;
      }
    }

    downloadCalibrationJson(jsonText);
  }

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(new Error('Could not read the selected file.'));
      };
      reader.readAsText(file);
    });
  }

  async function importCalibrationFromFile(file) {
    if (!file) {
      return;
    }

    let text;
    try {
      text = await readFileAsText(file);
    } catch (err) {
      showCalError(err.message);
      return;
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      showCalError('Invalid calibration file: could not parse JSON.');
      return;
    }

    const result = validateCalibrationImport(data);
    if (!result.ok) {
      showCalError(result.message);
      return;
    }

    hideCalError();
    applyCalibrationImport(result.payload);
    updateCalibration();
  }

  function updateCalibration() {
    hideCalError();
    const data = readCalibrationTable();
    if (!data) {
      showCalError('Please fill every cell in the calibration table with valid numbers.');
      return;
    }

    const fit = LoadCellAppPhysics.linearFit(data.weights, data.levels);
    if (!fit) {
      showCalError('Linear fit failed. Check that weights are not all identical.');
      calibrationReady = false;
      calibration = null;
      return;
    }

    calibration = fit;
    calibrationPoints = data.weights.map(function (w, idx) {
      return { w: w, l: data.levels[idx] };
    });
    calibrationReady = true;

    const mStr = formatNumber(fit.m);
    const cStr = formatNumber(fit.C);
    const interceptStr = formatNumber(fit.intercept);

    renderEquation(
      elements.equationTransfer,
      'L = ' + mStr + 'W - (' + cStr + ')'
    );
    renderEquation(
      elements.equationInverse,
      'W = \\frac{1}{' + mStr + '} L - \\frac{' + interceptStr + '}{' + mStr + '}'
    );

    renderCalChart();
  }

  const sensorLimitInputs = [
    elements.sensorXMin,
    elements.sensorXMax,
    elements.sensorYMin,
    elements.sensorYMax,
  ];

  const weightLimitInputs = [
    elements.weightXMin,
    elements.weightXMax,
    elements.weightYMin,
    elements.weightYMax,
  ];

  const calLimitInputs = [
    elements.calXMin,
    elements.calXMax,
    elements.calYMin,
    elements.calYMax,
  ];

  function syncSensorConsole() {
    sensorChartOptions.showRaw = elements.sensorShowRaw ? elements.sensorShowRaw.checked : true;
    sensorChartOptions.showMa = elements.sensorShowMa ? elements.sensorShowMa.checked : true;
    sensorChartOptions.showScale = elements.sensorShowScale ? elements.sensorShowScale.checked : true;
    sensorChartOptions.showGrid = elements.sensorShowGrid ? elements.sensorShowGrid.checked : true;
    sensorChartOptions.fixedLimits = elements.sensorFixedLimits ? elements.sensorFixedLimits.checked : false;
    sensorChartOptions.xMin = parseOptionalLimit(elements.sensorXMin);
    sensorChartOptions.xMax = parseOptionalLimit(elements.sensorXMax);
    sensorChartOptions.yMin = parseOptionalLimit(elements.sensorYMin);
    sensorChartOptions.yMax = parseOptionalLimit(elements.sensorYMax);
    setLimitInputsEnabled(sensorLimitInputs, sensorChartOptions.fixedLimits);
    redrawAllCharts();
  }

  function syncWeightConsole() {
    weightChartOptions.showTrace = elements.weightShowTrace ? elements.weightShowTrace.checked : true;
    weightChartOptions.showScale = elements.weightShowScale ? elements.weightShowScale.checked : true;
    weightChartOptions.showGrid = elements.weightShowGrid ? elements.weightShowGrid.checked : true;
    weightChartOptions.fixedLimits = elements.weightFixedLimits ? elements.weightFixedLimits.checked : false;
    weightChartOptions.xMin = parseOptionalLimit(elements.weightXMin);
    weightChartOptions.xMax = parseOptionalLimit(elements.weightXMax);
    weightChartOptions.yMin = parseOptionalLimit(elements.weightYMin);
    weightChartOptions.yMax = parseOptionalLimit(elements.weightYMax);
    setLimitInputsEnabled(weightLimitInputs, weightChartOptions.fixedLimits);
    redrawAllCharts();
  }

  function syncCalConsole() {
    calChartOptions.showPoints = elements.calShowPoints ? elements.calShowPoints.checked : true;
    calChartOptions.showFit = elements.calShowFit ? elements.calShowFit.checked : true;
    calChartOptions.showScale = elements.calShowScale ? elements.calShowScale.checked : true;
    calChartOptions.showGrid = elements.calShowGrid ? elements.calShowGrid.checked : true;
    calChartOptions.fixedLimits = elements.calFixedLimits ? elements.calFixedLimits.checked : false;
    calChartOptions.xMin = parseOptionalLimit(elements.calXMin);
    calChartOptions.xMax = parseOptionalLimit(elements.calXMax);
    calChartOptions.yMin = parseOptionalLimit(elements.calYMin);
    calChartOptions.yMax = parseOptionalLimit(elements.calYMax);
    setLimitInputsEnabled(calLimitInputs, calChartOptions.fixedLimits);
    redrawAllCharts();
  }

  function resetSensorAxes() {
    if (elements.sensorFixedLimits) {
      elements.sensorFixedLimits.checked = false;
    }
    sensorLimitInputs.forEach(function (input) {
      if (input) {
        input.value = '';
      }
    });
    syncSensorConsole();
  }

  function resetWeightAxes() {
    if (elements.weightFixedLimits) {
      elements.weightFixedLimits.checked = false;
    }
    weightLimitInputs.forEach(function (input) {
      if (input) {
        input.value = '';
      }
    });
    syncWeightConsole();
  }

  function resetCalAxes() {
    if (elements.calFixedLimits) {
      elements.calFixedLimits.checked = false;
    }
    calLimitInputs.forEach(function (input) {
      if (input) {
        input.value = '';
      }
    });
    syncCalConsole();
  }

  function bindConsoleEvents(checkboxes, limitInputs, syncFn) {
    checkboxes.forEach(function (el) {
      if (el) {
        el.addEventListener('change', syncFn);
      }
    });
    limitInputs.forEach(function (el) {
      if (el) {
        el.addEventListener('input', syncFn);
        el.addEventListener('change', syncFn);
      }
    });
  }

  function bindEvents() {
    elements.themeToggle.addEventListener('click', toggleTheme);
    elements.btnConnect.addEventListener('click', connectSerial);
    elements.btnDisconnect.addEventListener('click', function () {
      disconnectSerial();
    });
    if (elements.btnStreamToggle) {
      elements.btnStreamToggle.addEventListener('click', toggleStream);
    }
    if (elements.btnClearGraph) {
      elements.btnClearGraph.addEventListener('click', clearGraphData);
    }
    elements.btnUpdateCal.addEventListener('click', updateCalibration);
    if (elements.btnExportCal) {
      elements.btnExportCal.addEventListener('click', exportCalibration);
    }
    if (elements.btnImportCal && elements.inputImportCal) {
      elements.btnImportCal.addEventListener('click', function () {
        elements.inputImportCal.click();
      });
      elements.inputImportCal.addEventListener('change', function () {
        const file = elements.inputImportCal.files && elements.inputImportCal.files[0];
        importCalibrationFromFile(file).finally(function () {
          elements.inputImportCal.value = '';
        });
      });
    }

    bindConsoleEvents(
      [
        elements.sensorShowRaw,
        elements.sensorShowMa,
        elements.sensorShowScale,
        elements.sensorShowGrid,
        elements.sensorFixedLimits,
      ],
      sensorLimitInputs,
      syncSensorConsole
    );

    bindConsoleEvents(
      [
        elements.weightShowTrace,
        elements.weightShowScale,
        elements.weightShowGrid,
        elements.weightFixedLimits,
      ],
      weightLimitInputs,
      syncWeightConsole
    );

    bindConsoleEvents(
      [
        elements.calShowPoints,
        elements.calShowFit,
        elements.calShowScale,
        elements.calShowGrid,
        elements.calFixedLimits,
      ],
      calLimitInputs,
      syncCalConsole
    );

    if (elements.sensorResetAxes) {
      elements.sensorResetAxes.addEventListener('click', resetSensorAxes);
    }
    if (elements.weightResetAxes) {
      elements.weightResetAxes.addEventListener('click', resetWeightAxes);
    }
    if (elements.calResetAxes) {
      elements.calResetAxes.addEventListener('click', resetCalAxes);
    }

    window.addEventListener('resize', redrawAllCharts);
    window.addEventListener('beforeunload', function () {
      disconnectSerial();
    });

    const themeObserver = new MutationObserver(function () {
      redrawAllCharts();
    });
    themeObserver.observe(elements.html, { attributes: true, attributeFilter: ['data-theme'] });
  }

  function initConsoleCollapseToggle(section, toggle) {
    const body = section ? section.querySelector('.lca-console-body') : null;
    if (!section || !toggle || !body) {
      return;
    }

    let expanded = !section.classList.contains('is-collapsed');

    function sync() {
      section.classList.toggle('is-collapsed', !expanded);
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.setAttribute(
        'aria-label',
        expanded ? 'Collapse graph console' : 'Expand graph console'
      );
    }

    toggle.addEventListener('click', function () {
      expanded = !expanded;
      sync();
    });

    sync();
  }

  function init() {
    if (!navigator.serial) {
      showSerialWarning('Web Serial API is not supported in this browser. Use Chrome or Edge over http://localhost:8080.');
    }

    initTheme();
    bindEvents();
    initConsoleCollapseToggle(
      document.getElementById('lca-sensor-console'),
      document.getElementById('lca-sensor-console-toggle')
    );
    initConsoleCollapseToggle(
      document.getElementById('lca-weight-console'),
      document.getElementById('lca-weight-console-toggle')
    );
    initConsoleCollapseToggle(
      document.getElementById('lca-cal-console'),
      document.getElementById('lca-cal-console-toggle')
    );
    setLimitInputsEnabled(sensorLimitInputs, false);
    setLimitInputsEnabled(weightLimitInputs, false);
    setLimitInputsEnabled(calLimitInputs, false);
    updateClearGraphButton();
    renderEquation(elements.equationTransfer, 'L = mW - C');
    renderEquation(elements.equationInverse, 'W = \\frac{1}{m} L - \\frac{C}{m}');
    redrawAllCharts();
  }

  init();
})();
