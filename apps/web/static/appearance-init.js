/* global document, localStorage */
/* Before first paint; local and precached. Keep migration in parity with theme-option.ts tests. */
(function () {
  var root = document.documentElement;
  function read(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  function color(value) {
    if (typeof value !== 'string' || value.length > 100) return null;
    var hex = /^#([\da-f]{6})$/i.exec(value);
    if (hex)
      return [0, 2, 4]
        .map(function (i) {
          return parseInt(hex[1].slice(i, i + 2), 16);
        })
        .concat(1);
    var match = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(
      value
    );
    if (!match) return null;
    var channels = [+match[1], +match[2], +match[3], +(match[4] === undefined ? 1 : match[4])];
    return channels.every(function (n, i) {
      return Number.isFinite(n) && n >= 0 && n <= (i === 3 ? 1 : 255);
    })
      ? channels
      : null;
  }
  var theme = read('theme') || 'manabi-theme';
  var saved = read('appearance');
  var custom = {};
  try {
    var parsed = JSON.parse(read('customThemes') || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) custom = parsed;
  } catch {
    /* A damaged optional palette must not discard an explicit appearance. */
  }
  var preset = [
    'manabi-theme',
    'light-theme',
    'ecru-theme',
    'water-theme',
    'gray-theme',
    'dark-theme',
    'black-theme'
  ].includes(theme);
  var original = Object.hasOwn(custom, theme) ? custom[theme] : null;
  var c = original && color(original.backgroundColor);
  var dark =
    ['gray-theme', 'dark-theme', 'black-theme'].includes(theme) ||
    (c && 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] < 128);
  var appearance = ['system', 'light', 'dark'].includes(saved)
    ? saved
    : ['manabi-theme', 'system-theme'].includes(theme)
      ? 'system'
      : dark
        ? 'dark'
        : 'light';
  if (
    !preset &&
    c &&
    [
      'fontColor',
      'backgroundColor',
      'selectionFontColor',
      'selectionBackgroundColor',
      'hintFuriganaShadowColor',
      'hintFuriganaFontColor',
      'tooltipTextFontColor'
    ].every(function (key) {
      return color(original[key]);
    })
  ) {
    ['light', 'dark'].forEach(function (mode) {
      var canvas = mode === 'dark' ? 0 : 255;
      var rgb = c.slice(0, 3).map(function (n) {
        var reading = mode === (dark ? 'dark' : 'light') ? n : Math.round(n * 0.1 + canvas * 0.9);
        return Math.round(canvas * 0.92 + reading * 0.08);
      });
      root.style.setProperty('--' + mode + '-canvas', 'rgba(' + rgb.join(', ') + ', 1)');
    });
  }
  root.dataset.theme = theme === 'system-theme' ? 'manabi-theme' : theme;
  root.dataset.appearance = appearance;
  // Native controls/canvas can be painted before the application's stylesheet loads.
  var meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.setAttribute('content', appearance === 'system' ? 'light dark' : appearance);
})();
