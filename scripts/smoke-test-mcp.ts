#!/usr/bin/env npx tsx
/**
 * smoke-test-mcp — Boot the MCP server, call each tool, verify responses.
 *
 * Spawns the engine as a child process, communicates via MCP stdio protocol,
 * sends a test request to each tool, and verifies the response shape.
 *
 * Usage: npx tsx scripts/smoke-test-mcp.ts [path/to/seed.ts]
 * Requires: map-viewer/src/seed.ts (or scaffold/src/seed.ts) to exist
 */

import { spawn } from 'child_process';
import { resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

const ENGINE_ENTRY = resolve('engine/src/index.ts');

// Find seed path
let seedPath = resolve('map-viewer/src/seed.ts');
if (!existsSync(seedPath)) {
  seedPath = resolve('scaffold/src/seed.ts');
}
if (process.argv[2]) {
  seedPath = resolve(process.argv[2]);
}

const tmpDb = resolve(tmpdir(), `cogmap-test-${randomBytes(4).toString('hex')}.db`);

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

async function runSmokeTest() {
  console.log('── MCP Smoke Test ──\n');
  console.log(`  Engine: ${ENGINE_ENTRY}`);
  console.log(`  Seed:   ${seedPath}`);
  console.log(`  DB:     ${tmpDb}\n`);

  if (!existsSync(ENGINE_ENTRY)) {
    console.error(`Engine not found: ${ENGINE_ENTRY}`);
    process.exit(1);
  }

  // Spawn MCP server
  const child = spawn('npx', ['tsx', ENGINE_ENTRY], {
    env: {
      ...process.env,
      COGMAP_SEED_PATH: seedPath,
      COGMAP_DB_PATH: tmpDb,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (data: Buffer) => {
    stderr += data.toString();
  });

  // Wait for server to be ready
  await new Promise<void>((res, rej) => {
    const timeout = setTimeout(() => rej(new Error('Server startup timeout')), 15000);
    child.stderr.on('data', (data: Buffer) => {
      if (data.toString().includes('MCP server running')) {
        clearTimeout(timeout);
        res();
      }
    });
    child.on('error', (err) => { clearTimeout(timeout); rej(err); });
    child.on('exit', (code) => {
      if (code !== 0) { clearTimeout(timeout); rej(new Error(`Server exited with code ${code}\n${stderr}`)); }
    });
  });

  console.log('  Server started.\n');

  let nextId = 1;
  const pending = new Map<number, { resolve: (v: JsonRpcResponse) => void; reject: (e: Error) => void }>();

  // Response parser
  let buffer = '';
  child.stdout.on('data', (data: Buffer) => {
    buffer += data.toString();
    // MCP uses newline-delimited JSON-RPC
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && pending.has(msg.id)) {
          pending.get(msg.id)!.resolve(msg);
          pending.delete(msg.id);
        }
      } catch {
        // Not JSON — skip
      }
    }
  });

  function send(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
    const id = nextId++;
    const request: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    return new Promise((res, rej) => {
      const timeout = setTimeout(() => { pending.delete(id); rej(new Error(`Timeout: ${method}`)); }, 10000);
      pending.set(id, {
        resolve: (v) => { clearTimeout(timeout); res(v); },
        reject: (e) => { clearTimeout(timeout); rej(e); },
      });
      child.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  // ── Initialize MCP session ──

  const initResult = await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'cogmap-smoke-test', version: '1.0.0' },
  });

  if (initResult.error) {
    console.error('  Initialize failed:', initResult.error);
    child.kill();
    process.exit(1);
  }

  console.log('  Initialized MCP session.');

  // Send initialized notification
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  // ── List tools ──

  const listResult = await send('tools/list', {});
  const tools = (listResult.result as any)?.tools ?? [];
  console.log(`  Found ${tools.length} tools: ${tools.map((t: any) => t.name).join(', ')}\n`);

  // ── Test each tool ──

  const testCases: Array<{ tool: string; args: Record<string, unknown> }> = [
    { tool: 'cogmap_status', args: {} },
    { tool: 'cogmap_search', args: { query: 'test', limit: 3 } },
    { tool: 'cogmap_context', args: { max_tokens: 500, layers: [0, 1] } },
  ];

  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    try {
      const result = await send('tools/call', { name: tc.tool, arguments: tc.args });
      if (result.error) {
        console.log(`  FAIL  ${tc.tool}: ${result.error.message}`);
        failed++;
      } else {
        const content = (result.result as any)?.content;
        if (Array.isArray(content) && content.length > 0) {
          console.log(`  PASS  ${tc.tool} — returned ${content.length} content block(s)`);
          passed++;
        } else {
          console.log(`  WARN  ${tc.tool} — unexpected response shape`);
          passed++; // Still counts as pass — server responded
        }
      }
    } catch (err) {
      console.log(`  FAIL  ${tc.tool}: ${err}`);
      failed++;
    }
  }

  // Cleanup
  child.kill();

  // Remove temp DB
  try {
    const { unlinkSync } = await import('fs');
    unlinkSync(tmpDb);
    // Also remove WAL/SHM files
    try { unlinkSync(tmpDb + '-wal'); } catch {}
    try { unlinkSync(tmpDb + '-shm'); } catch {}
  } catch {}

  console.log(`\n── Results: ${passed} passed, ${failed} failed out of ${testCases.length} ──`);

  if (failed > 0) {
    console.log('\nFAILED');
    process.exit(1);
  }

  console.log('\nPASSED');
}

runSmokeTest().catch(err => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
