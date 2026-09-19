// NiZyLa Preferences: Themes, Fonts, and Language-specific Syntax Highlighting

export const THEME_PRESETS = {
  structs: {
    id: 'structs',
    name: 'Structs Teal (Indie Sci-Fi)',
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
    selection: '#47d8d833',
    font: "'Pixelify Sans', 'Silkscreen', 'JetBrains Mono', monospace",
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
    selection: '#5d55a766',
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
    selection: '#d8b56f66',
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
    selection: '#ff005533',
    font: "'Space Mono', 'Pixelify Sans', monospace",
    syntax: {
      keyword: '#ff0055',
      function: '#00f0ff',
      class: '#ffe600',
      variable: '#e2e8f0',
      string: '#00ff88',
      number: '#ff9900',
      comment: '#5f658b'
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
  const fontFamily = localStorage.getItem('nizyla.fontFamily') || (theme === 'structs' ? FONT_OPTIONS[0].value : FONT_OPTIONS[3].value);
  const fontSize = Number(localStorage.getItem('nizyla.fontSize')) || 14;
  const fontUi = localStorage.getItem('nizyla.fontUi') !== 'false';

  let customColors = { ...THEME_PRESETS.structs };
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

export function applyPreferences(prefs) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  // Apply typography
  root.style.setProperty('--mono-font', prefs.fontFamily);
  root.style.setProperty('--editor-font-size', `${prefs.fontSize}px`);

  if (prefs.fontUi) {
    root.style.setProperty('--ui-font', prefs.fontFamily);
  } else {
    root.style.removeProperty('--ui-font');
  }

  // Apply custom theme colors if active
  if (prefs.theme === 'custom' && prefs.customColors) {
    const c = prefs.customColors;
    if (c.bg) root.style.setProperty('--bg', c.bg);
    if (c.bgSoft) root.style.setProperty('--bg-soft', c.bgSoft);
    if (c.panel) root.style.setProperty('--panel', c.panel);
    if (c.panel) root.style.setProperty('--panel-solid', c.panel);
    if (c.editorBg) root.style.setProperty('--editor-bg', c.editorBg);
    if (c.text) root.style.setProperty('--text', c.text);
    if (c.muted) root.style.setProperty('--muted', c.muted);
    if (c.border) root.style.setProperty('--border', c.border);
    if (c.borderStrong) root.style.setProperty('--border-strong', c.borderStrong);
    if (c.button) root.style.setProperty('--button', c.button);
    if (c.buttonHover) root.style.setProperty('--button-hover', c.buttonHover);
    if (c.accent) root.style.setProperty('--accent', c.accent);
    if (c.accent2) root.style.setProperty('--accent-2', c.accent2);
    if (c.activeLine) root.style.setProperty('--active-line', c.activeLine);
  } else {
    // Clean custom overrides so preset CSS classes work cleanly
    for (const prop of [
      '--bg', '--bg-soft', '--panel', '--panel-solid', '--editor-bg',
      '--text', '--muted', '--border', '--border-strong', '--button',
      '--button-hover', '--accent', '--accent-2', '--active-line'
    ]) {
      root.style.removeProperty(prop);
    }
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
