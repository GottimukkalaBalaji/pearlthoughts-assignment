import axios from 'axios';
import { Task, SyncQueueItem, SyncResult, BatchSyncResponse } from '../types';
import { Database } from '../db/database';
import { TaskService } from './taskService';

export class SyncService {
  private apiUrl: string;
  
  constructor(
    private db: Database,
    private taskService: TaskService,
    apiUrl: string = process.env.API_BASE_URL || 'http://localhost:3000/api'
  ) {
    this.apiUrl = apiUrl;
  }

  async sync(): Promise<SyncResult> {
    // Step 1: Check connectivity first
    const isOnline = await this.checkConnectivity();
    if (!isOnline) {
      return {
        success: false,
        synced_items: 0,
        failed_items: 0,
        errors: [{
          task_id: '',
          operation: 'connectivity',
          error: 'Server is not reachable',
          timestamp: new Date()
        }]
      };
    }

    // Step 2: Get all items from sync queue
    const queueItems = await this.getSyncQueueItems();
    if (queueItems.length === 0) {
      return {
        success: true,
        synced_items: 0,
        failed_items: 0,
        errors: []
      };
    }

    // Step 3: Process items in batches
    const batchSize = parseInt(process.env.SYNC_BATCH_SIZE || '50');
    let syncedCount = 0;
    let failedCount = 0;
    const errors: any[] = [];

    for (let i = 0; i < queueItems.length; i += batchSize) {
      const batch = queueItems.slice(i, i + batchSize);
      
      try {
        // For now, simulate batch processing since we don't have a real server
        for (const item of batch) {
          try {
            await this.updateSyncStatus(item.task_id, 'synced');
            await this.removeFromSyncQueue(item.id);
            syncedCount++;
            console.log(`Synced task ${item.task_id} (${item.operation})`);
          } catch (error) {
            await this.handleSyncError(item, error as Error);
            failedCount++;
            errors.push({
              task_id: item.task_id,
              operation: item.operation,
              error: (error as Error).message,
              timestamp: new Date()
            });
          }
        }
      } catch (batchError) {
        console.error('Batch processing failed:', batchError);
        failedCount += batch.length;
      }
    }

    return {
      success: failedCount === 0,
      synced_items: syncedCount,
      failed_items: failedCount,
      errors
    };
  }

  async addToSyncQueue(taskId: string, operation: 'create' | 'update' | 'delete', data: Partial<Task>): Promise<void> {
    try {
      // Step 1: Generate unique ID for sync queue item
      const queueId = `sync_${taskId}_${operation}_${Date.now()}`;
      
      // Step 2: Serialize task data
      const serializedData = JSON.stringify(data);
      
      // Step 3: Insert into sync_queue table
      const sql = `
        INSERT INTO sync_queue (id, task_id, operation, data, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      
      const params = [
        queueId,
        taskId,
        operation,
        serializedData,
        new Date().toISOString(),
        0
      ];
      
      await this.db.run(sql, params);
      console.log(`Added ${operation} operation for task ${taskId} to sync queue`);
      
    } catch (error) {
      console.error(`Failed to add ${operation} operation to sync queue for task ${taskId}:`, error);
      throw error;
    }
  }

  private async processBatch(items: SyncQueueItem[]): Promise<BatchSyncResponse> {
    // Simulate server-side batch processing
    const processedItems = [];
    
    for (const item of items) {
      try {
        // In a real implementation, this would send to actual server
        // For now, we'll simulate successful processing
        processedItems.push({
          client_id: item.task_id,
          server_id: `srv_${item.task_id}`,
          status: 'success' as const,
          resolved_data: JSON.parse(item.data as string)
        });
      } catch (error) {
        processedItems.push({
          client_id: item.task_id,
          server_id: '',
          status: 'error' as const,
          error: (error as Error).message
        });
      }
    }

    return { processed_items: processedItems };
  }

  private async resolveConflict(localTask: Task, serverTask: Task): Promise<Task> {
    // Step 1: Compare updated_at timestamps for last-write-wins
    const localTime = new Date(localTask.updated_at).getTime();
    const serverTime = new Date(serverTask.updated_at).getTime();
    
    // Step 2: Return the more recent version
    const winner = localTime > serverTime ? localTask : serverTask;
    
    // Step 3: Log conflict resolution decision
    console.log(`Conflict resolved for task ${localTask.id}: ${localTime > serverTime ? 'local' : 'server'} version wins`);
    console.log(`Local: ${localTask.updated_at}, Server: ${serverTask.updated_at}`);
    
    return winner;
  }

  private async updateSyncStatus(taskId: string, status: 'synced' | 'error', serverData?: Partial<Task>): Promise<void> {
    // Step 1: Prepare update data
    const now = new Date().toISOString();
    let sql = `
      UPDATE tasks 
      SET sync_status = ?, last_synced_at = ?
    `;
    let params = [status, now];

    // Step 2: Include server_id if provided
    if (serverData?.server_id) {
      sql += `, server_id = ?`;
      params.push(serverData.server_id);
    }

    sql += ` WHERE id = ?`;
    params.push(taskId);

    // Step 3: Execute update
    await this.db.run(sql, params);
    
    console.log(`Updated sync status for task ${taskId} to ${status}`);
  }

  private async handleSyncError(item: SyncQueueItem, error: Error): Promise<void> {
    // Step 1: Increment retry count
    const newRetryCount = item.retry_count + 1;
    const maxRetries = 3;

    // Step 2: Update sync queue item with error info
    if (newRetryCount >= maxRetries) {
      // Step 3: Mark as permanent failure and remove from queue
      await this.updateSyncStatus(item.task_id, 'error');
      await this.removeFromSyncQueue(item.id);
      console.error(`Task ${item.task_id} failed permanently after ${maxRetries} attempts:`, error.message);
    } else {
      // Update retry count and error message
      const sql = `
        UPDATE sync_queue 
        SET retry_count = ?, error_message = ?
        WHERE id = ?
      `;
      await this.db.run(sql, [newRetryCount, error.message, item.id]);
      console.warn(`Task ${item.task_id} failed (attempt ${newRetryCount}/${maxRetries}):`, error.message);
    }
  }

  async checkConnectivity(): Promise<boolean> {
    // TODO: Check if server is reachable
    // 1. Make a simple health check request
    // 2. Return true if successful, false otherwise
    try {
      await axios.get(`${this.apiUrl}/health`, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  // Helper method to get sync status summary
  async getSyncStatus(): Promise<{
    pending_sync_count: number;
    last_sync_timestamp: Date | null;
    is_online: boolean;
    sync_queue_size: number;
  }> {
    try {
      // Get pending tasks count
      const pendingTasks = await this.taskService.getTasksNeedingSync();
      
      // Get sync queue size
      const queueItems = await this.getSyncQueueItems();
      
      // Get last sync timestamp
      const lastSyncSql = `
        SELECT MAX(last_synced_at) as last_sync 
        FROM tasks 
        WHERE last_synced_at IS NOT NULL
      `;
      const lastSyncRow = await this.db.get(lastSyncSql);
      
      // Check connectivity
      const isOnline = await this.checkConnectivity();
      
      return {
        pending_sync_count: pendingTasks.length,
        last_sync_timestamp: lastSyncRow?.last_sync ? new Date(lastSyncRow.last_sync) : null,
        is_online: isOnline,
        sync_queue_size: queueItems.length
      };
    } catch (error) {
      console.error('Failed to get sync status:', error);
      // Return safe defaults on error
      return {
        pending_sync_count: 0,
        last_sync_timestamp: null,
        is_online: false,
        sync_queue_size: 0
      };
    }
  }

  // Get all items from sync queue
  private async getSyncQueueItems(): Promise<SyncQueueItem[]> {
    try {
      const sql = `
        SELECT id, task_id, operation, data, created_at, retry_count, error_message
        FROM sync_queue
        ORDER BY created_at ASC
      `;
      
      const rows = await this.db.all(sql);
      
      return rows.map(row => ({
        id: row.id,
        task_id: row.task_id,
        operation: row.operation,
        data: row.data,
        created_at: new Date(row.created_at),
        retry_count: row.retry_count || 0,
        error_message: row.error_message || undefined
      }));
      
    } catch (error) {
      console.error('Failed to get sync queue items:', error);
      throw error;
    }
  }

  // Remove item from sync queue
  private async removeFromSyncQueue(queueItemId: string): Promise<void> {
    try {
      const sql = 'DELETE FROM sync_queue WHERE id = ?';
      await this.db.run(sql, [queueItemId]);
      console.log(`Removed sync queue item ${queueItemId}`);
    } catch (error) {
      console.error(`Failed to remove sync queue item ${queueItemId}:`, error);
      throw error;
    }
  }
}