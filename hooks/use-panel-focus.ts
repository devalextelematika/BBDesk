import { useLayoutEffect, type RefObject } from "react";

export function usePanelFocus(panelRef: RefObject<HTMLElement | null>, open: boolean | string | null,
  openerRef: RefObject<HTMLElement | null>, externalFocusRef?: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    if (!open || !panelRef.current) return;
    const panel = panelRef.current;
    const opener = openerRef.current;
    const externalFocus = externalFocusRef?.current;
    if (!externalFocus) panel.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]')?.focus();
    return () => {
      const active = panel.ownerDocument.activeElement;
      if (panel.contains(active) || active === externalFocus || active === panel.ownerDocument.body) {
        if (opener?.isConnected && !opener.closest('[inert], [aria-hidden="true"]')) opener.focus();
      }
    };
  }, [open, panelRef, openerRef, externalFocusRef]);
}
