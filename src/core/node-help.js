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
    summary: 'Performs arithmetic operations (+, -, *, /) on two numbers and outputs the result.',
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
  print: {
    summary: 'Outputs a value or expression to the console or standard output.',
    python: 'print("Hello, world!")',
    gdscript: 'print("Hello, world!")'
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
  }
};
