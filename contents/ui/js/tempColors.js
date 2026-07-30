/*
 * Copyright 2026  Petar Nedyalkov
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License as
 * published by the Free Software Foundation; either version 2 of
 * the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

/**
 * tempColors.js — Shared temperature-to-color scale
 *
 * Single source of truth for the cold-to-hot gradient. Used by the forecast
 * temperature curve, which paints it into a Canvas, and by the panel
 * temperature, which needs a QML color, hence the two output helpers.
 *
 * Two sets of stops: bright ones stay readable on a dark background, deeper
 * ones on a light background.
 *
 * Non-pragma JS — plain globals, imported with "as TempColorsJS".
 */

var STOPS_DARK = [
    { t: -10, r:  50, g: 100, b: 255 },
    { t:   0, r:   0, g: 180, b: 255 },
    { t:  10, r:  80, g: 220, b: 160 },
    { t:  20, r: 220, g: 220, b:  40 },
    { t:  30, r: 255, g: 130, b:   0 },
    { t:  40, r: 220, g:  30, b:  30 }
];

var STOPS_LIGHT = [
    { t: -10, r:  20, g:  60, b: 200 },
    { t:   0, r:   0, g: 120, b: 210 },
    { t:  10, r:   0, g: 160, b:  80 },
    { t:  20, r: 170, g: 150, b:   0 },
    { t:  30, r: 210, g:  80, b:   0 },
    { t:  40, r: 180, g:  10, b:  10 }
];

/**
 * Interpolate the scale at a temperature.
 *
 * @param t     temperature in degrees Celsius
 * @param dark  true when the color sits on a dark background
 * @return      { r, g, b } with each channel in 0..255
 */
function rgbForTemperature(t, dark) {
    var stops = dark ? STOPS_DARK : STOPS_LIGHT;
    if (!isFinite(t) || t <= stops[0].t)
        return { r: stops[0].r, g: stops[0].g, b: stops[0].b };
    var last = stops[stops.length - 1];
    if (t >= last.t)
        return { r: last.r, g: last.g, b: last.b };
    for (var i = 1; i < stops.length; i++) {
        if (t <= stops[i].t) {
            var a = stops[i - 1], b = stops[i];
            var frac = (t - a.t) / (b.t - a.t);
            return {
                r: Math.round(a.r + frac * (b.r - a.r)),
                g: Math.round(a.g + frac * (b.g - a.g)),
                b: Math.round(a.b + frac * (b.b - a.b))
            };
        }
    }
    return { r: last.r, g: last.g, b: last.b };
}

/** CSS string for Canvas painting. */
function cssForTemperature(t, dark) {
    var c = rgbForTemperature(t, dark);
    return "rgba(" + c.r + "," + c.g + "," + c.b + ",1.0)";
}

/** QML color for regular items. */
function colorForTemperature(t, dark) {
    var c = rgbForTemperature(t, dark);
    return Qt.rgba(c.r / 255, c.g / 255, c.b / 255, 1.0);
}

/** True when a background color is dark enough to need the bright stops. */
function isDarkBackground(bg) {
    return (0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b) < 0.5;
}
