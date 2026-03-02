import React, { useEffect, useRef, useState } from 'react';
import type { ReactPortal } from 'react';
import { createPortal } from 'react-dom';
import { GoldenLayout, LayoutConfig, ComponentContainer } from 'golden-layout';
import 'golden-layout/dist/css/goldenlayout-base.css';
import 'golden-layout/dist/css/themes/goldenlayout-dark-theme.css';

interface GoldenLayoutWrapperProps {
  config: LayoutConfig;
  components: Record<string, React.FC<any>>;
  onLayoutReady?: (layout: GoldenLayout) => void;
}

interface ComponentRegistryItem {
  id: string;
  type: string;
  props: any;
  container: HTMLElement;
}

export const GoldenLayoutWrapper: React.FC<GoldenLayoutWrapperProps> = ({ config, components, onLayoutReady }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<GoldenLayout | null>(null);
  const [componentRegistry, setComponentRegistry] = useState<Map<string, ComponentRegistryItem>>(new Map());

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize Golden Layout with the exact signature required to avoid subWindow DOM wiping
    const layout = new GoldenLayout(
      containerRef.current,
      (container: ComponentContainer, itemConfig: any) => {
        const type = itemConfig.componentType as string;
        const props = itemConfig.componentState || {};
        const id = crypto.randomUUID();

        container.stateRequestEvent = () => props;

        setComponentRegistry(prev => {
          const next = new Map(prev);
          next.set(id, { id, type, props, container: container.element });
          return next;
        });

        return {
          virtual: true,
          component: {
            rootHtmlElement: container.element
          }
        };
      },
      (container: ComponentContainer) => {
        // Our registry relies on the ID we gave it, but since unbind only gives us the container,
        // we find the registry entry with the matching container.
        setComponentRegistry(prev => {
          const next = new Map(prev);
          for (const [key, val] of next.entries()) {
            if (val.container === container.element) {
              next.delete(key);
              break;
            }
          }
          return next;
        });
      }
    );
    layoutRef.current = layout;

    // Load layout
    if (!layout.isSubWindow) {
      layout.loadLayout(config);
    }

    if (onLayoutReady) {
      onLayoutReady(layout);
    }

    const handleResize = () => {
      if (layoutRef.current && containerRef.current) {
        layoutRef.current.updateRootSize();
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      layout.destroy();
    };
  }, [config, components, onLayoutReady]);

  // Render Portals for each tracked component
  const portals: ReactPortal[] = [];
  componentRegistry.forEach(({ id, type, props, container }) => {
    const Component = components[type];
    if (Component) {
      portals.push(createPortal(<Component {...props} key={id} />, container));
    }
  });

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {portals}
    </div>
  );
};
