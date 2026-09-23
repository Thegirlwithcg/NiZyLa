import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { THEME_PRESETS } from '../src/core/preferences.js';

function sRGBtoLin(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function luminance(hex) {
  const clean = hex.replace('#', '').trim();
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return 0.2126 * sRGBtoLin(r) + 0.7152 * sRGBtoLin(g) + 0.0722 * sRGBtoLin(b);
}

function contrastRatio(hex1, hex2) {
  const l1 = luminance(hex1);
  const l2 = luminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function extractThemeTokens(cssContent, themeId) {
  const themeRegex = new RegExp(`\\.theme-${themeId}\\s*\\{([^}]+)\\}`, 's');
  const match = cssContent.match(themeRegex);
  assert.ok(match, `CSS class .theme-${themeId} should exist in styles.css`);
  const block = match[1];
  const tokens = {};
  const propRegex = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let pMatch;
  while ((pMatch = propRegex.exec(block)) !== null) {
    tokens[pMatch[1].trim()] = pMatch[2].trim();
  }
  return tokens;
}

const targetThemes = ['sage', 'acid', 'swiss'];
const stylesPath = path.resolve('src/styles.css');
const stylesCss = fs.readFileSync(stylesPath, 'utf8');

for (const themeId of targetThemes) {
  test(`theme ${themeId}: WCAG contrast and token consistency`, () => {
    const preset = THEME_PRESETS[themeId];
    assert.ok(preset, `Preset ${themeId} should exist in THEME_PRESETS`);

    // 1. WCAG contrast of text against bg, panel and editorBg >= 4.5
    const textBgContrast = contrastRatio(preset.text, preset.bg);
    assert.ok(
      textBgContrast >= 4.5,
      `${themeId} text vs bg contrast ${textBgContrast.toFixed(2)} must be >= 4.5`
    );

    const textPanelContrast = contrastRatio(preset.text, preset.panel);
    assert.ok(
      textPanelContrast >= 4.5,
      `${themeId} text vs panel contrast ${textPanelContrast.toFixed(2)} must be >= 4.5`
    );

    const textEditorBgContrast = contrastRatio(preset.text, preset.editorBg);
    assert.ok(
      textEditorBgContrast >= 4.5,
      `${themeId} text vs editorBg contrast ${textEditorBgContrast.toFixed(2)} must be >= 4.5`
    );

    // 2. muted against panel >= 3
    const mutedPanelContrast = contrastRatio(preset.muted, preset.panel);
    assert.ok(
      mutedPanelContrast >= 3.0,
      `${themeId} muted vs panel contrast ${mutedPanelContrast.toFixed(2)} must be >= 3.0`
    );

    // 3. #FFFFFF against accent >= 4.5 (the active row of .gcn-menu uses white text)
    const whiteAccentContrast = contrastRatio('#FFFFFF', preset.accent);
    assert.ok(
      whiteAccentContrast >= 4.5,
      `${themeId} white vs accent contrast ${whiteAccentContrast.toFixed(2)} must be >= 4.5`
    );

    // 4. every syntax colour against editorBg >= 4.5, except comment >= 3
    for (const [key, color] of Object.entries(preset.syntax)) {
      const syntaxContrast = contrastRatio(color, preset.editorBg);
      const minRequired = key === 'comment' ? 3.0 : 4.5;
      assert.ok(
        syntaxContrast >= minRequired,
        `${themeId} syntax ${key} (${color}) vs editorBg contrast ${syntaxContrast.toFixed(2)} must be >= ${minRequired}`
      );
    }

    // 5. the .theme-<id> block in styles.css has the same --bg, --panel, --editor-bg, --text, --muted and --accent values as the preset (case-insensitive)
    const tokens = extractThemeTokens(stylesCss, themeId);
    assert.equal(tokens['--bg']?.toLowerCase(), preset.bg.toLowerCase(), `${themeId} --bg should match`);
    assert.equal(tokens['--panel']?.toLowerCase(), preset.panel.toLowerCase(), `${themeId} --panel should match`);
    assert.equal(tokens['--editor-bg']?.toLowerCase(), preset.editorBg.toLowerCase(), `${themeId} --editor-bg should match`);
    assert.equal(tokens['--text']?.toLowerCase(), preset.text.toLowerCase(), `${themeId} --text should match`);
    assert.equal(tokens['--muted']?.toLowerCase(), preset.muted.toLowerCase(), `${themeId} --muted should match`);
    assert.equal(tokens['--accent']?.toLowerCase(), preset.accent.toLowerCase(), `${themeId} --accent should match`);
  });
}
