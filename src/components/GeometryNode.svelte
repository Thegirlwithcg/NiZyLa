<script>
  import { getContext } from 'svelte';
  import { Handle, Position, useUpdateNodeInternals } from '@xyflow/svelte';
  import { nodeDefinitions, VARIABLE_NODE_TYPES } from '../core/geometry.js';
  import GeometryField from './GeometryField.svelte';
  import GeometryVariableFields from './GeometryVariableFields.svelte';
  import CodeEditor from './CodeEditor.svelte';

  let { id, selected = false } = $props();
  const ctx = getContext('gcn');
  const updateNodeInternals = useUpdateNodeInternals();

  const view = $derived(ctx.view);
  const node = $derived(view.nodes.get(id));
  const definition = $derived(node ? nodeDefinitions[node.type] : null);
  const ports = $derived(view.ports.get(id) ?? []);
  const inputs = $derived(ports.filter((p) => p.direction === 'in'));
  const outputs = $derived(ports.filter((p) => p.direction === 'out'));
  const diagnostics = $derived(view.diagnostics.get(id) ?? []);
  const isVarNode = $derived(node?.type === 'getVariable');
  const isVariableNode = $derived(node && VARIABLE_NODE_TYPES.includes(node.type));
  const otherVarNode = $derived(isVariableNode && !isVarNode);
  const variableChoices = $derived(node?.type === 'forRange' ? view.variables.filter((v) => v.type === 'int' || v.id === node.data?.variableId) : view.variables);
  const variableKnown = $derived(isVariableNode && view.variables.some((v) => v.id === node.data?.variableId));
  const currentVariable = $derived(view.variables.find((v) => v.id === node.data?.variableId));
  const isOuter = (v) => view.localVariableIds && !view.localVariableIds.has(v.id);
  const varDiagnostics = $derived(isVarNode && node.data?.variableId ? (view.variableDiagnostics?.get(node.data.variableId) ?? []) : []);
  const allDiagnostics = $derived([...diagnostics, ...varDiagnostics]);
  const hasError = $derived(allDiagnostics.some((d) => d.severity === 'error'));
  const operatorLabels = { and: 'And', or: 'Or', not: 'Not' };
  const commentText = $derived(typeof node?.data?.comment === 'string' ? node.data.comment : '');

  const PARAM_TYPES = ['any', 'int', 'float', 'string', 'bool', 'list', 'dict'];
  function getTypeOptions(current) {
    if (current && !PARAM_TYPES.includes(current)) {
      return [current, ...PARAM_TYPES];
    }
    return PARAM_TYPES;
  }

  const signature = $derived(ports.map((p) => `${p.id}:${p.direction}`).join('|'));
  $effect(() => {
    void signature;
    updateNodeInternals(id);
  });

  const typeLabel = (port) => port.kind === 'exec' ? 'exec' : port.valueType;
  const onValueType = (event) => ctx.setLiteralType(id, event.currentTarget.value);
  const onSelectData = (key) => (event) => ctx.setData(id, { [key]: event.currentTarget.value });
  const onInputData = (key) => (event) => ctx.setData(id, { [key]: event.currentTarget.value }, true);

  function ondblclick(event) {
    if (event.target?.closest?.('input, textarea, select, button, .cm-editor')) return;
    if (['functionDef', 'classDef'].includes(node?.type)) {
      ctx.enterScope(id);
    }
  }
</script>

{#if node && definition}
  <div class="gcn-node" class:has-error={hasError} data-node-type={node.type} data-id={id} {ondblclick} role="presentation">
    <header class="gcn-node-head" title={commentText || undefined}>
      <div class="gcn-node-head-main">
        <strong>{node.type === 'functionDef' ? `def ${node.data?.name || 'func'}` : node.type === 'classDef' ? `class ${node.data?.name || 'Class'}` : node.type === 'codeNode' ? `</> ${node.data?.title || 'Code'}` : definition.label}</strong>
        {#if commentText}<span class="gcn-comment-badge" aria-label="Has comment">#</span>{/if}
        <span class="gcn-category">{definition.category}</span>
      </div>
      <button type="button" class="gcn-node-help-btn nodrag" aria-label={`Help for ${definition.label}`} onclick={(e) => { e.stopPropagation(); ctx.showHelp(id); }}>?</button>
    </header>

    <div class="gcn-node-form nodrag nopan nowheel">
      {#if node.type === 'start'}
        {#if ctx.isRoot && ctx.target === 'python'}
          <label class="gcn-check"><input type="checkbox" checked={node.data?.mainGuard === true}
            onchange={(event) => ctx.setData(id, { mainGuard: event.currentTarget.checked })} /> if __name__ == "__main__"</label>
        {/if}

      {:else if node.type === 'literal'}
        <select aria-label="Value type" value={node.data?.valueType} onchange={onValueType}>
          {#each definition.valueTypes as type}<option value={type}>{type}</option>{/each}
        </select>
        {#if node.data?.valueType === 'int' || node.data?.valueType === 'float'}
          <GeometryField kind={node.data.valueType} value={node.data.value} fieldKey={`${id}:value`} label="Literal value"
            oncommit={(value) => ctx.setData(id, { value }, true)} onblur={ctx.endEdit} ondraft={ctx.setDraft} />
        {:else if node.data?.valueType === 'string'}
          {@const strVal = typeof node.data.value === 'string' ? node.data.value : String(node.data.value ?? '')}
          <textarea aria-label="Literal text" rows="2" spellcheck="false" value={strVal}
            oninput={(event) => ctx.setData(id, { value: event.currentTarget.value }, true)} onblur={ctx.endEdit}></textarea>
          <label class="gcn-check">
            <input type="checkbox" aria-label="New line at end" checked={strVal.endsWith('\n')}
              onchange={(e) => {
                const next = e.currentTarget.checked ? strVal + '\n' : (strVal.endsWith('\n') ? strVal.slice(0, -1) : strVal);
                ctx.setData(id, { value: next }, false);
              }} /> ↵ New line
          </label>
        {:else}
          <label class="gcn-check"><input type="checkbox" checked={node.data?.value}
            onchange={(event) => ctx.setData(id, { value: event.currentTarget.checked })} /> {node.data?.value ? 'true' : 'false'}</label>
        {/if}

      {:else if isVarNode}
        {#if currentVariable}
          <GeometryVariableFields
            variable={currentVariable}
            onupdate={(patch, live) => ctx.updateVariable(currentVariable.id, patch, live)}
            onendedit={ctx.endEdit}
            ondraft={ctx.setDraft}
          />
        {/if}
        {#if selected || !currentVariable || isOuter(currentVariable)}
          <select aria-label="Variable" value={node.data?.variableId} onchange={onSelectData('variableId')}>
            {#if !currentVariable}
              <option value={node.data?.variableId}>{node.data?.variableId ? 'Missing variable' : 'Select variable…'}</option>
            {/if}
            {#each view.variables as variable (variable.id)}
              <option value={variable.id}>{variable.name || '(unnamed)'} : {variable.type}{isOuter(variable) ? ' (outer)' : ''}</option>
            {/each}
          </select>
        {/if}

      {:else if otherVarNode}
        <select aria-label="Variable" value={node.data?.variableId} onchange={onSelectData('variableId')}>
          {#if !variableKnown}
            <option value={node.data?.variableId}>{node.data?.variableId ? 'Missing variable' : 'Select variable…'}</option>
          {/if}
          {#each variableChoices as variable (variable.id)}
            <option value={variable.id}>{variable.name || '(unnamed)'} : {variable.type}{isOuter(variable) ? ' (outer)' : ''}</option>
          {/each}
        </select>

      {:else if node.type === 'input'}
        <input aria-label="Prompt (optional)" value={node.data?.prompt || ''} placeholder="Prompt (optional)"
          oninput={onInputData('prompt')} onblur={ctx.endEdit} spellcheck="false" />

      {:else if node.type === 'convert'}
        <select aria-label="Convert to type" value={node.data?.toType || 'int'} onchange={onSelectData('toType')}>
          <option value="int">int</option>
          <option value="float">float</option>
          <option value="string">string</option>
        </select>

      {:else if node.type === 'functionDef'}
        <div class="gcn-subgraph-card">
          <input aria-label="Function name" value={node.data?.name || ''} placeholder="function_name"
            oninput={onInputData('name')} onblur={ctx.endEdit} spellcheck="false" />
          
          {#each (node.data?.parameters || []) as p (p.id)}
            <div class="gcn-param-row">
              <input aria-label="Parameter name" value={p.name} placeholder="param_name" spellcheck="false"
                oninput={(e) => ctx.updateParam(id, ctx.scopePathIds, p.id, { name: e.currentTarget.value }, true)}
                onblur={ctx.endEdit} />
              <select aria-label="Parameter type" value={p.type || 'any'}
                onchange={(e) => ctx.updateParam(id, ctx.scopePathIds, p.id, { type: e.currentTarget.value })}>
                {#each getTypeOptions(p.type || 'any') as t}
                  <option value={t}>{t}</option>
                {/each}
              </select>
              <button type="button" aria-label={`Remove parameter ${p.name}`}
                onclick={() => ctx.removeParam(id, ctx.scopePathIds, p.id)}>×</button>
            </div>
          {/each}

          <button type="button" onclick={() => ctx.addParam(id, ctx.scopePathIds)}>+ Param</button>

          <div class="gcn-returns-row">
            <span>returns</span>
            <select aria-label="Return type" value={node.data?.returnType || 'any'}
              onchange={(e) => ctx.setData(id, { returnType: e.currentTarget.value })}>
              {#each getTypeOptions(node.data?.returnType || 'any') as t}
                <option value={t}>{t}</option>
              {/each}
            </select>
          </div>

          <button type="button" class="gcn-enter-btn" onclick={() => ctx.enterScope(id)} title="Open function body" aria-label="Open Subgraph">
            Open Subgraph ⏎
          </button>
        </div>

      {:else if node.type === 'classDef'}
        <div class="gcn-subgraph-card">
          <input aria-label="Class name" value={node.data?.name || ''} placeholder="ClassName"
            oninput={onInputData('name')} onblur={ctx.endEdit} spellcheck="false" />
          <input aria-label="Base class" value={node.data?.baseClass || ''} placeholder="BaseClass (optional)"
            oninput={onInputData('baseClass')} onblur={ctx.endEdit} spellcheck="false" />
          <div class="gcn-subgraph-info">
            <button type="button" class="gcn-enter-btn" onclick={() => ctx.enterScope(id)} title="Open class body" aria-label="Open Subgraph">
              Open Subgraph ⏎
            </button>
          </div>
        </div>

      {:else if node.type === 'functionCall'}
        {@const funcs = ctx.availableFunctions || []}
        {@const matchedFn = funcs.find((f) => f.id === node.data?.targetId || (!node.data?.targetId && f.data?.name && f.data.name === node.data?.name))}
        {#if funcs.length > 0 && !node.data?.isCustom}
          <select aria-label="Function name" value={matchedFn?.id || ''} onchange={(e) => {
            const val = e.currentTarget.value;
            if (val === '__custom__') {
              ctx.setData(id, { isCustom: true });
            } else {
              const target = funcs.find((f) => f.id === val);
              if (target) {
                ctx.setData(id, {
                  targetId: target.id,
                  name: target.data?.name || 'call',
                  argumentNames: (target.data?.parameters || []).map((p) => p.name || 'arg'),
                  isCustom: false
                });
              }
            }
          }}>
            {#if !matchedFn}
              <option value="">{node.data?.name ? `Custom: ${node.data.name}` : 'Select function…'}</option>
            {/if}
            {#each funcs as fn (fn.id)}
              {@const pNames = (fn.data?.parameters || []).map((p) => p.name || 'arg').join(', ')}
              <option value={fn.id}>{fn.data?.name || 'func'}({pNames})</option>
            {/each}
            <option value="__custom__">Custom / built-in name…</option>
          </select>
        {:else}
          <div style="display: flex; gap: 4px; align-items: center;">
            <input aria-label="Function or method name" value={node.data?.name || ''} placeholder="func_name"
              oninput={onInputData('name')} onblur={ctx.endEdit} spellcheck="false" />
            {#if funcs.length > 0}
              <button type="button" class="gcn-counter-btn" title="Pick from defined functions" onclick={() => ctx.setData(id, { isCustom: false })}>▾</button>
            {/if}
          </div>
        {/if}

      {:else if node.type === 'instantiate'}
        <input aria-label="Class name" value={node.data?.className || ''} placeholder="ClassName"
          oninput={onInputData('className')} onblur={ctx.endEdit} spellcheck="false" />

      {:else if node.type === 'parameter'}
        {@const paramChoices = ctx.parameters || []}
        {@const paramKnown = paramChoices.some((p) => p.id === node.data?.parameterId)}
        {#if paramChoices.length > 0}
          <select aria-label="Parameter" value={node.data?.parameterId} onchange={(e) => {
            const selected = paramChoices.find((p) => p.id === e.currentTarget.value);
            if (selected) {
              ctx.setData(id, { parameterId: selected.id, name: selected.name, paramType: selected.type || 'any' });
            }
          }}>
            {#if !paramKnown}
              <option value={node.data?.parameterId || ''}>{node.data?.name ? (node.data.parameterId ? 'Missing parameter' : `Select (${node.data.name})…`) : 'Select parameter…'}</option>
            {/if}
            {#each paramChoices as p (p.id)}
              <option value={p.id}>{p.name || '(unnamed)'} : {p.type || 'any'}</option>
            {/each}
          </select>
        {:else}
          <span class="gcn-param-badge">{node.data?.name || 'param'} : {node.data?.paramType || 'any'}</span>
        {/if}

      {:else if node.type === 'import'}
        <select aria-label="Import type" value={node.data?.importType || 'module'} onchange={onSelectData('importType')}>
          <option value="module">import module</option>
          <option value="from">from ... import ...</option>
          <option value="gd_extends">extends (GDScript)</option>
          <option value="gd_class_name">class_name (GDScript)</option>
          <option value="gd_preload">preload (GDScript)</option>
          <option value="gd_load">load (GDScript)</option>
        </select>
        <input aria-label="Module name or path" value={node.data?.module || ''} placeholder="module or res://"
          oninput={onInputData('module')} onblur={ctx.endEdit} spellcheck="false" />

      {:else if node.type === 'symbolRef'}
        <input aria-label="Symbol name" value={node.data?.symbol || ''} placeholder="symbol_name"
          oninput={onInputData('symbol')} onblur={ctx.endEdit} spellcheck="false" />

      {:else if node.type === 'getMember' || node.type === 'setMember'}
        <input aria-label="Member name" value={node.data?.memberName || ''} placeholder="member_name"
          oninput={onInputData('memberName')} onblur={ctx.endEdit} spellcheck="false" />

      {:else if node.type === 'codeNode'}
        {@const ext = ctx.target === 'gdscript' ? 'gd' : 'py'}
        <input aria-label="Code name" value={node.data?.title || ''} placeholder="Code name (optional)"
          oninput={onInputData('title')} onblur={ctx.endEdit} spellcheck="false" />
        <select aria-label="Code kind" value={node.data?.codeKind || 'statement'} onchange={onSelectData('codeKind')}>
          <option value="statement">Statement</option>
          <option value="expression">Expression</option>
          <option value="block">Block</option>
        </select>
        <div class="gcn-code-tools">
          <button type="button" class="gcn-btn-lines" class:active={ctx.codeLineNumbers} aria-pressed={ctx.codeLineNumbers}
            onclick={ctx.toggleCodeLineNumbers} title="Toggle line numbers">#</button>
          <button type="button" class="gcn-btn-expand" onclick={() => ctx.openCode(id)} title="Expand code editor">⤢ Expand</button>
          <button type="button" class="gcn-btn-expand" onclick={() => ctx.convertCode(id)} title="Convert this Code node into Geometry nodes">⇄ To Nodes</button>
        </div>
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div class="gcn-code-host" onfocusout={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) ctx.endEdit(); }}>
          <CodeEditor
            file={{ name: `node.${ext}`, path: `gcn-code:${id}.${ext}` }}
            content={node.data?.code ?? ''}
            showLineNumbers={ctx.codeLineNumbers}
            theme={ctx.theme}
            preferences={ctx.preferences}
            onchange={(code) => ctx.setData(id, { code }, true)}
          />
        </div>

      {:else if node.type === 'print'}
        {@const count = node.data?.argCount ?? 1}
        <div class="gcn-counter nodrag">
          <button type="button" class="gcn-counter-btn" aria-label="Decrease arguments"
            disabled={count <= 0}
            onclick={() => ctx.setData(id, { argCount: Math.max(0, count - 1) })}>−</button>
          <span class="gcn-counter-val" aria-label="Argument count">{count}</span>
          <button type="button" class="gcn-counter-btn" aria-label="Increase arguments"
            disabled={count >= 16}
            onclick={() => ctx.setData(id, { argCount: Math.min(16, count + 1) })}>+</button>
        </div>

      {:else if node.type === 'formatText'}
        {@const tmpl = typeof node.data?.template === 'string' ? node.data.template : 'Value: {x}'}
        <select aria-label="Format style" value={node.data?.style ?? 'fstring'} onchange={onSelectData('style')}>
          <option value="fstring">f-string</option>
          <option value="format">.format()</option>
          <option value="concat">+ concat</option>
        </select>
        <textarea aria-label="Format template" rows="1" spellcheck="false" value={tmpl}
          onchange={(e) => ctx.setData(id, { template: e.currentTarget.value })}></textarea>
        <label class="gcn-check">
          <input type="checkbox" aria-label="New line at end" checked={tmpl.endsWith('\n')}
            onchange={(e) => {
              const next = e.currentTarget.checked ? tmpl + '\n' : (tmpl.endsWith('\n') ? tmpl.slice(0, -1) : tmpl);
              ctx.setData(id, { template: next }, false);
            }} /> ↵ New line
        </label>

      {:else if node.type === 'list'}
        {@const count = node.data?.itemCount ?? 0}
        <div class="gcn-counter nodrag">
          <button type="button" class="gcn-counter-btn" aria-label="Decrease items"
            disabled={count <= 0}
            onclick={() => ctx.setData(id, { itemCount: Math.max(0, count - 1) })}>−</button>
          <span class="gcn-counter-val" aria-label="Item count">{count}</span>
          <button type="button" class="gcn-counter-btn" aria-label="Increase items"
            disabled={count >= 64}
            onclick={() => ctx.setData(id, { itemCount: Math.min(64, count + 1) })}>+</button>
        </div>

      {:else if node.type === 'array'}
        {@const count = node.data?.itemCount ?? 0}
        <select aria-label="Element type" value={node.data?.elementType ?? 'int'} onchange={onSelectData('elementType')}>
          <option value="int">int</option>
          <option value="float">float</option>
          <option value="string">string</option>
          <option value="bool">bool</option>
        </select>
        <div class="gcn-counter nodrag">
          <button type="button" class="gcn-counter-btn" aria-label="Decrease items"
            disabled={count <= 0}
            onclick={() => ctx.setData(id, { itemCount: Math.max(0, count - 1) })}>−</button>
          <span class="gcn-counter-val" aria-label="Item count">{count}</span>
          <button type="button" class="gcn-counter-btn" aria-label="Increase items"
            disabled={count >= 64}
            onclick={() => ctx.setData(id, { itemCount: Math.min(64, count + 1) })}>+</button>
        </div>

      {:else if node.type === 'dict'}
        <div class="gcn-dict-entries nodrag">
          {#each (node.data?.entries || []) as entry (entry.id)}
            <div class="gcn-dict-row">
              <input aria-label="Entry key" value={entry.key} placeholder="key" spellcheck="false"
                onchange={(e) => {
                  const updated = (node.data?.entries || []).map((item) =>
                    item.id === entry.id ? { ...item, key: e.currentTarget.value } : item
                  );
                  ctx.setData(id, { entries: updated });
                }} />
              <button type="button" class="gcn-dict-remove" aria-label={`Remove key ${entry.key}`}
                onclick={() => {
                  const updated = (node.data?.entries || []).filter((item) => item.id !== entry.id);
                  ctx.setData(id, { entries: updated });
                }}>×</button>
            </div>
          {/each}
          <button type="button" class="gcn-dict-add" onclick={() => {
            const existingKeys = new Set((node.data?.entries || []).map((e) => e.key));
            let n = 0;
            while (existingKeys.has(`key_${n}`)) n++;
            const newId = 'k_' + crypto.randomUUID().slice(0, 8);
            const updated = [...(node.data?.entries || []), { id: newId, key: `key_${n}` }];
            ctx.setData(id, { entries: updated });
          }}>+ Key</button>
        </div>

      {:else if definition.operators}
        <select aria-label="Operator" value={node.data?.operator} onchange={onSelectData('operator')}>
          {#each definition.operators as operator}<option value={operator}>{operatorLabels[operator] ?? operator}</option>{/each}
        </select>
      {/if}
    </div>

    <div class="gcn-ports">
      <div class="gcn-ports-in">
        {#each inputs as port (port.id)}
          <div class="gcn-port in" data-port={port.id}>
            <Handle type="target" position={Position.Left} id={port.id} class={`gcn-handle ${port.kind}`} />
            <span class="gcn-port-name">{port.label ?? port.id}</span><span class="gcn-port-type">{typeLabel(port)}</span>
          </div>
        {/each}
      </div>
      <div class="gcn-ports-out">
        {#each outputs as port (port.id)}
          <div class="gcn-port out" data-port={port.id}>
            <span class="gcn-port-type">{typeLabel(port)}</span><span class="gcn-port-name">{port.label ?? port.id}</span>
            <Handle type="source" position={Position.Right} id={port.id} class={`gcn-handle ${port.kind}`} />
          </div>
        {/each}
      </div>
    </div>

    {#if allDiagnostics.length}
      <ul class="gcn-node-diag" aria-label="Node problems">
        {#each allDiagnostics as item}
          <li class={item.severity}><b>{item.severity === 'error' ? 'Error' : 'Warning'}:</b> {ctx.describe(item)}</li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}
