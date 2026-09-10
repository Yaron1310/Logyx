import { Router } from 'express';
import * as groupController from '../controllers/group.controller.js';
import * as webhookController from '../controllers/webhook.controller.js';

// Groups are always nested under boards: /boards/:boardId/groups/...
// This router is mounted at /boards in index.ts.
export const groupRouter = Router({ mergeParams: true });

// List & create
groupRouter.get('/', groupController.getGroups);
groupRouter.post('/', groupController.createGroup);

// Reorder (specific route before parameterised /:groupId to avoid conflict)
groupRouter.patch('/reorder', groupController.reorderGroups);

// Single group fetch (used to resolve a subitem's parent group, e.g. from Personal Hub)
groupRouter.get('/:groupId', groupController.getGroupById);

// Single group archive/restore/duplicate (before generic /:groupId)
groupRouter.patch('/:groupId/archive', groupController.archiveGroup);
groupRouter.patch('/:groupId/restore', groupController.restoreGroup);
groupRouter.post('/:groupId/duplicate', groupController.duplicateGroup);
groupRouter.post('/:groupId/assign-users', groupController.assignGroupUsers);

// Single group CRUD
groupRouter.patch('/:groupId', groupController.updateGroup);
groupRouter.delete('/:groupId', groupController.deleteGroup);

// Webhook management (one active webhook per group)
groupRouter.get('/:groupId/webhook', webhookController.getWebhook);
groupRouter.post('/:groupId/webhook', webhookController.createWebhook);
groupRouter.patch('/:groupId/webhook', webhookController.updateWebhook);
groupRouter.delete('/:groupId/webhook', webhookController.revokeWebhook);
