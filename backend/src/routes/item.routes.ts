import { Router } from 'express';
import express from 'express';
import * as itemController from '../controllers/item.controller.js';

export const itemRouter = Router();

// List & create
itemRouter.get('/', itemController.getItems);
itemRouter.post('/', itemController.createItem);

// Reorder (specific route before parameterised /:id to avoid conflict)
itemRouter.patch('/reorder', itemController.reorderItems);

// Single item — specific action routes before generic /:id
itemRouter.patch('/:id/archive', itemController.archiveItem);
itemRouter.patch('/:id/restore', itemController.restoreItem);
// Raw binary upload for a FILES column — express.raw() reads the buffer; global express.json()
// skips non-JSON content types so the stream is still available here (same convention as the
// item chat's file upload route).
itemRouter.post('/:id/files', express.raw({ type: () => true, limit: '20mb' }), itemController.uploadItemFile);

itemRouter.get('/:id', itemController.getItemById);
itemRouter.patch('/:id', itemController.updateItem);
itemRouter.delete('/:id', itemController.deleteItem);
