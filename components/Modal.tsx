'use client';

import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Leading icon in the header, typically matching the modal's accent color. */
  icon?: ReactNode;
  accentColor?: string;
  children: ReactNode;
}

/**
 * Accessible modal dialog.
 *
 * Replaces React Native's `Modal`: a fixed backdrop with a centered panel.
 * Adds three things the native primitive gave us for free — Escape-to-close,
 * body scroll locking, and backdrop click-to-dismiss.
 */
export function Modal({
  open,
  onClose,
  title,
  icon,
  accentColor = 'var(--sky)',
  children,
}: ModalProps) {
  // Escape to close, mirroring `onRequestClose` on Android's Modal.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  // Lock background scroll while the dialog is open.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="modalBackdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modalPanel">
        <div className="modalHeader">
          <div className="modalTitleRow" style={{ color: accentColor }}>
            {icon ?? null}
            <span className="modalTitle" style={{ color: 'var(--text)' }}>
              {title}
            </span>
          </div>
          <button type="button" className="modalClose" onClick={onClose} aria-label="Close">
            <X size={18} color="currentColor" />
          </button>
        </div>
        <div className="modalBody">{children}</div>
      </div>
    </div>
  );
}