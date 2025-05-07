import React, { Component, ReactNode, ErrorInfo } from 'react';
import { ErrorDisplay } from './error-display';
import { clientLogger } from '../../../src/infrastructure/logging/clientLogger';
import { ErrorCategory } from '../../../src/infrastructure/errors/errorHandler';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  category?: ErrorCategory;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Error Boundary component that catches errors in its child component tree
 * Renders a fallback UI when an error occurs
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    // Update state so the next render will show the fallback UI
    return {
      hasError: true,
      error,
      errorInfo: null
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log the error
    clientLogger.error({
      message: `Error boundary caught error: ${error.message}`,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      category: this.props.category || ErrorCategory.UNKNOWN
    });

    // Set the error info in state
    this.setState({ errorInfo });

    // Call the error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  resetError = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
  };

  render(): ReactNode {
    const { hasError, error } = this.state;
    const { children, fallback } = this.props;

    if (hasError) {
      // If a custom fallback is provided, use it
      if (fallback) {
        return fallback;
      }

      // Otherwise, use the default error display
      return (
        <ErrorDisplay
          message="Something went wrong in this component"
          category={this.props.category || ErrorCategory.UNKNOWN}
          retry={this.resetError}
          details={error?.stack}
        />
      );
    }

    // When there's no error, render children normally
    return children;
  }
}

/**
 * Functional component wrapper for ErrorBoundary
 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  options: Omit<ErrorBoundaryProps, 'children'> = {}
): React.FC<P> {
  return function WithErrorBoundary(props: P) {
    return (
      <ErrorBoundary {...options}>
        <Component {...props} />
      </ErrorBoundary>
    );
  };
}