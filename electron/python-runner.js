export function buildRunnerScript({ cwd, depsDir, snapshotFile, logicalFile }) {
  const pathLines = [`sys.path.insert(0, ${JSON.stringify(cwd)})`];
  if (depsDir) pathLines.push(`sys.path.insert(0, ${JSON.stringify(depsDir)})`);
  return `import sys
${pathLines.join('\n')}
sys.argv = [${JSON.stringify(logicalFile)}]
with open(${JSON.stringify(snapshotFile)}, "rb") as f:
    source_bytes = f.read()
code_obj = compile(source_bytes, ${JSON.stringify(logicalFile)}, "exec")
exec(code_obj, {"__name__": "__main__", "__file__": ${JSON.stringify(logicalFile)}, "__doc__": None})
`;
}
