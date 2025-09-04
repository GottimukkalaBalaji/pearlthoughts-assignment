import { Router, Request, Response } from 'express';
import { SyncService } from '../services/syncService';
import { TaskService } from '../services/taskService';
import { Database } from '../db/database';

export function createSyncRouter(db: Database): Router {
  const router = Router();
  const taskService = new TaskService(db);
  const syncService = new SyncService(db, taskService);

  // Trigger manual sync
  router.post('/sync', async (req: Request, res: Response) => {
    try {
      // Step 1: Check connectivity first
      const isOnline = await syncService.checkConnectivity();
      if (!isOnline) {
        return res.status(503).json({ 
          error: 'Service unavailable - server is not reachable',
          success: false,
          synced_items: 0,
          failed_items: 0
        });
      }

      // Step 2: Call syncService.sync()
      const syncResult = await syncService.sync();

      // Step 3: Return sync result
      const statusCode = syncResult.success ? 200 : 207; // 207 = Multi-Status (partial success)
      res.status(statusCode).json(syncResult);
      
    } catch (error) {
      console.error('Sync failed:', error);
      res.status(500).json({ 
        error: 'Sync operation failed',
        success: false,
        synced_items: 0,
        failed_items: 0,
        errors: [{
          task_id: '',
          operation: 'sync',
          error: (error as Error).message,
          timestamp: new Date()
        }]
      });
    }
  });

  // Check sync status
  router.get('/status', async (req: Request, res: Response) => {
    try {
      // Step 1: Get sync status summary
      const status = await syncService.getSyncStatus();

      // Step 2: Return status summary
      res.json(status);
      
    } catch (error) {
      console.error('Failed to get sync status:', error);
      res.status(500).json({ 
        error: 'Failed to retrieve sync status',
        pending_sync_count: 0,
        last_sync_timestamp: null,
        is_online: false,
        sync_queue_size: 0
      });
    }
  });

  // Batch sync endpoint (for server-side)
  router.post('/batch', async (req: Request, res: Response) => {
    try {
      const { items } = req.body;
      
      // Validate request body
      if (!items || !Array.isArray(items)) {
        return res.status(400).json({ 
          error: 'Items array is required in request body',
          expected_format: {
            items: [
              {
                id: "string",
                task_id: "string", 
                operation: "create|update|delete",
                data: "object"
              }
            ]
          }
        });
      }
      
      if (items.length === 0) {
        return res.status(400).json({ 
          error: 'Items array cannot be empty' 
        });
      }
      
      // Validate each item structure
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item.id || !item.task_id || !item.operation || !item.data) {
          return res.status(400).json({
            error: `Invalid item at index ${i}: missing required fields (id, task_id, operation, data)`
          });
        }
        
        if (!['create', 'update', 'delete'].includes(item.operation)) {
          return res.status(400).json({
            error: `Invalid operation "${item.operation}" at index ${i}. Must be create, update, or delete`
          });
        }
      }
      
      console.log(`Processing batch sync with ${items.length} items`);
      
      // Process the batch (simulate server-side processing)
      const processedItems = [];
      
      for (const item of items) {
        try {
          // Simulate processing each item
          processedItems.push({
            client_id: item.task_id,
            server_id: `srv_${item.task_id}_${Date.now()}`,
            status: 'success',
            resolved_data: item.data
          });
        } catch (error) {
          processedItems.push({
            client_id: item.task_id,
            server_id: '',
            status: 'error',
            error: (error as Error).message
          });
        }
      }
      
      const response = {
        success: true,
        processed_items: processedItems,
        total_processed: processedItems.length,
        successful: processedItems.filter(item => item.status === 'success').length,
        failed: processedItems.filter(item => item.status === 'error').length
      };
      
      console.log(`Batch sync completed: ${response.successful} successful, ${response.failed} failed`);
      res.json(response);
      
    } catch (error) {
      console.error('Batch sync error:', error);
      res.status(500).json({ 
        error: 'Batch sync processing failed',
        details: (error as Error).message
      });
    }
  });

  // Health check endpoint
  router.get('/health', async (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date() });
  });

  return router;
}