/**
 * Load cell physics computation module.
 * Pure functions only — no DOM or window access.
 */

const GRAMS_TO_NEWTONS = 0.00981;
const R_MIN = 0.01;
const DEFAULT_R_NOM = 100;

/**
 * @param {number} F_gram
 * @returns {number}
 */
function gramsToNewtons(F_gram) {
  return F_gram * GRAMS_TO_NEWTONS;
}

/**
 * @param {number} F_N
 * @param {number} k
 * @returns {number}
 */
function computeStrainFromForce(F_N, k) {
  return k * F_N;
}

/**
 * @param {number} R_nom
 * @param {number} GF
 * @param {number} epsilon
 * @param {number} sign +1 tension, -1 compression
 * @returns {number}
 */
function computeGaugeResistance(R_nom, GF, epsilon, sign) {
  if (sign >= 0) {
    return R_nom * (1 + GF * epsilon);
  }
  return R_nom * (1 - GF * epsilon);
}

/**
 * @param {number} R
 * @returns {number}
 */
function clampResistance(R) {
  return Math.max(R_MIN, R);
}

/**
 * @param {number} R1
 * @param {number} R2
 * @param {number} R3
 * @param {number} R4
 * @param {number} Vs
 * @returns {{ Va: number, Vb: number, Vo: number }}
 */
function computeBridgeVoltages(R1, R2, R3, R4, Vs) {
  if (Vs === 0) {
    return { Va: 0, Vb: 0, Vo: 0 };
  }

  const r2r3 = R2 + R3;
  const r1r4 = R1 + R4;
  const Va = r2r3 > 0 ? (R3 / r2r3) * Vs : 0;
  const Vb = r1r4 > 0 ? (R4 / r1r4) * Vs : 0;
  const Vo = Va - Vb;

  return { Va, Vb, Vo };
}

/**
 * @param {object} params
 * @param {number} params.Vs
 * @param {number} params.F_gram
 * @param {number} params.GF
 * @param {number} params.k
 * @param {number} params.R1_nom
 * @param {number} params.R2_nom
 * @param {number} params.R3_nom
 * @param {number} params.R4_nom
 * @param {boolean} params.forceActive
 * @returns {object}
 */
function computeLoadCell(params) {
  const warnings = [];
  const Vs = params.Vs;
  const F_gram = params.F_gram;
  const GF = params.GF;
  const k = params.k;
  const R1_nom = params.R1_nom;
  const R2_nom = params.R2_nom;
  const R3_nom = params.R3_nom;
  const R4_nom = params.R4_nom;
  const forceActive = params.forceActive;

  if (Vs < 0.1 || Vs > 24) {
    return { valid: false, warnings: ['Supply voltage Vs must be between 0.1 V and 24 V.'] };
  }
  if (GF < 0.1 || GF > 200) {
    return { valid: false, warnings: ['Gauge factor GF must be between 0.1 and 200.'] };
  }
  if (k < 0.0001 || k > 1.0) {
    return { valid: false, warnings: ['Sensitivity k must be between 0.0001 and 1.0 (1/N).'] };
  }
  if (R1_nom <= 0 || R2_nom <= 0 || R3_nom <= 0 || R4_nom <= 0) {
    return { valid: false, warnings: ['Nominal resistances R1–R4 must be positive.'] };
  }

  const F_N = gramsToNewtons(F_gram);
  let epsilon = 0;
  let deltaR = 0;
  let R1;
  let R2;
  let R3;
  let R4;

  if (forceActive) {
    epsilon = computeStrainFromForce(F_N, k);
    deltaR = R1_nom * GF * epsilon;

    if (Math.abs(GF * epsilon) >= 1) {
      warnings.push('GF × ε ≥ 1: resistance would become negative — values clamped to minimum.');
    }

    R1 = clampResistance(computeGaugeResistance(R1_nom, GF, epsilon, 1));
    R2 = clampResistance(computeGaugeResistance(R2_nom, GF, epsilon, -1));
    R3 = clampResistance(computeGaugeResistance(R3_nom, GF, epsilon, 1));
    R4 = clampResistance(computeGaugeResistance(R4_nom, GF, epsilon, -1));
  } else {
    R1 = R1_nom;
    R2 = R2_nom;
    R3 = R3_nom;
    R4 = R4_nom;
  }

  const bridge = computeBridgeVoltages(R1, R2, R3, R4, Vs);

  return {
    valid: true,
    warnings,
    F_N,
    F_gram,
    epsilon,
    deltaR,
    R1,
    R2,
    R3,
    R4,
    R1_nom,
    R2_nom,
    R3_nom,
    R4_nom,
    Va: bridge.Va,
    Vb: bridge.Vb,
    Vo: bridge.Vo,
    Vs,
    GF,
    k,
    forceActive,
  };
}

var LoadCellPhysics = {
  GRAMS_TO_NEWTONS,
  R_MIN,
  DEFAULT_R_NOM,
  gramsToNewtons,
  computeStrainFromForce,
  computeGaugeResistance,
  computeBridgeVoltages,
  computeLoadCell,
};
