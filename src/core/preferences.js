// NiZyLa Preferences: Themes, Fonts, and Language-specific Syntax Highlighting

export const THEME_PRESETS = {
  structs: {
    id: 'structs',
    name: 'Structs Teal (Indie Sci-Fi)',
    scheme: 'dark',
    bg: '#0f1d24',
    bgSoft: '#13252e',
    panel: '#162832',
    editorBg: '#11212a',
    text: '#5ce1e6',
    muted: '#4d7b88',
    border: '#23424d',
    borderStrong: '#386777',
    button: '#19313d',
    buttonHover: '#214353',
    accent: '#47d8d8',
    accent2: '#9d72ff',
    activeLine: '#182f3b',
    selection: '#47d8d8aa',
    gcnSelected: '#9dffff',
    folderIcon: '#47d8d8',
    fileIcon: '#6aa4b0',
    graphClass: '#38bdf8',
    graphFunction: '#34d399',
    graphVariable: '#f87171',
    graphImports: '#c084fc',
    graphLinks: '#67e8f9',
    graphDefines: '#f472b6',
    font: "'Pixelify Sans', monospace",
    syntax: {
      keyword: '#e879f9',
      function: '#38bdf8',
      class: '#fbbf24',
      variable: '#5ce1e6',
      string: '#34d399',
      number: '#f97316',
      comment: '#4d7b88'
    }
  },
  obsidian: {
    id: 'obsidian',
    name: 'Obsidian Dark',
    scheme: 'dark',
    bg: '#1e1e1e',
    bgSoft: '#202020',
    panel: '#202020',
    editorBg: '#1e1e1e',
    text: '#dcddde',
    muted: '#a0a0a0',
    border: '#303030',
    borderStrong: '#454545',
    button: '#292929',
    buttonHover: '#363636',
    accent: '#7f6df2',
    accent2: '#a7c7ff',
    activeLine: '#2a2a2a',
    selection: '#7f6df2aa',
    gcnSelected: '#c7bfff',
    folderIcon: '#caa6ff',
    fileIcon: '#8f9bad',
    graphClass: '#38bdf8',
    graphFunction: '#4ade80',
    graphVariable: '#f87171',
    graphImports: '#a78bfa',
    graphLinks: '#7dd3fc',
    graphDefines: '#f0abfc',
    font: "'JetBrains Mono', monospace",
    syntax: {
      keyword: '#c678dd',
      function: '#61afef',
      class: '#e5c07b',
      variable: '#e06c75',
      string: '#98c379',
      number: '#d19a66',
      comment: '#5c6370'
    }
  },
  cream: {
    id: 'cream',
    name: 'Cream Light',
    scheme: 'light',
    bg: '#fcf8ee',
    bgSoft: '#f5edd9',
    panel: '#f8f1de',
    editorBg: '#fffdf7',
    text: '#171410',
    muted: '#7b7162',
    border: '#e5d8bf',
    borderStrong: '#c9b99e',
    button: '#f6edda',
    buttonHover: '#eadcc2',
    accent: '#7c5424',
    accent2: '#0f766e',
    activeLine: '#f2e7d1',
    selection: '#7c5424aa',
    gcnSelected: '#5a3d1d',
    folderIcon: '#b7791f',
    fileIcon: '#8a7d69',
    graphClass: '#0284c7',
    graphFunction: '#16a34a',
    graphVariable: '#dc2626',
    graphImports: '#7c3aed',
    graphLinks: '#0e7490',
    graphDefines: '#be185d',
    font: "'JetBrains Mono', monospace",
    syntax: {
      keyword: '#a626a4',
      function: '#4078f2',
      class: '#c18401',
      variable: '#e45649',
      string: '#50a14f',
      number: '#986801',
      comment: '#a0a1a7'
    }
  },
  cyberpunk: {
    id: 'cyberpunk',
    name: 'Cyberpunk Neon',
    scheme: 'dark',
    bg: '#0b0c15',
    bgSoft: '#111220',
    panel: '#141628',
    editorBg: '#0e0f1d',
    text: '#00f0ff',
    muted: '#6e749c',
    border: '#282a4a',
    borderStrong: '#424675',
    button: '#1c1e36',
    buttonHover: '#292d4f',
    accent: '#ff0055',
    accent2: '#ffe600',
    activeLine: '#191b32',
    selection: '#ff0055aa',
    gcnSelected: '#ffcc00',
    folderIcon: '#ffe600',
    fileIcon: '#7f86b6',
    graphClass: '#00f0ff',
    graphFunction: '#00ff88',
    graphVariable: '#ff0055',
    graphImports: '#ffe600',
    graphLinks: '#38bdf8',
    graphDefines: '#ff7700',
    font: "'Space Mono', monospace",
    syntax: {
      keyword: '#ff0055',
      function: '#00f0ff',
      class: '#ffe600',
      variable: '#e2e8f0',
      string: '#00ff88',
      number: '#ff9900',
      comment: '#5f658b'
    }
  },
  sage: {
    id: 'sage',
    name: 'Signal Sage',
    scheme: 'light',
    bg: '#C8D4A3',
    bgSoft: '#D0DBAE',
    panel: '#D5DFB4',
    editorBg: '#DCE5BE',
    text: '#1B2620',
    muted: '#56664A',
    border: '#A3B27F',
    borderStrong: '#1B2620',
    button: '#D0DBAE',
    buttonHover: '#BCCA92',
    accent: '#5F7A32',
    accent2: '#1F2D26',
    activeLine: '#D2DCB2',
    selection: '#5F7A3299',
    gcnSelected: '#1B2620',
    folderIcon: '#5F7A32',
    fileIcon: '#56664A',
    graphClass: '#2F5D7C',
    graphFunction: '#3F6B2A',
    graphVariable: '#A8261E',
    graphImports: '#5B4A8A',
    graphLinks: '#1B2620',
    graphDefines: '#8A5A1B',
    font: "'Share Tech Mono', monospace",
    uiFont: "'Saira', 'Segoe UI', system-ui, sans-serif",
    syntax: {
      keyword: '#1F4D3A',
      function: '#2F5D7C',
      class: '#7A5A12',
      variable: '#1B2620',
      string: '#4F6A14',
      number: '#9A4A16',
      comment: '#667556'
    }
  },
  acid: {
    id: 'acid',
    name: 'Hazard Acid',
    scheme: 'light',
    bg: '#E4E41A',
    bgSoft: '#EAEA3C',
    panel: '#EFEF6A',
    editorBg: '#F7F7C4',
    text: '#0A0A0A',
    muted: '#55550F',
    border: '#B5B512',
    borderStrong: '#0A0A0A',
    button: '#E4E41A',
    buttonHover: '#D6D614',
    accent: '#0A0A0A',
    accent2: '#0D1B22',
    activeLine: '#F0F09A',
    selection: '#0A0A0A99',
    gcnSelected: '#0A0A0A',
    folderIcon: '#0A0A0A',
    fileIcon: '#55550F',
    graphClass: '#0D3B66',
    graphFunction: '#1B5E20',
    graphVariable: '#B00020',
    graphImports: '#4A148C',
    graphLinks: '#0A0A0A',
    graphDefines: '#7A4F01',
    font: "'Kode Mono', monospace",
    uiFont: "'Chakra Petch', 'Segoe UI', system-ui, sans-serif",
    syntax: {
      keyword: '#7A0A5A',
      function: '#0D3B66',
      class: '#6B4E00',
      variable: '#0A0A0A',
      string: '#1B5E20',
      number: '#9A3412',
      comment: '#62622A'
    }
  },
  swiss: {
    id: 'swiss',
    name: 'Swiss Mono',
    scheme: 'light',
    bg: '#CFCFCF',
    bgSoft: '#D9D9D9',
    panel: '#E6E6E6',
    editorBg: '#F2F2F2',
    text: '#111111',
    muted: '#5E5E5E',
    border: '#A6A6A6',
    borderStrong: '#111111',
    button: '#E6E6E6',
    buttonHover: '#D4D4D4',
    accent: '#111111',
    accent2: '#7A7A7A',
    activeLine: '#E8E8E8',
    selection: '#11111199',
    gcnSelected: '#111111',
    folderIcon: '#111111',
    fileIcon: '#5E5E5E',
    graphClass: '#111111',
    graphFunction: '#3A3A3A',
    graphVariable: '#6A6A6A',
    graphImports: '#555555',
    graphLinks: '#111111',
    graphDefines: '#2A2A2A',
    font: "'IBM Plex Mono', monospace",
    uiFont: "'Archivo Narrow', 'Arial Narrow', system-ui, sans-serif",
    syntax: {
      keyword: '#000000',
      function: '#2B2B2B',
      class: '#000000',
      variable: '#3A3A3A',
      string: '#555555',
      number: '#444444',
      comment: '#7A7A7A'
    }
  }
};

export const FONT_OPTIONS = [
  { id: 'pixelify', name: 'Pixelify Sans (Indie Pixel)', value: "'Pixelify Sans', monospace" },
  { id: 'silkscreen', name: 'Silkscreen (Retro Bitmap)', value: "'Silkscreen', monospace" },
  { id: 'vt323', name: 'VT323 (Arcade CRT)', value: "'VT323', monospace" },
  { id: 'jetbrains', name: 'JetBrains Mono', value: "'JetBrains Mono', monospace" },
  { id: 'fira', name: 'Fira Code', value: "'Fira Code', monospace" },
  { id: 'spacemono', name: 'Space Mono', value: "'Space Mono', monospace" },
  { id: 'consolas', name: 'Consolas / Courier', value: "Consolas, 'Courier New', monospace" },
  { id: 'sharetech', name: 'Share Tech Mono (Signal)', value: "'Share Tech Mono', monospace" },
  { id: 'kodemono', name: 'Kode Mono (Hazard)', value: "'Kode Mono', monospace" },
  { id: 'plexmono', name: 'IBM Plex Mono (Swiss)', value: "'IBM Plex Mono', monospace" },
  { id: 'system', name: 'System Monospace', value: 'ui-monospace, SFMono-Regular, Menlo, monospace' }
];

export const SUPPORTED_LANGUAGES = [
  { id: 'default', name: 'Global / Default', ext: '*' },
  { id: 'python', name: 'Python (.py)', ext: '.py' },
  { id: 'gdscript', name: 'GDScript (.gd)', ext: '.gd' },
  { id: 'cpp', name: 'C++ (.cpp, .h)', ext: '.cpp' },
  { id: 'csharp', name: 'C# (.cs)', ext: '.cs' },
  { id: 'javascript', name: 'JavaScript / TypeScript', ext: '.js' },
  { id: 'markdown', name: 'Markdown (.md)', ext: '.md' }
];

export const LANGUAGE_SAMPLE_CODE = {
  python: `# Python Physics Engine
GLOBAL_SPEED = 100

class PhysicsEngine:
    def __init__(self, damping: float = 0.98):
        self.damping = damping

    def compute_velocity(self, delta: float) -> float:
        velocity = GLOBAL_SPEED * delta * self.damping
        return velocity
`,
  gdscript: `# GDScript Player Controller
class_name Player
extends CharacterBody2D

const MAX_HEALTH = 100
var current_health: int = MAX_HEALTH

func take_damage(amount: int) -> void:
    current_health = max(0, current_health - amount)
    print("Player health:", current_health)
`,
  cpp: `// C++ Vector Library
#include <cmath>

class Vector3 {
public:
    float x, y, z;
    Vector3(float x, float y, float z) : x(x), y(y), z(z) {}
};

void Normalize(Vector3& v) {
    float len = std::sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    if (len > 0.0f) { v.x /= len; v.y /= len; }
}
`,
  csharp: `// C# Game Controller
namespace GameCore
{
    public class PlayerController
    {
        public static int MaxPlayers = 8;
        public void Setup()
        {
            Console.WriteLine("Ready: " + MaxPlayers);
        }
    }
}
`,
  javascript: `// JavaScript Graph Engine
export const VERSION = "1.0.0";

export class ProjectGraph {
  constructor(name) {
    this.name = name;
  }

  processNodes(nodes) {
    return nodes.map(n => n.label);
  }
}
`,
  markdown: `# Project Overview
Welcome to **NiZyLa** - an indie code editor with graph relationships.

- [x] Class connections (Blue)
- [x] Function calls (Green)
- [x] Global Variables (Red)
`,
  default: `// Sample Source Code
const GLOBAL_CONFIG = { debug: true };

class Application {
  start() {
    console.log("System initialized");
  }
}
`
};

export function getLanguageFromFile(fileName = '') {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.gd')) return 'gdscript';
  if (/\.(cpp|c|cc|cxx|h|hpp|hxx|inl)$/.test(lower)) return 'cpp';
  if (/\.(cs|csx)$/.test(lower)) return 'csharp';
  if (/\.(js|jsx|ts|tsx|mjs|cjs|svelte|vue)$/.test(lower)) return 'javascript';
  if (lower.endsWith('.md')) return 'markdown';
  return 'default';
}

export function loadPreferences() {
  if (typeof localStorage === 'undefined') {
    return {
      theme: 'structs',
      fontFamily: FONT_OPTIONS[0].value,
      fontSize: 14,
      fontUi: true,
      customColors: { ...THEME_PRESETS.structs },
      syntaxColors: {}
    };
  }

  const theme = localStorage.getItem('nizyla.theme') || 'structs';
  const defaultPreset = THEME_PRESETS[theme] || THEME_PRESETS.structs;
  const fontFamily = localStorage.getItem('nizyla.fontFamily') || defaultPreset.font;
  const fontSize = Number(localStorage.getItem('nizyla.fontSize')) || 14;
  const fontUi = localStorage.getItem('nizyla.fontUi') !== null
    ? localStorage.getItem('nizyla.fontUi') !== 'false'
    : !defaultPreset.uiFont;

  let customColors = { ...defaultPreset };
  try {
    const saved = localStorage.getItem('nizyla.customThemeColors');
    if (saved) customColors = { ...customColors, ...JSON.parse(saved) };
  } catch {}

  let syntaxColors = {};
  try {
    const savedSyntax = localStorage.getItem('nizyla.syntaxColors');
    if (savedSyntax) syntaxColors = JSON.parse(savedSyntax);
  } catch {}

  return {
    theme,
    fontFamily,
    fontSize,
    fontUi,
    customColors,
    syntaxColors
  };
}

export function savePreferences(prefs) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem('nizyla.theme', prefs.theme);
  localStorage.setItem('nizyla.fontFamily', prefs.fontFamily);
  localStorage.setItem('nizyla.fontSize', String(prefs.fontSize));
  localStorage.setItem('nizyla.fontUi', String(prefs.fontUi));
  localStorage.setItem('nizyla.customThemeColors', JSON.stringify(prefs.customColors));
  localStorage.setItem('nizyla.syntaxColors', JSON.stringify(prefs.syntaxColors));
  applyPreferences(prefs);
}

export function getSyntaxColorsForLanguage(lang, theme, prefs) {
  const baseTheme = THEME_PRESETS[theme] || THEME_PRESETS.structs;
  const globalDefaults = baseTheme.syntax || THEME_PRESETS.structs.syntax;
  const userGlobal = prefs?.syntaxColors?.default || {};
  const userLang = prefs?.syntaxColors?.[lang] || {};

  return {
    keyword: userLang.keyword || userGlobal.keyword || globalDefaults.keyword,
    function: userLang.function || userGlobal.function || globalDefaults.function,
    class: userLang.class || userGlobal.class || globalDefaults.class,
    variable: userLang.variable || userGlobal.variable || globalDefaults.variable,
    string: userLang.string || userGlobal.string || globalDefaults.string,
    number: userLang.number || userGlobal.number || globalDefaults.number,
    comment: userLang.comment || userGlobal.comment || globalDefaults.comment
  };
}

export function getSyntaxStyleString(lang, theme, prefs) {
  const colors = getSyntaxColorsForLanguage(lang, theme, prefs);
  return `
    --syntax-keyword: ${colors.keyword};
    --syntax-function: ${colors.function};
    --syntax-class: ${colors.class};
    --syntax-variable: ${colors.variable};
    --syntax-string: ${colors.string};
    --syntax-number: ${colors.number};
    --syntax-comment: ${colors.comment};
  `.trim().replace(/\s+/g, ' ');
}

export const CUSTOM_COLOR_VARS = [
  ['bg', '--bg'], ['bgSoft', '--bg-soft'], ['panel', '--panel'], ['panelSolid', '--panel-solid'], ['editorBg', '--editor-bg'],
  ['text', '--text'], ['muted', '--muted'], ['border', '--border'], ['borderStrong', '--border-strong'],
  ['button', '--button'], ['buttonHover', '--button-hover'], ['accent', '--accent'], ['accent2', '--accent-2'],
  ['activeLine', '--active-line'], ['selection', '--selection'], ['gcnSelected', '--gcn-selected'],
  ['folderIcon', '--folder-icon'], ['fileIcon', '--file-icon'], ['graphClass', '--graph-class'],
  ['graphFunction', '--graph-function'], ['graphVariable', '--graph-variable'], ['graphImports', '--graph-imports'],
  ['graphLinks', '--graph-links'], ['graphDefines', '--graph-defines']
];

function parseHexColor(value) {
  if (typeof value !== 'string') return null;
  const hex = value.trim().replace(/^#/, '');
  if (![6, 8].includes(hex.length) || !/^[\da-fA-F]+$/.test(hex)) return null;
  return {
    r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16),
    a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
  };
}

function sRGBToLinear(value) {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function luminance({ r, g, b }) {
  return 0.2126 * sRGBToLinear(r) + 0.7152 * sRGBToLinear(g) + 0.0722 * sRGBToLinear(b);
}

function selectionContrast(selection, background) {
  const foreground = parseHexColor(selection);
  const base = parseHexColor(background);
  if (!foreground || !base) return 0;
  const blended = {
    r: foreground.r * foreground.a + base.r * (1 - foreground.a),
    g: foreground.g * foreground.a + base.g * (1 - foreground.a),
    b: foreground.b * foreground.a + base.b * (1 - foreground.a)
  };
  const lighter = Math.max(luminance(blended), luminance(base));
  const darker = Math.min(luminance(blended), luminance(base));
  return (lighter + 0.05) / (darker + 0.05);
}

export function applyThemePreset(prefs, id) {
  if (!prefs) prefs = {};
  if (id === 'custom') {
    prefs.theme = 'custom';
    return prefs;
  }
  const preset = THEME_PRESETS[id];
  if (preset) {
    prefs.theme = id;
    prefs.customColors = { ...preset };
    prefs.fontFamily = preset.font;
    prefs.fontUi = !preset.uiFont;
  }
  return prefs;
}

export function applyPreferences(prefs) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  // Apply typography
  root.style.setProperty('--mono-font', prefs.fontFamily);
  root.style.setProperty('--editor-font-size', `${prefs.fontSize}px`);

  if (prefs.fontUi) {
    root.style.setProperty('--ui-font', prefs.fontFamily);
  } else {
    const uiFont = THEME_PRESETS[prefs.theme]?.uiFont || prefs.customColors?.uiFont;
    if (uiFont) {
      root.style.setProperty('--ui-font', uiFont);
    } else {
      root.style.removeProperty('--ui-font');
    }
  }

  // Apply custom theme colors if active. The same table is used for cleanup so
  // switching back to a preset cannot leave stale custom tokens behind.
  if (prefs.theme === 'custom' && prefs.customColors) {
    const c = prefs.customColors;
    const base = THEME_PRESETS.structs;
    const editorBg = c.editorBg || base.editorBg;
    for (const [key, prop] of CUSTOM_COLOR_VARS) {
      let value = key === 'panelSolid' ? (c.panelSolid || c.panel || base.panel) : (c[key] || base[key]);
      if (key === 'selection' && selectionContrast(value, editorBg) < 1.35) {
        value = `color-mix(in srgb, ${c.accent || base.accent} 35%, transparent)`;
      }
      if (value) root.style.setProperty(prop, value);
    }
  } else {
    for (const [, prop] of CUSTOM_COLOR_VARS) root.style.removeProperty(prop);
  }

  // Apply global default syntax colors to root
  const globalSyntax = getSyntaxColorsForLanguage('default', prefs.theme, prefs);
  root.style.setProperty('--syntax-keyword', globalSyntax.keyword);
  root.style.setProperty('--syntax-function', globalSyntax.function);
  root.style.setProperty('--syntax-class', globalSyntax.class);
  root.style.setProperty('--syntax-variable', globalSyntax.variable);
  root.style.setProperty('--syntax-string', globalSyntax.string);
  root.style.setProperty('--syntax-number', globalSyntax.number);
  root.style.setProperty('--syntax-comment', globalSyntax.comment);
}
