#!/usr/bin/env npx tsx
/**
 * generate-tool-docs — Auto-generate markdown reference from MCP tool definitions.
 *
 * Parses engine/src/index.ts and outputs a markdown table documenting each tool,
 * its parameters, and description.
 *
 * Usage: npx tsx scripts/generate-tool-docs.ts [--output path/to/file.md]
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const INDEX_PATH = resolve('engine/src/index.ts');

interface ToolParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
  defaultVal?: string;
}

interface ToolDef {
  name: string;
  description: string;
  params: ToolParam[];
}

function parseToolDefinitions(source: string): ToolDef[] {
  const tools: ToolDef[] = [];

  // Split source by server.tool( calls
  const blocks = source.split(/server\.tool\(/);
  blocks.shift(); // Remove preamble

  for (const block of blocks) {
    // Extract name and description from first two string args
    const nameMatch = block.match(/^\s*'([^']+)',\s*'([^']+)'/);
    if (!nameMatch) continue;

    const name = nameMatch[1];
    const description = nameMatch[2];
    const params: ToolParam[] = [];

    // Extract Zod schema block — between the description string and the handler function
    const schemaStart = block.indexOf('{', block.indexOf(nameMatch[2]) + nameMatch[2].length);
    if (schemaStart === -1) {
      tools.push({ name, description, params });
      continue;
    }

    // Find matching closing brace for the schema object
    let depth = 0;
    let schemaEnd = schemaStart;
    for (let i = schemaStart; i < block.length; i++) {
      if (block[i] === '{') depth++;
      if (block[i] === '}') depth--;
      if (depth === 0) { schemaEnd = i; break; }
    }

    const schemaBlock = block.slice(schemaStart, schemaEnd + 1);

    // Parse individual z.xxx() parameter definitions
    const paramRegex = /(\w+):\s*z\.(\w+)\(([^)]*)\)((?:\.\w+\([^)]*\))*)/g;
    let paramMatch;
    while ((paramMatch = paramRegex.exec(schemaBlock)) !== null) {
      const paramName = paramMatch[1];
      const baseType = paramMatch[2];
      const chainedCalls = paramMatch[4] || '';

      const isOptional = chainedCalls.includes('.optional()');
      const descMatch = chainedCalls.match(/\.describe\('([^']+)'\)/);
      const defaultMatch = chainedCalls.match(/\.default\(([^)]+)\)/);

      // Map Zod types to readable types
      let type = baseType;
      if (baseType === 'enum') {
        const enumMatch = paramMatch[3].match(/\[([^\]]+)\]/);
        type = enumMatch ? enumMatch[1].replace(/'/g, '').split(',').map(s => s.trim()).join(' | ') : 'enum';
      } else if (baseType === 'array') {
        type = 'string[]';
      }

      params.push({
        name: paramName,
        type,
        required: !isOptional,
        description: descMatch ? descMatch[1] : '',
        defaultVal: defaultMatch ? defaultMatch[1] : undefined,
      });
    }

    tools.push({ name, description, params });
  }

  return tools;
}

function generateMarkdown(tools: ToolDef[]): string {
  const lines: string[] = [];
  lines.push('# Cogmap MCP Tool Reference');
  lines.push('');
  lines.push(`> Auto-generated from \`engine/src/index.ts\` — ${tools.length} tools`);
  lines.push('');

  for (const tool of tools) {
    lines.push(`## \`${tool.name}\``);
    lines.push('');
    lines.push(tool.description);
    lines.push('');

    if (tool.params.length > 0) {
      lines.push('| Parameter | Type | Required | Default | Description |');
      lines.push('|-----------|------|----------|---------|-------------|');

      for (const p of tool.params) {
        const req = p.required ? 'Yes' : 'No';
        const def = p.defaultVal ?? '—';
        lines.push(`| \`${p.name}\` | \`${p.type}\` | ${req} | ${def} | ${p.description} |`);
      }
    } else {
      lines.push('*No parameters*');
    }

    lines.push('');
  }

  return lines.join('\n');
}

// ── Main ──

let source: string;
try {
  source = readFileSync(INDEX_PATH, 'utf-8');
} catch {
  console.error(`Cannot read: ${INDEX_PATH}`);
  process.exit(1);
}

const tools = parseToolDefinitions(source);
const markdown = generateMarkdown(tools);

const outputArg = process.argv.indexOf('--output');
if (outputArg !== -1 && process.argv[outputArg + 1]) {
  const outputPath = resolve(process.argv[outputArg + 1]);
  writeFileSync(outputPath, markdown);
  console.log(`Wrote tool reference to: ${outputPath}`);
} else {
  console.log(markdown);
}
