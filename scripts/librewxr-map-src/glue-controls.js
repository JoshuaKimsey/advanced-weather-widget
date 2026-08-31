// ==========================================================================
// Glue script 3: create the viewer and expose the QML-facing window.* API.
// ==========================================================================
var _widgetAdapter = new WidgetLeafletAdapter();

var config = {
  apiFixed: API_BASE,
  strings: STRINGS,
  view: { lat: LAT, lon: LON, zoom: INIT_ZOOM, maxZoom: 12 },
  layerMode: ACTIVE_LAYER,                      // 'radar' | 'satellite' | 'both'
  colorScheme: CURRENT_COLOR,                   // clamped 0..12
  cells: CELLS_INIT,                            // 'light' | 'dark' | '' (URL)
  arrows: (ARROWS_ON ? (ACTIVE_THEME === 'dark' ? 'light' : 'dark') : ''),
  alerts: ALERTS_INIT,                          // fetch + overlay alerts at boot
  smooth: SMOOTH_INIT,
  snow: SNOW_INIT,
  format: FORMAT_INIT,
  tileSize: TILESIZE_INIT,
  theme: ACTIVE_THEME,                          // 'dark' | 'light'
  locateMode: 'view',
  nowMarker: true,
  nowMarkerLabel: true,
  locale: SYS_LOCALE,
  hour12: HOUR12,
  onThemeChange: function (theme) {
    // The QML chrome only knows arrows on/off; the page derives the arrow
    // color from the map theme, so re-derive it whenever the theme moves.
    if (arrowsOn) viewer.setArrows(theme === 'dark' ? 'light' : 'dark');
  }
};

// Whether motion arrows are currently on. Initialized from the same derivation
// used for config.arrows above (ARROWS_ON), so onThemeChange stays correct.
var arrowsOn = ARROWS_ON;

// Capture the viewer API: every window.* setter drives the engine directly.
var viewer = window.LibreWXR.createViewer(config, _widgetAdapter);

// === QML-FACING WINDOW API ===
window.setLayerMode = function (mode) { viewer.setLayerMode(mode); };

window.setColorScheme = function (n) { viewer.setColorScheme(n); };

window.setArrows = function (on) {
    arrowsOn = !!on;
    viewer.setArrows(arrowsOn ? (document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark') : '');
};

window.setCells = function (mode) { viewer.setCells(mode); };

window.setAlerts = function (on) { viewer.setAlertsEnabled(!!on); };

window.setTheme = function (theme) { viewer.setTheme(theme); };

window.setBackground = function (id) {
  if (id !== 'auto') {
    var found = false;
    for (var i = 0; i < BG_LIST.length; i++) {
      if (BG_LIST[i].id === id) { found = true; break; }
    }
    if (!found) return; // invalid id
  }
  BG_CURRENT = id;
  var theme = document.body.getAttribute('data-theme') || 'dark';
  if (_widgetAdapter && typeof _widgetAdapter.setBasemap === 'function') {
    _widgetAdapter.setBasemap(theme);
  }
};

window.fixViewport = function () {
  var m = _widgetAdapter ? _widgetAdapter.getMap() : null;
  if (!m) return;
  // Reproduce the old cure for the plasmoid's WebEngineView: recalculate the
  // container size and do an invisible 1px pan-and-back, which forces Leaflet
  // to reset its view and Chromium to repaint the damaged surface.
  m.invalidateSize(false);
  m.panBy([1, 0], { animate: false });
  m.panBy([-1, 0], { animate: false });
  // Timeout rearm: the engine's moveend restarts a quiet background preload,
  // which the cancelling 1px nudge (never a real view change) safely ignores.
  setTimeout(function () { m.invalidateSize(false); }, 400);
};

// === VIEWPORT FIX WIRING (map lifecycle in the ~380px embedded webview) ===
if (typeof ResizeObserver !== 'undefined') {
  var _roTimer = null;
  new ResizeObserver(function () {
    if (_roTimer) clearTimeout(_roTimer);
    _roTimer = setTimeout(window.fixViewport, 120);
  }).observe(document.getElementById('lv-map'));
}
window.addEventListener('load', function () {
  setTimeout(window.fixViewport, 250);
  setTimeout(window.fixViewport, 1200);
});

// === BUILD PROVENANCE ===
// Assembled by the advanced-weather-widget's scripts/build_librewxr_map.py.
