import { Task } from '../types';
import { Database } from '../db/database';

export class TaskService {
  private syncService: any;

  constructor(private db: Database) {}

  // Method to set sync service (will be called from routes)
  setSyncService(syncService: any) {
    this.syncService = syncService;
  }

  async createTask(taskData: Partial<Task>): Promise<Task> {
    try {
      // Step 1: Validate that ID is provided (now mandatory)
      if (!taskData.id || typeof taskData.id !== 'string' || taskData.id.trim().length === 0) {
        console.error('Task creation failed: Invalid ID provided', taskData.id);
        throw new Error('Task ID is required and must be a non-empty string');
      }
      
      const taskId = taskData.id.trim();
      console.log(`Creating task with ID: ${taskId}`);
      
      // Step 2: Check if a task with this ID already exists (including soft-deleted ones)
      const existingTaskSql = 'SELECT * FROM tasks WHERE id = ?';
      const existingTask = await this.db.get(existingTaskSql, [taskId]);
      
      if (existingTask) {
        if (existingTask.is_deleted === 0) {
          // Task exists and is not deleted
          console.error(`Task creation failed: Active task with ID ${taskId} already exists`);
          throw new Error('Task with this ID already exists');
        } else {
          // Task exists but is soft-deleted - we'll update it instead of creating new
          console.log(`Found soft-deleted task with ID ${taskId}, updating instead of creating new`);
          return await this.restoreAndUpdateTask(taskId, taskData);
        }
      }
      
      // Step 3: Get current timestamp for created_at and updated_at
      const now = new Date().toISOString();
      
      // Step 4: Create the complete task object with default values
      const newTask: Task = {
        id: taskId,
        title: taskData.title || '', // Title is required, use empty string as fallback
        description: taskData.description || undefined, // Description is optional, use undefined instead of null
        completed: taskData.completed || false, // Default to not completed
        created_at: new Date(now),
        updated_at: new Date(now),
        is_deleted: false, // New tasks are not deleted
        sync_status: 'pending', // New tasks need to be synced
        server_id: undefined, // No server ID yet (will be set after sync)
        last_synced_at: undefined // Not synced yet
      };

      console.log('Task object created:', JSON.stringify(newTask, null, 2));

      // Step 5: Insert the task into the database
      const sql = `
        INSERT INTO tasks (
          id, title, description, completed, created_at, updated_at, 
          is_deleted, sync_status, server_id, last_synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const params = [
        newTask.id,
        newTask.title,
        newTask.description || null, // Convert undefined to null for SQLite
        newTask.completed ? 1 : 0, // SQLite uses 1/0 for boolean
        now,
        now,
        newTask.is_deleted ? 1 : 0,
        newTask.sync_status,
        newTask.server_id || null, // Convert undefined to null for SQLite
        newTask.last_synced_at || null // Convert undefined to null for SQLite
      ];

      console.log('Executing SQL:', sql);
      console.log('With parameters:', params);

      await this.db.run(sql, params);
      console.log(`Task ${taskId} inserted into database successfully`);

      // Step 6: Add to sync queue if sync service is available
      if (this.syncService) {
        try {
          console.log(`Adding task ${taskId} to sync queue`);
          await this.syncService.addToSyncQueue(taskId, 'create', newTask);
          console.log(`Task ${taskId} added to sync queue successfully`);
        } catch (error) {
          console.error('Failed to add create operation to sync queue:', error);
          // Don't fail the task creation if sync queue fails
        }
      } else {
        console.log('Sync service not available, skipping sync queue');
      }

      console.log(`Task creation completed successfully for ID: ${taskId}`);
      return newTask;
      
    } catch (error) {
      console.error('Task creation failed with error:', error);
      console.error('Error details:', {
        message: (error as Error).message,
        stack: (error as Error).stack,
        taskData: taskData
      });
      throw error;
    }
  }

  // Helper method to restore and update a soft-deleted task
  private async restoreAndUpdateTask(taskId: string, taskData: Partial<Task>): Promise<Task> {
    const now = new Date().toISOString();
    
    const updatedTask: Task = {
      id: taskId,
      title: taskData.title || '',
      description: taskData.description || undefined,
      completed: taskData.completed || false,
      created_at: new Date(now), // Reset created_at to current time
      updated_at: new Date(now),
      is_deleted: false, // Restore the task
      sync_status: 'pending', // Needs to be synced
      server_id: undefined, // Reset server_id
      last_synced_at: undefined // Reset sync status
    };

    const sql = `
      UPDATE tasks SET 
        title = ?, 
        description = ?, 
        completed = ?, 
        created_at = ?, 
        updated_at = ?, 
        is_deleted = ?, 
        sync_status = ?, 
        server_id = ?, 
        last_synced_at = ?
      WHERE id = ?
    `;
    
    const params = [
      updatedTask.title,
      updatedTask.description || null,
      updatedTask.completed ? 1 : 0,
      now,
      now,
      0, // is_deleted = false
      updatedTask.sync_status,
      null, // server_id = null
      null, // last_synced_at = null
      taskId
    ];

    console.log('Restoring soft-deleted task with SQL:', sql);
    console.log('With parameters:', params);

    await this.db.run(sql, params);
    console.log(`Task ${taskId} restored and updated successfully`);

    // Add to sync queue as a create operation since it's effectively a new task
    if (this.syncService) {
      try {
        await this.syncService.addToSyncQueue(taskId, 'create', updatedTask);
        console.log(`Restored task ${taskId} added to sync queue`);
      } catch (error) {
        console.error('Failed to add restored task to sync queue:', error);
      }
    }

    return updatedTask;
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<Task | null> {
    // Step 1: Check if the task exists and is not deleted
    const existingTask = await this.getTask(id);
    if (!existingTask) {
      return null; // Task not found or is deleted
    }

    // Step 2: Prepare the updated task data
    const now = new Date().toISOString();
    const updatedTask: Task = {
      ...existingTask, // Keep existing values
      ...updates, // Override with new values
      updated_at: new Date(now), // Always update the timestamp
      sync_status: 'pending' // Mark as needing sync
    };

    // Step 3: Update the task in the database
    const sql = `
      UPDATE tasks 
      SET title = ?, description = ?, completed = ?, updated_at = ?, sync_status = ?
      WHERE id = ? AND is_deleted = 0
    `;
    
    const params = [
      updatedTask.title,
      updatedTask.description || null, // Convert undefined to null for SQLite
      updatedTask.completed ? 1 : 0,
      now,
      updatedTask.sync_status,
      id
    ];

    await this.db.run(sql, params);

    // Step 4: Add to sync queue if sync service is available
    if (this.syncService) {
      try {
        await this.syncService.addToSyncQueue(id, 'update', updatedTask);
      } catch (error) {
        console.error('Failed to add update operation to sync queue:', error);
        // Don't fail the task update if sync queue fails
      }
    }

    return updatedTask;
  }

  async deleteTask(id: string): Promise<boolean> {
    // Step 1: Check if the task exists
    const existingTask = await this.getTask(id);
    if (!existingTask) {
      return false; // Task not found or already deleted
    }

    // Step 2: Perform soft delete (mark as deleted, don't actually remove)
    const now = new Date().toISOString();
    const sql = `
      UPDATE tasks 
      SET is_deleted = 1, updated_at = ?, sync_status = ?
      WHERE id = ?
    `;
    
    const params = [now, 'pending', id];
    await this.db.run(sql, params);

    // Step 3: Add to sync queue if sync service is available
    if (this.syncService) {
      try {
        const deletedTask = { ...existingTask, is_deleted: true, updated_at: new Date(now) };
        await this.syncService.addToSyncQueue(id, 'delete', deletedTask);
      } catch (error) {
        console.error('Failed to add delete operation to sync queue:', error);
        // Don't fail the task deletion if sync queue fails
      }
    }

    return true; // Successfully deleted
  }

  async getTask(id: string): Promise<Task | null> {
    // Step 1: Query the database for the task
    const sql = `
      SELECT * FROM tasks 
      WHERE id = ? AND is_deleted = 0
    `;
    
    const row = await this.db.get(sql, [id]);
    
    // Step 2: Return null if task not found
    if (!row) {
      return null;
    }

    // Step 3: Convert database row to Task object
    return this.convertRowToTask(row);
  }

  async getAllTasks(): Promise<Task[]> {
    // Step 1: Query all non-deleted tasks from database
    const sql = `
      SELECT * FROM tasks 
      WHERE is_deleted = 0 
      ORDER BY created_at DESC
    `;
    
    const rows = await this.db.all(sql);

    // Step 2: Convert all rows to Task objects
    return rows.map(row => this.convertRowToTask(row));
  }

  async getTasksNeedingSync(): Promise<Task[]> {
    // Get all tasks that need to be synced (pending or error status)
    const sql = `
      SELECT * FROM tasks 
      WHERE sync_status IN ('pending', 'error')
      ORDER BY updated_at ASC
    `;
    
    const rows = await this.db.all(sql);
    return rows.map(row => this.convertRowToTask(row));
  }

  // Helper method to convert database row to Task object
  private convertRowToTask(row: any): Task {
    return {
      id: row.id,
      title: row.title,
      description: row.description || undefined, // Convert null to undefined for consistency
      completed: row.completed === 1, // Convert 1/0 to boolean
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      is_deleted: row.is_deleted === 1,
      sync_status: row.sync_status,
      server_id: row.server_id || undefined, // Convert null to undefined for consistency
      last_synced_at: row.last_synced_at ? new Date(row.last_synced_at) : undefined
    };
  }
}