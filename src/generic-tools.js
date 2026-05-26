export function buildGenericToolDefinitions() {
  return [
    {
      name: 'execute_query',
      description: 'Execute a SQL query on the Oracle database',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'SQL query to execute' },
          params: {
            type: 'array',
            description: 'Query parameters (optional)',
            items: { type: ['string', 'number', 'boolean', 'null'] },
          },
          maxRows: {
            type: 'number',
            description: 'Maximum number of rows to return (default: 1000)',
            default: 1000,
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'list_tables',
      description: 'List database tables from a schema or all accessible schemas',
      inputSchema: {
        type: 'object',
        properties: {
          schema: { type: 'string', description: 'Schema name (optional)' },
          pattern: { type: 'string', description: 'Table name pattern with % wildcards (optional)' },
        },
      },
    },
    {
      name: 'describe_table',
      description: 'Describe columns for a table',
      inputSchema: {
        type: 'object',
        properties: {
          table_name: { type: 'string', description: 'Table name' },
          schema: { type: 'string', description: 'Schema name (optional)' },
        },
        required: ['table_name'],
      },
    },
    {
      name: 'get_table_indexes',
      description: 'List indexes for a table',
      inputSchema: {
        type: 'object',
        properties: {
          table_name: { type: 'string', description: 'Table name' },
          schema: { type: 'string', description: 'Schema name (optional)' },
        },
        required: ['table_name'],
      },
    },
    {
      name: 'get_table_constraints',
      description: 'List constraints for a table',
      inputSchema: {
        type: 'object',
        properties: {
          table_name: { type: 'string', description: 'Table name' },
          schema: { type: 'string', description: 'Schema name (optional)' },
        },
        required: ['table_name'],
      },
    },
    {
      name: 'list_schemas',
      description: 'List all accessible schemas in the Oracle database',
      inputSchema: { type: 'object', properties: {} },
    },
  ];
}

export function registerGenericToolHandlers(server, client) {
  return {
    async execute_query(args) {
      if (!args.query || typeof args.query !== 'string') {
        throw new Error('Query parameter is required and must be a string');
      }
      if (args.query.length > 10000) {
        throw new Error('Query too long (max 10000 characters)');
      }
      const result = await client.execute(args.query, args.params || [], {
        maxRows: args.maxRows || 1000,
      });
      return server.jsonResponse({
        query: args.query,
        rowCount: result.rowCount,
        rows: result.rows,
        metadata: result.metadata,
      });
    },

    async list_tables(args) {
      let query = `
        SELECT owner AS schema_name, table_name, num_rows, last_analyzed
        FROM all_tables
        WHERE 1=1
      `;
      const params = [];
      if (args.schema) {
        query += ' AND owner = :1';
        params.push(args.schema.toUpperCase());
      }
      if (args.pattern) {
        query += ` AND table_name LIKE :${params.length + 1}`;
        params.push(args.pattern.toUpperCase());
      }
      query += ' ORDER BY owner, table_name';
      const result = await client.execute(query, params);
      return server.jsonResponse(result.rows);
    },

    async describe_table(args) {
      const query = `
        SELECT owner AS schema_name, column_name, data_type, data_length,
               data_precision, data_scale, nullable, data_default, column_id
        FROM all_tab_columns
        WHERE table_name = :1
        ${args.schema ? 'AND owner = :2' : ''}
        ORDER BY owner, column_id
      `;
      const params = [args.table_name.toUpperCase()];
      if (args.schema) {
        params.push(args.schema.toUpperCase());
      }
      const result = await client.execute(query, params);
      return server.jsonResponse({
        table: args.table_name,
        schema: args.schema || 'all accessible schemas',
        columns: result.rows,
      });
    },

    async get_table_indexes(args) {
      const query = `
        SELECT i.owner AS schema_name, i.index_name, i.index_type, i.uniqueness,
               i.status, i.tablespace_name,
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
      const result = await client.execute(query, params);
      return server.jsonResponse(result.rows);
    },

    async get_table_constraints(args) {
      const query = `
        SELECT c.owner AS schema_name, c.constraint_name, c.constraint_type,
               c.status, c.validated,
               CASE WHEN c.constraint_type = 'C' THEN 'CHECK CONSTRAINT' ELSE NULL END AS search_condition,
               LISTAGG(cc.column_name, ', ') WITHIN GROUP (ORDER BY cc.position) AS columns,
               r.table_name AS referenced_table, r.constraint_name AS referenced_constraint
        FROM all_constraints c
        LEFT JOIN all_cons_columns cc ON c.constraint_name = cc.constraint_name AND c.owner = cc.owner
        LEFT JOIN all_constraints r ON c.r_constraint_name = r.constraint_name AND c.r_owner = r.owner
        WHERE c.table_name = :1
        ${args.schema ? 'AND c.owner = :2' : ''}
        GROUP BY c.owner, c.constraint_name, c.constraint_type, c.status, c.validated, r.table_name, r.constraint_name
        ORDER BY c.owner,
          CASE c.constraint_type WHEN 'P' THEN 1 WHEN 'U' THEN 2 WHEN 'R' THEN 3 WHEN 'C' THEN 4 ELSE 5 END,
          c.constraint_name
      `;
      const params = [args.table_name.toUpperCase()];
      if (args.schema) {
        params.push(args.schema.toUpperCase());
      }
      const result = await client.execute(query, params);
      return server.jsonResponse(result.rows);
    },

    async list_schemas() {
      const query = `
        SELECT DISTINCT username AS schema_name, created,
          CASE WHEN username IN ('SYS', 'SYSTEM', 'DBSNMP', 'SYSMAN') THEN 'SYSTEM' ELSE 'USER' END AS schema_type
        FROM all_users
        ORDER BY username
      `;
      const result = await client.execute(query);
      return server.jsonResponse(result.rows);
    },
  };
}
