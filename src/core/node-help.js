export const nodeHelp = {
  start: {
    summary: 'Entry point of graph execution. Begins the sequential statement flow.',
    python: 'def main():\n    pass',
    gdscript: 'func _ready():\n    pass'
  },
  literal: {
    summary: 'Represents a constant value (integer, float, boolean, or string) and outputs it to other nodes.',
    python: 'x = 42\nprint(x)',
    gdscript: 'var x = 42\nprint(x)'
  },
  getVariable: {
    summary: 'Reads the current value of a defined variable. Connects to expression input ports.',
    python: 'x = 10\ny = (x + 1)',
    gdscript: 'var x: int = 10\nvar y = (x + 1)'
  },
  setVariable: {
    summary: 'Assigns a new value to an existing variable in the execution sequence.',
    python: 'total = 0\ntotal = (total + 5)',
    gdscript: 'var total: int = 0\ntotal = (total + 5)'
  },
  binary: {
    summary: 'Performs arithmetic operations (+, -, *, /, %, //, **) on two numbers and outputs the result.',
    python: 'result = (10 + 20)',
    gdscript: 'var result = (10 + 20)'
  },
  compare: {
    summary: 'Compares two values using relational operators (==, !=, <, <=, >, >=) and outputs a boolean.',
    python: 'is_valid = (score >= 50)',
    gdscript: 'var is_valid = (score >= 50)'
  },
  boolean: {
    summary: 'Performs logical boolean operations (and, or, not) to combine or invert conditions.',
    python: 'can_proceed = (is_ready and (not has_error))',
    gdscript: 'var can_proceed = (is_ready and (not has_error))'
  },
  if: {
    summary: 'Branches execution flow based on a boolean condition into then and else paths.',
    python: 'if (x > 0):\n    print(x)\nelse:\n    print(0)',
    gdscript: 'if (x > 0):\n    print(x)\nelse:\n    print(0)'
  },
  while: {
    summary: 'Repeatedly executes a body of statements as long as its condition remains true.',
    python: 'while (count > 0):\n    count = (count - 1)',
    gdscript: 'while (count > 0):\n    count = (count - 1)'
  },
  forRange: {
    summary: 'Loops over an integer range from start to stop with a step, updating an iterator variable.',
    python: 'for i in range(0, 5, 1):\n    print(i)',
    gdscript: 'for i in range(0, 5, 1):\n    print(i)'
  },
  forEach: {
    summary: 'Iterates over elements of a collection or sequence, assigning each item to a variable.',
    python: 'items = [1, 2, 3]\nfor item in items:\n    print(item)',
    gdscript: 'var items = [1, 2, 3]\nfor item in items:\n    print(item)'
  },
  break: {
    summary: 'Terminates the nearest enclosing loop immediately.',
    python: 'while True:\n    break',
    gdscript: 'while true:\n    break'
  },
  continue: {
    summary: 'Skips the rest of the current loop iteration and moves to the next iteration.',
    python: 'for i in range(5):\n    continue',
    gdscript: 'for i in range(5):\n    continue'
  },
  print: {
    summary: 'Outputs a value or expression to the console or standard output.',
    python: 'print("Hello, world!")',
    gdscript: 'print("Hello, world!")'
  },
  input: {
    summary: 'Reads a line of text from standard input with an optional prompt. Note: GDScript Input reads the console, so the game must be run from a terminal.',
    python: 'name = input("Name: ")',
    gdscript: 'var name = _gcn_input("Name: ")'
  },
  functionDef: {
    summary: 'Defines a reusable function with parameters and return type. Contains a child graph for its body.',
    python: 'def calculate(x, y):\n    return (x + y)',
    gdscript: 'func calculate(x, y):\n    return (x + y)'
  },
  parameter: {
    summary: 'Accesses an input parameter within a function body subgraph.',
    python: 'def greet(name):\n    print(name)',
    gdscript: 'func greet(name):\n    print(name)'
  },
  return: {
    summary: 'Exits the enclosing function and optionally returns a result value to the caller.',
    python: 'return (x * 2)',
    gdscript: 'return (x * 2)'
  },
  classDef: {
    summary: 'Defines a class with optional inheritance. Encapsulates member variables and methods in an inner graph.',
    python: 'class Player:\n    name = "Hero"',
    gdscript: 'class Player:\n    var name: String = "Hero"'
  },
  functionCall: {
    summary: 'Invokes a function or method by name or target reference, passing input arguments.',
    python: 'result = calculate(10, 20)',
    gdscript: 'var result = calculate(10, 20)'
  },
  instantiate: {
    summary: 'Instantiates a class object using constructor arguments.',
    python: 'player = Player("Hero")',
    gdscript: 'var player = Player.new("Hero")'
  },
  import: {
    summary: 'Imports external modules or resources into the current module scope.',
    python: 'import math\nfrom sys import argv',
    gdscript: 'const Res = preload("res://scene.tscn")'
  },
  symbolRef: {
    summary: 'References a global symbol, module identifier, or built-in object by name.',
    python: 'pi = math.pi',
    gdscript: 'var pi = PI'
  },
  getMember: {
    summary: 'Reads a property or attribute value from an object instance.',
    python: 'hp = player.health',
    gdscript: 'var hp = player.health'
  },
  setMember: {
    summary: 'Sets a property or attribute value on an object instance in the execution chain.',
    python: 'player.health = 100',
    gdscript: 'player.health = 100'
  },
  codeNode: {
    summary: 'Executes or evaluates a custom snippet of raw target code directly inside the graph.',
    python: 'for key, val in data.items():\n    print(key, val)',
    gdscript: 'for key in data:\n    print(key, data[key])'
  },
  formatText: {
    summary: 'Builds formatted text using f-strings, format(), or concatenation. Note: GDScript .format() also replaces a literal {0} in the text.',
    python: 'name = "Erin"\nlevel = 3\nmsg = f"Player: {name}, Level: {level}"\nprint(msg)',
    gdscript: 'var name = "Erin"\nvar level = 3\nvar msg = "Player: {0}, Level: {1}".format([name, level])\nprint(msg)'
  },
  list: {
    summary: 'Constructs a mixed-type list collection from input elements.',
    python: 'items = [1, "two", 3.0]\nprint(items)',
    gdscript: 'var items = [1, "two", 3.0]\nprint(items)'
  },
  array: {
    summary: 'Constructs a typed array collection with elements converted or checked against the element type.',
    python: 'numbers = [1, 2, 3]\nprint(numbers)',
    gdscript: 'var numbers = [1, 2, 3]\nprint(numbers)'
  },
  dict: {
    summary: 'Constructs a dictionary / key-value map collection.',
    python: 'player = {"name": "Hero", "level": 1}\nprint(player)',
    gdscript: 'var player = {"name": "Hero", "level": 1}\nprint(player)'
  },
  getItem: {
    summary: 'Accesses an element in a collection or dictionary by index or key.',
    python: 'items = [10, 20, 30]\nval = items[0]\nprint(val)',
    gdscript: 'var items = [10, 20, 30]\nvar val = items[0]\nprint(val)'
  },
  setItem: {
    summary: 'Assigns an element into a collection or dictionary at a specific index or key.',
    python: 'items = [1, 2]\nitems[0] = 99\nprint(items)',
    gdscript: 'var items = [1, 2]\nitems[0] = 99\nprint(items)'
  },
  append: {
    summary: 'Appends a new value or item to the end of a list.',
    python: 'items = [1, 2]\nitems.append(3)\nprint(items)',
    gdscript: 'var items = [1, 2]\nitems.append(3)\nprint(items)'
  },
  length: {
    summary: 'Calculates the number of elements in a collection, sequence, or string.',
    python: 'items = [1, 2, 3]\ncount = len(items)\nprint(count)',
    gdscript: 'var items = [1, 2, 3]\nvar count = len(items)\nprint(count)'
  },
  contains: {
    summary: 'Checks whether an item exists in a collection, sequence, or container.',
    python: 'items = [1, 2, 3]\nhas_two = (2 in items)\nprint(has_two)',
    gdscript: 'var items = [1, 2, 3]\nvar has_two = (2 in items)\nprint(has_two)'
  },
  convert: {
    summary: 'Converts a value to int, float, or string. Note: GDScript int("3.7") returns 3, while Python raises ValueError.',
    python: 'x = int("42")\ny = float("3.14")\ns = str(100)',
    gdscript: 'var x = int("42")\nvar y = float("3.14")\nvar s = str(100)'
  }
};
