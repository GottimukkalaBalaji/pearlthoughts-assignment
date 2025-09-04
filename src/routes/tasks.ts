import { Router, Request, Response } from 'express';
import { TaskService } from '../services/taskService';
import { SyncService } from '../services/syncService';
import { Database } from '../db/database';

export function createTaskRouter(db: Database): Router {
  const router = Router();
  const taskService = new TaskService(db);
  const syncService = new SyncService(db, taskService);
  
  // Set up the sync service in task service for integration
  taskService.setSyncService(syncService);

  // Get all tasks
  router.get('/', async (req: Request, res: Response) => {
    try {
      const tasks = await taskService.getAllTasks();
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch tasks' });
    }
  });

  // Get single task
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const task = await taskService.getTask(req.params.id);
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }
      res.json(task);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch task' });
    }
  });

  // Create task
  router.post('/', async (req: Request, res: Response) => {
    try {
      console.log('POST /api/tasks - Request body:', JSON.stringify(req.body, null, 2));
      
      const { id, title, description } = req.body;
      
      // Validate required fields
      if (!id || typeof id !== 'string' || id.trim().length === 0) {
        console.error('Task creation failed: Invalid ID', { id, type: typeof id });
        return res.status(400).json({ error: 'ID is required and must be a non-empty string' });
      }
      
      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        console.error('Task creation failed: Invalid title', { title, type: typeof title });
        return res.status(400).json({ error: 'Title is required and must be a non-empty string' });
      }

      // Check if task with this ID already exists
      console.log(`Checking if task with ID ${id.trim()} already exists`);
      const existingTask = await taskService.getTask(id.trim());
      if (existingTask) {
        console.error(`Task creation failed: Task with ID ${id.trim()} already exists`);
        return res.status(409).json({ error: 'Task with this ID already exists' });
      }

      // Create task data object
      const taskData = {
        id: id.trim(),
        title: title.trim(),
        description: description ? description.trim() : undefined
      };

      console.log('Creating task with data:', JSON.stringify(taskData, null, 2));
      
      // Create the task
      const newTask = await taskService.createTask(taskData);
      console.log('Task created successfully:', JSON.stringify(newTask, null, 2));
      
      res.status(201).json(newTask);
    } catch (error) {
      console.error('POST /api/tasks - Error occurred:', error);
      console.error('Error details:', {
        message: (error as Error).message,
        stack: (error as Error).stack,
        requestBody: req.body
      });
      
      // Return more specific error information
      const errorMessage = (error as Error).message || 'Failed to create task';
      res.status(500).json({ 
        error: errorMessage,
        details: process.env.NODE_ENV === 'development' ? (error as Error).stack : undefined
      });
    }
  });

  // Update task
  router.put('/:id', async (req: Request, res: Response) => {
    try {
      // Step 1: Get task ID from URL parameters
      const taskId = req.params.id;
      
      // Step 2: Validate request body
      const { title, description, completed } = req.body;
      
      // Prepare updates object - only include fields that are provided
      const updates: any = {};
      
      // Validate title if provided
      if (title !== undefined) {
        if (typeof title !== 'string' || title.trim().length === 0) {
          return res.status(400).json({ 
            error: 'Title must be a non-empty string if provided' 
          });
        }
        updates.title = title.trim();
      }
      
      // Validate description if provided
      if (description !== undefined) {
        if (typeof description !== 'string') {
          return res.status(400).json({ 
            error: 'Description must be a string if provided' 
          });
        }
        updates.description = description.trim();
      }
      
      // Validate completed if provided
      if (completed !== undefined) {
        if (typeof completed !== 'boolean') {
          return res.status(400).json({ 
            error: 'Completed must be a boolean if provided' 
          });
        }
        updates.completed = completed;
      }

      // Check if at least one field is being updated
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ 
          error: 'At least one field (title, description, or completed) must be provided' 
        });
      }

      // Step 3: Update the task using TaskService
      const updatedTask = await taskService.updateTask(taskId, updates);
      
      // Step 4: Handle not found case
      if (!updatedTask) {
        return res.status(404).json({ error: 'Task not found' });
      }

      // Step 5: Return the updated task
      res.json(updatedTask);
      
    } catch (error) {
      console.error('Error updating task:', error);
      res.status(500).json({ error: 'Failed to update task' });
    }
  });

  // Delete task
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      // Step 1: Get task ID from URL parameters
      const taskId = req.params.id;
      
      // Step 2: Validate that ID is provided
      if (!taskId || taskId.trim().length === 0) {
        return res.status(400).json({ error: 'Task ID is required' });
      }

      // Step 3: Delete the task using TaskService (soft delete)
      const deleted = await taskService.deleteTask(taskId);
      
      // Step 4: Handle not found case
      if (!deleted) {
        return res.status(404).json({ error: 'Task not found' });
      }

      // Step 5: Return success response (204 No Content)
      res.status(204).send(); // No content for successful delete
      
    } catch (error) {
      console.error('Error deleting task:', error);
      res.status(500).json({ error: 'Failed to delete task' });
    }
  });

  return router;
}