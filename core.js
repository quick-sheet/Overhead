/* Overhead core: SGP4 (near-Earth), frames, Sun, pass search, brightness.
   No dependencies. Works in the browser (window.Orbit) and Node (require). */
(function (root) {
  'use strict';

  const PI = Math.PI, TWO_PI = 2 * PI, DEG = PI / 180, RAD = 180 / PI;
  const MIN_PER_DAY = 1440;

  // WGS-72 constants, as SGP4 expects
  const MU = 398600.8, RE = 6378.135;
  const XKE = 60 / Math.sqrt(RE * RE * RE / MU);
  const J2 = 0.001082616, J3 = -0.00000253881, J4 = -0.00000165597;
  const J3OJ2 = J3 / J2, X2O3 = 2 / 3;

  // WGS-84 for the observer
  const A84 = 6378.137, F84 = 1 / 298.257223563, E2_84 = F84 * (2 - F84);

  const AU = 149597870.7;

  const mod2pi = (x) => { x %= TWO_PI; return x < 0 ? x + TWO_PI : x; };
  const jdFromMs = (ms) => ms / 86400000 + 2440587.5;

  /* ---------- Element parsing ---------- */

  // CelesTrak OMM JSON record -> elements
  function fromOMM(o) {
    const ep = String(o.EPOCH).replace(/(\.\d{3})\d*/, '$1');
    const epochMs = Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(ep) ? ep : ep + 'Z');
    return {
      id: String(o.NORAD_CAT_ID),
      name: String(o.OBJECT_NAME || o.NORAD_CAT_ID).trim(),
      epochMs,
      inclo: +o.INCLINATION * DEG,
      nodeo: +o.RA_OF_ASC_NODE * DEG,
      ecco: +o.ECCENTRICITY,
      argpo: +o.ARG_OF_PERICENTER * DEG,
      mo: +o.MEAN_ANOMALY * DEG,
      no: +o.MEAN_MOTION * TWO_PI / MIN_PER_DAY,
      bstar: +o.BSTAR,
    };
  }

  // Two-line element set -> elements
  function fromTLE(name, l1, l2) {
    const yy = parseInt(l1.substring(18, 20), 10);
    const doy = parseFloat(l1.substring(20, 32));
    const year = yy < 57 ? 2000 + yy : 1900 + yy;
    const epochMs = Date.UTC(year, 0, 1) + (doy - 1) * 86400000;
    const bs = l1.substring(53, 61);
    const bsign = bs.trim().startsWith('-') ? -1 : 1;
    const bm = bs.replace(/^\s*[-+]?/, '');
    const bstar = bsign * parseFloat('0.' + bm.substring(0, 5)) * Math.pow(10, parseInt(bm.substring(5), 10) || 0);
    return {
      id: l1.substring(2, 7).trim(),
      name: (name || l1.substring(2, 7)).trim(),
      epochMs,
      inclo: parseFloat(l2.substring(8, 16)) * DEG,
      nodeo: parseFloat(l2.substring(17, 25)) * DEG,
      ecco: parseFloat('0.' + l2.substring(26, 33).trim()),
      argpo: parseFloat(l2.substring(34, 42)) * DEG,
      mo: parseFloat(l2.substring(43, 51)) * DEG,
      no: parseFloat(l2.substring(52, 63)) * TWO_PI / MIN_PER_DAY,
      bstar,
    };
  }

  /* ---------- SGP4 (near-Earth branch, after Vallado et al. 2006) ---------- */

  function init(el) {
    const s = Object.assign({}, el, { error: 0 });
    const { ecco, inclo, argpo, mo } = s;
    const no_k = s.no;

    // initl
    const eccsq = ecco * ecco, omeosq = 1 - eccsq, rteosq = Math.sqrt(omeosq);
    const cosio = Math.cos(inclo), cosio2 = cosio * cosio;
    const ak = Math.pow(XKE / no_k, X2O3);
    const d1 = 0.75 * J2 * (3 * cosio2 - 1) / (rteosq * omeosq);
    let del = d1 / (ak * ak);
    const adel = ak * (1 - del * del - del * (1 / 3 + 134 * del * del / 81));
    del = d1 / (adel * adel);
    const no = no_k / (1 + del);
    const ao = Math.pow(XKE / no, X2O3);
    const sinio = Math.sin(inclo);
    const po = ao * omeosq;
    const con42 = 1 - 5 * cosio2;
    const con41 = -con42 - cosio2 - cosio2;
    const posq = po * po;
    const rp = ao * (1 - ecco);

    s.no_unkozai = no;
    s.con41 = con41;
    s.x1mth2 = 1 - cosio2;
    s.x7thm1 = 7 * cosio2 - 1;

    if (TWO_PI / no >= 225) { s.error = 'deep'; return s; } // high orbits not supported

    const ss = 78 / RE + 1;
    const qzms2t = Math.pow((120 - 78) / RE, 4);
    s.isimp = rp < (220 / RE + 1) ? 1 : 0;
    let sfour = ss, qzms24 = qzms2t;
    const perige = (rp - 1) * RE;
    if (perige < 156) {
      sfour = perige - 78;
      if (perige < 98) sfour = 20;
      qzms24 = Math.pow((120 - sfour) / RE, 4);
      sfour = sfour / RE + 1;
    }
    const pinvsq = 1 / posq;
    const tsi = 1 / (ao - sfour);
    const eta = ao * ecco * tsi;
    const etasq = eta * eta, eeta = ecco * eta;
    const psisq = Math.abs(1 - etasq);
    const coef = qzms24 * Math.pow(tsi, 4);
    const coef1 = coef / Math.pow(psisq, 3.5);
    const cc2 = coef1 * no * (ao * (1 + 1.5 * etasq + eeta * (4 + etasq)) +
      0.375 * J2 * tsi / psisq * con41 * (8 + 3 * etasq * (8 + etasq)));
    const cc1 = s.bstar * cc2;
    let cc3 = 0;
    if (ecco > 1e-4) cc3 = -2 * coef * tsi * J3OJ2 * no * sinio / ecco;
    const cc4 = 2 * no * coef1 * ao * omeosq * (eta * (2 + 0.5 * etasq) + ecco * (0.5 + 2 * etasq) -
      J2 * tsi / (ao * psisq) * (-3 * con41 * (1 - 2 * eeta + etasq * (1.5 - 0.5 * eeta)) +
        0.75 * s.x1mth2 * (2 * etasq - eeta * (1 + etasq)) * Math.cos(2 * argpo)));
    const cc5 = 2 * coef1 * ao * omeosq * (1 + 2.75 * (etasq + eeta) + eeta * etasq);
    const cosio4 = cosio2 * cosio2;
    const temp1 = 1.5 * J2 * pinvsq * no;
    const temp2 = 0.5 * temp1 * J2 * pinvsq;
    const temp3 = -0.46875 * J4 * pinvsq * pinvsq * no;
    s.mdot = no + 0.5 * temp1 * rteosq * con41 + 0.0625 * temp2 * rteosq * (13 - 78 * cosio2 + 137 * cosio4);
    s.argpdot = -0.5 * temp1 * con42 + 0.0625 * temp2 * (7 - 114 * cosio2 + 395 * cosio4) +
      temp3 * (3 - 36 * cosio2 + 49 * cosio4);
    const xhdot1 = -temp1 * cosio;
    s.nodedot = xhdot1 + (0.5 * temp2 * (4 - 19 * cosio2) + 2 * temp3 * (3 - 7 * cosio2)) * cosio;
    s.omgcof = s.bstar * cc3 * Math.cos(argpo);
    s.xmcof = ecco > 1e-4 ? -X2O3 * coef * s.bstar / eeta : 0;
    s.nodecf = 3.5 * omeosq * xhdot1 * cc1;
    s.t2cof = 1.5 * cc1;
    const den = Math.abs(cosio + 1) > 1.5e-12 ? 1 + cosio : 1.5e-12;
    s.xlcof = -0.25 * J3OJ2 * sinio * (3 + 5 * cosio) / den;
    s.aycof = -0.5 * J3OJ2 * sinio;
    s.delmo = Math.pow(1 + eta * Math.cos(mo), 3);
    s.sinmao = Math.sin(mo);
    s.eta = eta; s.cc1 = cc1; s.cc4 = cc4; s.cc5 = cc5;

    if (s.isimp !== 1) {
      const cc1sq = cc1 * cc1;
      s.d2 = 4 * ao * tsi * cc1sq;
      const temp = s.d2 * tsi * cc1 / 3;
      s.d3 = (17 * ao + sfour) * temp;
      s.d4 = 0.5 * temp * ao * tsi * (221 * ao + 31 * sfour) * cc1;
      s.t3cof = s.d2 + 2 * cc1sq;
      s.t4cof = 0.25 * (3 * s.d3 + cc1 * (12 * s.d2 + 10 * cc1sq));
      s.t5cof = 0.2 * (3 * s.d4 + 12 * cc1 * s.d3 + 6 * s.d2 * s.d2 + 15 * cc1sq * (2 * s.d2 + cc1sq));
    }
    return s;
  }

  // Position (km) and velocity (km/s) in TEME at tsince minutes from epoch. Returns null on failure.
  function sgp4(s, t) {
    if (s.error) return null;
    const xmdf = s.mo + s.mdot * t;
    const argpdf = s.argpo + s.argpdot * t;
    const nodedf = s.nodeo + s.nodedot * t;
    let argpm = argpdf, mm = xmdf;
    const t2 = t * t;
    let nodem = nodedf + s.nodecf * t2;
    let tempa = 1 - s.cc1 * t;
    let tempe = s.bstar * s.cc4 * t;
    let templ = s.t2cof * t2;
    if (s.isimp !== 1) {
      const delomg = s.omgcof * t;
      const delm = s.xmcof * (Math.pow(1 + s.eta * Math.cos(xmdf), 3) - s.delmo);
      const temp = delomg + delm;
      mm = xmdf + temp;
      argpm = argpdf - temp;
      const t3 = t2 * t, t4 = t3 * t;
      tempa = tempa - s.d2 * t2 - s.d3 * t3 - s.d4 * t4;
      tempe = tempe + s.bstar * s.cc5 * (Math.sin(mm) - s.sinmao);
      templ = templ + s.t3cof * t3 + t4 * (s.t4cof + t * s.t5cof);
    }
    let nm = s.no_unkozai;
    let em = s.ecco;
    const inclm = s.inclo;
    const am = Math.pow(XKE / nm, X2O3) * tempa * tempa;
    nm = XKE / Math.pow(am, 1.5);
    em = em - tempe;
    if (em >= 1 || em < -0.001 || am < 0.95) return null;
    if (em < 1e-6) em = 1e-6;
    mm = mm + s.no_unkozai * templ;
    let xlm = mm + argpm + nodem;
    nodem = mod2pi(nodem); argpm = mod2pi(argpm); xlm = mod2pi(xlm);
    mm = mod2pi(xlm - argpm - nodem);

    const sinip = Math.sin(inclm), cosip = Math.cos(inclm);
    const axnl = em * Math.cos(argpm);
    let temp = 1 / (am * (1 - em * em));
    const aynl = em * Math.sin(argpm) + temp * s.aycof;
    const xl = mm + argpm + nodem + temp * s.xlcof * axnl;

    const u = mod2pi(xl - nodem);
    let eo1 = u, tem5 = 9999.9, ktr = 1, sineo1 = 0, coseo1 = 0;
    while (Math.abs(tem5) >= 1e-12 && ktr <= 10) {
      sineo1 = Math.sin(eo1); coseo1 = Math.cos(eo1);
      tem5 = 1 - coseo1 * axnl - sineo1 * aynl;
      tem5 = (u - aynl * coseo1 + axnl * sineo1 - eo1) / tem5;
      if (Math.abs(tem5) >= 0.95) tem5 = tem5 > 0 ? 0.95 : -0.95;
      eo1 += tem5; ktr++;
    }
    const ecose = axnl * coseo1 + aynl * sineo1;
    const esine = axnl * sineo1 - aynl * coseo1;
    const el2 = axnl * axnl + aynl * aynl;
    const pl = am * (1 - el2);
    if (pl < 0) return null;
    const rl = am * (1 - ecose);
    const rdotl = Math.sqrt(am) * esine / rl;
    const rvdotl = Math.sqrt(pl) / rl;
    const betal = Math.sqrt(1 - el2);
    temp = esine / (1 + betal);
    const sinu = am / rl * (sineo1 - aynl - axnl * temp);
    const cosu = am / rl * (coseo1 - axnl + aynl * temp);
    let su = Math.atan2(sinu, cosu);
    const sin2u = (cosu + cosu) * sinu;
    const cos2u = 1 - 2 * sinu * sinu;
    temp = 1 / pl;
    const temp1 = 0.5 * J2 * temp;
    const temp2 = temp1 * temp;
    const mrt = rl * (1 - 1.5 * temp2 * betal * s.con41) + 0.5 * temp1 * s.x1mth2 * cos2u;
    if (mrt < 1) return null; // decayed
    su = su - 0.25 * temp2 * s.x7thm1 * sin2u;
    const xnode = nodem + 1.5 * temp2 * cosip * sin2u;
    const xinc = inclm + 1.5 * temp2 * cosip * sinip * cos2u;
    const mvt = rdotl - nm * temp1 * s.x1mth2 * sin2u / XKE;
    const rvdot = rvdotl + nm * temp1 * (s.x1mth2 * cos2u + 1.5 * s.con41) / XKE;

    const sinsu = Math.sin(su), cossu = Math.cos(su);
    const snod = Math.sin(xnode), cnod = Math.cos(xnode);
    const sini = Math.sin(xinc), cosi = Math.cos(xinc);
    const xmx = -snod * cosi, xmy = cnod * cosi;
    const ux = xmx * sinsu + cnod * cossu;
    const uy = xmy * sinsu + snod * cossu;
    const uz = sini * sinsu;
    const vx = xmx * cossu - cnod * sinsu;
    const vy = xmy * cossu - snod * sinsu;
    const vz = sini * cossu;
    const mr = mrt * RE;
    const vk = RE * XKE / 60;
    return {
      r: [mr * ux, mr * uy, mr * uz],
      v: [(mvt * ux + rvdot * vx) * vk, (mvt * uy + rvdot * vy) * vk, (mvt * uz + rvdot * vz) * vk],
    };
  }

  /* ---------- Frames ---------- */

  function gmst(jd) {
    const t = (jd - 2451545.0) / 36525;
    let g = -6.2e-6 * t * t * t + 0.093104 * t * t + (876600 * 3600 + 8640184.812866) * t + 67310.54841;
    return mod2pi(g * DEG / 240);
  }

  const rotZ = (v, g) => {
    const c = Math.cos(g), s = Math.sin(g);
    return [c * v[0] + s * v[1], -s * v[0] + c * v[1], v[2]];
  };

  function observer(latDeg, lonDeg, hKm) {
    const lat = latDeg * DEG, lon = lonDeg * DEG, h = hKm || 0;
    const sl = Math.sin(lat), cl = Math.cos(lat), so = Math.sin(lon), co = Math.cos(lon);
    const N = A84 / Math.sqrt(1 - E2_84 * sl * sl);
    return {
      lat, lon, h, sl, cl, so, co,
      ecf: [(N + h) * cl * co, (N + h) * cl * so, (N * (1 - E2_84) + h) * sl],
    };
  }

  // Azimuth (deg from north, clockwise), elevation (deg), range (km) of an ECEF point
  function look(obs, p) {
    const dx = p[0] - obs.ecf[0], dy = p[1] - obs.ecf[1], dz = p[2] - obs.ecf[2];
    const south = obs.sl * obs.co * dx + obs.sl * obs.so * dy - obs.cl * dz;
    const east = -obs.so * dx + obs.co * dy;
    const up = obs.cl * obs.co * dx + obs.cl * obs.so * dy + obs.sl * dz;
    const range = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let az = Math.atan2(east, -south) * RAD;
    if (az < 0) az += 360;
    return { az, el: Math.asin(up / range) * RAD, range };
  }

  // Low-precision Sun position, equatorial of date (km). Good to ~0.01°.
  function sunEci(jd) {
    const n = jd - 2451545.0;
    const L = (280.460 + 0.9856474 * n) * DEG;
    const g = (357.528 + 0.9856003 * n) * DEG;
    const lam = L + (1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
    const eps = (23.439 - 0.0000004 * n) * DEG;
    const r = (1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g)) * AU;
    return [r * Math.cos(lam), r * Math.cos(eps) * Math.sin(lam), r * Math.sin(eps) * Math.sin(lam)];
  }

  function sunAltitude(obs, ms) {
    const jd = jdFromMs(ms);
    return look(obs, rotZ(sunEci(jd), gmst(jd))).el;
  }

  // Low-precision Moon position, equatorial of date (km). Good to ~0.3°, plenty for rise, set and phase.
  function moonEci(jd) {
    const T = (jd - 2451545.0) / 36525, d = DEG;
    const L = 218.32 + 481267.881 * T
      + 6.29 * Math.sin((135.0 + 477198.87 * T) * d) - 1.27 * Math.sin((259.3 - 413335.36 * T) * d)
      + 0.66 * Math.sin((235.7 + 890534.22 * T) * d) + 0.21 * Math.sin((269.9 + 954397.74 * T) * d)
      - 0.19 * Math.sin((357.5 + 35999.05 * T) * d) - 0.11 * Math.sin((186.5 + 966404.03 * T) * d);
    const B = 5.13 * Math.sin((93.3 + 483202.02 * T) * d) + 0.28 * Math.sin((228.2 + 960400.89 * T) * d)
      - 0.28 * Math.sin((318.3 + 6003.15 * T) * d) - 0.17 * Math.sin((217.6 - 407332.21 * T) * d);
    const P = 0.9508 + 0.0518 * Math.cos((135.0 + 477198.87 * T) * d) + 0.0095 * Math.cos((259.3 - 413335.36 * T) * d)
      + 0.0078 * Math.cos((235.7 + 890534.22 * T) * d) + 0.0028 * Math.cos((269.9 + 954397.74 * T) * d);
    const r = 6378.14 / Math.sin(P * d);
    const lam = L * d, bet = B * d, eps = (23.439 - 0.0000004 * (jd - 2451545.0)) * d;
    const xe = r * Math.cos(bet) * Math.cos(lam), ye = r * Math.cos(bet) * Math.sin(lam), ze = r * Math.sin(bet);
    return [xe, ye * Math.cos(eps) - ze * Math.sin(eps), ye * Math.sin(eps) + ze * Math.cos(eps)];
  }

  // Moon as seen from the observer: altitude, azimuth, fraction lit, waxing or waning
  function moon(obs, ms) {
    const lit = (t) => {
      const jd = jdFromMs(t), m = moonEci(jd), s = sunEci(jd);
      const c = (m[0] * s[0] + m[1] * s[1] + m[2] * s[2]) / (Math.hypot(...m) * Math.hypot(...s));
      return (1 - c) / 2;
    };
    const jd = jdFromMs(ms);
    const la = look(obs, rotZ(moonEci(jd), gmst(jd)));
    const illum = lit(ms);
    return { alt: la.el, az: la.az, dist: la.range, illum, waxing: lit(ms + 6 * 3600e3) > illum };
  }

  // Moonrise and moonset between two times (centre at -0.83°, allowing for refraction and size)
  function moonEvents(obs, fromMs, toMs) {
    const h0 = -0.83, f = (t) => moon(obs, t).alt - h0, out = [];
    let t = fromMs, v = f(t);
    while (t < toMs) {
      const nt = t + 10 * 60000, nv = f(nt);
      if ((v < 0) !== (nv < 0)) {
        let a = t, b = nt, va = v;
        while (b - a > 30000) { const m = (a + b) / 2, vm = f(m); if ((vm < 0) === (va < 0)) { a = m; va = vm; } else b = m; }
        out.push({ type: v < 0 ? 'rise' : 'set', t: Math.round((a + b) / 2) });
      }
      t = nt; v = nv;
    }
    return out;
  }

  /* ---------- Satellite state seen from an observer ---------- */

  // Typical standard magnitudes (1000 km, half lit). Approximate.
  const STD_MAG = { '25544': -1.3, '48274': 0.5, '20580': 2.2 };

  function state(sat, obs, ms) {
    const jd = jdFromMs(ms);
    const tsince = (ms - sat.epochMs) / 60000;
    const pv = sgp4(sat, tsince);
    if (!pv) return null;
    const g = gmst(jd);
    const satE = rotZ(pv.r, g);
    const sunE = rotZ(sunEci(jd), g);
    const la = look(obs, satE);
    const sunAlt = look(obs, sunE).el;

    // Earth shadow (cylinder) test
    const sm = Math.hypot(sunE[0], sunE[1], sunE[2]);
    const su = [sunE[0] / sm, sunE[1] / sm, sunE[2] / sm];
    const d = satE[0] * su[0] + satE[1] * su[1] + satE[2] * su[2];
    let sunlit = true;
    if (d < 0) {
      const px = satE[0] - d * su[0], py = satE[1] - d * su[1], pz = satE[2] - d * su[2];
      sunlit = Math.sqrt(px * px + py * py + pz * pz) > RE;
    }

    // Brightness from phase angle and range (diffuse sphere)
    let mag = null;
    const std = sat.stdMag != null ? sat.stdMag : STD_MAG[sat.id];
    if (std != null && sunlit) {
      const toSun = [sunE[0] - satE[0], sunE[1] - satE[1], sunE[2] - satE[2]];
      const toObs = [obs.ecf[0] - satE[0], obs.ecf[1] - satE[1], obs.ecf[2] - satE[2]];
      const a = Math.hypot(...toSun), b = Math.hypot(...toObs);
      const cosph = (toSun[0] * toObs[0] + toSun[1] * toObs[1] + toSun[2] * toObs[2]) / (a * b);
      const ph = Math.acos(Math.max(-1, Math.min(1, cosph)));
      const f = Math.max(1e-3, Math.sin(ph) + (PI - ph) * Math.cos(ph));
      mag = std + 5 * Math.log10(la.range / 1000) - 2.5 * Math.log10(f);
    }
    return { t: ms, az: la.az, el: la.el, range: la.range, sunlit, sunAlt, mag };
  }

  /* ---------- Pass search ---------- */

  const DEFAULTS = { mask: 10, darkSun: -6, step: 30000 };

  function bisect(fn, a, b, va) {
    // fn(t) boolean; fn(a) === va, fn(b) !== va; returns boundary to ~1 s
    while (b - a > 1000) {
      const m = (a + b) / 2;
      if (fn(m) === va) a = m; else b = m;
    }
    return Math.round((a + b) / 2);
  }

  function peak(sat, obs, a, b) {
    let best = null;
    const step = Math.max(2000, (b - a) / 60);
    for (let t = a; t <= b; t += step) {
      const s = state(sat, obs, t);
      if (s && (!best || s.el > best.el)) best = s;
    }
    if (!best) return null;
    // golden-section refine around best sample
    let lo = Math.max(a, best.t - step), hi = Math.min(b, best.t + step);
    const gr = 0.6180339887;
    for (let i = 0; i < 18; i++) {
      const m1 = hi - gr * (hi - lo), m2 = lo + gr * (hi - lo);
      const s1 = state(sat, obs, m1), s2 = state(sat, obs, m2);
      if (!s1 || !s2) break;
      if (s1.el > s2.el) hi = m2; else lo = m1;
    }
    return state(sat, obs, (lo + hi) / 2) || best;
  }

  function summarise(sat, obs, a, b) {
    const s0 = state(sat, obs, a), s1 = state(sat, obs, b), pk = peak(sat, obs, a, b);
    if (!s0 || !s1 || !pk) return null;
    // brightest moment within the window (for the label)
    let bright = pk.mag;
    for (let t = a; t <= b; t += 10000) {
      const s = state(sat, obs, t);
      if (s && s.mag != null && (bright == null || s.mag < bright)) bright = s.mag;
    }
    return { start: a, end: b, startAz: s0.az, startEl: s0.el, endAz: s1.az, endEl: s1.el, max: pk, mag: bright };
  }

  function findPasses(sat, obs, fromMs, toMs, opts) {
    const o = Object.assign({}, DEFAULTS, opts);
    if (sat.error) return [];
    const up = (t) => { const s = state(sat, obs, t); return !!s && s.el >= o.mask; };
    const vis = (t) => {
      const s = state(sat, obs, t);
      return !!s && s.el >= o.mask && s.sunlit && s.sunAlt <= o.darkSun;
    };

    const passes = [];
    let prev = up(fromMs), t = fromMs, riseT = prev ? fromMs : null;
    // if already up at the start, walk back to find the real rise (max 20 min)
    if (prev) {
      let b = fromMs;
      while (b > fromMs - 20 * 60000 && up(b - o.step)) b -= o.step;
      riseT = up(b - o.step) ? b : bisect(up, b - o.step, b, false);
    }
    while (t < toMs) {
      const nt = t + o.step;
      const cur = up(nt);
      if (!prev && cur) riseT = bisect(up, t, nt, false);
      if (prev && !cur && riseT != null) {
        const setT = bisect(up, t, nt, true);
        passes.push(build(riseT, setT));
        riseT = null;
      }
      prev = cur; t = nt;
    }
    return passes.filter(Boolean);

    function build(a, b) {
      const all = summarise(sat, obs, a, b);
      if (!all) return null;
      // visible part
      let va = null, vb = null;
      for (let x = a; x <= b; x += 5000) {
        if (vis(x)) { if (va == null) va = x; vb = x; }
      }
      if (vis(b)) vb = b;
      let visible = null, startReason = 'rise', endReason = 'set';
      if (va != null) {
        if (va > a) va = bisect(vis, va - 5000 < a ? a : va - 5000, va, false);
        if (vb < b) vb = bisect(vis, vb, Math.min(b, vb + 5000), true);
        visible = summarise(sat, obs, va, vb);
        if (visible) {
          const pre = state(sat, obs, va - 2000), post = state(sat, obs, vb + 2000);
          if (pre && pre.el >= o.mask) startReason = !pre.sunlit ? 'shadow' : 'sky';
          if (post && post.el >= o.mask) endReason = !post.sunlit ? 'shadow' : 'sky';
        }
      }
      const why = visible ? 'visible' : (all.max.sunAlt > o.darkSun ? 'daylight' : 'shadow');
      return {
        satId: sat.id, name: sat.name, all, visible, why, startReason, endReason,
      };
    }
  }

  // Sky path for drawing: from horizon to horizon, sampled every 10 s
  function path(sat, obs, pass, opts) {
    const o = Object.assign({}, DEFAULTS, opts);
    const pts = [];
    let a = pass.all.start, b = pass.all.end;
    for (let i = 0; i < 60; i++) { const s = state(sat, obs, a - 10000); if (!s || s.el < 0) break; a -= 10000; }
    for (let i = 0; i < 60; i++) { const s = state(sat, obs, b + 10000); if (!s || s.el < 0) break; b += 10000; }
    for (let t = a; t <= b; t += 10000) {
      const s = state(sat, obs, t);
      if (!s) continue;
      s.vis = s.el >= o.mask && s.sunlit && s.sunAlt <= o.darkSun;
      pts.push(s);
    }
    return pts;
  }

  /* ---------- Words ---------- */

  const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const WORDS = ['north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast', 'southeast',
    'south-southeast', 'south', 'south-southwest', 'southwest', 'west-southwest', 'west', 'west-northwest',
    'northwest', 'north-northwest'];
  const idx = (az) => Math.round(((az % 360) + 360) % 360 / 22.5) % 16;
  const compass = (az) => POINTS[idx(az)];
  const compassWords = (az) => WORDS[idx(az)];

  const api = {
    fromOMM, fromTLE, init, sgp4, gmst, observer, look, sunEci, sunAltitude, moonEci, moon, moonEvents, state,
    findPasses, path, compass, compassWords, jdFromMs, STD_MAG,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Orbit = api;
})(typeof self !== 'undefined' ? self : this);
