import { StreamLanguage } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { python } from '@codemirror/lang-python';
import { cppLanguage } from '@codemirror/lang-cpp';
import { csharp } from '@codemirror/legacy-modes/mode/clike';
import { completeAnyWord } from '@codemirror/autocomplete';

const gdKeywords = new Set('and as assert await break breakpoint class class_name const continue elif else enum extends for func if in is match namespace not or pass preload return self signal static super trait var void while when yield'.split(' '));
const gdTypes = new Set('Array Basis bool Callable Color Dictionary float int Node Node2D Node3D Object PackedByteArray PackedFloat32Array PackedInt32Array Plane Projection Quaternion Rect2 Rect2i RID Signal String StringName Transform2D Transform3D Variant Vector2 Vector2i Vector3 Vector3i Vector4 Vector4i'.split(' '));
const gdAtoms = new Set(['true', 'false', 'null', 'PI', 'TAU', 'INF', 'NAN']);
const gdBuiltins = 'abs ceil clamp cos deg_to_rad floor fmod inverse_lerp is_equal_approx is_instance_valid lerp load max min move_toward pow preload print print_rich printerr push_error push_warning rad_to_deg randf randf_range randi randi_range range remap round sign sin smoothstep snapped sqrt str tan typeof wrapf wrapi'.split(' ');
const cppKeywords = 'alignas alignof asm auto bool break case catch char char8_t char16_t char32_t class concept const consteval constexpr constinit const_cast continue co_await co_return co_yield decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept nullptr operator private protected public register reinterpret_cast requires return short signed sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while'.split(' ');
const cppTypes = 'array map set shared_ptr size_t std string unordered_map unique_ptr vector'.split(' ');
const cppFunctions = 'free make_shared make_unique malloc printf scanf'.split(' ');
const csharpTypes = 'Console DateTime Dictionary HashSet IEnumerable List Math StringBuilder Task'.split(' ');
const csharpFunctions = 'Write WriteLine'.split(' ');

const completions = (words, type) => [...words].map((label) => ({ label, type }));
const gdCompletions = [
  ...completions(gdKeywords, 'keyword'),
  ...completions(gdTypes, 'type'),
  ...completions(gdAtoms, 'constant'),
  ...completions(gdBuiltins, 'function')
];
const cppCompletions = [...completions(cppKeywords, 'keyword'), ...completions(cppTypes, 'type'), ...completions(cppFunctions, 'function')];
const csharpCompletions = [...completions(csharpTypes, 'type'), ...completions(csharpFunctions, 'function')];

function readGdString(stream, state) {
  let escaped = false;
  while (!stream.eol()) {
    if (state.triple && stream.match(state.quote.repeat(3))) {
      state.quote = null;
      state.triple = false;
      break;
    }
    const char = stream.next();
    if (!state.triple && char === state.quote && !escaped) {
      state.quote = null;
      break;
    }
    escaped = !escaped && char === '\\';
  }
  return 'string';
}

export const gdscriptLanguage = StreamLanguage.define({
  name: 'gdscript',
  startState: () => ({ quote: null, triple: false }),
  token(stream, state) {
    if (state.quote) return readGdString(stream, state);
    if (stream.eatSpace()) return null;
    if (stream.peek() === '#') { stream.skipToEnd(); return 'comment'; }
    if (stream.peek() === '@') { stream.next(); stream.eatWhile(/[\w_]/); return 'meta'; }
    if (stream.match(/^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?[\d_]+)?)/)) return 'number';
    const quote = stream.peek();
    if (quote === '"' || quote === "'") {
      stream.next();
      state.quote = quote;
      state.triple = stream.match(quote.repeat(2));
      return readGdString(stream, state);
    }
    if (stream.match(/^[A-Za-z_][\w_]*/)) {
      const word = stream.current();
      if (gdKeywords.has(word)) return 'keyword';
      if (gdTypes.has(word)) return 'typeName';
      if (gdAtoms.has(word)) return 'bool';
      if (/^[A-Z]/.test(word)) return 'className';
      return 'variableName';
    }
    if (stream.match(/^(?:\*\*|\/\/|<<|>>|==|!=|<=|>=|->|:=|&&|\|\||[-+*/%=&|^~<>!:])/)) return 'operator';
    stream.next();
    return null;
  },
  languageData: {
    commentTokens: { line: '#' },
    closeBrackets: { brackets: ['(', '[', '{', "'", '"'] },
    indentOnInput: /^\s*(?:elif|else|except|finally).*:$/,
    autocomplete: gdCompletions
  }
});

const csharpLanguage = StreamLanguage.define(csharp);

function withLocalWords(language, completionOptions = null) {
  return [
    language,
    ...(completionOptions ? [language.data.of({ autocomplete: completionOptions })] : []),
    language.data.of({ autocomplete: completeAnyWord })
  ];
}

export function languageExtension(name = '') {
  const lower = name.toLowerCase();
  if (/\.(js|jsx|ts|tsx|mjs|cjs|svelte)$/.test(lower)) return javascript({ jsx: true, typescript: /\.(ts|tsx|svelte)$/.test(lower) });
  if (lower.endsWith('.md')) return markdown();
  if (lower.endsWith('.json')) return json();
  if (/\.(css|scss)$/.test(lower)) return css();
  if (/\.(html|xml)$/.test(lower)) return html();
  if (lower.endsWith('.py')) return python();
  if (lower.endsWith('.gd')) return withLocalWords(gdscriptLanguage);
  if (/\.(c|cc|cpp|cxx|h|hh|hpp|hxx|ipp|tpp|inl)$/.test(lower)) return withLocalWords(cppLanguage, cppCompletions);
  if (/\.(cs|csx)$/.test(lower)) return withLocalWords(csharpLanguage, csharpCompletions);
  return [];
}
