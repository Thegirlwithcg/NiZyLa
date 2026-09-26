<script>
  import { createEventDispatcher } from 'svelte';
  import {
    THEME_PRESETS,
    FONT_OPTIONS,
    SUPPORTED_LANGUAGES,
    LANGUAGE_SAMPLE_CODE,
    getSyntaxColorsForLanguage,
    savePreferences,
    applyThemePreset
  } from '../core/preferences.js';

  export let preferences;
  export let currentTheme = 'structs';

  const dispatch = createEventDispatcher();

  let activeTab = 'theme'; // 'theme' | 'fonts' | 'syntax'
  let selectedLanguage = 'python';

  $: currentPreset = THEME_PRESETS[currentTheme] || THEME_PRESETS.structs;
  $: activeSyntax = getSyntaxColorsForLanguage(selectedLanguage, currentTheme, preferences);
  $: sampleCode = LANGUAGE_SAMPLE_CODE[selectedLanguage] || LANGUAGE_SAMPLE_CODE.default;

  function selectTheme(themeId) {
    preferences = applyThemePreset(preferences, themeId);
    saveAndNotify();
  }

  function updateCustomColor(key, value) {
    if (!preferences.customColors) preferences.customColors = { ...currentPreset };
    preferences.customColors[key] = value;
    preferences.theme = 'custom';
    saveAndNotify();
  }

  function selectFont(fontValue) {
    preferences.fontFamily = fontValue;
    saveAndNotify();
  }

  function setFontSize(size) {
    preferences.fontSize = Math.max(11, Math.min(26, size));
    saveAndNotify();
  }

  function toggleFontUi() {
    preferences.fontUi = !preferences.fontUi;
    saveAndNotify();
  }

  function updateSyntaxColor(tokenKey, color) {
    if (!preferences.syntaxColors) preferences.syntaxColors = {};
    if (!preferences.syntaxColors[selectedLanguage]) preferences.syntaxColors[selectedLanguage] = {};
    preferences.syntaxColors[selectedLanguage][tokenKey] = color;
    saveAndNotify();
  }

  function resetLanguageSyntax() {
    if (preferences.syntaxColors?.[selectedLanguage]) {
      delete preferences.syntaxColors[selectedLanguage];
      saveAndNotify();
    }
  }

  function resetAllSyntax() {
    preferences.syntaxColors = {};
    saveAndNotify();
  }

  function resetThemeDefaults() {
    const preset = THEME_PRESETS[currentTheme] || THEME_PRESETS.structs;
    preferences.customColors = { ...preset };
    preferences.syntaxColors = {};
    saveAndNotify();
  }

  function saveAndNotify() {
    savePreferences(preferences);
    dispatch('update', preferences);
  }

  function close() {
    dispatch('close');
  }

  function handleKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }
</script>

<div class="pref-backdrop" role="presentation" on:click|self={close} on:keydown={handleKeydown}>
  <div class="pref-modal" role="dialog" aria-modal="true" aria-label="Preferences">
    <!-- Header -->
    <div class="pref-header">
      <div class="pref-title-group">
        <span class="pref-badge">STRUCTS · CONFIG</span>
        <h2>Preferences & Customization</h2>
        <span class="pref-subtitle">Custom Color Themes, Language Syntax Color Scheme & Indie Typography</span>
      </div>
      <button class="pref-close-btn" on:click={close} aria-label="Close preferences">✕</button>
    </div>

    <!-- Navigation Tabs -->
    <div class="pref-tabs">
      <button class="pref-tab" class:active={activeTab === 'theme'} on:click={() => (activeTab = 'theme')}>
        🎨 Color Theme
      </button>
      <button class="pref-tab" class:active={activeTab === 'fonts'} on:click={() => (activeTab = 'fonts')}>
        🔤 Fonts & Typography
      </button>
      <button class="pref-tab" class:active={activeTab === 'syntax'} on:click={() => (activeTab = 'syntax')}>
        💻 Syntax Color Scheme (Per Language)
      </button>
    </div>

    <!-- Tab Content -->
    <div class="pref-body">
      {#if activeTab === 'theme'}
        <!-- THEME SETTINGS -->
        <section class="pref-section">
          <h3>Theme Presets</h3>
          <div class="theme-presets-grid">
            {#each Object.values(THEME_PRESETS) as preset}
              <button
                class="theme-card"
                class:active={preferences.theme === preset.id}
                on:click={() => selectTheme(preset.id)}
              >
                <div class="theme-card-preview" style="background: {preset.bg}; border: 2px solid {preset.border};">
                  <div class="preview-panel" style="background: {preset.panel};">
                    <span class="preview-dot" style="background: {preset.accent};"></span>
                    <span class="preview-line" style="background: {preset.accent2};"></span>
                  </div>
                  <div class="preview-editor" style="background: {preset.editorBg}; color: {preset.text};">
                    <span style="color: {preset.syntax.keyword}">def</span> <span style="color: {preset.syntax.function}">init</span>():
                  </div>
                </div>
                <div class="theme-card-info">
                  <strong style="font-family: {preset.uiFont ?? preset.font};">{preset.name}</strong>
                  {#if preset.id === 'structs'}<span class="indie-tag">INDIE SCI-FI</span>{/if}
                </div>
              </button>
            {/each}

            <button
              class="theme-card custom-card"
              class:active={preferences.theme === 'custom'}
              on:click={() => selectTheme('custom')}
            >
              <div class="theme-card-preview custom-preview">
                <span class="custom-icon">⚙</span>
                <span>Custom Palette</span>
              </div>
              <div class="theme-card-info">
                <strong>Custom Theme</strong>
                <span class="indie-tag">USER DEFINED</span>
              </div>
            </button>
          </div>

          <h3 style="margin-top: 24px;">Theme Color Customizer</h3>
          <p class="pref-hint">Fine-tune the UI color palette. Changes apply in real-time across the workspace.</p>
          <div class="color-pickers-grid">
            <label class="color-item">
              <span class="color-label">Window Background</span>
              <div class="picker-wrap">
                <input type="color" value={preferences.customColors?.bg || currentPreset.bg} on:input={(e) => updateCustomColor('bg', e.currentTarget.value)} />
                <input type="text" class="color-hex" value={preferences.customColors?.bg || currentPreset.bg} on:change={(e) => updateCustomColor('bg', e.currentTarget.value)} />
              </div>
            </label>

            <label class="color-item">
              <span class="color-label">Panel & Sidebar</span>
              <div class="picker-wrap">
                <input type="color" value={preferences.customColors?.panel || currentPreset.panel} on:input={(e) => updateCustomColor('panel', e.currentTarget.value)} />
                <input type="text" class="color-hex" value={preferences.customColors?.panel || currentPreset.panel} on:change={(e) => updateCustomColor('panel', e.currentTarget.value)} />
              </div>
            </label>

            <label class="color-item">
              <span class="color-label">Editor Background</span>
              <div class="picker-wrap">
                <input type="color" value={preferences.customColors?.editorBg || currentPreset.editorBg} on:input={(e) => updateCustomColor('editorBg', e.currentTarget.value)} />
                <input type="text" class="color-hex" value={preferences.customColors?.editorBg || currentPreset.editorBg} on:change={(e) => updateCustomColor('editorBg', e.currentTarget.value)} />
              </div>
            </label>

            <label class="color-item">
              <span class="color-label">Primary Text</span>
              <div class="picker-wrap">
                <input type="color" value={preferences.customColors?.text || currentPreset.text} on:input={(e) => updateCustomColor('text', e.currentTarget.value)} />
                <input type="text" class="color-hex" value={preferences.customColors?.text || currentPreset.text} on:change={(e) => updateCustomColor('text', e.currentTarget.value)} />
              </div>
            </label>

            <label class="color-item">
              <span class="color-label">Accent / Highlight</span>
              <div class="picker-wrap">
                <input type="color" value={preferences.customColors?.accent || currentPreset.accent} on:input={(e) => updateCustomColor('accent', e.currentTarget.value)} />
                <input type="text" class="color-hex" value={preferences.customColors?.accent || currentPreset.accent} on:change={(e) => updateCustomColor('accent', e.currentTarget.value)} />
              </div>
            </label>

            <label class="color-item">
              <span class="color-label">Selection</span>
              <div class="picker-wrap">
                <input type="color" value={preferences.customColors?.selection || currentPreset.selection} on:input={(e) => updateCustomColor('selection', e.currentTarget.value)} />
                <input type="text" class="color-hex" value={preferences.customColors?.selection || currentPreset.selection} on:change={(e) => updateCustomColor('selection', e.currentTarget.value)} />
              </div>
            </label>
            <label class="color-item">
              <span class="color-label">Secondary Accent</span>
              <div class="picker-wrap">
                <input type="color" value={preferences.customColors?.accent2 || currentPreset.accent2} on:input={(e) => updateCustomColor('accent2', e.currentTarget.value)} />
                <input type="text" class="color-hex" value={preferences.customColors?.accent2 || currentPreset.accent2} on:change={(e) => updateCustomColor('accent2', e.currentTarget.value)} />
              </div>
            </label>

            <label class="color-item">
              <span class="color-label">Border & Dividers</span>
              <div class="picker-wrap">
                <input type="color" value={preferences.customColors?.border || currentPreset.border} on:input={(e) => updateCustomColor('border', e.currentTarget.value)} />
                <input type="text" class="color-hex" value={preferences.customColors?.border || currentPreset.border} on:change={(e) => updateCustomColor('border', e.currentTarget.value)} />
              </div>
            </label>

            <label class="color-item">
              <span class="color-label">Active Line / Highlight</span>
              <div class="picker-wrap">
                <input type="color" value={preferences.customColors?.activeLine || currentPreset.activeLine} on:input={(e) => updateCustomColor('activeLine', e.currentTarget.value)} />
                <input type="text" class="color-hex" value={preferences.customColors?.activeLine || currentPreset.activeLine} on:change={(e) => updateCustomColor('activeLine', e.currentTarget.value)} />
              </div>
            </label>

            <label class="color-item">
              <span class="color-label">Folder Icon</span>
              <div class="picker-wrap">
                <input type="color" value={preferences.customColors?.folderIcon || currentPreset.folderIcon || currentPreset.accent} on:input={(e) => updateCustomColor('folderIcon', e.currentTarget.value)} />
                <input type="text" class="color-hex" value={preferences.customColors?.folderIcon || currentPreset.folderIcon || currentPreset.accent} on:change={(e) => updateCustomColor('folderIcon', e.currentTarget.value)} />
              </div>
            </label>

            <label class="color-item">
              <span class="color-label">File Icon</span>
              <div class="picker-wrap">
                <input type="color" value={preferences.customColors?.fileIcon || currentPreset.fileIcon || currentPreset.muted} on:input={(e) => updateCustomColor('fileIcon', e.currentTarget.value)} />
                <input type="text" class="color-hex" value={preferences.customColors?.fileIcon || currentPreset.fileIcon || currentPreset.muted} on:change={(e) => updateCustomColor('fileIcon', e.currentTarget.value)} />
              </div>
            </label>
          </div>

          <div class="pref-actions-row">
            <button class="pref-btn" on:click={resetThemeDefaults}>Reset Theme Defaults</button>
          </div>
        </section>

      {:else if activeTab === 'fonts'}
        <!-- FONT SETTINGS -->
        <section class="pref-section">
          <h3>Font Family</h3>
          <p class="pref-hint">Choose between indie pixel retro aesthetics or high-clarity developer monospace fonts.</p>
          <div class="font-options-grid">
            {#each FONT_OPTIONS as font}
              <button
                class="font-card"
                class:active={preferences.fontFamily === font.value}
                on:click={() => selectFont(font.value)}
              >
                <div class="font-preview" style="font-family: {font.value};">
                  Aa Bb Cc 123
                </div>
                <div class="font-meta">
                  <strong>{font.name}</strong>
                  <span>{font.value}</span>
                </div>
              </button>
            {/each}
          </div>

          <h3 style="margin-top: 24px;">Font Size</h3>
          <div class="font-size-control">
            <input
              type="range"
              min="11"
              max="24"
              step="1"
              value={preferences.fontSize}
              on:input={(e) => setFontSize(Number(e.currentTarget.value))}
            />
            <span class="font-size-badge">{preferences.fontSize}px</span>
            <div class="quick-size-btns">
              {#each [12, 13, 14, 15, 16, 18] as s}
                <button
                  class="size-pill"
                  class:active={preferences.fontSize === s}
                  on:click={() => setFontSize(s)}
                >
                  {s}px
                </button>
              {/each}
            </div>
          </div>

          <h3 style="margin-top: 24px;">Indie Retro UI Experience</h3>
          <label class="checkbox-option">
            <input type="checkbox" checked={preferences.fontUi} on:change={toggleFontUi} />
            <div>
              <strong>Apply font to entire UI</strong>
              <p>Renders all application menus, sidebars, tabs, and buttons in the selected font for an authentic indie sci-fi game UI look.</p>
            </div>
          </label>
        </section>

      {:else if activeTab === 'syntax'}
        <!-- SYNTAX SCHEME PER LANGUAGE -->
        <section class="pref-section">
          <div class="syntax-header-bar">
            <div>
              <h3>Language Syntax Color Scheme</h3>
              <p class="pref-hint">Customize syntax highlighting colors individually for each programming language.</p>
            </div>
            <div class="syntax-actions">
              <button class="pref-btn small" on:click={resetLanguageSyntax}>Reset {selectedLanguage}</button>
              <button class="pref-btn small danger" on:click={resetAllSyntax}>Reset All Syntax</button>
            </div>
          </div>

          <!-- Language Selector Tabs -->
          <div class="lang-selector-tabs">
            {#each SUPPORTED_LANGUAGES as lang}
              <button
                class="lang-tab"
                class:active={selectedLanguage === lang.id}
                on:click={() => (selectedLanguage = lang.id)}
              >
                {lang.name}
              </button>
            {/each}
          </div>

          <!-- Syntax Colors & Live Preview Columns -->
          <div class="syntax-two-column">
            <!-- Left: Color Pickers -->
            <div class="syntax-pickers-col">
              <h4>Syntax Tokens ({selectedLanguage})</h4>
              <div class="syntax-pickers-list">
                <label class="syntax-picker-row">
                  <span class="syntax-label">
                    <i class="dot" style="background: {activeSyntax.keyword}"></i>
                    Keywords (def, class, func, return)
                  </span>
                  <div class="picker-wrap">
                    <input type="color" value={activeSyntax.keyword} on:input={(e) => updateSyntaxColor('keyword', e.currentTarget.value)} />
                    <input type="text" class="color-hex" value={activeSyntax.keyword} on:change={(e) => updateSyntaxColor('keyword', e.currentTarget.value)} />
                  </div>
                </label>

                <label class="syntax-picker-row">
                  <span class="syntax-label">
                    <i class="dot" style="background: {activeSyntax.function}"></i>
                    Functions & Methods (call, def)
                  </span>
                  <div class="picker-wrap">
                    <input type="color" value={activeSyntax.function} on:input={(e) => updateSyntaxColor('function', e.currentTarget.value)} />
                    <input type="text" class="color-hex" value={activeSyntax.function} on:change={(e) => updateSyntaxColor('function', e.currentTarget.value)} />
                  </div>
                </label>

                <label class="syntax-picker-row">
                  <span class="syntax-label">
                    <i class="dot" style="background: {activeSyntax.class}"></i>
                    Classes & Types (struct, interface)
                  </span>
                  <div class="picker-wrap">
                    <input type="color" value={activeSyntax.class} on:input={(e) => updateSyntaxColor('class', e.currentTarget.value)} />
                    <input type="text" class="color-hex" value={activeSyntax.class} on:change={(e) => updateSyntaxColor('class', e.currentTarget.value)} />
                  </div>
                </label>

                <label class="syntax-picker-row">
                  <span class="syntax-label">
                    <i class="dot" style="background: {activeSyntax.variable}"></i>
                    Variables & Identifiers
                  </span>
                  <div class="picker-wrap">
                    <input type="color" value={activeSyntax.variable} on:input={(e) => updateSyntaxColor('variable', e.currentTarget.value)} />
                    <input type="text" class="color-hex" value={activeSyntax.variable} on:change={(e) => updateSyntaxColor('variable', e.currentTarget.value)} />
                  </div>
                </label>

                <label class="syntax-picker-row">
                  <span class="syntax-label">
                    <i class="dot" style="background: {activeSyntax.string}"></i>
                    Strings ("text", 'content')
                  </span>
                  <div class="picker-wrap">
                    <input type="color" value={activeSyntax.string} on:input={(e) => updateSyntaxColor('string', e.currentTarget.value)} />
                    <input type="text" class="color-hex" value={activeSyntax.string} on:change={(e) => updateSyntaxColor('string', e.currentTarget.value)} />
                  </div>
                </label>

                <label class="syntax-picker-row">
                  <span class="syntax-label">
                    <i class="dot" style="background: {activeSyntax.number}"></i>
                    Numbers & Booleans (100, true)
                  </span>
                  <div class="picker-wrap">
                    <input type="color" value={activeSyntax.number} on:input={(e) => updateSyntaxColor('number', e.currentTarget.value)} />
                    <input type="text" class="color-hex" value={activeSyntax.number} on:change={(e) => updateSyntaxColor('number', e.currentTarget.value)} />
                  </div>
                </label>

                <label class="syntax-picker-row">
                  <span class="syntax-label">
                    <i class="dot" style="background: {activeSyntax.comment}"></i>
                    Comments (# note, // comment)
                  </span>
                  <div class="picker-wrap">
                    <input type="color" value={activeSyntax.comment} on:input={(e) => updateSyntaxColor('comment', e.currentTarget.value)} />
                    <input type="text" class="color-hex" value={activeSyntax.comment} on:change={(e) => updateSyntaxColor('comment', e.currentTarget.value)} />
                  </div>
                </label>
              </div>
            </div>

            <!-- Right: Interactive Live Code Preview Box -->
            <div class="syntax-preview-col">
              <h4>Live Code Preview ({selectedLanguage})</h4>
              <div
                class="syntax-code-preview"
                style="
                  font-family: {preferences.fontFamily};
                  font-size: {preferences.fontSize}px;
                  --syntax-keyword: {activeSyntax.keyword};
                  --syntax-function: {activeSyntax.function};
                  --syntax-class: {activeSyntax.class};
                  --syntax-variable: {activeSyntax.variable};
                  --syntax-string: {activeSyntax.string};
                  --syntax-number: {activeSyntax.number};
                  --syntax-comment: {activeSyntax.comment};
                "
              >
                <pre><code>{#if selectedLanguage === 'python'}<span class="syn-comment"># Python Physics Engine</span>
<span class="syn-var">GLOBAL_SPEED</span> = <span class="syn-num">100</span>

<span class="syn-kw">class</span> <span class="syn-class">PhysicsEngine</span>:
    <span class="syn-kw">def</span> <span class="syn-fn">__init__</span>(<span class="syn-var">self</span>, <span class="syn-var">damping</span>: <span class="syn-class">float</span> = <span class="syn-num">0.98</span>):
        <span class="syn-var">self</span>.<span class="syn-var">damping</span> = <span class="syn-var">damping</span>

    <span class="syn-kw">def</span> <span class="syn-fn">compute_velocity</span>(<span class="syn-var">self</span>, <span class="syn-var">delta</span>: <span class="syn-class">float</span>) -> <span class="syn-class">float</span>:
        <span class="syn-var">velocity</span> = <span class="syn-var">GLOBAL_SPEED</span> * <span class="syn-var">delta</span> * <span class="syn-var">self</span>.<span class="syn-var">damping</span>
        <span class="syn-kw">return</span> <span class="syn-var">velocity</span>
{:else if selectedLanguage === 'gdscript'}<span class="syn-comment"># GDScript Player Controller</span>
<span class="syn-kw">class_name</span> <span class="syn-class">Player</span>
<span class="syn-kw">extends</span> <span class="syn-class">CharacterBody2D</span>

<span class="syn-kw">const</span> <span class="syn-var">MAX_HEALTH</span> = <span class="syn-num">100</span>
<span class="syn-kw">var</span> <span class="syn-var">current_health</span>: <span class="syn-class">int</span> = <span class="syn-var">MAX_HEALTH</span>

<span class="syn-kw">func</span> <span class="syn-fn">take_damage</span>(<span class="syn-var">amount</span>: <span class="syn-class">int</span>) -> <span class="syn-kw">void</span>:
    <span class="syn-var">current_health</span> = <span class="syn-fn">max</span>(<span class="syn-num">0</span>, <span class="syn-var">current_health</span> - <span class="syn-var">amount</span>)
    <span class="syn-fn">print</span>(<span class="syn-str">"Player health:"</span>, <span class="syn-var">current_health</span>)
{:else if selectedLanguage === 'cpp'}<span class="syn-comment">// C++ Vector Math Library</span>
<span class="syn-kw">#include</span> <span class="syn-str">&lt;cmath&gt;</span>

<span class="syn-kw">class</span> <span class="syn-class">Vector3</span> &#123;
<span class="syn-kw">public</span>:
    <span class="syn-class">float</span> <span class="syn-var">x</span>, <span class="syn-var">y</span>, <span class="syn-var">z</span>;
    <span class="syn-fn">Vector3</span>(<span class="syn-class">float</span> <span class="syn-var">x</span>, <span class="syn-class">float</span> <span class="syn-var">y</span>, <span class="syn-class">float</span> <span class="syn-var">z</span>) : <span class="syn-var">x</span>(<span class="syn-var">x</span>), <span class="syn-var">y</span>(<span class="syn-var">y</span>), <span class="syn-var">z</span>(<span class="syn-var">z</span>) &#123;&#125;
&#125;;

<span class="syn-kw">void</span> <span class="syn-fn">Normalize</span>(<span class="syn-class">Vector3</span>&amp; <span class="syn-var">v</span>) &#123;
    <span class="syn-class">float</span> <span class="syn-var">len</span> = <span class="syn-fn">sqrt</span>(<span class="syn-var">v</span>.<span class="syn-var">x</span> * <span class="syn-var">v</span>.<span class="syn-var">x</span> + <span class="syn-var">v</span>.<span class="syn-var">y</span> * <span class="syn-var">v</span>.<span class="syn-var">y</span>);
    <span class="syn-kw">if</span> (<span class="syn-var">len</span> &gt; <span class="syn-num">0.0f</span>) &#123; <span class="syn-var">v</span>.<span class="syn-var">x</span> /= <span class="syn-var">len</span>; &#125;
&#125;
{:else if selectedLanguage === 'csharp'}<span class="syn-comment">// C# Game Controller</span>
<span class="syn-kw">namespace</span> <span class="syn-class">GameCore</span>
&#123;
    <span class="syn-kw">public class</span> <span class="syn-class">PlayerController</span>
    &#123;
        <span class="syn-kw">public static int</span> <span class="syn-var">MaxPlayers</span> = <span class="syn-num">8</span>;

        <span class="syn-kw">public void</span> <span class="syn-fn">Setup</span>()
        &#123;
            <span class="syn-class">Console</span>.<span class="syn-fn">WriteLine</span>(<span class="syn-str">"Ready: "</span> + <span class="syn-var">MaxPlayers</span>);
        &#125;
    &#125;
&#125;
{:else if selectedLanguage === 'javascript'}<span class="syn-comment">// JavaScript Graph Engine</span>
<span class="syn-kw">export const</span> <span class="syn-var">VERSION</span> = <span class="syn-str">"1.0.0"</span>;

<span class="syn-kw">export class</span> <span class="syn-class">ProjectGraph</span> &#123;
  <span class="syn-fn">constructor</span>(<span class="syn-var">name</span>) &#123;
    <span class="syn-var">this</span>.<span class="syn-var">name</span> = <span class="syn-var">name</span>;
  &#125;

  <span class="syn-fn">processNodes</span>(<span class="syn-var">nodes</span>) &#123;
    <span class="syn-kw">return</span> <span class="syn-var">nodes</span>.<span class="syn-fn">map</span>(<span class="syn-var">n</span> =&gt; <span class="syn-var">n</span>.<span class="syn-var">label</span>);
  &#125;
&#125;
{:else}<span class="syn-comment"># Project Documentation</span>
Welcome to <span class="syn-class">NiZyLa</span> editor!

- <span class="syn-kw">Class</span>: <span class="syn-fn">Blue</span>
- <span class="syn-kw">Function</span>: <span class="syn-str">Green</span>
- <span class="syn-kw">Variable</span>: <span class="syn-num">Red</span>
{/if}</code></pre>
              </div>
            </div>
          </div>
        </section>
      {/if}
    </div>

    <!-- Footer -->
    <div class="pref-footer">
      <span class="pref-footer-note">Settings are saved automatically to your profile.</span>
      <button class="pref-btn primary" on:click={close}>Done</button>
    </div>
  </div>
</div>

<style>
  .pref-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }

  .pref-modal {
    width: 100%;
    max-width: 900px;
    max-height: 88vh;
    display: flex;
    flex-direction: column;
    background: var(--panel-solid, #162832);
    border: 2px solid var(--border-strong, #386777);
    border-radius: 8px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
    overflow: hidden;
    color: var(--text, #5ce1e6);
  }

  .pref-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 16px 20px;
    border-bottom: 2px solid var(--border, #23424d);
    background: color-mix(in srgb, var(--panel-solid) 90%, black);
  }

  .pref-badge {
    display: inline-block;
    padding: 2px 7px;
    font-size: 10px;
    letter-spacing: 0.12em;
    border: 1px solid var(--accent, #47d8d8);
    border-radius: 3px;
    color: var(--accent, #47d8d8);
    margin-bottom: 4px;
  }

  .pref-header h2 {
    margin: 0;
    font-size: 20px;
    letter-spacing: 0.03em;
    color: var(--text);
  }

  .pref-subtitle {
    font-size: 12px;
    color: var(--muted, #4d7b88);
  }

  .pref-close-btn {
    background: transparent;
    border: 1px solid var(--border, #23424d);
    color: var(--muted, #4d7b88);
    padding: 4px 10px;
    font-size: 14px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 160ms ease;
  }

  .pref-close-btn:hover {
    color: var(--text);
    border-color: var(--accent);
    background: var(--button-hover);
  }

  .pref-tabs {
    display: flex;
    border-bottom: 2px solid var(--border, #23424d);
    background: var(--bg-soft, #13252e);
    overflow-x: auto;
  }

  .pref-tab {
    padding: 11px 18px;
    background: transparent;
    border: none;
    border-bottom: 3px solid transparent;
    color: var(--muted, #4d7b88);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: all 160ms ease;
  }

  .pref-tab:hover {
    color: var(--text);
    background: var(--button);
  }

  .pref-tab.active {
    color: var(--accent, #47d8d8);
    border-bottom-color: var(--accent, #47d8d8);
    background: var(--panel-solid);
  }

  .pref-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
  }

  .pref-section h3 {
    margin: 0 0 8px;
    font-size: 15px;
    color: var(--text);
    letter-spacing: 0.04em;
  }

  .pref-section h4 {
    margin: 0 0 10px;
    font-size: 13px;
    color: var(--muted);
  }

  .pref-hint {
    margin: 0 0 14px;
    font-size: 12px;
    color: var(--muted);
  }

  .theme-presets-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 12px;
  }

  .theme-card {
    display: flex;
    flex-direction: column;
    background: var(--bg-soft);
    border: 2px solid var(--border);
    border-radius: 6px;
    padding: 8px;
    cursor: pointer;
    text-align: left;
    transition: all 180ms ease;
  }

  .theme-card:hover {
    border-color: var(--accent);
    transform: translateY(-2px);
  }

  .theme-card.active {
    border-color: var(--accent);
    box-shadow: 0 0 12px color-mix(in srgb, var(--accent) 40%, transparent);
  }

  .theme-card-preview {
    height: 64px;
    border-radius: 4px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    padding: 4px;
    gap: 4px;
  }

  .preview-panel {
    height: 14px;
    border-radius: 2px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 4px;
  }

  .preview-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .preview-line {
    width: 24px;
    height: 3px;
    border-radius: 1px;
  }

  .preview-editor {
    flex: 1;
    border-radius: 2px;
    font-size: 10px;
    padding: 2px 4px;
    font-family: monospace;
    overflow: hidden;
  }

  .custom-preview {
    background: var(--bg);
    border: 2px dashed var(--border-strong);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    font-size: 11px;
  }

  .custom-icon {
    font-size: 18px;
  }

  .theme-card-info {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .theme-card-info strong {
    font-size: 12px;
    color: var(--text);
  }

  .indie-tag {
    font-size: 9px;
    letter-spacing: 0.1em;
    padding: 1px 4px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--accent) 25%, transparent);
    color: var(--accent);
    width: fit-content;
  }

  .color-pickers-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
  }

  .color-item {
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--bg-soft);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
  }

  .color-label {
    font-size: 12px;
    color: var(--muted);
  }

  .picker-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .picker-wrap input[type="color"] {
    width: 28px;
    height: 28px;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    background: transparent;
    padding: 0;
  }

  .color-hex {
    flex: 1;
    font-size: 12px;
    font-family: monospace;
    padding: 4px 6px;
    background: var(--panel-solid);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
  }

  .font-options-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 10px;
  }

  .font-card {
    display: flex;
    flex-direction: column;
    background: var(--bg-soft);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px;
    text-align: left;
    cursor: pointer;
    transition: all 160ms ease;
  }

  .font-card:hover {
    border-color: var(--accent);
  }

  .font-card.active {
    border-color: var(--accent);
    box-shadow: 0 0 10px color-mix(in srgb, var(--accent) 30%, transparent);
  }

  .font-preview {
    font-size: 16px;
    margin-bottom: 6px;
    color: var(--text);
  }

  .font-meta strong {
    display: block;
    font-size: 12px;
    color: var(--text);
  }

  .font-meta span {
    font-size: 10px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    display: block;
  }

  .font-size-control {
    display: flex;
    align-items: center;
    gap: 14px;
    background: var(--bg-soft);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px 14px;
  }

  .font-size-control input[type="range"] {
    flex: 1;
    accent-color: var(--accent);
  }

  .font-size-badge {
    font-weight: bold;
    font-size: 14px;
    min-width: 40px;
    color: var(--accent);
  }

  .quick-size-btns {
    display: flex;
    gap: 4px;
  }

  .size-pill {
    padding: 3px 7px;
    font-size: 11px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--button);
    color: var(--text);
    cursor: pointer;
  }

  .size-pill.active {
    background: var(--accent);
    color: #000;
    border-color: var(--accent);
  }

  .checkbox-option {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    background: var(--bg-soft);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 12px;
    cursor: pointer;
  }

  .checkbox-option input[type="checkbox"] {
    margin-top: 3px;
    accent-color: var(--accent);
    width: 16px;
    height: 16px;
  }

  .checkbox-option strong {
    font-size: 13px;
    color: var(--text);
    display: block;
  }

  .checkbox-option p {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--muted);
  }

  /* SYNTAX TAB */
  .syntax-header-bar {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }

  .syntax-actions {
    display: flex;
    gap: 8px;
  }

  .lang-selector-tabs {
    display: flex;
    gap: 6px;
    margin: 14px 0;
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .lang-tab {
    padding: 6px 12px;
    background: var(--bg-soft);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
    transition: all 140ms ease;
  }

  .lang-tab:hover {
    color: var(--text);
    border-color: var(--border-strong);
  }

  .lang-tab.active {
    background: var(--accent);
    color: #0b1a20;
    font-weight: bold;
    border-color: var(--accent);
  }

  .syntax-two-column {
    display: grid;
    grid-template-columns: minmax(300px, 1fr) minmax(340px, 1.2fr);
    gap: 16px;
  }

  .syntax-pickers-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .syntax-picker-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    background: var(--bg-soft);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 6px 10px;
  }

  .syntax-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--text);
  }

  .syntax-label .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    display: inline-block;
  }

  .syntax-code-preview {
    background: var(--editor-bg, #11212a);
    border: 2px solid var(--border-strong, #386777);
    border-radius: 6px;
    padding: 14px;
    height: 310px;
    overflow: auto;
    line-height: 1.5;
  }

  .syntax-code-preview pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .syn-kw { color: var(--syntax-keyword); font-weight: 600; }
  .syn-fn { color: var(--syntax-function); }
  .syn-class { color: var(--syntax-class); }
  .syn-var { color: var(--syntax-variable); }
  .syn-str { color: var(--syntax-string); }
  .syn-num { color: var(--syntax-number); }
  .syn-comment { color: var(--syntax-comment); font-style: italic; }

  .pref-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 20px;
    border-top: 2px solid var(--border, #23424d);
    background: color-mix(in srgb, var(--panel-solid) 90%, black);
  }

  .pref-footer-note {
    font-size: 12px;
    color: var(--muted);
  }

  .pref-btn {
    padding: 7px 14px;
    font-size: 12px;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    background: var(--button);
    color: var(--text);
    cursor: pointer;
    transition: all 160ms ease;
  }

  .pref-btn:hover {
    background: var(--button-hover);
    border-color: var(--accent);
  }

  .pref-btn.primary {
    background: var(--accent);
    color: #0b1a20;
    border-color: var(--accent);
    font-weight: bold;
  }

  .pref-btn.small {
    padding: 4px 8px;
    font-size: 11px;
  }

  .pref-btn.danger:hover {
    border-color: #ef4444;
    color: #ef4444;
  }

  .pref-actions-row {
    margin-top: 16px;
    display: flex;
    justify-content: flex-end;
  }

  @media (max-width: 760px) {
    .syntax-two-column {
      grid-template-columns: 1fr;
    }
  }
</style>
