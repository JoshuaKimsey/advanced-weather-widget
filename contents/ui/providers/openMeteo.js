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
 * openMeteo.js — Open-Meteo current + hourly fetcher
 *
 * Non-pragma JS — accesses config via service properties.
 * Qt global is available; Plasmoid/i18n/Locale are NOT (use service instead).
 */

.import "../js/weather.js" as W

function fetchCurrent(service, chain, idx) {
    var gen = service._refreshGen;
    var r = service.weatherRoot;
    var tz = service.timezone;
    var requestedDays = Math.min(service.forecastDays, 16);
    var url = "https://api.open-meteo.com/v1/forecast"
        + "?latitude=" + service.latitude
        + "&longitude=" + service.longitude
        + "&timezone=" + encodeURIComponent(tz.length > 0 ? tz : "auto")
        + "&forecast_days=" + requestedDays
        + "&current=temperature_2m,apparent_temperature,relative_humidity_2m,"
        + "weather_code,wind_speed_10m,wind_direction_10m,pressure_msl,"
        + "dew_point_2m,visibility,is_day,precipitation,uv_index,snow_depth"
        + "&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,"
        + "precipitation_sum,snowfall_sum,precipitation_probability_max,wind_speed_10m_max,wind_direction_10m_dominant,"
        + "uv_index_max,pressure_msl_mean,visibility_mean"
        + W.openMeteoModelParam(service.openMeteoModel, service.countryCode);

    var req = new XMLHttpRequest();
    req.open("GET", url);
    req.onreadystatechange = function () {
        if (req.readyState !== XMLHttpRequest.DONE)
            return;
        if (service._refreshGen !== gen) return;
        if (req.status !== 200) {
            service._tryProvider(chain, idx + 1);
            return;
        }
        var d = JSON.parse(req.responseText);
        if (!d.current) {
            service._tryProvider(chain, idx + 1);
            return;
        }
        var c = d.current;
        var nd = _parseDailyArray(d, requestedDays);

        // National high-res models (ICON-D2 for Germany, AROME for France,
        // UKMO for the UK, etc.) each cover a different number of days —
        // Open-Meteo doesn't error for the days beyond that, it just returns
        // null for them. Detect that here rather than trusting a hardcoded
        // per-country day count, since coverage windows change over time.
        var needsBackfill = nd.length < requestedDays || nd.some(_isDailyIncomplete);

        function finalizeWithDaily(dailyArr) {
            if (service._refreshGen !== gen) return;
            r.weatherDataStaged = {
                temperatureC:        c.temperature_2m,
                apparentC:           c.apparent_temperature,
                humidityPercent:     c.relative_humidity_2m,
                windKmh:             c.wind_speed_10m,
                windDirection:       isNaN(c.wind_direction_10m) ? NaN : c.wind_direction_10m,
                pressureHpa:         c.pressure_msl,   // sea-level pressure (matches Foreca et al.)
                dewPointC:           c.dew_point_2m,
                visibilityKm:        c.visibility / 1000.0,
                weatherCode:         c.weather_code,
                isDay:               (c.is_day !== undefined) ? c.is_day : -1,
                precipMmh:           (c.precipitation !== undefined) ? c.precipitation : NaN,
                uvIndex:             (c.uv_index !== undefined) ? c.uv_index : NaN,
                snowDepthCm:         (c.snow_depth !== undefined && c.snow_depth !== null) ? c.snow_depth * 100 : NaN,
                locationUtcOffsetMins: (d.utc_offset_seconds !== undefined) ? Math.round(d.utc_offset_seconds / 60) : 0,
                sunriseTimeText:     (d.daily && d.daily.sunrise && d.daily.sunrise.length > 0) ? Qt.formatTime(new Date(d.daily.sunrise[0]), "HH:mm") : "--",
                sunsetTimeText:      (d.daily && d.daily.sunset  && d.daily.sunset.length  > 0) ? Qt.formatTime(new Date(d.daily.sunset[0]),  "HH:mm") : "--",
                dailyData:           dailyArr
            };
            r.loading = false;
            r.updateText = service._formatUpdateText("openMeteo");

            // No native alerts — fall back to MeteoAlarm / NWS
            service._fetchAlertsIfNeeded();
        }

        if (!needsBackfill) {
            finalizeWithDaily(nd);
            return;
        }

        // Fetch the same range from Open-Meteo's global best-match blend and
        // use it only to fill the days the high-res model didn't cover.
        _fetchDailyBackup(service, gen, requestedDays, function (backupNd) {
            finalizeWithDaily(_mergeDailyArrays(nd, backupNd, requestedDays));
        });
    };
    req.send();
}

// Parses the "daily" block of an Open-Meteo /v1/forecast response into the
// widget's internal per-day shape. Shared by the primary (model-specific)
// fetch and the best-match backup fetch used to fill gaps beyond a national
// high-res model's forecast horizon.
function _parseDailyArray(d, requestedDays) {
    var nd = [];
    if (d.daily && d.daily.time) {
        var maxD = Math.min(requestedDays, d.daily.time.length);
        for (var i = 0; i < maxD; ++i)
            nd.push({
                day: Qt.formatDate(new Date(d.daily.time[i]), "ddd"),
                dateStr: d.daily.time[i],
                maxC: d.daily.temperature_2m_max[i],
                minC: d.daily.temperature_2m_min[i],
                code: d.daily.weather_code[i],
                precipMm: d.daily.precipitation_sum ? d.daily.precipitation_sum[i] : NaN,
                snowCm: d.daily.snowfall_sum ? d.daily.snowfall_sum[i] : NaN,
                precipProb: d.daily.precipitation_probability_max ? d.daily.precipitation_probability_max[i] : NaN,
                windKmh: d.daily.wind_speed_10m_max ? d.daily.wind_speed_10m_max[i] : NaN,
                windDir: d.daily.wind_direction_10m_dominant ? d.daily.wind_direction_10m_dominant[i] : NaN,
                uvMax: d.daily.uv_index_max ? d.daily.uv_index_max[i] : NaN,
                pressureHpa: d.daily.pressure_msl_mean ? d.daily.pressure_msl_mean[i] : NaN,
                visibilityKm: d.daily.visibility_mean ? d.daily.visibility_mean[i] / 1000.0 : NaN
            });
    }
    return nd;
}

// A day is "incomplete" when the national high-res model has no forecast
// for it — Open-Meteo represents that as null rather than omitting the day
// or erroring, so length alone isn't a reliable signal.
function _isDailyIncomplete(entry) {
    if (!entry) return true;
    if (entry.maxC === null || entry.maxC === undefined || isNaN(entry.maxC)) return true;
    if (entry.minC === null || entry.minC === undefined || isNaN(entry.minC)) return true;
    if (entry.code === null || entry.code === undefined) return true;
    // Some national high-res models (ICON-D2, AROME, UKMO, etc.) cover temp/code
    // but don't report uv_index_max at all, leaving it null. Treat that as
    // incomplete too so the global best-match backfill fills the real value
    // instead of the null silently surviving the merge.
    if (entry.uvMax === null || entry.uvMax === undefined || isNaN(entry.uvMax)) return true;
    return false;
}

// Fetches the same date range from Open-Meteo's global best-match blend to
// use as backfill. Deliberately omits &models= so Open-Meteo picks its own
// default, which has full worldwide 16-day coverage. Only "daily" is
// requested — "current" (today) always comes from the primary fetch.
function _fetchDailyBackup(service, gen, requestedDays, callback) {
    var tz = service.timezone;
    var url = "https://api.open-meteo.com/v1/forecast"
        + "?latitude=" + service.latitude
        + "&longitude=" + service.longitude
        + "&timezone=" + encodeURIComponent(tz.length > 0 ? tz : "auto")
        + "&forecast_days=" + requestedDays
        + "&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,"
        + "precipitation_sum,snowfall_sum,precipitation_probability_max,wind_speed_10m_max,wind_direction_10m_dominant,"
        + "uv_index_max,pressure_msl_mean,visibility_mean";

    var req = new XMLHttpRequest();
    req.open("GET", url);
    req.onreadystatechange = function () {
        if (req.readyState !== XMLHttpRequest.DONE)
            return;
        if (service._refreshGen !== gen || req.status !== 200) {
            callback([]);
            return;
        }
        try {
            var d = JSON.parse(req.responseText);
            callback(_parseDailyArray(d, requestedDays));
        } catch (e) {
            callback([]);
        }
    };
    req.send();
}

// Merges the model-specific daily array with the best-match backup, keeping
// the high-res values wherever they exist and filling only the days the
// primary model doesn't cover. Matched by dateStr so timezone/date-boundary
// differences between the two requests can't misalign the days; falls back
// to positional matching for a day the primary fetch didn't return at all.
function _mergeDailyArrays(primary, backup, requestedDays) {
    var backupByDate = {};
    for (var i = 0; i < backup.length; ++i)
        backupByDate[backup[i].dateStr] = backup[i];

    var merged = [];
    var len = Math.max(primary.length, requestedDays);
    for (var j = 0; j < len; ++j) {
        var entry = primary[j];
        if (!_isDailyIncomplete(entry)) {
            merged.push(entry);
            continue;
        }
        var backupEntry = (entry && backupByDate[entry.dateStr]) ? backupByDate[entry.dateStr] : backup[j];
        if (backupEntry) {
            merged.push({
                day: backupEntry.day,
                dateStr: backupEntry.dateStr,
                maxC: backupEntry.maxC,
                minC: backupEntry.minC,
                code: backupEntry.code,
                precipMm: backupEntry.precipMm,
                snowCm: backupEntry.snowCm,
                precipProb: backupEntry.precipProb,
                windKmh: backupEntry.windKmh,
                windDir: backupEntry.windDir,
                uvMax: backupEntry.uvMax,
                pressureHpa: backupEntry.pressureHpa,
                visibilityKm: backupEntry.visibilityKm,
                isBackupModel: true // best-match fallback, not the high-res model
            });
        } else if (entry) {
            merged.push(entry); // nothing better available — keep as-is (still NaN/null)
        }
    }
    return merged;
}

// Air-quality fetching for the default (Open-Meteo) provider path lives in
// WeatherService.qml's _fetchAirQualityOpenMeteo() — the shared fetch every
// provider falls back to — not here. A duplicate, unused _fetchAirQuality()
// used to live in this file (never dispatched from Providers.qml, which has
// no "openMeteo" case in its fetchAirQuality() switch) and had gone stale:
// its result object assigned `index`/`label` twice in the same literal, so
// the european_aqi values it computed were always silently discarded in
// favor of us_aqi. Removed rather than fixed, since WeatherService.qml's
// version is the actual live path and now handles both figures (plus
// Canadian AQHI) correctly — see airQuality.js for the current index math.


function fetchHourly(service, dateStr) {
    var gen = service._refreshGen;
    var r = service.weatherRoot;
    var tz = service.timezone;
    var url = "https://api.open-meteo.com/v1/forecast?latitude="
        + service.latitude
        + "&longitude=" + service.longitude
        + "&timezone=" + encodeURIComponent(tz.length > 0 ? tz : "auto")
        + "&hourly=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,relative_humidity_2m,precipitation_probability,precipitation,pressure_msl,visibility,uv_index"
        + "&start_date=" + dateStr + "&end_date=" + dateStr
        + W.openMeteoModelParam(service.openMeteoModel, service.countryCode);
    var req = new XMLHttpRequest();
    req.open("GET", url);
    req.onreadystatechange = function () {
        if (req.readyState !== XMLHttpRequest.DONE)
            return;
        if (service._refreshGen !== gen) return;
        if (req.status !== 200) {
            r.hourlyData = [];
            return;
        }
        var d = JSON.parse(req.responseText);
        var arr = _parseHourlyArray(d);

        // Same national-model horizon issue as the daily forecast: if
        // dateStr falls outside the high-res model's coverage, Open-Meteo
        // returns either an empty hourly.time array or null-filled hours
        // for it. Backfill from the global best-match blend when needed.
        var needsBackfill = arr.length === 0 || arr.some(_isHourlyIncomplete);
        if (!needsBackfill) {
            r.hourlyData = arr;
            return;
        }

        _fetchHourlyBackup(service, gen, dateStr, function (backupArr) {
            if (service._refreshGen !== gen) return;
            r.hourlyData = _mergeHourlyArrays(arr, backupArr);
        });
    };
    req.send();
}

// Parses the "hourly" block of an Open-Meteo /v1/forecast response into the
// widget's internal per-hour shape. Shared by the primary (model-specific)
// fetch and the best-match backup fetch.
function _parseHourlyArray(d) {
    var arr = [];
    if (d.hourly && d.hourly.time)
        for (var i = 0; i < d.hourly.time.length; ++i)
            arr.push({
                timeIso: d.hourly.time[i],
                hour: Qt.formatTime(new Date(d.hourly.time[i]), "HH:mm"),
                tempC: d.hourly.temperature_2m[i],
                code: d.hourly.weather_code[i],
                windKmh: d.hourly.wind_speed_10m[i],
                windDeg: d.hourly.wind_direction_10m ? d.hourly.wind_direction_10m[i] : NaN,
                humidity: d.hourly.relative_humidity_2m[i],
                precipProb: d.hourly.precipitation_probability ? d.hourly.precipitation_probability[i] : NaN,
                precipMm: d.hourly.precipitation ? d.hourly.precipitation[i] : NaN,
                pressureHpa: d.hourly.pressure_msl ? d.hourly.pressure_msl[i] : NaN,
                visibilityKm: d.hourly.visibility ? d.hourly.visibility[i] / 1000.0 : NaN,
                uvIndex: d.hourly.uv_index ? d.hourly.uv_index[i] : NaN
            });
    return arr;
}

// An hour is "incomplete" when the national high-res model has no data for
// it — Open-Meteo represents that as null rather than omitting the hour.
function _isHourlyIncomplete(entry) {
    if (!entry) return true;
    if (entry.tempC === null || entry.tempC === undefined || isNaN(entry.tempC)) return true;
    if (entry.code === null || entry.code === undefined) return true;
    return false;
}

// Fetches the same day from Open-Meteo's global best-match blend to use as
// backfill. Deliberately omits &models= so Open-Meteo picks its own
// default, which has full worldwide coverage.
function _fetchHourlyBackup(service, gen, dateStr, callback) {
    var tz = service.timezone;
    var url = "https://api.open-meteo.com/v1/forecast?latitude="
        + service.latitude
        + "&longitude=" + service.longitude
        + "&timezone=" + encodeURIComponent(tz.length > 0 ? tz : "auto")
        + "&hourly=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,relative_humidity_2m,precipitation_probability,precipitation,pressure_msl,visibility,uv_index"
        + "&start_date=" + dateStr + "&end_date=" + dateStr;
    var req = new XMLHttpRequest();
    req.open("GET", url);
    req.onreadystatechange = function () {
        if (req.readyState !== XMLHttpRequest.DONE)
            return;
        if (service._refreshGen !== gen || req.status !== 200) {
            callback([]);
            return;
        }
        try {
            var d = JSON.parse(req.responseText);
            callback(_parseHourlyArray(d));
        } catch (e) {
            callback([]);
        }
    };
    req.send();
}

// Merges the model-specific hourly array with the best-match backup, keeping
// the high-res values wherever they exist and filling only the hours the
// primary model didn't cover. Matched by timeIso, with positional fallback
// for hours the primary fetch didn't return at all.
function _mergeHourlyArrays(primary, backup) {
    var backupByTime = {};
    for (var i = 0; i < backup.length; ++i)
        backupByTime[backup[i].timeIso] = backup[i];

    var len = Math.max(primary.length, backup.length);
    var merged = [];
    for (var j = 0; j < len; ++j) {
        var entry = primary[j];
        if (!_isHourlyIncomplete(entry)) {
            merged.push(entry);
            continue;
        }
        var backupEntry = (entry && backupByTime[entry.timeIso]) ? backupByTime[entry.timeIso] : backup[j];
        if (backupEntry) {
            merged.push({
                timeIso: backupEntry.timeIso,
                hour: backupEntry.hour,
                tempC: backupEntry.tempC,
                code: backupEntry.code,
                windKmh: backupEntry.windKmh,
                windDeg: backupEntry.windDeg,
                humidity: backupEntry.humidity,
                precipProb: backupEntry.precipProb,
                precipMm: backupEntry.precipMm,
                pressureHpa: backupEntry.pressureHpa,
                visibilityKm: backupEntry.visibilityKm,
                uvIndex: backupEntry.uvIndex,
                isBackupModel: true // best-match fallback, not the high-res model
            });
        } else if (entry) {
            merged.push(entry); // nothing better available — keep as-is (still NaN/null)
        }
    }
    return merged;
}
