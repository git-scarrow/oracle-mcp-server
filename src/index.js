#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import oracledb from 'oracledb';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// MCP stdio servers must not write non-JSON output to stdout; dotenv v17 logs a
// startup banner to stdout unless `quiet` is enabled.
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');
dotenv.config({ path: envPath, quiet: true });

// Initialize Oracle client
// For Oracle Autonomous Database with wallet, you may need thick mode
if (process.env.TNS_ADMIN || process.env.ORACLE_WALLET_LOCATION) {
  try {
    // Initialize thick mode for wallet-based connections
    const clientOpts = {};
    if (process.env.ORACLE_CLIENT_PATH) {
      clientOpts.libDir = process.env.ORACLE_CLIENT_PATH;
    }
    if (process.env.TNS_ADMIN) {
      clientOpts.configDir = process.env.TNS_ADMIN;
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
      {
        name: 'oracle-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    // Configure Oracle connection pool settings
    oracledb.poolMin = 0;
    oracledb.poolMax = 4;
    oracledb.poolTimeout = 60;

    this.setupToolHandlers();
    this.setupResourceHandlers();
  }

  getConnectionConfig() {
    // Support multiple Oracle connection methods
    if (process.env.ORACLE_CONNECTION_STRING) {
      // Easy Connect string format: hostname:port/service_name
      return {
        connectString: process.env.ORACLE_CONNECTION_STRING,
        user: process.env.ORACLE_USER,
        password: process.env.ORACLE_PASSWORD
      };
    } else if (process.env.ORACLE_TNS_NAME) {
      // TNS alias from tnsnames.ora
      return {
        connectString: process.env.ORACLE_TNS_NAME,
        user: process.env.ORACLE_USER,
        password: process.env.ORACLE_PASSWORD
      };
    } else {
      // Individual components
      const host = process.env.ORACLE_HOST || 'localhost';
      const port = process.env.ORACLE_PORT || '1521';
      const service = process.env.ORACLE_SERVICE_NAME || process.env.ORACLE_SID;
      
      if (!service) {
        throw new Error('Oracle connection requires either CONNECTION_STRING, TNS_NAME, or SERVICE_NAME/SID');
      }
      
      return {
        connectString: `${host}:${port}/${service}`,
        user: process.env.ORACLE_USER,
        password: process.env.ORACLE_PASSWORD
      };
    }
  }

  async executeQuery(query, params = [], options = {}) {
    let connection;
    const startTime = Date.now();
    
    // Security audit logging
    console.error(`[AUDIT] Query execution started at ${new Date().toISOString()}`);
    console.error(`[AUDIT] Query: ${query.substring(0, 200)}${query.length > 200 ? '...' : ''}`);
    console.error(`[AUDIT] Parameters: ${JSON.stringify(params)}`);
    
    try {
      // Get connection from pool or create new connection
      const config = this.getConnectionConfig();
      connection = await oracledb.getConnection(config);
      
      // Set default schema if specified
      if (process.env.ORACLE_DEFAULT_SCHEMA) {
        // Validate schema name to prevent SQL injection
        const schemaName = process.env.ORACLE_DEFAULT_SCHEMA.toUpperCase();
        if (!/^[A-Z][A-Z0-9_$]*$/.test(schemaName)) {
          throw new Error('Invalid schema name format');
        }
        await connection.execute(`ALTER SESSION SET CURRENT_SCHEMA = ${schemaName}`);
      }
      
      // Convert positional parameters ($1, $2) to Oracle bind parameters (:1, :2)
      let oracleQuery = query;
      let oracleParams = {};
      
      // Handle PostgreSQL style parameters
      if (params.length > 0) {
        params.forEach((param, index) => {
          const pgParam = `$${index + 1}`;
          const oracleParam = `:${index + 1}`;
          oracleQuery = oracleQuery.replace(new RegExp('\\' + pgParam + '\\b', 'g'), oracleParam);
          oracleParams[index + 1] = param;
        });
      }
      
      // Execute query with options
      const result = await connection.execute(oracleQuery, oracleParams, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        autoCommit: options.autoCommit !== false,
        maxRows: options.maxRows || 1000
      });
      
      // Format result to match expected structure
      return {
        rows: result.rows || [],
        rowCount: result.rowsAffected || (result.rows ? result.rows.length : 0),
        metadata: result.metaData
      };
    } catch (error) {
      if (connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error('Rollback error:', rollbackError);
        }
      }
      // Audit log for errors
      console.error(`[AUDIT] Query failed: ${error.message} (Duration: ${Date.now() - startTime}ms)`);
      throw error;
    } finally {
      if (connection) {
        try {
          await connection.close();
        } catch (closeError) {
          console.error('Connection close error:', closeError);
        }
      }
      // Audit log completion
      console.error(`[AUDIT] Query execution completed (Duration: ${Date.now() - startTime}ms)`);
    }
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'execute_query',
            description: 'Execute a SQL query on the Oracle database',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'SQL query to execute'
                },
                params: {
                  type: 'array',
                  description: 'Query parameters (optional)',
                  items: {
                    type: ['string', 'number', 'boolean', 'null']
                  }
                },
                maxRows: {
                  type: 'number',
                  description: 'Maximum number of rows to return (default: 1000)',
                  default: 1000
                }
              },
              required: ['query']
            }
          },
          {
            name: 'list_tables',
            description: 'List tables from specified schema or all accessible schemas',
            inputSchema: {
              type: 'object',
              properties: {
                schema: {
                  type: 'string',
                  description: 'Schema name (optional, shows all accessible schemas if not specified)'
                },
                pattern: {
                  type: 'string',
                  description: 'Table name pattern (supports % wildcards)'
                }
              }
            }
          },
          {
            name: 'describe_table',
            description: 'Get table structure including columns, data types, and constraints',
            inputSchema: {
              type: 'object',
              properties: {
                table_name: {
                  type: 'string',
                  description: 'Table name'
                },
                schema: {
                  type: 'string',
                  description: 'Schema name (optional, searches all accessible schemas if not specified)'
                }
              },
              required: ['table_name']
            }
          },
          {
            name: 'get_table_indexes',
            description: 'Get indexes for a specific table',
            inputSchema: {
              type: 'object',
              properties: {
                table_name: {
                  type: 'string',
                  description: 'Table name'
                },
                schema: {
                  type: 'string',
                  description: 'Schema name (optional, searches all accessible schemas if not specified)'
                }
              },
              required: ['table_name']
            }
          },
          {
            name: 'get_table_constraints',
            description: 'Get constraints (primary keys, foreign keys, unique, check) for a table',
            inputSchema: {
              type: 'object',
              properties: {
                table_name: {
                  type: 'string',
                  description: 'Table name'
                },
                schema: {
                  type: 'string',
                  description: 'Schema name (optional, searches all accessible schemas if not specified)'
                }
              },
              required: ['table_name']
            }
          },
          {
            name: 'list_schemas',
            description: 'List all schemas in the database',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          }
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;

        switch (name) {
          case 'execute_query':
            return await this.handleExecuteQuery(args);
          
          case 'list_tables':
            return await this.handleListTables(args);
          
          case 'describe_table':
            return await this.handleDescribeTable(args);
          
          case 'get_table_indexes':
            return await this.handleGetTableIndexes(args);
          
          case 'get_table_constraints':
            return await this.handleGetTableConstraints(args);
          
          case 'list_schemas':
            return await this.handleListSchemas(args);
          
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`
            }
          ]
        };
      }
    });
  }

  async handleExecuteQuery(args) {
    // Input validation
    if (!args.query || typeof args.query !== 'string') {
      throw new Error('Query parameter is required and must be a string');
    }
    
    if (args.query.length > 10000) {
      throw new Error('Query too long (max 10000 characters)');
    }
    
    const result = await this.executeQuery(args.query, args.params || [], {
      maxRows: args.maxRows || 1000
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            query: args.query,
            rowCount: result.rowCount,
            rows: result.rows,
            metadata: result.metadata
          }, null, 2)
        }
      ]
    };
  }

  async handleListTables(args) {
    let query = `
      SELECT 
        owner AS schema_name,
        table_name,
        num_rows,
        last_analyzed
      FROM all_tables
      WHERE 1=1
    `;
    const params = [];
    
    if (args.schema) {
      query += ` AND owner = :1`;
      params.push(args.schema.toUpperCase());
    }
    
    if (args.pattern) {
      query += ` AND table_name LIKE :${params.length + 1}`;
      params.push(args.pattern.toUpperCase());
    }
    
    query += ` ORDER BY owner, table_name`;
    
    const result = await this.executeQuery(query, params);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result.rows, null, 2)
        }
      ]
    };
  }

  async handleDescribeTable(args) {
    const query = `
      SELECT 
        owner AS schema_name,
        column_name,
        data_type,
        data_length,
        data_precision,
        data_scale,
        nullable,
        data_default,
        column_id
      FROM all_tab_columns
      WHERE table_name = :1
        ${args.schema ? 'AND owner = :2' : ''}
      ORDER BY owner, column_id
    `;
    
    const params = [args.table_name.toUpperCase()];
    if (args.schema) {
      params.push(args.schema.toUpperCase());
    }
    
    const result = await this.executeQuery(query, params);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            table: args.table_name,
            schema: args.schema || 'all accessible schemas',
            columns: result.rows
          }, null, 2)
        }
      ]
    };
  }

  async handleGetTableIndexes(args) {
    const query = `
      SELECT 
        i.owner AS schema_name,
        i.index_name,
        i.index_type,
        i.uniqueness,
        i.status,
        i.tablespace_name,
        LISTAGG(ic.column_name, ', ') WITHIN GROUP (ORDER BY ic.column_position) AS columns
      FROM all_indexes i
      JOIN all_ind_columns ic ON i.index_name = ic.index_name AND i.owner = ic.index_owner
      WHERE i.table_name = :1
        ${args.schema ? 'AND i.owner = :2' : ''}
      GROUP BY i.owner, i.index_name, i.index_type, i.uniqueness, i.status, i.tablespace_name
      ORDER BY i.owner, i.index_name
    `;
    
    const params = [args.table_name.toUpperCase()];
    if (args.schema) {
      params.push(args.schema.toUpperCase());
    }
    
    const result = await this.executeQuery(query, params);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result.rows, null, 2)
        }
      ]
    };
  }

  async handleGetTableConstraints(args) {
    const query = `
      SELECT 
        c.owner AS schema_name,
        c.constraint_name,
        c.constraint_type,
        c.status,
        c.validated,
        CASE 
          WHEN c.constraint_type = 'C' THEN 'CHECK CONSTRAINT' 
          ELSE NULL 
        END as search_condition,
        LISTAGG(cc.column_name, ', ') WITHIN GROUP (ORDER BY cc.position) AS columns,
        r.table_name AS referenced_table,
        r.constraint_name AS referenced_constraint
      FROM all_constraints c
      LEFT JOIN all_cons_columns cc ON c.constraint_name = cc.constraint_name AND c.owner = cc.owner
      LEFT JOIN all_constraints r ON c.r_constraint_name = r.constraint_name AND c.r_owner = r.owner
      WHERE c.table_name = :1
        ${args.schema ? 'AND c.owner = :2' : ''}
      GROUP BY c.owner, c.constraint_name, c.constraint_type, c.status, c.validated, 
               r.table_name, r.constraint_name
      ORDER BY 
        c.owner,
        CASE c.constraint_type 
          WHEN 'P' THEN 1 
          WHEN 'U' THEN 2 
          WHEN 'R' THEN 3 
          WHEN 'C' THEN 4 
          ELSE 5 
        END,
        c.constraint_name
    `;
    
    const params = [args.table_name.toUpperCase()];
    if (args.schema) {
      params.push(args.schema.toUpperCase());
    }
    
    const result = await this.executeQuery(query, params);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result.rows, null, 2)
        }
      ]
    };
  }

  async handleListSchemas(args) {
    const query = `
      SELECT DISTINCT 
        username AS schema_name,
        created,
        CASE 
          WHEN username IN ('SYS', 'SYSTEM', 'DBSNMP', 'SYSMAN') THEN 'SYSTEM'
          ELSE 'USER'
        END AS schema_type
      FROM all_users
      ORDER BY username
    `;
    
    const result = await this.executeQuery(query);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result.rows, null, 2)
        }
      ]
    };
  }

  setupResourceHandlers() {
    // TODO: Implement resource handlers for database metadata
    // This could include resources for:
    // - Database connection info
    // - Schema documentation
    // - Table relationships diagram
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Oracle MCP server running on stdio');
  }
}

const server = new OracleMCPServer();

// Export for testing
export { OracleMCPServer };

// Run server if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  server.run().catch(console.error);
}
