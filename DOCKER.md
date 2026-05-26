# Docker Usage Guide - oracle-mcp-server

## Building and Pushing

```bash
# Build and push to local registry
./docker-build-push.sh
```

This will build and push two tags:
- `nix:5000/oracle-mcp:latest` - Always points to most recent build
- `nix:5000/oracle-mcp:<git-sha>` - Specific commit version for reproducibility

## Running the Container

### Basic MCP Server Mode (stdio)

```bash
docker run --rm \
  -e ORACLE_CONNECTION_STRING="hostname:1521/service_name" \
  -e ORACLE_USER="your_username" \
  -e ORACLE_PASSWORD="your_password" \
  nix:5000/oracle-mcp:latest
```

### Using TNS Name

```bash
docker run --rm \
  -v /path/to/tnsnames.ora:/app/tnsnames.ora:ro \
  -e TNS_ADMIN=/app \
  -e ORACLE_TNS_NAME="ORCL" \
  -e ORACLE_USER="your_username" \
  -e ORACLE_PASSWORD="your_password" \
  nix:5000/oracle-mcp:latest
```

### Using Individual Connection Components

```bash
docker run --rm \
  -e ORACLE_HOST="localhost" \
  -e ORACLE_PORT="1521" \
  -e ORACLE_SERVICE_NAME="ORCL" \
  -e ORACLE_USER="your_username" \
  -e ORACLE_PASSWORD="your_password" \
  nix:5000/oracle-mcp:latest
```

## Environment Variables

### Required (choose one connection method):

**Method 1: Easy Connect String**
- `ORACLE_CONNECTION_STRING` - Format: `hostname:port/service_name`
- `ORACLE_USER` - Database username
- `ORACLE_PASSWORD` - Database password

**Method 2: TNS Name**
- `ORACLE_TNS_NAME` - TNS alias from tnsnames.ora
- `ORACLE_USER` - Database username
- `ORACLE_PASSWORD` - Database password
- Must mount tnsnames.ora file and set `TNS_ADMIN` environment variable

**Method 3: Individual Components**
- `ORACLE_HOST` - Database hostname
- `ORACLE_PORT` - Database port (default: 1521)
- `ORACLE_SERVICE_NAME` or `ORACLE_SID` - Service name or SID
- `ORACLE_USER` - Database username
- `ORACLE_PASSWORD` - Database password

### Optional:
- `ORACLE_DEFAULT_SCHEMA` - Default schema if different from user
- `ORACLE_CLIENT_PATH` - Path to Oracle Instant Client (for thick mode features)

## Integration with Claude Desktop

Add to your Claude Desktop MCP configuration:

```json
{
  "mcpServers": {
    "oracle": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "ORACLE_CONNECTION_STRING=${ORACLE_CONNECTION_STRING}",
        "-e", "ORACLE_USER=${ORACLE_USER}",
        "-e", "ORACLE_PASSWORD=${ORACLE_PASSWORD}",
        "nix:5000/oracle-mcp:latest"
      ]
    }
  }
}
```

## Deployment with Docker Compose

```yaml
services:
  oracle-mcp:
    image: nix:5000/oracle-mcp:latest
    environment:
      ORACLE_CONNECTION_STRING: "hostname:1521/service_name"
      ORACLE_USER: "your_username"
      ORACLE_PASSWORD: "your_password"
    restart: unless-stopped
```

## Self-hosting Oracle Database 23ai Free

`compose.yaml` spins up Oracle Database 23ai Free alongside the MCP server. 23ai Free is Oracle's production engine with no license cost, 12 GB user-data cap, AI Vector Search, Oracle Text, JSON, and LOB support — functionally equivalent to ADB for most workloads.

### Start it

```bash
echo 'ORACLE_FREE_PWD=<pick-a-strong-password>' >> .env
echo 'ORACLE_USER=chatsearch' >> .env
echo 'ORACLE_PASSWORD=<app-user-password>' >> .env

# Login to Oracle container registry (one-time, free account)
docker login container-registry.oracle.com

docker compose up -d oracle-free
docker compose logs -f oracle-free   # wait for "DATABASE IS READY TO USE"
```

First boot takes 2–5 minutes while the seed database initializes. The `oracle-free-data` volume persists across restarts.

### Create the application user

```bash
docker exec -it oracle-free sqlplus sys/$ORACLE_FREE_PWD@FREEPDB1 as sysdba <<'SQL'
CREATE USER chatsearch IDENTIFIED BY "<app-user-password>"
  DEFAULT TABLESPACE USERS
  QUOTA UNLIMITED ON USERS;
GRANT CONNECT, RESOURCE, CREATE VIEW, CREATE MATERIALIZED VIEW TO chatsearch;
GRANT EXECUTE ON CTXSYS.CTX_DDL TO chatsearch;
EXIT
SQL
```

### Migrate from ADB

Since DML on the source ADB is blocked (ORA-01552), Data Pump over DB link won't work. Two options:

**Option A — Data Pump via cloud object storage (preferred if ADB DML recovers):**

```sql
-- On ADB (as ADMIN) — run expdp over DBMS_CLOUD to OCI Object Storage
BEGIN
  DBMS_CLOUD.CREATE_CREDENTIAL(
    credential_name => 'OCI_CRED',
    username        => '<oci-user-ocid>',
    password        => '<oci-auth-token>'
  );
END;
/

-- Then run expdp with DIRECTORY=DATA_PUMP_DIR and DUMPFILE pointing at
-- the credential'd cloud URI. Download the .dmp with the oci cli and
-- impdp it into oracle-free.
```

**Option B — SELECT-based dump (works despite ORA-01552, since SELECT still works):**

Write a small script (Python / Node) that does:
1. `SELECT * FROM source_table` from ADB in pages
2. Stream rows into `INSERT INTO ... VALUES` batches against the local 23ai Free instance
3. Handle LOBs via `DBMS_LOB.SUBSTR` chunking for columns > ~4000 bytes

This bypasses Data Pump entirely and is the only reliable path while the source ADB's undo is full.

### Point the MCP server at the local instance

Update `.env`:

```
ORACLE_HOST=localhost      # or oracle-free if running the MCP in the same compose
ORACLE_PORT=1521
ORACLE_SERVICE_NAME=FREEPDB1
ORACLE_USER=chatsearch
ORACLE_PASSWORD=<app-user-password>
```

Then `docker compose up -d oracle-mcp` and the MCP server talks to your local DB with no external dependency, no free-tier undo ceiling, and no vendor lock-in.

## Security Notes

- Never commit credentials to version control
- Use Docker secrets or environment files for production deployments
- The container runs as non-root user (node)
- All queries use bind variables to prevent SQL injection
- Consider using Oracle Wallet for credential management in production
