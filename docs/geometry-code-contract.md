# Geometry Code contract — .gcn v1

Stage 1 implements data and validation only in `src/core/geometry.js`.
No UI, file IPC, compiler or execution is implemented yet. Subsequent stages
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
  Iterative traversals avoid JavaScript recursion limits on long chains.
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

## Contract for the following compiler stage (not implemented)

- Python 3: `def main():` plus a `__main__` entry guard. Godot 4: `extends Node`
  and `func _ready():`. Four-space indentation; empty blocks emit `pass`.
- Initialize all declared variables at function entry. Emit Get expressions
  at their points of use, including reevaluating While conditions each iteration.
- For Range uses exclusive stop and supports negative steps. Generate a
  private `_gcn_` iterator, then assign it to the declared variable at body
  entry. Setting that variable in the body must not change the iteration sequence.
- Preserve type promotion, escape strings, parenthesize expressions and make
  division floating-point in both languages (`float(a) / b` in GDScript).
- Reject errors and omit unused nodes. Do not silently display old code as
  current after a validation failure. Runtime-only issues (dynamic zero step,
  division by zero, nontermination, overflow) are not statically proved here.
- No reverse conversion, arbitrary script evaluation or migrations in v1.

## Checks

Run `node --test test/geometry.test.js` and `npm test`. Tests cover schema vs
editable errors, round-trip and transient stripping, typed connections,
control nesting, cycles, variable references, immutable input and long chains.
Build the installer with `npm run dist:win` as required by AGENTS.md.

Keyword references: [Python lexical analysis](https://docs.python.org/3/reference/lexical_analysis.html#keywords)
and [GDScript reference](https://docs.godotengine.org/en/stable/tutorials/scripting/gdscript/gdscript_basics.html#keywords).
