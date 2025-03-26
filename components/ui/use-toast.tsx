/**
 * use-toast.tsx - Toast notification hook
 */
"use client";

import { useState, useCallback } from "react";
import { Toast, ToastProvider } from "@/components/ui/toast";

interface ToastOptions {
  id?: string;
  title?: string;
  description?: string;
  variant?: "default" | "destructive";
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastOptions[]>([]);

  const toast = useCallback(
    ({ title, description, variant = "default" }: Omit<ToastOptions, "id">) => {
      const id = Math.random().toString(36).substr(2, 9);
      setToasts(prev => [...prev, { id, title, description, variant }]);

      // Remove toast after 5 seconds
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 5000);
    },
    []
  );

  return {
    toast,
    toasts,
  };
}

interface ToastContainerProps {
  toasts: ToastOptions[];
}

export function ToastContainer({ toasts }: ToastContainerProps) {
  return (
    <ToastProvider>
      {toasts.map(toast => (
        <Toast key={toast.id} {...toast} />
      ))}
    </ToastProvider>
  );
}
