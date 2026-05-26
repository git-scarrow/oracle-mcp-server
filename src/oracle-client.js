import oracledb from 'oracledb';

export class OracleClient {
  constructor(getConnectionConfig) {
    this.getConnectionConfig = getConnectionConfig;
  }

  async execute(query, params = [], options = {}) {
    let connection;
    const startTime = Date.now();

    console.error(`[AUDIT] Query execution started at ${new Date().toISOString()}`);
    console.error(`[AUDIT] Query: ${query.substring(0, 200)}${query.length > 200 ? '...' : ''}`);
    console.error(`[AUDIT] Parameters: ${JSON.stringify(params)}`);

    try {
      connection = await oracledb.getConnection(this.getConnectionConfig());

      if (process.env.ORACLE_DEFAULT_SCHEMA) {
        const schemaName = process.env.ORACLE_DEFAULT_SCHEMA.toUpperCase();
        if (!/^[A-Z][A-Z0-9_$]*$/.test(schemaName)) {
          throw new Error('Invalid schema name format');
        }
        await connection.execute(`ALTER SESSION SET CURRENT_SCHEMA = ${schemaName}`);
      }

      let oracleQuery = query;
      const oracleParams = {};

      if (Array.isArray(params) && params.length > 0) {
        params.forEach((param, index) => {
          const pgParam = `$${index + 1}`;
          const oracleParam = `:${index + 1}`;
          oracleQuery = oracleQuery.replace(new RegExp(`\\${pgParam}\\b`, 'g'), oracleParam);
          oracleParams[index + 1] = param;
        });
      }

      const result = await connection.execute(oracleQuery, oracleParams, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        autoCommit: options.autoCommit !== false,
        maxRows: options.maxRows || 1000,
      });

      return {
        rows: result.rows || [],
        rowCount: result.rowsAffected || (result.rows ? result.rows.length : 0),
        metadata: result.metaData || [],
      };
    } catch (error) {
      if (connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error('Rollback error:', rollbackError);
        }
      }
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
      console.error(`[AUDIT] Query execution completed (Duration: ${Date.now() - startTime}ms)`);
    }
  }
}
