#!/usr/bin/env python3
import ast
import json
import math
import sys
import io
import tokenize

if hasattr(sys.stdin, 'reconfigure'):
    try:
        sys.stdin.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
if hasattr(sys.stderr, 'reconfigure'):
    try:
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

def serialize_expr(node, source):
    if node is None:
        return None
    segment = ast.get_source_segment(source, node) or ""
    t = type(node).__name__

    if isinstance(node, ast.Constant):
        value = node.value
        # Keep JSON strictly portable. These values are represented by a Code
        # expression node in the converter, preserving the original source.
        unsupported = (
            isinstance(value, (bytes, complex)) or value is Ellipsis or
            (isinstance(value, float) and not math.isfinite(value)) or
            (isinstance(value, int) and not isinstance(value, bool) and abs(value) > 9007199254740991)
        )
        if unsupported:
            return {"type": "CodeExpression", "segment": segment, "lineno": getattr(node, 'lineno', 1)}
        return {
            "type": "Constant",
            "value": value,
            "value_type": (
                "int" if isinstance(value, int) and not isinstance(value, bool)
                else "float" if isinstance(value, float)
                else "string" if isinstance(value, str)
                else "bool" if isinstance(value, bool)
                else "other"
            ),
            "segment": segment,
            "lineno": getattr(node, 'lineno', 1)
        }
    if isinstance(node, ast.Name):
        return {
            "type": "Name",
            "id": node.id,
            "segment": segment,
            "lineno": getattr(node, 'lineno', 1)
        }
    if isinstance(node, ast.BinOp):
        op_map = {
            ast.Add: "+", ast.Sub: "-", ast.Mult: "*", ast.Div: "/",
            ast.FloorDiv: "//", ast.Mod: "%", ast.Pow: "**"
        }
        op_str = op_map.get(type(node.op))
        return {
            "type": "BinOp",
            "operator": op_str,
            "left": serialize_expr(node.left, source),
            "right": serialize_expr(node.right, source),
            "segment": segment,
            "lineno": getattr(node, 'lineno', 1)
        }
    if isinstance(node, ast.Compare):
        op_map = {
            ast.Eq: "==", ast.NotEq: "!=", ast.Lt: "<",
            ast.LtE: "<=", ast.Gt: ">", ast.GtE: ">="
        }
        ops = [op_map.get(type(op)) for op in node.ops]
        comparators = [serialize_expr(c, source) for c in node.comparators]
        return {
            "type": "Compare",
            "left": serialize_expr(node.left, source),
            "operators": ops,
            "comparators": comparators,
            "segment": segment,
            "lineno": getattr(node, 'lineno', 1)
        }
    if isinstance(node, ast.BoolOp):
        op_str = "and" if isinstance(node.op, ast.And) else "or"
        return {
            "type": "BoolOp",
            "operator": op_str,
            "values": [serialize_expr(v, source) for v in node.values],
            "segment": segment,
            "lineno": getattr(node, 'lineno', 1)
        }
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
        return {
            "type": "UnaryNot",
            "operand": serialize_expr(node.operand, source),
            "segment": segment,
            "lineno": getattr(node, 'lineno', 1)
        }
    if isinstance(node, ast.Attribute):
        return {
            "type": "Attribute",
            "value": serialize_expr(node.value, source),
            "attr": node.attr,
            "segment": segment,
            "lineno": getattr(node, 'lineno', 1)
        }
    if isinstance(node, ast.Call):
        func_expr = serialize_expr(node.func, source)
        args_expr = [serialize_expr(a, source) for a in node.args]
        keywords = []
        for keyword in node.keywords:
            keywords.append({
                "name": keyword.arg,
                "value": serialize_expr(keyword.value, source),
                "segment": ast.get_source_segment(source, keyword) or ""
            })
        return {
            "type": "Call",
            "func": func_expr,
            "args": args_expr,
            "keywords": keywords,
            "has_keywords": bool(keywords),
            "has_starred_args": any(isinstance(a, ast.Starred) for a in node.args),
            "segment": segment,
            "lineno": getattr(node, 'lineno', 1)
        }
    if isinstance(node, ast.JoinedStr):
        valid = True
        for v in node.values:
            if isinstance(v, ast.FormattedValue):
                if v.conversion != -1 or v.format_spec is not None:
                    valid = False
                    break
            elif not isinstance(v, ast.Constant):
                valid = False
                break
        if valid:
            parts = []
            for v in node.values:
                if isinstance(v, ast.Constant):
                    parts.append({"text": str(v.value)})
                elif isinstance(v, ast.FormattedValue):
                    parts.append({"expr": serialize_expr(v.value, source)})
            return {
                "type": "JoinedStr",
                "parts": parts,
                "segment": segment,
                "lineno": getattr(node, 'lineno', 1)
            }
        return {
            "type": "OtherExpr",
            "segment": segment,
            "lineno": getattr(node, 'lineno', 1)
        }

    return {
        "type": "OtherExpr",
        "segment": segment,
        "lineno": getattr(node, 'lineno', 1)
    }

def serialize_stmt(node, source):
    segment = ast.get_source_segment(source, node) or ""
    loc = {
        "startLine": getattr(node, 'lineno', 1),
        "startCol": getattr(node, 'col_offset', 0),
        "endLine": getattr(node, 'end_lineno', getattr(node, 'lineno', 1)),
        "endCol": getattr(node, 'end_col_offset', getattr(node, 'col_offset', 0) + len(segment))
    }

    if isinstance(node, ast.FunctionDef) or isinstance(node, getattr(ast, 'AsyncFunctionDef', ast.FunctionDef)):
        is_async = type(node).__name__ == 'AsyncFunctionDef'
        params = []
        for arg in node.args.args:
            ann = ast.get_source_segment(source, arg.annotation) if arg.annotation else "any"
            params.append({
                "name": arg.arg,
                "type": ann or "any",
                "default": None
            })
        # Default values (aligned from the right)
        defaults = [ast.get_source_segment(source, d) for d in node.args.defaults]
        for i, default_val in enumerate(reversed(defaults)):
            if i < len(params):
                params[-(i + 1)]["default"] = default_val

        decorators = [ast.get_source_segment(source, d) for d in node.decorator_list]
        if node.decorator_list:
            loc["startLine"] = min(getattr(d, 'lineno', loc["startLine"]) for d in node.decorator_list)
            loc["startCol"] = min(getattr(d, 'col_offset', loc["startCol"]) for d in node.decorator_list)
        ret_type = ast.get_source_segment(source, node.returns) if node.returns else "any"

        return {
            "kind": "FunctionDef",
            "name": node.name,
            "is_async": is_async,
            "params": params,
            "return_type": ret_type or "any",
            "decorators": [d for d in decorators if d],
            "body": [serialize_stmt(s, source) for s in node.body],
            "segment": segment,
            "loc": loc
        }

    if isinstance(node, ast.ClassDef):
        bases = [ast.get_source_segment(source, b) for b in node.bases]
        decorators = [ast.get_source_segment(source, d) for d in node.decorator_list]
        if node.decorator_list:
            loc["startLine"] = min(getattr(d, 'lineno', loc["startLine"]) for d in node.decorator_list)
            loc["startCol"] = min(getattr(d, 'col_offset', loc["startCol"]) for d in node.decorator_list)
        return {
            "kind": "ClassDef",
            "name": node.name,
            "base": bases[0] if bases else "",
            "decorators": [d for d in decorators if d],
            "body": [serialize_stmt(s, source) for s in node.body],
            "segment": segment,
            "loc": loc
        }

    if isinstance(node, ast.Import):
        names = [{"name": alias.name, "alias": alias.asname or ""} for alias in node.names]
        return {
            "kind": "Import",
            "import_type": "module",
            "module": names[0]["name"] if names else "",
            "names": names,
            "segment": segment,
            "loc": loc
        }

    if isinstance(node, ast.ImportFrom):
        names = [{"name": alias.name, "alias": alias.asname or ""} for alias in node.names]
        return {
            "kind": "ImportFrom",
            "import_type": "from",
            "module": node.module or "",
            "level": node.level,
            "names": names,
            "segment": segment,
            "loc": loc
        }

    if isinstance(node, ast.Assign):
        # target = value
        if len(node.targets) == 1:
            target_node = node.targets[0]
            if isinstance(target_node, ast.Name):
                return {
                    "kind": "AssignVar",
                    "name": target_node.id,
                    "value": serialize_expr(node.value, source),
                    "segment": segment,
                    "loc": loc
                }
            if isinstance(target_node, ast.Attribute):
                return {
                    "kind": "AssignMember",
                    "object": serialize_expr(target_node.value, source),
                    "member": target_node.attr,
                    "value": serialize_expr(node.value, source),
                    "segment": segment,
                    "loc": loc
                }
        return {
            "kind": "CodeNode",
            "codeKind": "statement",
            "code": segment,
            "segment": segment,
            "loc": loc
        }

    if isinstance(node, ast.Expr):
        # Call print(...) or function call
        if isinstance(node.value, ast.Call):
            func_name = ""
            if isinstance(node.value.func, ast.Name):
                func_name = node.value.func.id
            if (func_name == "print" and
                len(node.value.keywords) == 0 and
                0 <= len(node.value.args) <= 16 and
                not any(isinstance(a, ast.Starred) for a in node.value.args)):
                return {
                    "kind": "Print",
                    "values": [serialize_expr(a, source) for a in node.value.args],
                    "segment": segment,
                    "loc": loc
                }
            return {
                "kind": "CallStmt",
                "call": serialize_expr(node.value, source),
                "segment": segment,
                "loc": loc
            }
        return {
            "kind": "CodeNode",
            "codeKind": "statement",
            "code": segment,
            "segment": segment,
            "loc": loc
        }

    if isinstance(node, ast.If):
        # Check if this is the main guard: if __name__ == "__main__":
        is_main_guard = False
        if isinstance(node.test, ast.Compare) and len(node.test.ops) == 1 and isinstance(node.test.ops[0], ast.Eq):
            left = getattr(node.test.left, 'id', '')
            right = getattr(node.test.comparators[0], 'value', '') if hasattr(node.test.comparators[0], 'value') else ''
            if left == "__name__" and right == "__main__":
                is_main_guard = True

        return {
            "kind": "If",
            "is_main_guard": is_main_guard,
            "test": serialize_expr(node.test, source),
            "body": [serialize_stmt(s, source) for s in node.body],
            "orelse": [serialize_stmt(s, source) for s in node.orelse],
            "segment": segment,
            "loc": loc
        }

    if isinstance(node, ast.While):
        return {
            "kind": "While",
            "test": serialize_expr(node.test, source),
            "body": [serialize_stmt(s, source) for s in node.body],
            "segment": segment,
            "loc": loc
        }

    if isinstance(node, ast.For):
        # Check if range(...)
        is_range = False
        start_expr = None
        stop_expr = None
        step_expr = None
        if isinstance(node.iter, ast.Call) and getattr(node.iter.func, 'id', '') == 'range':
            is_range = True
            r_args = node.iter.args
            if len(r_args) == 1:
                start_expr = {"type": "Constant", "value": 0, "value_type": "int", "segment": "0", "lineno": node.lineno}
                stop_expr = serialize_expr(r_args[0], source)
                step_expr = {"type": "Constant", "value": 1, "value_type": "int", "segment": "1", "lineno": node.lineno}
            elif len(r_args) == 2:
                start_expr = serialize_expr(r_args[0], source)
                stop_expr = serialize_expr(r_args[1], source)
                step_expr = {"type": "Constant", "value": 1, "value_type": "int", "segment": "1", "lineno": node.lineno}
            elif len(r_args) == 3:
                start_expr = serialize_expr(r_args[0], source)
                stop_expr = serialize_expr(r_args[1], source)
                step_expr = serialize_expr(r_args[2], source)

        var_name = getattr(node.target, 'id', 'i') if isinstance(node.target, ast.Name) else 'i'

        if is_range:
            return {
                "kind": "ForRange",
                "variable": var_name,
                "start": start_expr,
                "stop": stop_expr,
                "step": step_expr,
                "body": [serialize_stmt(s, source) for s in node.body],
                "segment": segment,
                "loc": loc
            }

        return {
            "kind": "CodeNode",
            "codeKind": "block",
            "code": segment,
            "segment": segment,
            "loc": loc
        }

    if isinstance(node, ast.Return):
        return {
            "kind": "Return",
            "value": serialize_expr(node.value, source) if node.value else None,
            "segment": segment,
            "loc": loc
        }

    if isinstance(node, ast.Pass):
        return {
            "kind": "Pass",
            "segment": segment,
            "loc": loc
        }

    # Default fallback for any other statement
    return {
        "kind": "CodeNode",
        "codeKind": "statement",
        "code": segment,
        "segment": segment,
        "loc": loc
    }

def attach_comments(statements, source):
    lines = source.splitlines()
    full = {}
    inline = {}
    try:
        for tok in tokenize.generate_tokens(io.StringIO(source).readline):
            if tok.type != tokenize.COMMENT:
                continue
            line, col = tok.start
            text = tok.string[1:].strip()
            before = lines[line - 1][:col].strip() if 0 < line <= len(lines) else ''
            (full if not before else inline).setdefault(line, []).append(text)
    except (tokenize.TokenError, IndentationError):
        return

    def walk(items):
        for item in items:
            loc = item.get('loc') or {}
            start = loc.get('startLine')
            if not isinstance(start, int):
                continue
            attached = []
            line = start - 1
            while line in full:
                attached[0:0] = full[line]
                line -= 1
            attached.extend(inline.get(start, []))
            if attached and item.get('codeKind') not in ('statement', 'block'):
                item['comment'] = '\n'.join(attached)[:2000]
            for key in ('body', 'orelse'):
                if isinstance(item.get(key), list): walk(item[key])

    walk(statements)

def main():
    try:
        if hasattr(sys.stdin, 'buffer'):
            raw = sys.stdin.buffer.read()
            source = raw.decode('utf-8', errors='replace')
        else:
            source = sys.stdin.read()
    except Exception as e:
        print(json.dumps({"error": True, "message": f"Failed to read input: {e}"}))
        sys.exit(1)

    if any(0xD800 <= ord(c) <= 0xDFFF for c in source):
        source = source.encode('utf-8', errors='replace').decode('utf-8', errors='replace')

    try:
        tree = ast.parse(source)
    except SyntaxError as e:
        print(json.dumps({
            "error": True,
            "line": e.lineno,
            "col": e.offset,
            "message": f"SyntaxError at line {e.lineno}, col {e.offset}: {e.msg}"
        }))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({
            "error": True,
            "message": f"Parse error: {e}"
        }))
        sys.exit(1)

    statements = [serialize_stmt(s, source) for s in tree.body]
    attach_comments(statements, source)
    print(json.dumps({"error": False, "statements": statements}))

if __name__ == "__main__":
    main()
