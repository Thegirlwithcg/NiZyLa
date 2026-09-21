<script>
  import { getContext } from 'svelte';
  import { Handle, Position, useUpdateNodeInternals } from '@xyflow/svelte';
  import { nodeDefinitions } from '../core/geometry.js';
  import GeometryField from './GeometryField.svelte';

  let { id } = $props();
  const ctx = getContext('gcn');
  const updateNodeInternals = useUpdateNodeInternals();

  const view = $derived(ctx.view);
  const node = $derived(view.nodes.get(id));
  const definition = $derived(node ? nodeDefinitions[node.type] : null);
  const ports = $derived(view.ports.get(id) ?? []);
  const inputs = $derived(ports.filter((p) => p.direction === 'in'));
  const outputs = $derived(ports.filter((p) => p.direction === 'out'));
  const diagnostics = $derived(view.diagnostics.get(id) ?? []);
  const isVariableNode = $derived(node && ['getVariable', 'setVariable', 'forRange'].includes(node.type));
  const variableChoices = $derived(node?.type === 'forRange' ? view.variables.filter((v) => v.type === 'int' || v.id === node.data?.variableId) : view.variables);
  const variableKnown = $derived(isVariableNode && view.variables.some((v) => v.id === node.data?.variableId));
  const operatorLabels = { and: 'And', or: 'Or', not: 'Not' };

  const signature = $derived(ports.map((p) => `${p.id}:${p.direction}`).join('|'));
  $effect(() => {
    void signature;
    updateNodeInternals(id);
  });

  const typeLabel = (port) => port.kind === 'exec' ? 'exec' : port.valueType;
  const onValueType = (event) => ctx.setLiteralType(id, event.currentTarget.value);
  const onSelectData = (key) => (event) => ctx.setData(id, { [key]: event.currentTarget.value });
  const onInputData = (key) => (event) => ctx.setData(id, { [key]: event.currentTarget.value }, true);

  function ondblclick() {
    if (['functionDef', 'classDef'].includes(node?.type)) {
      ctx.enterScope(id);
    }
  }
</script>

{#if node && definition}
  <div class="gcn-node" class:has-error={diagnostics.some((d) => d.severity === 'error')} data-node-type={node.type} {ondblclick} role="presentation">
    <header class="gcn-node-head">
      <strong>{node.type === 'functionDef' ? `def ${node.data?.name || 'func'}` : node.type === 'classDef' ? `class ${node.data?.name || 'Class'}` : definition.label}</strong>
      <span class="gcn-category">{definition.category}</span>
    </header>

    <div class="gcn-node-form nodrag nopan nowheel">
      {#if node.type === 'literal'}
        <select aria-label="Value type" value={node.data?.valueType} onchange={onValueType}>
          {#each definition.valueTypes as type}<option value={type}>{type}</option>{/each}
        </select>
        {#if node.data?.valueType === 'int' || node.data?.valueType === 'float'}
          <GeometryField kind={node.data.valueType} value={node.data.value} fieldKey={`${id}:value`} label="Literal value"
            oncommit={(value) => ctx.setData(id, { value }, true)} onblur={ctx.endEdit} ondraft={ctx.setDraft} />
        {:else if node.data?.valueType === 'string'}
          <textarea aria-label="Literal text" rows="2" spellcheck="false" value={node.data.value}
            oninput={(event) => ctx.setData(id, { value: event.currentTarget.value }, true)} onblur={ctx.endEdit}></textarea>
        {:else}
          <label class="gcn-check"><input type="checkbox" checked={node.data?.value}
            onchange={(event) => ctx.setData(id, { value: event.currentTarget.checked })} /> {node.data?.value ? 'true' : 'false'}</label>
        {/if}

      {:else if isVariableNode}
        <select aria-label="Variable" value={node.data?.variableId} onchange={onSelectData('variableId')}>
          {#if !variableKnown}
            <option value={node.data?.variableId}>{node.data?.variableId ? 'Missing variable' : 'Select variable…'}</option>
          {/if}
          {#each variableChoices as variable (variable.id)}
            <option value={variable.id}>{variable.name || '(unnamed)'} : {variable.type}</option>
          {/each}
        </select>

      {:else if node.type === 'functionDef'}
        <div class="gcn-subgraph-card">
          <input aria-label="Function name" value={node.data?.name || ''} placeholder="function_name"
            oninput={onInputData('name')} onblur={ctx.endEdit} spellcheck="false" />
          <div class="gcn-subgraph-info">
            <span>{(node.data?.parameters || []).length} params</span>
            <button type="button" class="gcn-enter-btn" onclick={() => ctx.enterScope(id)} title="Enter graph (Enter / Double click)">
              เข้าไปแก้ไข ⏎
            </button>
          </div>
        </div>

      {:else if node.type === 'classDef'}
        <div class="gcn-subgraph-card">
          <input aria-label="Class name" value={node.data?.name || ''} placeholder="ClassName"
            oninput={onInputData('name')} onblur={ctx.endEdit} spellcheck="false" />
          <input aria-label="Base class" value={node.data?.baseClass || ''} placeholder="BaseClass (optional)"
            oninput={onInputData('baseClass')} onblur={ctx.endEdit} spellcheck="false" />
          <div class="gcn-subgraph-info">
            <button type="button" class="gcn-enter-btn" onclick={() => ctx.enterScope(id)} title="Enter graph (Enter / Double click)">
              เข้าไปแก้ไข ⏎
            </button>
          </div>
        </div>

      {:else if node.type === 'functionCall'}
        <input aria-label="Function or method name" value={node.data?.name || ''} placeholder="func_name"
          oninput={onInputData('name')} onblur={ctx.endEdit} spellcheck="false" />

      {:else if node.type === 'instantiate'}
        <input aria-label="Class name" value={node.data?.className || ''} placeholder="ClassName"
          oninput={onInputData('className')} onblur={ctx.endEdit} spellcheck="false" />

      {:else if node.type === 'parameter'}
        <span class="gcn-param-badge">{node.data?.name || 'param'} : {node.data?.paramType || 'any'}</span>

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
        <select aria-label="Code kind" value={node.data?.codeKind || 'statement'} onchange={onSelectData('codeKind')}>
          <option value="statement">Statement</option>
          <option value="expression">Expression</option>
          <option value="block">Block</option>
        </select>
        <textarea aria-label="Code" rows="3" spellcheck="false" value={node.data?.code || ''}
          oninput={onInputData('code')} onblur={ctx.endEdit}></textarea>

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
            <span class="gcn-port-name">{port.id}</span><span class="gcn-port-type">{typeLabel(port)}</span>
          </div>
        {/each}
      </div>
      <div class="gcn-ports-out">
        {#each outputs as port (port.id)}
          <div class="gcn-port out" data-port={port.id}>
            <span class="gcn-port-type">{typeLabel(port)}</span><span class="gcn-port-name">{port.id}</span>
            <Handle type="source" position={Position.Right} id={port.id} class={`gcn-handle ${port.kind}`} />
          </div>
        {/each}
      </div>
    </div>

    {#if diagnostics.length}
      <ul class="gcn-node-diag" aria-label="Node problems">
        {#each diagnostics as item}
          <li class={item.severity}><b>{item.severity === 'error' ? 'Error' : 'Warning'}:</b> {ctx.describe(item)}</li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}
