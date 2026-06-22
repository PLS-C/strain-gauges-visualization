/**
 * Load cell application physics — serial ADC, moving average, calibration.
 * Pure functions only — no DOM or window access.
 */

const M_EPS = 1e-12;

/**
 * @param {number[]} values
 * @param {number} windowSize
 * @returns {number|null}
 */
function movingAverage(values, windowSize) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  if (windowSize === 0) {
    return null;
  }
  if (windowSize < 0 || !Number.isFinite(windowSize)) {
    return null;
  }
  const n = Math.floor(windowSize);
  if (values.length < n) {
    return 0;
  }
  const slice = values.slice(-n);
  let sum = 0;
  for (let i = 0; i < slice.length; i++) {
    sum += slice[i];
  }
  return sum / n;
}

/**
 * Ordinary least squares: L = m * W + intercept.
 * Transfer display uses L = mW - C where C = -intercept.
 *
 * @param {number[]} weights
 * @param {number[]} sensorLevels
 * @returns {{ m: number, C: number, intercept: number, r2: number }|null}
 */
function linearFit(weights, sensorLevels) {
  if (!Array.isArray(weights) || !Array.isArray(sensorLevels)) {
    return null;
  }
  const n = weights.length;
  if (n < 2 || n !== sensorLevels.length) {
    return null;
  }

  let sumW = 0;
  let sumL = 0;
  let sumWW = 0;
  let sumWL = 0;

  for (let i = 0; i < n; i++) {
    const w = weights[i];
    const l = sensorLevels[i];
    if (!Number.isFinite(w) || !Number.isFinite(l)) {
      return null;
    }
    sumW += w;
    sumL += l;
    sumWW += w * w;
    sumWL += w * l;
  }

  const denom = n * sumWW - sumW * sumW;
  if (Math.abs(denom) < M_EPS) {
    return null;
  }

  const m = (n * sumWL - sumW * sumL) / denom;
  const intercept = (sumL - m * sumW) / n;
  const C = -intercept;

  let ssTot = 0;
  let ssRes = 0;
  const meanL = sumL / n;
  for (let i = 0; i < n; i++) {
    const predicted = m * weights[i] + intercept;
    ssRes += (sensorLevels[i] - predicted) ** 2;
    ssTot += (sensorLevels[i] - meanL) ** 2;
  }
  const r2 = ssTot > M_EPS ? 1 - ssRes / ssTot : 1;

  return { m, C, intercept, r2 };
}

/**
 * Inverse transfer per mockup: W = (1/m) * L - (C/m).
 * C here is the positive intercept constant (b in L = mW + b).
 *
 * @param {number} L
 * @param {number} m
 * @param {number} intercept
 * @returns {number|null}
 */
function computeWeight(L, m, intercept) {
  if (!Number.isFinite(L) || !Number.isFinite(m) || !Number.isFinite(intercept)) {
    return null;
  }
  if (Math.abs(m) < M_EPS) {
    return null;
  }
  return L / m - intercept / m;
}

/**
 * Evaluate forward model L = mW - C.
 *
 * @param {number} W
 * @param {number} m
 * @param {number} C
 * @returns {number|null}
 */
function computeSensorLevel(W, m, C) {
  if (!Number.isFinite(W) || !Number.isFinite(m) || !Number.isFinite(C)) {
    return null;
  }
  return m * W - C;
}

var LoadCellAppPhysics = {
  M_EPS,
  movingAverage,
  linearFit,
  computeWeight,
  computeSensorLevel,
};
