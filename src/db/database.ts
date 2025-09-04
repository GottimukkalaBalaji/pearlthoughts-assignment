import sqlite3 from 'sqlite3';
import * as fs from 'fs';
import * as path from 'path';

const sqlite = sqlite3.verbose();

export class Database {
  private db: sqlite3.Database;

  constructor(filename: string = ':memory:') {
    // Ensure data directory exists if using file database
    if (filename !== ':memory:') {
      const dir = path.dirname(filename);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Created database directory: ${dir}`);
      }
    }
    
    this.db = new sqlite.Database(filename, (err) => {
      if (err) {
        console.error('Database connection error:', err);
      } else {
        console.log(`Database connected: ${filename}`);
      }
    });
  }

  async initialize(): Promise<void> {
    console.log('Initializing database tables...');
    await this.createTables();
    console.log('Database tables created successfully');
  }

  private async createTables(): Promise<void> {
    const createTasksTable = `
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        completed INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_deleted INTEGER DEFAULT 0,
        sync_status TEXT DEFAULT 'pending',
        server_id TEXT,
        last_synced_at DATETIME
      )
    `;

    const createSyncQueueTable = `
      CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        retry_count INTEGER DEFAULT 0,
        error_message TEXT,
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      )
    `;

    try {
      await this.run(createTasksTable);
      console.log('Tasks table created/verified');
      
      await this.run(createSyncQueueTable);
      console.log('Sync queue table created/verified');
    } catch (error) {
      console.error('Error creating tables:', error);
      throw error;
    }
  }

  // Helper methods
  run(sql: string, params: any[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          console.error('SQL Error:', err);
          console.error('SQL Query:', sql);
          console.error('Parameters:', params);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  get(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          console.error('SQL Error:', err);
          console.error('SQL Query:', sql);
          console.error('Parameters:', params);
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  all(sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          console.error('SQL Error:', err);
          console.error('SQL Query:', sql);
          console.error('Parameters:', params);
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}