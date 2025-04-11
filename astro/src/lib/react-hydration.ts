/**
 * Helper functions for React hydration in Astro pages
 */
import React from 'react';
import * as ReactDOM from 'react-dom/client';

// Make React available globally
declare global {
  interface Window {
    React: typeof React;
    ReactDOM: typeof ReactDOM;
  }
}

/**
 * Initializes React in the global scope for hydration
 */
export function initReactHydration() {
  window.React = React;
  window.ReactDOM = ReactDOM;
}

/**
 * Create a React root and render a component in a container
 * This provides a more reliable way to hydrate React components
 */
export function hydrateReactComponent<P>(
  Component: React.ComponentType<P>,
  props: P,
  container: HTMLElement
) {
  // Make sure React is globally available
  initReactHydration();

  // Create a div to mount the component
  const root = document.createElement('div');
  container.appendChild(root);

  // Try to render the component using ReactDOM.createRoot
  try {
    const reactRoot = ReactDOM.createRoot(root);
    reactRoot.render(React.createElement(Component, props));
    return true;
  } catch (error) {
    console.error('Failed to hydrate React component:', error);
    return false;
  }
}