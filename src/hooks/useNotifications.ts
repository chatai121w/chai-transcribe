import { useState, useCallback } from 'react';

export interface AppNotification {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  description?: string;
  timestamp: Date;
  read: boolean;
}

const MAX_NOTIFICATIONS = 50;

let globalNotifications: AppNotification[] = [];
let listeners: Set<() => void> = new Set();

const notify = () => listeners.forEach(fn => fn());

export const addNotification = (n: Omit<AppNotification, 'id' | 'timestamp' | 'read'>) => {
  const entry: AppNotification = {
    ...n,
    id: crypto.randomUUID(),
    timestamp: new Date(),
    read: false,
  };
  globalNotifications = [entry, ...globalNotifications].slice(0, MAX_NOTIFICATIONS);
  notify();
  return entry;
};

export const useNotifications = () => {
  const [, forceUpdate] = useState(0);

  // Subscribe to global changes
  useState(() => {
    const listener = () => forceUpdate(n => n + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  });

  const markRead = useCallback((id: string) => {
    globalNotifications = globalNotifications.map(n => n.id === id ? { ...n, read: true } : n);
    notify();
  }, []);

  const markAllRead = useCallback(() => {
    globalNotifications = globalNotifications.map(n => ({ ...n, read: true }));
    notify();
  }, []);

  const clearAll = useCallback(() => {
    globalNotifications = [];
    notify();
  }, []);

  return {
    notifications: globalNotifications,
    unreadCount: globalNotifications.filter(n => !n.read).length,
    markRead,
    markAllRead,
    clearAll,
  };
};
