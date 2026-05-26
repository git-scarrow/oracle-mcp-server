#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import oracledb from 'oracledb';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

import { buildGenericToolDefinitions, registerGenericToolHandlers } from './generic-tools.js';
import { buildLabToolDefinitions, registerLabToolHandlers } from './lab-tools.js';
import { OracleClient } from './oracle-client.js';

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');
dotenv.config({ path: envPath, quiet: true });

if (process.env.ORACLE_CLIENT_PATH || process.env.ORACLE_WALLET_LOCATION) {
  try {
    const clientOpts = {};
    if (process.env.ORACLE_CLIENT_PATH) {
      clientOpts.libDir = process.env.ORACLE_CLIENT_PATH;
    }
    oracledb.initOracleClient(clientOpts);
    console.error('Oracle client initialized in thick mode for wallet support');
  } catch (err) {
    console.error('Failed to initialize Oracle client:', err.message);
    console.error('Continuing in thin mode - wallet connections may not work');
  }
}

class OracleMCPServer {
  constructor() {
    this.server = new Server(
      { name: 'oracle-mcp-server', version: '1.1.0' },
      { capabilities: { tools: {}, resources: {} } },
    );

    oracledb.poolMin = 0;
    oracledb.poolMax = 4;
    oracledb.poolTimeout = 60;

    this.client = new OracleClient(() => this.getConnectionConfig());
    this.toolDefinitions = [
      ...buildGenericToolDefinitions(),
      ...buildLabToolDefinitions(),
    ];
    this.toolHandlers = {
      ...registerGenericToolHandlers(this, this.client),
      ...registerLabToolHandlers(this, this.client),
    };

    this.setupToolHandlers();
    this.setupResourceHandlers();
  }

  jsonResponse(payload) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  }

  getConnectionConfig() {
    if (process.env.ORACLE_CONNECTION_STRING) {
      return {
        connectString: process.env.ORACLE_CONNECTION_STRING,
        user: process.env.ORACLE_USER,
        password: process.env.ORACLE_PASSWORD,
      };
    }
    if (process.env.ORACLE_TNS_NAME) {
      return {
        connectString: process.env.ORACLE_TNS_NAME,
        user: process.env.ORACLE_USER,
        password: process.env.ORACLE_PASSWORD,
      };
    }

    const host = process.env.ORACLE_HOST || 'localhost';
    const port = process.env.ORACLE_PORT || '1521';
    const service = process.env.ORACLE_SERVICE_NAME || process.env.ORACLE_SID;
    if (!service) {
      throw new Error('Oracle connection requires CONNECTION_STRING, TNS_NAME, or SERVICE_NAME/SID');
    }
    return {
      connectString: `${host}:${port}/${service}`,
      user: process.env.ORACLE_USER,
      password: process.env.ORACLE_PASSWORD,
    };
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.toolDefinitions,
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args = {} } = request.params;
        const handler = this.toolHandlers[name];
        if (!handler) {
          throw new Error(`Unknown tool: ${name}`);
        }
        return await handler(args);
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
        };
      }
    });
  }

  setupResourceHandlers() {
    // No MCP resources yet. This server is tool-only.
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Oracle MCP Server running on stdio');
  }
}

const server = new OracleMCPServer();
server.run().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
