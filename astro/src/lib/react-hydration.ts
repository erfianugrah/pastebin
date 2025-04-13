/**
 * Helper functions for React hydration in Astro pages
 */
import React from 'react';

// Makes TypeScript happy without having to import specific functions
declare global {
  interface Window {
    React: typeof React;
    // Define only what we need
    ReactDOM: {
      createRoot(container: Element | DocumentFragment): {
        render(element: React.ReactNode): void;
      };
      hydrateRoot(container: Element, initialChildren: React.ReactNode): unknown;
      // Add any other needed props
      [key: string]: any;
    };
  }
}

/**
 * Initializes React in the global scope for hydration
 */
export function initReactHydration() {
  window.React = React;
  
  // Set ReactDOM on the window using dynamic import
  // to avoid TypeScript issues
  if (!window.ReactDOM) {
    import('react-dom/client')
      .then(ReactDOMClient => {
        window.ReactDOM = ReactDOMClient as any;
      })
      .catch(error => {
        console.error('Failed to initialize React DOM:', error);
      });
  }
}

/**
 * Create a React root and render a component in a container
 * This provides a more reliable way to hydrate React components
 */
export function hydrateReactComponent<P extends object>(
  Component: React.ComponentType<P>,
  props: P,
  container: HTMLElement
): boolean {
  // Make sure React is globally available
  initReactHydration();

  // Create a div to mount the component
  const root = document.createElement('div');
  container.appendChild(root);

  // Try to render the component using ReactDOM.createRoot
  try {
    // Wait until ReactDOM is available
    if (window.ReactDOM && window.ReactDOM.createRoot) {
      const reactRoot = window.ReactDOM.createRoot(root);
      reactRoot.render(React.createElement(Component, props as any));
      return true;
    } else {
      console.warn('ReactDOM.createRoot not available yet');
      // Try again shortly
      setTimeout(() => {
        if (window.ReactDOM && window.ReactDOM.createRoot) {
          const reactRoot = window.ReactDOM.createRoot(root);
          reactRoot.render(React.createElement(Component, props as any));
        }
      }, 100);
      return false;
    }
  } catch (error) {
    console.error('Failed to hydrate React component:', error);
    return false;
  }
}