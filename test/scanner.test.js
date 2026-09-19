import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanProject } from '../electron/scanner.js';

test('scans Python files and detects Class (blue), Function (green), and Global Variable (red) relationships', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nizyla-py-test-'));
  try {
    const fileA = path.join(temp, 'engine.py');
    const fileB = path.join(temp, 'main.py');

    await fs.writeFile(
      fileA,
      `GLOBAL_SPEED = 100\n\nclass PhysicsEngine:\n    pass\n\ndef compute_velocity():\n    return 42\n`
    );

    await fs.writeFile(
      fileB,
      `from engine import PhysicsEngine, compute_velocity, GLOBAL_SPEED\n\nengine = PhysicsEngine()\nspeed = compute_velocity()\nprint(GLOBAL_SPEED)\n`
    );

    const result = await scanProject(temp);
    const edges = result.graph.edges;

    const classEdge = edges.find((e) => e.type === 'class');
    assert.ok(classEdge, 'Should create class edge for PhysicsEngine');
    assert.match(classEdge.label, /PhysicsEngine/);

    const funcEdge = edges.find((e) => e.type === 'function');
    assert.ok(funcEdge, 'Should create function edge for compute_velocity');
    assert.match(funcEdge.label, /compute_velocity/);

    const varEdge = edges.find((e) => e.type === 'variable');
    assert.ok(varEdge, 'Should create variable edge for GLOBAL_SPEED');
    assert.match(varEdge.label, /GLOBAL_SPEED/);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('scans GDScript files and detects class_name, func, and global var relationships', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nizyla-gd-test-'));
  try {
    const fileA = path.join(temp, 'player.gd');
    const fileB = path.join(temp, 'enemy.gd');

    await fs.writeFile(
      fileA,
      `class_name Player\n\nconst MAX_HEALTH = 100\n\nfunc take_damage(amount):\n    pass\n`
    );

    await fs.writeFile(
      fileB,
      `extends Node\n\nfunc _process(delta):\n    var p = Player.new()\n    p.take_damage(10)\n    if p.health > MAX_HEALTH:\n        pass\n`
    );

    const result = await scanProject(temp);
    const edges = result.graph.edges;

    const classEdge = edges.find((e) => e.type === 'class');
    assert.ok(classEdge, 'Should detect Player class relationship in GDScript');

    const funcEdge = edges.find((e) => e.type === 'function');
    assert.ok(funcEdge, 'Should detect take_damage function call in GDScript');

    const varEdge = edges.find((e) => e.type === 'variable');
    assert.ok(varEdge, 'Should detect MAX_HEALTH global const relationship in GDScript');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('scans C++ files and detects class, function, and extern/macro variable relationships', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nizyla-cpp-test-'));
  try {
    const fileH = path.join(temp, 'math_utils.h');
    const fileCpp = path.join(temp, 'main.cpp');

    await fs.writeFile(
      fileH,
      `#pragma once\n\nclass Vector3 {\npublic:\n    float x, y, z;\n};\n\nvoid Normalize(Vector3& v);\n\nextern int GLOBAL_RENDER_SCALE;\n`
    );

    await fs.writeFile(
      fileCpp,
      `#include "math_utils.h"\n\nint main() {\n    Vector3 vec;\n    Normalize(vec);\n    GLOBAL_RENDER_SCALE = 2;\n    return 0;\n}\n`
    );

    const result = await scanProject(temp);
    const edges = result.graph.edges;

    const classEdge = edges.find((e) => e.type === 'class');
    assert.ok(classEdge, 'Should detect Vector3 class relationship in C++');

    const funcEdge = edges.find((e) => e.type === 'function');
    assert.ok(funcEdge, 'Should detect Normalize function call in C++');

    const varEdge = edges.find((e) => e.type === 'variable');
    assert.ok(varEdge, 'Should detect GLOBAL_RENDER_SCALE variable in C++');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('scans C# files and detects class, method, and static variable relationships', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nizyla-cs-test-'));
  try {
    const fileA = path.join(temp, 'GameConfig.cs');
    const fileB = path.join(temp, 'PlayerController.cs');

    await fs.writeFile(
      fileA,
      `namespace Game\n{\n    public class GameConfig\n    {\n        public static int MaxPlayers = 8;\n        public static void Initialize()\n        {\n        }\n    }\n}\n`
    );

    await fs.writeFile(
      fileB,
      `namespace Game\n{\n    public class PlayerController\n    {\n        public void Setup()\n        {\n            var cfg = new GameConfig();\n            GameConfig.Initialize();\n            int limit = GameConfig.MaxPlayers;\n        }\n    }\n}\n`
    );

    const result = await scanProject(temp);
    const edges = result.graph.edges;

    const classEdge = edges.find((e) => e.type === 'class');
    assert.ok(classEdge, 'Should detect GameConfig class relationship in C#');

    const funcEdge = edges.find((e) => e.type === 'function');
    assert.ok(funcEdge, 'Should detect Initialize function call in C#');

    const varEdge = edges.find((e) => e.type === 'variable');
    assert.ok(varEdge, 'Should detect MaxPlayers static variable in C#');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('detects shared global variables between multiple files and connects them', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nizyla-shared-var-'));
  try {
    const fileA = path.join(temp, 'config.py');
    const fileB = path.join(temp, 'player.py');
    const fileC = path.join(temp, 'score.py');

    await fs.writeFile(fileA, 'GLOBAL_STATE = {"running": True}\n');
    await fs.writeFile(fileB, 'import config\ndef update_player():\n    if GLOBAL_STATE["running"]:\n        pass\n');
    await fs.writeFile(fileC, 'import config\ndef add_score():\n    if GLOBAL_STATE["running"]:\n        pass\n');

    const result = await scanProject(temp);
    const varEdges = result.graph.edges.filter((e) => e.type === 'variable');
    assert.ok(varEdges.length >= 2, 'Should create variable relationships between files using GLOBAL_STATE');
    for (const edge of varEdges) {
      assert.match(edge.label, /GLOBAL_STATE/);
    }
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('sets imported Class names on import edges when files are imported', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nizyla-import-lbl-'));
  try {
    const fileA = path.join(temp, 'WeaponStage3D.gd');
    const fileB = path.join(temp, 'WeaponSelectUI.gd');

    await fs.writeFile(fileA, 'class_name WeaponStage3D\nextends Node3D\n');
    await fs.writeFile(fileB, 'extends Control\nconst Stage = preload("res://WeaponStage3D.gd")\n');

    const result = await scanProject(temp);
    const edge = result.graph.edges.find((e) => e.type === 'imports' || e.type === 'class');
    assert.ok(edge, 'Should create edge between WeaponSelectUI and WeaponStage3D');
    assert.match(edge.label, /WeaponStage3D/, 'Edge should display imported class name WeaponStage3D');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});


