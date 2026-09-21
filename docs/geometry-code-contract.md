# Geometry Code contract — .gcn v1

Stage 1 (data and validation) lives in `src/core/geometry.js`; stage 2 (code
generation) in `src/core/geometry-codegen.js`; stage 3 (editor UI, experimental) is
described at the end. No file IPC, Run button or export exists yet. Subsequent stages
must use this contract rather than introduce a second graph representation.

## File format

UTF-8 JSON, two-space indentation and a final newline. Example new document:

```json
{
  "format": "nizyla.geometry-code",
  "version": 1,
  "target": "python",
  "variables": [],
  "nodes": [
    {
      "id": "start",
      "type": "start",
      "position": { "x": 0, "y": 0 },
      "data": {}
    }
  ],
  "edges": [],
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

- `target`: `python` or `gdscript`; this does not change graph validation.
- Variable: `{ id, name, type, initialValue }`.
- Node: `{ id, type, position: { x, y }, data }`.
- Edge: `{ id, source, sourceHandle, target, targetHandle }`.
- IDs and edge endpoints/handles are nonempty strings. IDs are unique within
  each collection, not globally across variables/nodes/edges.
- Positions and viewport coordinates are finite numbers; zoom is positive.
- Value types: `int` (JS safe integer), `float` (finite number), `string`, `bool`.
  A float may store `1`; its type must remain float when generating code.
- JSON serialization normalizes negative zero to zero.
- Missing fields, wrong field types, unknown node types/operators, nonmatching
  literal/initial values and unsupported versions are file-shape errors.
- Additional fields are accepted on input but dropped on serialization,
  including inside position, viewport, node data, variables and edges.
  Never store UI objects or port definitions in the document.

## Public JavaScript API

| Export | Result |
| --- | --- |
| `createGeometryDocument()` | Fresh independent document with one Start, target Python |
| `parseGeometryDocument(text)` | `{ document, diagnostics }`; null document only for JSON/file-shape errors |
| `serializeGeometryDocument(document)` | Canonical JSON containing only contract fields; throws `TypeError` for file-shape errors |
| `validateGeometryDocument(document)` | Diagnostics without changing the document; safe on invalid file shape |
| `nodeDefinitions` | Metadata by type: `label`, `category`, `defaults`, `ports`; literal also has `valueTypes`, operator nodes have `operators` |
| `getNodePorts(node, variables = [], inputTypes = {})` | Fresh port descriptions for a schema-valid node; unknown node type returns `[]` |

A port is `{ id, direction: 'in' | 'out', kind: 'exec' | 'value', valueType }`.
Execution ports use `valueType: null`. Value ports use a concrete type or
`number` (int/float accepted), `any` (any supported type) or `unknown`
(unresolved reference/input). These three labels are not literal types.
`inputTypes` maps input handle IDs to source types; it is used to infer binary
outputs. Call `getNodePorts` rather than using the registry's internal static
array/function directly. Treat registry metadata as read-only and copy defaults
when adding nodes.

Diagnostics are `{ severity: 'error' | 'warning', code, message, nodeId?, edgeId? }`.
Codes are for programmatic handling; messages are human-readable English.
Graph-level and variable diagnostics may lack node/edge IDs. Variable messages
identify the variable. Validation stops after file-shape errors or duplicate
IDs because graph references would otherwise be ambiguous.

## Node data and ports

Each value output below has ID `value`; execution inputs have ID `in`.

| Node type | Data | Execution ports | Value ports |
| --- | --- | --- | --- |
| `start` | `{}` | out `next` | none |
| `literal` | `{ valueType, value }` | none | out declared type |
| `getVariable` | `{ variableId }` | none | out variable type |
| `setVariable` | `{ variableId }` | in; out `next` | in `value`: variable type |
| `binary` | `{ operator: '+' / '-' / '*' / '/' }` | none | in `a`, `b`: numbers; out inferred numeric type |
| `compare` | `{ operator: '==' / '!=' / '<' / '<=' / '>' / '>=' }` | none | in `a`, `b`; out bool |
| `boolean` | `{ operator: 'and' / 'or' / 'not' }` | none | bool in `a`, `b` (only `a` for not); out bool |
| `if` | `{}` | in; out `then`, `else`, `next` | bool in `condition` |
| `while` | `{}` | in; out `body`, `next` | bool in `condition` |
| `forRange` | `{ variableId }` | in; out `body`, `next` | int in `start`, `stop`, `step` |
| `print` | `{}` | in; out `next` | in `value`: any supported type |

Defaults: int literal 0; binary `+`; compare `==`; boolean `and`;
variable references `''` (unselected). An empty variable reference is a
saveable graph error, not an invalid file shape.

## Graph rules

- Exactly one Start. It cannot accept an incoming execution edge.
- Edges connect existing output handles to existing input handles of the same
  kind. Each input accepts one edge; each execution output accepts one edge;
  value outputs can fan out. All statements have only one execution input,
  so branches/bodies cannot share statements.
- Both execution and value cycles are errors, including disconnected cycles.
  Iterative traversals avoid JavaScript recursion limits on long chains, and generated Python/GDScript. Codegen tests also run the output
with real Python 3 and Godot 4 (`GODOT_BIN` = a Godot console executable, or
`godot` on PATH) and skip with a reason when a runtime is missing.
- Unconnected execution exits end the current block. If runs its selected
  branch and then next. Loops run body repeatedly and then next. Do not draw
  loop-back edges. Empty blocks are allowed.
- Reachability begins at Start, follows all execution exits and includes
  value dependencies. Used value inputs must be connected. Unused nodes get
  warnings and no missing-input errors, but invalid wires, known type
  mismatches, cycles and bad variable references still get errors.
- Math accepts only int/float. `/` outputs float; other operators output int
  for two int operands and float otherwise. Equality accepts matching types
  or an int/float pair; ordering accepts numbers only. Logic/conditions require bool.
- Assignment permits identical types and int-to-float promotion only. For
  bounds/step and iterator must be int. A literal zero step is an error.
  Validation does not evaluate expressions or prove dynamic steps nonzero.
- Variable names match `[A-Za-z_][A-Za-z0-9_]*` and are unique, case-sensitive.
  Python/GDScript keywords, literals, GDScript built-in type names, reserved words and generator names are
  excluded, together with prefix `_gcn_`. The complete conservative union is
  `reservedNames` in the implementation (including Python soft keywords and
  Godot legacy/reserved words). Both targets use the same naming policy.
- Get, Set and For reference variables by ID, so a rename preserves links.
  A For inside another For's body, even through If/While, must use a different
  variable ID. A following For via next may reuse the ID. This rule also
  applies to disconnected execution trees.
- Errors block future code generation/export, not saving an editable graph.
  `serializeGeometryDocument` checks file shape only. Parsing never replaces
  bad files with an empty document and never executes graph content.

Diagnostic codes: `invalid-json`, `invalid-format`, `unsupported-version`,
`invalid-schema`, `duplicate-id`, `invalid-variable-name`,
`duplicate-variable-name`, `start-count`, `missing-variable`,
`for-variable-type`, `missing-node`, `missing-port`, `port-direction`,
`port-kind`, `input-connected`, `exec-output-connected`, `exec-cycle`,
`value-cycle`, `unused-node`, `missing-input`, `type-mismatch`,
`comparison-type`, `zero-step`, `nested-for-variable`.

## Code generation (stage 2, `src/core/geometry-codegen.js`)

`generateGeometryCode(document, target = document?.target)` returns
`{ code: string | null, diagnostics }`. `target` (`python` or `gdscript`)
overrides the language for that call only; the document is never modified. It
runs `validateGeometryDocument` first and returns `code: null` plus the
diagnostics on any error, including `unsupported-target` for a bad target.
Warnings alone still generate code and are returned unchanged. The module is
pure (no filesystem, process or Electron use) and never evaluates graph data.

- Python 3: `def main():` plus `if __name__ == "__main__":`. Godot 4:
  `extends Node` and `func _ready():`. Four-space indentation, LF, final newline.
  `pass` appears only in blocks with no statement.
- All variables are initialized at function entry in array order. GDScript uses
  typed locals (`int`, `float`, `String`, `bool`); float values are always
  emitted as float literals (`1.0`), and an int assigned to a float variable is
  wrapped in `float(...)`.
- Execution is walked from Start through ports only (never by node position or a
  global sort), with an explicit work stack rather than recursion. If runs then/else
  and then `next` once; loops run body and then `next`. Unused nodes are omitted.
- Expressions are fully parenthesized, rendered at the point of use and never
  hoisted. `and`/`or`/`not` keep short-circuiting. `/` is `(a / b)` in Python and
  `(float(a) / b)` in GDScript. Negative number literals are parenthesized.
- For Range emits `for _gcn_iN in range(start, stop, step):` (N counts loops in
  generation order), then `variable = _gcn_iN` as the first body line, so assigning
  the variable in the body cannot change iteration and an empty range leaves it alone.
- Strings are escaped per language; node IDs are never written to the output.
  Lone surrogates (both targets) and NUL (GDScript) cannot be represented and give
  `invalid-string-literal`.
- Generation limits (diagnostic, `code: null`, never a thrown `RangeError`):
  expression nesting 64 (`expression-too-deep`), one expression's text 100,000
  characters (`expression-too-large`, reached by heavy value fan-out), block
  indentation 50 (`block-too-deep`), and `generation-limit` as a last-resort guard.
  Statement chains of any length are fine (tested at 6,000).
- Not proved statically: dynamic zero step, division by zero (Python raises;
  GDScript float division gives inf), overflow, nontermination. GDScript locals
  may shadow `Node` members such as `name` (Godot warns); the reserved-name list
  does not cover those. Generated `print` output differs across languages
  (`True` vs `true`, `3.0` vs `3`).
- Still not implemented: reverse conversion, migrations, UI, execution or export.

## Checks

Run `node --test test/geometry.test.js test/geometry-codegen.test.js` and `npm test`. Tests cover schema vs
editable errors, round-trip and transient stripping, typed connections,
control nesting, cycles, variable references, immutable input and long chains, and generated Python/GDScript. Codegen tests
also run the output with real Python 3 and Godot 4 (`GODOT_BIN` = a Godot
console executable, or `godot` on PATH) and skip with a reason if one is missing.
Build the installer with `npm run dist:win` as required by AGENTS.md.

Keyword references: [Python lexical analysis](https://docs.python.org/3/reference/lexical_analysis.html#keywords)
and [GDScript reference](https://docs.godotengine.org/en/stable/tutorials/scripting/gdscript/gdscript_basics.html#keywords).

## Stage 3: node editor UI (experimental, in memory only)

Open it with the **Geometry Code** switch in the top bar (next to **Code**). The
graph starts as one Start node, needs no open project, and is **not saved**
(banner: "กราฟทดลอง — ยังบันทึกไม่ได้ในรุ่นนี้"). No Save/Export/Run/.gcn open yet.
Closing or reloading after an edit asks to discard the graph (Cancel stays);
undoing back to the initial content is not "changed". Picking a file in the
Explorer returns to Code mode and keeps the graph. While in Geometry, Code-pane
buttons/shortcuts (Save, Split, Graph, Terminal, +Editor) are disabled and
floating windows are hidden; Ctrl+S only reports "cannot save yet".

Files: `src/core/geometry-editor.js` (pure document ops + history, tested in
`test/geometry-editor.test.js`), `src/components/GeometryWorkspace.svelte`
(public, wraps `SvelteFlowProvider`) -> `GeometryWorkspaceInner.svelte`,
`GeometryNode.svelte` (one component for all node types), `GeometryAddMenu.svelte`,
`GeometryField.svelte` (numeric draft input). Dependency: `@xyflow/svelte` 1.6.6.

Component API: `<GeometryWorkspace document documentKey active theme preferences
showLineNumbers onchange />`. `document` is a plain .gcn object, never mutated and
read only when `documentKey` changes (new key = load, reset history/selection;
same key = the echo of our own `onchange` is ignored). `onchange(next)` receives a
fresh plain .gcn document (no selection/measured/DOM fields) after every edit and
after pan/zoom (viewport). `active=false` hides it and disables shortcuts. App
keeps the document (key `"scratch"`) and computes "changed" with `sameContent`.

Shortcuts (only when focus is not in an input/textarea/select/CodeMirror):
Shift+A add-node menu (canvas focus; at the pointer, else canvas center; Add Node
button uses the center), Shift+D duplicate selection (canvas focus), Delete/Backspace delete selection (canvas focus),
Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl+Y redo. Menu: search, Up/Down, Enter, Esc.

Undo/Redo: snapshots of plain .gcn content, 100 transactions. One transaction =
add/delete, wire add/delete, one drag (group), one field focus-to-blur edit,
one variable edit, target change, an operator change with its removed wires.
No-ops, selection, menus, pan/zoom/Fit View make no entry; Undo/Redo keep the
current viewport. Wires are added only after `checkConnection` (same-kind
output->input, cardinality, no exec/value cycle, no known type mismatch); missing
inputs never block a wire. Wires to ports that disappear (And -> Not) are removed
in the same transaction; type mismatches from retyping are kept and reported.

Code preview uses `generateGeometryCode`; with errors or an invalid input draft
the preview is cleared and Copy Code is disabled. `CodeEditor` got `readOnly`.

Close/reload guard: a prevented `beforeunload` is followed by a confirm (browsers
suppress `confirm()` inside `beforeunload`). Cancel keeps the page and data. There is
no IPC to tell reload from close, so a reload key (F5/Ctrl+R) pressed just before means
reload; anything else (Alt+F4, taskbar, the X button) means close. The app has no
reload command or menu, so a reload started outside the page (DevTools/CDP) is treated
as a close; a reliable fix needs a `will-prevent-unload` handler in `electron/main.js`.

Stage 4 (next): Open/Save `.gcn` and Export `.py`/`.gd`. Run is not part of stage 4.
It needs: `document`/`documentKey` from a real file, `onchange` marking that file
dirty, `parse/serializeGeometryDocument`, a save prompt replacing the discard prompt,
a Code-tab route for `.gcn`, and Export via `generateGeometryCode`.

### Test status
Automated: `npm test` (see the last run in the delivery report). New editor tests cover
iterative Math-chain inference (6,000 nodes in reverse order, cycles, codegen refusal),
and Undo/live-edit/revert history for drags and typing.
Checked by hand in real Electron (dev build and installed exe) through the debug
port, screenshots in `docs/geometry-stage3-shots/`: Shift+A/menu/placement after
pan+zoom, typing guards, drafts, 5/2 -> Print and For 0..4 in both languages,
wire/node delete + Undo/Redo, drag and multi-node drag undo, rejected wires, variables,
And -> Not + Undo, mode switching, Ctrl+S, read-only preview, Copy Code (clipboard read
back; Windows stores CRLF), library deletion disabled (`deleteKey={[]}`), Fit View moves
only the viewport, close/reload Cancel/Accept, four themes at a real 1000x680 window.
Not verified: real GDScript run (no Godot).
