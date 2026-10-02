import { useEffect, type ReactNode } from 'react';

export function Modal({ titulo, onCerrar, children, ancho }: { titulo: string; onCerrar: () => void; children: ReactNode; ancho?: number }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [onCerrar]);
  return (
    <div className="modal-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo} style={ancho ? { maxWidth: ancho } : undefined}>
        <div className="modal-cabeza">
          <h2>{titulo}</h2>
          <button className="btn-icono" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>
        <div className="modal-cuerpo">{children}</div>
      </div>
    </div>
  );
}

export function Campo({ etiqueta, children, ayuda }: { etiqueta: string; children: ReactNode; ayuda?: string }) {
  return (
    <label className="campo">
      <span>{etiqueta}</span>
      {children}
      {ayuda && <small>{ayuda}</small>}
    </label>
  );
}

export function Aviso({ tipo = 'error', children }: { tipo?: 'error' | 'ok' | 'info'; children: ReactNode }) {
  if (!children) return null;
  return <div className={`aviso aviso-${tipo}`}>{children}</div>;
}

export function Vacio({ children }: { children: ReactNode }) {
  return <div className="vacio">{children}</div>;
}

export function Cabecera({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="cabecera">
      <h1>{titulo}</h1>
      <div className="cabecera-acciones">{children}</div>
    </div>
  );
}

export function Cargando() {
  return <div className="cargando" aria-live="polite">Cargando…</div>;
}
