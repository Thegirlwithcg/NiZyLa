import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THEME_PRESETS,
  FONT_OPTIONS,
  SUPPORTED_LANGUAGES,
  getLanguageFromFile,
  getSyntaxColorsForLanguage,
  getSyntaxStyleString
} from '../src/core/preferences.js';

test('includes the Structs Teal indie sci-fi theme preset with authentic palette', () => {
  assert.ok(THEME_PRESETS.structs, 'Structs theme preset should exist');
  assert.equal(THEME_PRESETS.structs.bg, '#0f1d24');
  assert.equal(THEME_PRESETS.structs.text, '#5ce1e6');
  assert.equal(THEME_PRESETS.structs.accent, '#47d8d8');
  assert.match(THEME_PRESETS.structs.font, /Pixelify Sans/);
});

test('detects language correctly from file names', () => {
  assert.equal(getLanguageFromFile('main.py'), 'python');
  assert.equal(getLanguageFromFile('player.gd'), 'gdscript');
  assert.equal(getLanguageFromFile('engine.cpp'), 'cpp');
  assert.equal(getLanguageFromFile('vector.h'), 'cpp');
  assert.equal(getLanguageFromFile('Game.cs'), 'csharp');
  assert.equal(getLanguageFromFile('app.ts'), 'javascript');
  assert.equal(getLanguageFromFile('notes.md'), 'markdown');
  assert.equal(getLanguageFromFile('plain.txt'), 'default');
});

test('resolves language-specific syntax colors with custom overrides', () => {
  const prefs = {
    theme: 'structs',
    syntaxColors: {
      default: { keyword: '#111111' },
      python: { keyword: '#ff0000', function: '#00ff00' }
    }
  };

  const pyColors = getSyntaxColorsForLanguage('python', 'structs', prefs);
  assert.equal(pyColors.keyword, '#ff0000', 'Should use Python-specific keyword color');
  assert.equal(pyColors.function, '#00ff00', 'Should use Python-specific function color');

  const gdColors = getSyntaxColorsForLanguage('gdscript', 'structs', prefs);
  assert.equal(gdColors.keyword, '#111111', 'Should fallback to default keyword color for GDScript');
  assert.equal(gdColors.function, THEME_PRESETS.structs.syntax.function, 'Should fallback to structs theme function color');
});

test('generates valid CSS custom property string for syntax styling', () => {
  const css = getSyntaxStyleString('python', 'structs', null);
  assert.match(css, /--syntax-keyword:\s*#[0-9a-fA-F]+/);
  assert.match(css, /--syntax-function:\s*#[0-9a-fA-F]+/);
  assert.match(css, /--syntax-class:\s*#[0-9a-fA-F]+/);
  assert.match(css, /--syntax-variable:\s*#[0-9a-fA-F]+/);
});

test('provides pixel and monospace font options', () => {
  const fontIds = FONT_OPTIONS.map((f) => f.id);
  assert.ok(fontIds.includes('pixelify'), 'Should provide Pixelify Sans');
  assert.ok(fontIds.includes('silkscreen'), 'Should provide Silkscreen');
  assert.ok(fontIds.includes('jetbrains'), 'Should provide JetBrains Mono');
});
