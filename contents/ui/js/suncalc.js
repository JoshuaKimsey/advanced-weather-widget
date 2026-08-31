/**
 * suncalc.js - QML-compatible modification of SunCalc
 *
 * Original project:
 * https://github.com/mourner/suncalc
 *
 * Copyright (c) 2014, Vladimir Agafonkin
 *
 * License: BSD 2-Clause
 * Full license text: https://github.com/mourner/suncalc/blob/master/LICENSE
 *
 * This file retains the original copyright and license notice.
 * Modifications were made for KDE / Qt / QML compatibility.
 *
 * Changes:
 *   • Adapted for Qt/QML V4 engine (.pragma library, no ES modules)
 *   • Removed module.exports / require usage
 *   • Exposed public API as top-level functions
 *   • Extended getMoonTimes() with utcOffsetMins for location-local time
 *
 * Public API (mirrors original SunCalc):
 *
 *   getMoonIllumination(date)
 *     → { fraction: 0..1, phase: 0..1, angle }
 *       phase: 0/1=new moon, 0.25=first quarter, 0.5=full, 0.75=last quarter
 *       Multiply phase × 29.530588853 to get moon age in days.
 *
 *   getMoonTimes(date, lat, lng, utcOffsetMins)
 *     → { rise: "HH:mm", set: "HH:mm", alwaysUp: bool, alwaysDown: bool }
 *       Times are in location-local time (uses utcOffsetMins, not machine TZ).
 *
 *   getTimes(date, lat, lng)
 *     → { sunrise: Date, sunset: Date, solarNoon: Date, ... }
 *       (Date objects in UTC - format with Qt.formatTime as needed)
 */
.pragma library

// ── Math shorthands ────────────────────────────────────────────────────────
var PI  = Math.PI;
var sin = Math.sin, cos = Math.cos, tan = Math.tan;
var asin = Math.asin, atan = Math.atan2, acos = Math.acos;
var rad = PI / 180;

var dayMs  = 86400000;   // ms per day
var J1970  = 2440588;    // Julian day of Unix epoch
var J2000  = 2451545;    // Julian day of J2000.0

// ── Julian day helpers ─────────────────────────────────────────────────────

function _toJulian(date) {
    return date.valueOf() / dayMs - 0.5 + J1970;
}

function _toDays(date) {
    return _toJulian(date) - J2000;
}

function _fromJulian(j) {
    return new Date((j + 0.5 - J1970) * dayMs);
}

// ── Spherical coordinate helpers ───────────────────────────────────────────

var e = rad * 23.4397;   // obliquity of Earth's axis

function _rightAscension(l, b) {
    return atan(sin(l) * cos(e) - tan(b) * sin(e), cos(l));
}
function _declination(l, b) {
    return asin(sin(b) * cos(e) + cos(b) * sin(e) * sin(l));
}
function _altitude(H, phi, dec) {
    return asin(sin(phi) * sin(dec) + cos(phi) * cos(dec) * cos(H));
}
function _siderealTime(d, lw) {
    return rad * (280.16 + 360.9856235 * d) - lw;
}
function _astroRefraction(h) {
    // Atmospheric refraction correction (Saemundsson, simplified)
    if (h < 0) h = 0;
    return 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179));
}

// ── Sun position ───────────────────────────────────────────────────────────

function _solarMeanAnomaly(d) {
    return rad * (357.5291 + 0.98560028 * d);
}
function _eclipticLongitude(M) {
    var C = rad * (1.9148 * sin(M) + 0.02  * sin(2 * M) + 0.0003 * sin(3 * M));
    var P = rad * 102.9372;   // perihelion of Earth
    return M + C + P + PI;
}
function _sunCoords(d) {
    var M = _solarMeanAnomaly(d);
    var L = _eclipticLongitude(M);
    return { dec: _declination(L, 0), ra: _rightAscension(L, 0) };
}

// ── Moon position ──────────────────────────────────────────────────────────

function _moonCoords(d) {
    var L  = rad * (218.316 + 13.176396 * d);   // ecliptic longitude
    var M  = rad * (134.963 + 13.064993 * d);   // mean anomaly
    var F  = rad * (93.272  + 13.229350 * d);   // mean distance

    var l  = L + rad * 6.289 * sin(M);   // longitude
    var b  = rad * 5.128 * sin(F);       // latitude
    var dt = 385001 - 20905 * cos(M);    // distance in km

    return {
        ra:   _rightAscension(l, b),
        dec:  _declination(l, b),
        dist: dt
    };
}

// ── Public: getMoonIllumination ────────────────────────────────────────────
/**
 * Returns illumination data for the moon at the given date.
 *   fraction - illuminated fraction (0=new, 1=full)
 *   phase    - moon phase (0/1=new, 0.25=first quarter, 0.5=full, 0.75=last quarter)
 *   angle    - midpoint angle of illuminated limb (radians)
 *
 * To get moon age in days: phase * 29.530588853
 */
function getMoonIllumination(date) {
    var d   = _toDays(date || new Date());
    var s   = _sunCoords(d);
    var m   = _moonCoords(d);
    var sdist = 149598000;   // Earth-Sun distance in km

    var phi   = acos(sin(s.dec) * sin(m.dec) +
                     cos(s.dec) * cos(m.dec) * cos(s.ra - m.ra));
    var inc   = atan(sdist * sin(phi), m.dist - sdist * cos(phi));
    var angle = atan(cos(s.dec) * sin(s.ra - m.ra),
                     sin(s.dec) * cos(m.dec) -
                     cos(s.dec) * sin(m.dec) * cos(s.ra - m.ra));

    return {
        fraction: (1 + cos(inc)) / 2,
        phase:    0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / PI,
        angle:    angle
    };
}

// ── Public: getMoonTimes ───────────────────────────────────────────────────
/**
 * Calculates moon rise and set times for the given date and location.
 *
 *   date          - Date object (today is used when in doubt)
 *   lat, lng      - observer's latitude / longitude in decimal degrees
 *   utcOffsetMins - location's UTC offset in minutes (e.g. 120 for UTC+2)
 *                   Used so results are in location-local time, not machine TZ.
 *
 * Returns { rise: "HH:mm", set: "HH:mm", alwaysUp: bool, alwaysDown: bool }
 * "HH:mm" strings are in location-local time.  "--" when the event doesn't
 * occur that day (arctic summer/winter).
 *
 * Algorithm: quadratic interpolation on hourly altitude samples, identical
 * to mourner/suncalc - accurate to ±2 min for mid-latitudes.
 */
function getMoonTimes(date, lat, lng, utcOffsetMins) {
    var offset = (utcOffsetMins !== undefined && !isNaN(utcOffsetMins))
                 ? utcOffsetMins : 0;

    // Build a Date representing local midnight at the location in UTC
    var nowUTC   = new Date();
    var localMs  = nowUTC.getTime() + offset * 60000;
    var localNow = new Date(localMs);
    var t0 = new Date(Date.UTC(
        localNow.getUTCFullYear(),
        localNow.getUTCMonth(),
        localNow.getUTCDate()
    ));   // UTC midnight of local "today"

    var hc  = 0.133 * rad;   // moon horizon correction
    var lw  = -rad * lng;
    var phi = rad * lat;

    function hoursLater(h) {
        return new Date(t0.valueOf() + h * dayMs / 24);
    }
    function moonAlt(h) {
        var d  = _toDays(hoursLater(h));
        var m  = _moonCoords(d);
        var H  = _siderealTime(d, lw) - m.ra;
        return _altitude(H, phi, m.dec) - hc;
    }

    var x1 = moonAlt(0);
    var riseH = -1, setH = -1;

    // Search up to 30 hours (6 h into next day) so moonset/moonrise events
    // that spill past midnight are still found.
    for (var i = 1; i <= 30; i++) {
        var x2 = moonAlt(i - 0.5);
        var x3 = moonAlt(i);

        // Quadratic interpolation through (x1, x2, x3)
        var a  = 0.5 * (x1 + x3) - x2;
        var b  = 0.5 * (x3 - x1);
        var c  = x2;
        var xe = -b / (2 * a);
        var ye = (a * xe + b) * xe + c;
        var d2 = b * b - 4 * a * c;

        if (d2 >= 0) {
            var dx    = 0.5 * Math.sqrt(d2) / Math.abs(a);
            var r1    = xe - dx;
            var r2    = xe + dx;
            var roots = 0;

            if (Math.abs(r1) <= 1) roots++;
            if (Math.abs(r2) <= 1) roots++;
            if (r1 < -1) r1 = r2;

            if (roots === 1) {
                var h1 = i - 0.5 + 0.5 * r1;
                if (x1 < 0) { if (riseH < 0) riseH = h1; }
                else        { if (setH  < 0) setH  = h1; }
            } else if (roots === 2) {
                var hr = i - 0.5 + 0.5 * (ye < 0 ? r2 : r1);
                var hs = i - 0.5 + 0.5 * (ye < 0 ? r1 : r2);
                if (riseH < 0) riseH = hr;
                if (setH  < 0) setH  = hs;
            }
        }

        if (riseH >= 0 && setH >= 0) break;
        x1 = x3;
    }

    // Convert UT fractional hour → location-local "HH:mm" string
    function toLocalHHMM(h) {
        if (h < 0) return "--";
        var ms       = t0.valueOf() + h * dayMs / 24;
        var localMs2 = ms + offset * 60000;
        var ld       = new Date(localMs2);
        var hh = ld.getUTCHours(), mm = ld.getUTCMinutes();
        return (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm;
    }

    var isAlwaysUp   = riseH < 0 && setH < 0 && moonAlt(0) > 0;
    var isAlwaysDown = riseH < 0 && setH < 0 && !isAlwaysUp;

    return {
        rise:       toLocalHHMM(riseH),
        set:        toLocalHHMM(setH),
        alwaysUp:   isAlwaysUp,
        alwaysDown: isAlwaysDown
    };
}

// ── Public: getTimes ───────────────────────────────────────────────────────
/**
 * Returns sun event times for the given date and location.
 * Each property is a Date object (in UTC).  Format with Qt.formatTime().
 * Main properties: sunrise, sunset, solarNoon, dawn, dusk, nauticalDawn,
 *   nauticalDusk, astronomicalDawn, astronomicalDusk, goldenHour,
 *   goldenHourEnd, night, nightEnd, nadir.
 */
function getTimes(date, lat, lng) {
    var lw   = -rad * lng;
    var phi  = rad * lat;
    var d    = _toDays(date);
    var J0   = 0.0009;

    function julianCycle(d2, lw2) {
        return Math.round(d2 - J0 - lw2 / (2 * PI));
    }
    function approxTransit(Ht, lw2, n) {
        return J0 + (Ht + lw2) / (2 * PI) + n;
    }
    function solarTransitJ(ds, M, L) {
        return J2000 + ds + 0.0053 * sin(M) - 0.0069 * sin(2 * L);
    }
    function hourAngle(h, phi2, d2) {
        return acos((sin(h) - sin(phi2) * sin(d2)) / (cos(phi2) * cos(d2)));
    }
    function observerAngle(height) {
        return -2.076 * Math.sqrt(height) / 60;
    }
    function getSetJ(h, lw2, phi2, dec, n, M, L) {
        var w  = hourAngle(h, phi2, dec);
        var a  = approxTransit(w, lw2, n);
        return solarTransitJ(a, M, L);
    }

    var n    = julianCycle(d, lw);
    var ds   = approxTransit(0, lw, n);
    var M    = _solarMeanAnomaly(ds);
    var L    = _eclipticLongitude(M);
    var dec  = _declination(L, 0);
    var Jnoon = solarTransitJ(ds, M, L);

    var sunEvents = [
        [-0.833, "sunrise",         "sunset"        ],
        [-0.3,   "sunriseEnd",      "sunsetStart"   ],
        [-6,     "dawn",            "dusk"          ],
        [-12,    "nauticalDawn",    "nauticalDusk"  ],
        [-18,    "astronomicalDawn","astronomicalDusk"],
        [6,      "goldenHourEnd",   "goldenHour"    ]
    ];

    var result = {
        solarNoon: _fromJulian(Jnoon),
        nadir:     _fromJulian(Jnoon - 0.5)
    };

    for (var i = 0; i < sunEvents.length; i++) {
        var ev   = sunEvents[i];
        var ha   = ev[0] * rad + _astroRefraction(ev[0] * rad);
        try {
            var Jset  = getSetJ(ha, lw, phi, dec, n, M, L);
            var Jrise = Jnoon - (Jset - Jnoon);
            result[ev[1]] = _fromJulian(Jrise);
            result[ev[2]] = _fromJulian(Jset);
        } catch (e2) {
            result[ev[1]] = null;
            result[ev[2]] = null;
        }
    }

    return result;
}
