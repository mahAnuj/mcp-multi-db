export type DatabaseType = "postgres" | "mysql" | "sqlite";

export interface DatabaseConfigBase {
  id: string;
  label?: string;
  description?: string;
}

export interface PostgresConfig extends DatabaseConfigBase {
  type: "postgres";
  connectionString: string;
}

export interface MysqlConfig extends DatabaseConfigBase {
  type: "mysql";
  connectionString: string;
}

export interface SqliteConfig extends DatabaseConfigBase {
  type: "sqlite";
  path: string;
}

export type DatabaseConfig = PostgresConfig | MysqlConfig | SqliteConfig;

export interface DatabaseSummary {
  id: string;
  type: DatabaseType;
  label?: string;
  description?: string;
}

export interface TableInfo {
  name: string;
  schema?: string;
  type: "table" | "view" | string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}
