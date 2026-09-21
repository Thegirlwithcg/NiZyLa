#!/usr/bin/env python3
import ast
import json
import sys

def serialize_expr(node, source):
    if node is None:
        return None
    segment = ast.get_source_segment(source, node) or ""
    t = type(node).__name__

    if isinstance(node, ast.Constant):
        return {
            "type": "Constant",
            "value": node.value,
            "value_type": (
                "int" if isinstance(node.value, int) and not isinstance(node.value, bool)
                else "float" if isinstance(node.value, float)
                else "string" if isinstance(node.value, str)
                else "bool" if isinstance(node.value, bool)
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
        return {
            "type": "Call",
            "func": func_expr,
            "args": args_expr,
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
            if func_name == "print" and len(node.value.args) == 1:
                return {
                    "kind": "Print",
                    "value": serialize_expr(node.value.args[0], source),
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

def main():
    try:
        source = sys.stdin.read()
    except Exception as e:
        print(json.dumps({"error": True, "message": f"Failed to read input: {e}"}))
        sys.exit(1)

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
    print(json.dumps({"error": False, "statements": statements}))

if __name__ == "__main__":
    main()
