import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import * as wm from '@/services/workManagementService';
import type { CreateGroupData, UpdateGroupData, ReorderGroupItem, DuplicateGroupMode } from '@/services/workManagementService';

export const useGroups = (boardId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.groups.all(boardId),
    queryFn: () => wm.listGroups(boardId, false),
    enabled: enabled && !!boardId,
    staleTime: 2 * 60 * 1000,
  });

export const useGroup = (boardId: string, groupId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.groups.one(boardId, groupId),
    queryFn: () => wm.getGroup(boardId, groupId),
    enabled: enabled && !!boardId && !!groupId,
    staleTime: 2 * 60 * 1000,
  });

export const useSubitemGroup = (boardId: string, parentItemId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.groups.subitem(boardId, parentItemId),
    queryFn: () => wm.listGroups(boardId, false, parentItemId),
    enabled: enabled && !!boardId && !!parentItemId,
    staleTime: 2 * 60 * 1000,
    select: (groups) => groups[0] ?? null,
  });

export const useArchivedGroups = (boardId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.groups.archived(boardId),
    queryFn: async () => {
      const all = await wm.listGroups(boardId, true);
      return all.filter((g) => g.isArchived);
    },
    enabled: enabled && !!boardId,
    staleTime: 0,
  });

export const useCreateGroup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, data }: { boardId: string; data: CreateGroupData }) =>
      wm.createGroup(boardId, data),
    onSuccess: (_group, { boardId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.groups.all(boardId) });
    },
  });
};

export const useUpdateGroup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, groupId, patch }: { boardId: string; groupId: string; patch: UpdateGroupData }) =>
      wm.updateGroup(boardId, groupId, patch),
    onSuccess: (_group, { boardId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.groups.all(boardId) });
    },
  });
};

export const useDeleteGroup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, groupId }: { boardId: string; groupId: string }) =>
      wm.deleteGroup(boardId, groupId),
    onSuccess: (_data, { boardId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.groups.all(boardId) });
    },
  });
};

export const useArchiveGroup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, groupId }: { boardId: string; groupId: string }) =>
      wm.archiveGroup(boardId, groupId),
    onSuccess: (_data, { boardId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.groups.all(boardId) });
      void qc.invalidateQueries({ queryKey: queryKeys.groups.archived(boardId) });
    },
  });
};

export const useRestoreGroup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, groupId }: { boardId: string; groupId: string }) =>
      wm.restoreGroup(boardId, groupId),
    onSuccess: (_data, { boardId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.groups.all(boardId) });
      void qc.invalidateQueries({ queryKey: queryKeys.groups.archived(boardId) });
    },
  });
};

export const useDuplicateGroup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, groupId, mode }: { boardId: string; groupId: string; mode: DuplicateGroupMode }) =>
      wm.duplicateGroup(boardId, groupId, mode),
    onSuccess: (_group, { boardId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.groups.all(boardId) });
      void qc.invalidateQueries({ queryKey: ['items'] });
    },
  });
};

export const useAssignGroupUsers = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, groupId, columnId, userIds }: { boardId: string; groupId: string; columnId: string; userIds: string[] }) =>
      wm.assignGroupUsers(boardId, groupId, columnId, userIds),
    onSuccess: (_result, { boardId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.groups.all(boardId) });
      void qc.invalidateQueries({ queryKey: ['items'] });
    },
  });
};

export const useReorderGroups = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, order }: { boardId: string; order: ReorderGroupItem[] }) =>
      wm.reorderGroups(boardId, order),
    onSuccess: (_data, { boardId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.groups.all(boardId) });
    },
  });
};
