/* global document, localStorage */
/* Before first paint. External, local and precached: compatible with Reader's strict CSP. */
(function () {
  var root = document.documentElement;
  var theme = 'manabi-theme';
  var appearance = 'system';
  try {
    theme = localStorage.getItem('theme') || theme;
    var saved = localStorage.getItem('appearance');
    var custom = JSON.parse(localStorage.getItem('customThemes') || '{}') || {};
    var color = custom[theme] && custom[theme].backgroundColor;
    var c =
      typeof color === 'string' &&
      /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(color);
    var dark =
      ['gray-theme', 'dark-theme', 'black-theme'].includes(theme) ||
      (c && 0.2126 * +c[1] + 0.7152 * +c[2] + 0.0722 * +c[3] < 128);
    appearance = ['system', 'light', 'dark'].includes(saved)
      ? saved
      : ['manabi-theme', 'system-theme'].includes(theme)
        ? 'system'
        : dark
          ? 'dark'
          : 'light';
    // A custom theme's authored background prevents a bright loading flash too.
    if (
      c &&
      c.slice(1, 4).every(function (n) {
        return +n >= 0 && +n <= 255;
      })
    ) {
      var alpha = c[4] === undefined ? 1 : +c[4];
      if (alpha >= 0 && alpha <= 1)
        ['light', 'dark'].forEach(function (mode) {
          var canvas = mode === 'dark' ? 0 : 255;
          var originalMode = dark ? 'dark' : 'light';
          var rgb = c.slice(1, 4).map(function (n) {
            return Math.round(
              mode === originalMode ? canvas * (1 - alpha) + +n * alpha : +n * 0.1 + canvas * 0.9
            );
          });
          root.style.setProperty('--' + mode + '-canvas', 'rgb(' + rgb.join(',') + ')');
        });
    }
  } catch {
    /* Default remains usable with storage disabled or damaged. */
  }
  root.dataset.theme = theme;
  root.dataset.appearance = appearance;
})();
