/**
 * Strain gauge physics computation module.
 * Pure functions only — no DOM or window access.
 */

const T_NOMINAL = 20;

const MATERIALS = {
  constantan: {
    name: 'Constantan (Cu-Ni)',
    E: 162e9,
    nu: 0.33,
    GF: 2.0,
    rho: 4.9e-7,
    alpha: 0.000008,
    sigma_y: 380e6,
  },
  nichrome: {
    name: 'Nichrome (Ni-Cr)',
    E: 220e9,
    nu: 0.30,
    GF: 2.2,
    rho: 1.1e-6,
    alpha: 0.00040,
    sigma_y: 700e6,
  },
  platinum: {
    name: 'Platinum',
    E: 168e9,
    nu: 0.39,
    GF: 6.1,
    rho: 1.06e-7,
    alpha: 0.003927,
    sigma_y: 140e6,
  },
  semiconductor: {
    name: 'Semiconductor (Si)',
    E: 130e9,
    nu: 0.28,
    GF: 155,
    rho: 6.4e-2,
    alpha: -0.075,
    sigma_y: 7000e6,
  },
};

const MATERIAL_KEYS = Object.keys(MATERIALS);

/**
 * @param {string} materialKey
 * @returns {object|null}
 */
function getMaterial(materialKey) {
  return MATERIALS[materialKey] || null;
}

/**
 * @param {number} A - cross-sectional area (m²)
 * @param {string} materialKey
 * @returns {{ min: number, max: number }}
 */
function getForceLimits(A, materialKey) {
  const material = getMaterial(materialKey);
  if (!material || A <= 0) {
    return { min: 0, max: 0 };
  }
  const limit = material.sigma_y * A;
  return { min: -limit, max: limit };
}

/**
 * @param {number} F
 * @param {number} A
 * @param {string} materialKey
 * @returns {number}
 */
function clampForce(F, A, materialKey) {
  const { min, max } = getForceLimits(A, materialKey);
  return Math.max(min, Math.min(max, F));
}

/**
 * @param {object} params
 * @param {string} params.materialKey
 * @param {number} params.L - length (m)
 * @param {number} params.A - cross-sectional area (m²)
 * @param {number} params.F - force (N)
 * @param {number} params.T - temperature (°C)
 * @returns {object}
 */
function computeStrainGauge(params) {
  const { materialKey, L, A, F, T } = params;
  const material = getMaterial(materialKey);

  if (!material || L <= 0 || A <= 0) {
    return {
      valid: false,
      material: material || null,
      F_clamped: 0,
      sigma: 0,
      epsilon: 0,
      deltaL: 0,
      epsilon_lateral: 0,
      A_prime: A > 0 ? A : 0,
      R_nominal: 0,
      R_strained: 0,
      R_T: 0,
      deltaT: T - T_NOMINAL,
      forceLimits: getForceLimits(A, materialKey),
    };
  }

  const F_clamped = clampForce(F, A, materialKey);
  const { E, nu, GF, rho, alpha } = material;

  const sigma = F_clamped / A;
  const epsilon = sigma / E;
  const deltaL = epsilon * L;
  const epsilon_lateral = -nu * epsilon;
  const A_prime = A * Math.pow(1 + epsilon_lateral, 2);

  const R_nominal = (rho * L) / A;
  const R_strained = R_nominal * (1 + GF * epsilon);
  const deltaT = T - T_NOMINAL;
  const R_T = R_strained * (1 + alpha * deltaT);

  return {
    valid: true,
    material,
    F_clamped,
    sigma,
    epsilon,
    deltaL,
    epsilon_lateral,
    A_prime,
    R_nominal,
    R_strained,
    R_T,
    deltaT,
    forceLimits: getForceLimits(A, materialKey),
  };
}

const SPECIMEN_STEEL = {
  E: 200e9,
  nu: 0.30,
  sigma_y: 250e6,
};

const SERPENTINE_MATERIALS = Object.assign({}, MATERIALS, {
  example_constantan: {
    name: 'Example Constantan',
    E: 162e9,
    nu: 0.33,
    GF: 2.0,
    rho: 5.0e-7,
    alpha: 0.000010,
    sigma_y: 380e6,
  },
});

const SERPENTINE_MATERIAL_KEYS = Object.keys(SERPENTINE_MATERIALS);

/**
 * @param {string} materialKey
 * @returns {object|null}
 */
function getSerpentineMaterial(materialKey) {
  return SERPENTINE_MATERIALS[materialKey] || null;
}

/**
 * @param {object} params - all lengths in metres (SI)
 * @param {number} params.n
 * @param {number} params.l_grid
 * @param {number} params.w
 * @param {number} params.s
 * @param {number} params.t
 * @returns {{ valid: boolean, L_total: number, A_gauge: number }}
 */
function computeGaugeGeometry(params) {
  const n = Math.max(1, Math.floor(params.n));
  const l_grid = params.l_grid;
  const w = params.w;
  const s = params.s;
  const t = params.t;

  if (l_grid <= 0 || w <= 0 || s < 0 || t <= 0) {
    return { valid: false, L_total: 0, A_gauge: 0, n };
  }

  const L_total = n * l_grid + Math.max(0, n - 1) * (s + w);
  const A_gauge = w * t;

  return { valid: true, L_total, A_gauge, n };
}

/**
 * @param {number} A_specimen - cross-sectional area (m²)
 * @returns {{ min: number, max: number, F_max: number }}
 */
function getSpecimenForceLimits(A_specimen) {
  if (A_specimen <= 0) {
    return { min: 0, max: 0, F_max: 0 };
  }
  const F_max = SPECIMEN_STEEL.sigma_y * A_specimen;
  return { min: -F_max, max: F_max, F_max };
}

/**
 * @param {number} F
 * @param {number} A_specimen
 * @returns {number}
 */
function clampSpecimenForce(F, A_specimen) {
  const { min, max } = getSpecimenForceLimits(A_specimen);
  return Math.max(min, Math.min(max, F));
}

/**
 * @param {object} params - geometric values in SI (m, m²)
 * @returns {object}
 */
function computeSerpentineGauge(params) {
  const {
    materialKey,
    n,
    l_grid,
    w,
    s,
    t,
    L_specimen,
    A_specimen,
    F,
    T,
  } = params;

  const material = getSerpentineMaterial(materialKey);
  const geometry = computeGaugeGeometry({ n, l_grid, w, s, t });
  const forceLimits = getSpecimenForceLimits(A_specimen);

  if (!material || !geometry.valid || L_specimen <= 0 || A_specimen <= 0) {
    return {
      valid: false,
      material: material || null,
      geometry,
      specimen: SPECIMEN_STEEL,
      F_clamped: 0,
      F_max: forceLimits.F_max,
      sigma: 0,
      epsilon: 0,
      epsilon_lateral: 0,
      deltaL_specimen: 0,
      R_nominal: 0,
      R_strained: 0,
      R_T: 0,
      deltaR_ratio: 0,
      deltaR_thermal_ratio: 0,
      deltaT: T - T_NOMINAL,
      forceLimits,
    };
  }

  const F_clamped = clampSpecimenForce(F, A_specimen);
  const { E, nu } = SPECIMEN_STEEL;
  const { GF, rho, alpha } = material;
  const { L_total, A_gauge } = geometry;

  const sigma = F_clamped / A_specimen;
  const epsilon = sigma / E;
  const epsilon_lateral = -nu * epsilon;
  const deltaL_specimen = epsilon * L_specimen;

  const R_nominal = (rho * L_total) / A_gauge;
  const R_strained = R_nominal * (1 + GF * epsilon);
  const deltaT = T - T_NOMINAL;
  const R_T = R_strained * (1 + alpha * deltaT);

  const deltaR_ratio = R_nominal !== 0
    ? ((R_strained - R_nominal) / R_nominal) * 100
    : 0;
  const deltaR_thermal_ratio = R_strained !== 0
    ? ((R_T - R_strained) / R_strained) * 100
    : 0;

  return {
    valid: true,
    material,
    geometry,
    specimen: SPECIMEN_STEEL,
    F_clamped,
    F_max: forceLimits.F_max,
    sigma,
    epsilon,
    epsilon_lateral,
    deltaL_specimen,
    R_nominal,
    R_strained,
    R_T,
    deltaR_ratio,
    deltaR_thermal_ratio,
    deltaT,
    forceLimits,
  };
}

var StrainGaugePhysics = {
  T_NOMINAL,
  MATERIALS,
  MATERIAL_KEYS,
  getMaterial,
  getForceLimits,
  clampForce,
  computeStrainGauge,
  SPECIMEN_STEEL,
  SERPENTINE_MATERIALS,
  SERPENTINE_MATERIAL_KEYS,
  getSerpentineMaterial,
  computeGaugeGeometry,
  getSpecimenForceLimits,
  clampSpecimenForce,
  computeSerpentineGauge,
};
